from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import uuid

from app.core.database import get_db
from app.core.security import create_access_token, get_password_hash, verify_password
from app.core.auth import Principal, get_current_principal, require_staff, ensure_customer_access
from app.core.storage import storage_service
from app.models.domain import (
    Customer, CustomerPhoto, StyleRecommendation, StyleGeneration, StyleSelection,
    HaircutInstruction, CustomerVisit, ServiceHistory, Hairstyle, Coupon, LoyaltyAccount, Membership, Referral,
    User, Role, MembershipTransaction
)
from app.core.config import settings
import secrets
import re
from datetime import datetime
from app.schemas.domain_schemas import (
    CustomerResponse, CustomerCreate, PhotoUploadResponse, RecommendationRequest,
    RecommendationResponse, GenerationRequest, GenerationJobResponse, GenerationStatusItem,
    SelectionRequest, SelectionResponse, ServiceCompletionRequest, DashboardOverview,
    OfferRecommendationRequest, OfferRecommendationResponse, Token
)
from app.ai.face_analysis import face_analyzer, normalize_photo, MIN_FACE_WIDTH_PX
from PIL import UnidentifiedImageError
from app.ai.recommendation_engine import recommendation_engine
from app.ai.image_editing import hair_style_generator, ImageEditError
import asyncio
from app.ai.style_catalogue import ALL_STYLES, get_style
from app.analytics.rfm_segmentation import rfm_engine
from app.analytics.capacity_analytics import capacity_engine
from app.analytics.discount_optimizer import discount_engine
from app.campaigns.campaign_manager import campaign_loyalty_engine
from app.integrations.notifications import whatsapp_provider

router = APIRouter()

# -------------------------------------------------------------
# 1. Auth & Customer Lookup Flow
# -------------------------------------------------------------
@router.post("/auth/login", response_model=Token)
def login_user(username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    """Staff login (stylist / admin) with a username and password from the users table."""
    user = db.query(User).filter(User.username == username.strip().lower()).first()
    if not user or not user.is_active or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    role = db.query(Role).filter(Role.id == user.role_id).first()
    role_name = role.name if role else "Stylist"
    token = create_access_token({"sub": f"staff:{user.id}", "role": role_name, "name": user.full_name})
    return Token(access_token=token, role=role_name, user_id=user.id, full_name=user.full_name)


class CustomerLoginRequest(BaseModel):
    identifier: str          # mobile number or customer ID (CUST-xxxx)
    password: str


class CustomerRegisterRequest(BaseModel):
    full_name: str
    phone_number: str
    password: str
    gender: Optional[str] = None
    referral_code: Optional[str] = None


def _customer_session(db: Session, customer: Customer) -> dict:
    token = create_access_token({"sub": f"customer:{customer.id}", "role": "Customer", "name": customer.full_name})
    return {"access_token": token, "token_type": "bearer", "role": "Customer", **_customer_summary(db, customer)}


@router.post("/auth/customer/login")
def customer_login(payload: CustomerLoginRequest, db: Session = Depends(get_db)):
    """Customer login with mobile number (or customer ID) and password."""
    ident = payload.identifier.strip()
    if ident.upper().startswith("CUST-"):
        candidates = db.query(Customer).filter(Customer.customer_code == ident.upper()).all()
    else:
        digits = re.sub(r"\D", "", ident)
        digits = digits[-10:] if len(digits) > 10 else digits
        candidates = db.query(Customer).filter(Customer.phone_number == digits).all() if digits else []
    matches = [c for c in candidates if verify_password(payload.password, c.password_hash)]
    if not matches:
        raise HTTPException(status_code=401, detail="Incorrect mobile number / customer ID or password")
    if len(matches) > 1:
        raise HTTPException(status_code=409, detail="More than one profile uses this mobile number. "
                                                    "Please log in with your customer ID (e.g. CUST-1001).")
    return _customer_session(db, matches[0])


@router.post("/auth/customer/register")
def customer_register(payload: CustomerRegisterRequest, db: Session = Depends(get_db)):
    """New customer sign-up: creates the profile with a password and logs the customer in."""
    phone = re.sub(r"\D", "", payload.phone_number)
    phone = phone[-10:] if len(phone) > 10 else phone
    if len(phone) != 10:
        raise HTTPException(status_code=422, detail="Please enter a 10-digit mobile number.")
    if len(payload.password) < 6:
        raise HTTPException(status_code=422, detail="Password must be at least 6 characters.")
    if not payload.full_name.strip():
        raise HTTPException(status_code=422, detail="Please enter your name.")
    if db.query(Customer).filter(Customer.phone_number == phone).first():
        raise HTTPException(status_code=409, detail="This mobile number is already registered. Please log in.")
    customer = _create_customer(db, CustomerCreate(full_name=payload.full_name.strip(), phone_number=phone,
                                                    gender=payload.gender, referral_code=payload.referral_code),
                                password=payload.password)
    return _customer_session(db, customer)


@router.get("/auth/me")
def who_am_i(principal: Principal = Depends(get_current_principal)):
    return {"kind": principal.kind, "id": principal.id, "role": principal.role, "name": principal.name}

@router.get("/customers")
def get_customers_list(query: Optional[str] = None, db: Session = Depends(get_db), principal: Principal = Depends(require_staff)):
    """
    Staff customer directory (salon / stylist / admin). Phone numbers are never returned here; staff can still
    find a customer by typing their mobile number, and matches by phone are flagged as `matched_by_phone`.
    """
    db_query = db.query(Customer)
    phone_digits = ""
    if query:
        q = f"%{query.strip()}%"
        conditions = (Customer.full_name.ilike(q)) | (Customer.customer_code.ilike(q))
        # Phone search ignores spaces, dashes and a +91 / 0 prefix; needs at least 4 digits
        digits = re.sub(r"\D", "", query)
        if len(digits) >= 4:
            phone_digits = digits[-10:] if len(digits) > 10 else digits
            conditions = conditions | Customer.phone_number.contains(phone_digits)
        db_query = db_query.filter(conditions)
    
    customers = db_query.order_by(Customer.id.desc()).all()
    results = []
    for c in customers:
        photo = db.query(CustomerPhoto).filter(CustomerPhoto.customer_id == c.id).order_by(CustomerPhoto.id.desc()).first()
        last_selection = db.query(StyleSelection).filter(StyleSelection.customer_id == c.id).order_by(StyleSelection.id.desc()).first()
        avatar_url = c.avatar_url
        if photo and photo.original_image_url:
            avatar_url = photo.original_image_url
        elif last_selection and last_selection.reference_image_url:
            avatar_url = last_selection.reference_image_url
            
        hairstyle_name = None
        if last_selection and last_selection.selected_hairstyle_id:
            h = get_style(last_selection.selected_hairstyle_id)
            if h:
                hairstyle_name = h["name"]
                
        results.append({
            "id": c.id,
            "customer_code": c.customer_code,
            "full_name": c.full_name,
            "matched_by_phone": bool(phone_digits) and phone_digits in (c.phone_number or ""),
            "gender": c.gender or "Female",
            "segment_name": c.segment_name or "Regular Customer",
            "total_visits": c.total_visits,
            "total_spent": c.total_spent,
            "avatar_url": avatar_url,
            "previous_style": {
                "reference_image_url": last_selection.reference_image_url if last_selection else None,
                "hairstyle_id": last_selection.selected_hairstyle_id if last_selection else None,
                "hairstyle_name": hairstyle_name or "Previous Hairstyle"
            } if last_selection else None
        })
    return results

def _last_preferences(db: Session, customer: Customer) -> Optional[dict]:
    """A returning customer's last choices (collection, services, category, chosen hairstyle), or None."""
    last_rec = db.query(StyleRecommendation).filter(
        StyleRecommendation.customer_id == customer.id).order_by(StyleRecommendation.id.desc()).first()
    last_selection = db.query(StyleSelection).filter(
        StyleSelection.customer_id == customer.id).order_by(StyleSelection.id.desc()).first()
    collection = {"male": "Men", "female": "Women"}.get((customer.gender or "").lower())
    if not (last_rec or last_selection or collection):
        return None
    return {
        "gender": collection,
        "target_services": [s.strip() for s in last_rec.target_service_type.split(",") if s.strip()] if last_rec else [],
        "style_category": last_rec.style_category if last_rec else None,
        "hairstyle_id": last_selection.selected_hairstyle_id if last_selection else None,
    }


@router.get("/customers/{customer_id}/last-preferences")
def get_last_preferences(customer_id: int, db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    ensure_customer_access(principal, customer_id)
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"customer_id": customer.id, "last_preferences": _last_preferences(db, customer)}


@router.get("/customers/{customer_id}/summary")
def get_customer_summary(customer_id: int, db: Session = Depends(get_db),
                         principal: Principal = Depends(get_current_principal)):
    """Latest returning-customer details (incl. the most recently chosen style) for the welcome screen."""
    ensure_customer_access(principal, customer_id)
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return _customer_summary(db, customer)


@router.get("/customers/{customer_id}/profile")
def get_customer_profile(customer_id: int, db: Session = Depends(get_db),
                         principal: Principal = Depends(get_current_principal)):
    """The customer's own profile card: ID, segment, visits, spend, loyalty points and active membership."""
    ensure_customer_access(principal, customer_id)
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    loyalty = db.query(LoyaltyAccount).filter(LoyaltyAccount.customer_id == customer_id).first()
    membership = None
    tx = (db.query(MembershipTransaction)
          .filter(MembershipTransaction.customer_id == customer_id, MembershipTransaction.status == "ACTIVE")
          .order_by(MembershipTransaction.end_date.desc()).first())
    if tx and (tx.end_date is None or tx.end_date >= datetime.utcnow()):
        plan = db.query(Membership).filter(Membership.id == tx.membership_id).first()
        membership = {
            "name": plan.name if plan else "Member",
            "valid_until": tx.end_date.date().isoformat() if tx.end_date else None,
            "discount_percentage": plan.discount_percentage if plan else None,
        }
    return {
        "id": customer.id,
        "customer_code": customer.customer_code,
        "full_name": customer.full_name,
        "gender": customer.gender,
        "segment_name": customer.segment_name,
        "total_visits": customer.total_visits or 0,
        "total_spent": customer.total_spent or 0.0,
        "last_visit_date": customer.last_visit_date.date().isoformat() if customer.last_visit_date else None,
        "member_since": customer.created_at.date().isoformat() if customer.created_at else None,
        "loyalty_points": loyalty.points_balance if loyalty else 0,
        "membership": membership,
    }


@router.get("/customers/lookup/{phone_number}")
def lookup_customer(phone_number: str, db: Session = Depends(get_db), principal: Principal = Depends(require_staff)):
    customer = db.query(Customer).filter(Customer.phone_number == phone_number).first()
    if not customer:
        return {"found": False, "message": "New customer"}
    return _customer_summary(db, customer)


def _customer_summary(db: Session, customer: Customer) -> dict:
    """Profile, previous style and last choices for the returning-customer screen."""
    # Retrieve last visit & style selection history for returning customer flow
    last_selection = db.query(StyleSelection).filter(StyleSelection.customer_id == customer.id).order_by(StyleSelection.id.desc()).first()
    hairstyle_name = None
    if last_selection and last_selection.selected_hairstyle_id:
        h = get_style(last_selection.selected_hairstyle_id)
        if h:
            hairstyle_name = h["name"]

    last_preferences = _last_preferences(db, customer)

    return {
        "found": True,
        "customer": {
            "id": customer.id,
            "customer_code": customer.customer_code,
            "full_name": customer.full_name,
            "phone_number": customer.phone_number,
            "gender": customer.gender,
            "segment_name": customer.segment_name,
            "total_visits": customer.total_visits,
            "total_spent": customer.total_spent,
            "last_visit_date": customer.last_visit_date.isoformat() if customer.last_visit_date else None,
            "previous_style": {
                "reference_image_url": last_selection.reference_image_url if last_selection else None,
                "hairstyle_id": last_selection.selected_hairstyle_id if last_selection else None,
                "hairstyle_name": hairstyle_name or "Previous Hairstyle"
            },
            "last_preferences": last_preferences
        }
    }


@router.post("/customers", response_model=CustomerResponse)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db), principal: Principal = Depends(require_staff)):
    """Staff add a walk-in customer (they get the sample password and can change it later)."""
    existing = db.query(Customer).filter(Customer.phone_number == payload.phone_number).first()
    if existing:
        return existing
    from app.core.auth import SAMPLE_CUSTOMER_PASSWORD
    return _create_customer(db, payload, password=SAMPLE_CUSTOMER_PASSWORD)


def _create_customer(db: Session, payload: CustomerCreate, password: str) -> Customer:
    code = f"CUST-{uuid.uuid4().hex[:6].upper()}"
    referrer_link = None
    if payload.referral_code:
        referrer_link = db.query(Referral).filter(
            Referral.referral_code == payload.referral_code.strip().upper(), Referral.status == "SHARE_LINK").first()
    new_cust = Customer(
        customer_code=code,
        full_name=payload.full_name,
        phone_number=payload.phone_number,
        email=payload.email,
        gender=payload.gender,
        segment_name="Regular Customer",
        password_hash=get_password_hash(password),
    )
    db.add(new_cust)
    db.commit()
    db.refresh(new_cust)

    # Track who referred this new customer (one row per conversion; the share-link row stays reusable)
    if referrer_link and referrer_link.referrer_customer_id != new_cust.id:
        db.add(Referral(
            referral_code=f"{referrer_link.referral_code}-{new_cust.id}",
            referrer_customer_id=referrer_link.referrer_customer_id,
            referred_customer_id=new_cust.id,
            status="REGISTERED",
        ))
        db.commit()
    return new_cust


# -------------------------------------------------------------
# 1b. Shareable referral link (WhatsApp / SMS)
# -------------------------------------------------------------
class ShareLinkRequest(BaseModel):
    customer_id: int


@router.post("/referrals/share-link")
def get_share_link(payload: ShareLinkRequest, db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    """
    Returns the customer's personal share code, creating it once. Codes are random (not the customer ID)
    so nobody can guess other customers' links and see their hairstyle photos.
    """
    ensure_customer_access(principal, payload.customer_id)
    customer = db.query(Customer).filter(Customer.id == payload.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    link = db.query(Referral).filter(
        Referral.referrer_customer_id == customer.id, Referral.status == "SHARE_LINK").first()
    if not link:
        link = Referral(referral_code=f"LUXE-{secrets.token_hex(4).upper()}",
                        referrer_customer_id=customer.id, status="SHARE_LINK")
        db.add(link)
        db.commit()
        db.refresh(link)
    return {
        "referral_code": link.referral_code,
        "share_path": f"/r/{link.referral_code}",
        "discount_percent": settings.REFERRAL_DISCOUNT_PERCENT,
        "salon_name": settings.SALON_NAME,
    }


@router.get("/referrals/{referral_code}/public")
def get_shared_referral(referral_code: str, db: Session = Depends(get_db)):
    """Public data for a shared link page: first name only, latest hairstyle reference, and the offer."""
    link = db.query(Referral).filter(
        Referral.referral_code == referral_code.strip().upper(), Referral.status == "SHARE_LINK").first()
    if not link:
        raise HTTPException(status_code=404, detail="This link is invalid or has expired.")
    customer = db.query(Customer).filter(Customer.id == link.referrer_customer_id).first()
    selection = db.query(StyleSelection).filter(
        StyleSelection.customer_id == link.referrer_customer_id).order_by(StyleSelection.id.desc()).first()
    style = get_style(selection.selected_hairstyle_id) if selection else None
    return {
        "referral_code": link.referral_code,
        "salon_name": settings.SALON_NAME,
        "referrer_first_name": (customer.full_name or "Your friend").split()[0] if customer else "Your friend",
        "hairstyle_name": style["name"] if style else None,
        "reference_image_url": selection.reference_image_url if selection and selection.reference_image_url else None,
        "discount_percent": settings.REFERRAL_DISCOUNT_PERCENT,
    }

# -------------------------------------------------------------
# 2. Photo Upload & Computer Vision Analysis
# -------------------------------------------------------------
@router.post("/customers/{customer_id}/photo", response_model=PhotoUploadResponse)
async def upload_customer_photo(
    customer_id: int,
    principal: Principal = Depends(get_current_principal),
    file: UploadFile = File(...),
    back_file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    ensure_customer_access(principal, customer_id)
    # Store every photo as a standard JPEG (phones may send HEIC/AVIF that browsers cannot display)
    try:
        contents = normalize_photo(await file.read())
        back_contents = normalize_photo(await back_file.read()) if back_file else None
    except UnidentifiedImageError:
        raise HTTPException(status_code=422, detail="This photo could not be opened. Please upload a JPG, PNG or HEIC photo.")

    # Computer Vision Analysis on Front (face landmarks, hair segmentation) and optional Back photo (hair texture)
    analysis = face_analyzer.analyze_dual_photos(contents, back_contents)
    quality = analysis.get("quality_check", {})
    if not quality.get("face_detected"):
        raise HTTPException(status_code=422, detail=quality.get("message") or "Please make sure your face is clearly visible.")
    if (quality.get("face_width_px") or 0) < MIN_FACE_WIDTH_PX:
        raise HTTPException(status_code=422, detail=quality.get("message"))

    file_id, image_url = storage_service.save_bytes(contents, folder="original", filename_prefix=f"cust_{customer_id}_front")

    if back_contents:
        storage_service.save_bytes(back_contents, folder="original", filename_prefix=f"cust_{customer_id}_back")

    photo_record = CustomerPhoto(
        customer_id=customer_id,
        original_image_url=image_url,
        face_shape=analysis["face_shape"],
        hair_length=analysis["hair_length"],
        hair_density=analysis["hair_density"],
        beard_style_current=analysis["beard_style_current"],
        facial_features_json=analysis
    )
    db.add(photo_record)
    db.commit()
    db.refresh(photo_record)

    return PhotoUploadResponse(
        photo_id=photo_record.id,
        original_image_url=image_url,
        face_shape=analysis["face_shape"],
        hair_length=analysis["hair_length"],
        hair_density=analysis["hair_density"],
        beard_style_current=analysis["beard_style_current"],
        facial_features=analysis
    )


# -------------------------------------------------------------
# 3. Controlled Hairstyle Recommendations
# -------------------------------------------------------------
@router.post("/style-recommendations", response_model=RecommendationResponse)
def get_style_recommendations(payload: RecommendationRequest, db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    ensure_customer_access(principal, payload.customer_id)
    photo = db.query(CustomerPhoto).filter(CustomerPhoto.id == payload.photo_id).first()
    if photo and photo.customer_id != payload.customer_id:
        raise HTTPException(status_code=403, detail="This photo belongs to a different customer.")
    customer = db.query(Customer).filter(Customer.id == payload.customer_id).first()
    
    face_shape = photo.face_shape if photo else "Oval"
    hair_length = photo.hair_length if photo else "Medium"
    hair_density = photo.hair_density if photo else "Medium"
    gender = payload.gender or (customer.gender if customer and customer.gender else "Women")
    # Remember the collection the customer chose (Men/Women) for their next visit
    chosen_gender = {"men": "Male", "male": "Male", "women": "Female", "female": "Female"}.get((payload.gender or "").lower())
    if customer and chosen_gender and customer.gender != chosen_gender:
        customer.gender = chosen_gender
        db.commit()

    top_styles = recommendation_engine.recommend(
        face_shape=face_shape,
        hair_length=hair_length,
        hair_density=hair_density,
        hair_type=(photo.facial_features_json or {}).get("hair_type") if photo else None,
        gender=gender,
        target_service_type=payload.target_service_type,
        style_category=payload.style_category,
        beard_style=photo.beard_style_current if photo else None
    )

    style_ids = [s["id"] for s in top_styles]
    rec_record = StyleRecommendation(
        customer_id=payload.customer_id,
        photo_id=payload.photo_id,
        target_service_type=payload.target_service_type,
        style_category=payload.style_category,
        recommended_style_ids_json=style_ids
    )
    db.add(rec_record)
    db.commit()
    db.refresh(rec_record)

    formatted_styles = [
        {
            "style_id": s["id"],
            "style_code": s["style_code"],
            "name": s["name"],
            "category": s["category"],
            "face_shapes": s.get("face_shapes", []),
            "hair_types": s.get("hair_types", []),
            "hair_length": s.get("hair_length"),
            "hair_density": s.get("hair_density"),
            "maintenance_level": s.get("maintenance_level"),
            "description": s["description"],
            "stylist_instructions": s["stylist_instructions"],
            "preview_image_url": s.get("preview_image_url"),
            "service": s.get("service", "Hair"),
            "feasibility_status": s.get("feasibility_status"),
            "feasibility_warning": s.get("feasibility_warning"),
            "chemical_addon": s.get("chemical_addon"),
            "expert_analysis": s.get("expert_analysis"),
        } for s in top_styles
    ]

    return RecommendationResponse(
        recommendation_id=rec_record.id,
        target_service_type=payload.target_service_type,
        style_category=payload.style_category,
        recommended_styles=formatted_styles
    )

# -------------------------------------------------------------
# 4. Asynchronous AI Generation Job Orchestration
# -------------------------------------------------------------
@router.post("/style-generations", response_model=GenerationJobResponse)
async def generate_personalized_images(payload: GenerationRequest, db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    job_id = f"JOB-{uuid.uuid4().hex[:8].upper()}"

    print(f"\n\033[95m\033[1m========================================================================\033[0m", flush=True)
    print(f"\033[95m\033[1m🚀 [STYLE-GENERATION BATCH STARTED] Job ID: {job_id} | Rec ID: {payload.recommendation_id}\033[0m", flush=True)
    print(f"\033[95m\033[1mSelected Style IDs ({len(payload.selected_style_ids)}): {payload.selected_style_ids}\033[0m", flush=True)
    print(f"\033[95m\033[1mActive Provider: {settings.IMAGE_EDIT_PROVIDER.upper()}\033[0m", flush=True)
    print(f"\033[95m\033[1m========================================================================\033[0m\n", flush=True)

    rec = db.query(StyleRecommendation).filter(StyleRecommendation.id == payload.recommendation_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    ensure_customer_access(principal, rec.customer_id)
    photo = db.query(CustomerPhoto).filter(CustomerPhoto.id == rec.photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Customer photo not found for this recommendation")

    analysis = dict(photo.facial_features_json or {})
    analysis.setdefault("face_shape", photo.face_shape)
    analysis.setdefault("hair_length", photo.hair_length)
    analysis.setdefault("hair_density", photo.hair_density)

    # Unknown ids are an error: never fall back to a different style (that would preview the wrong look)
    style_metas = [get_style(style_id) for style_id in payload.selected_style_ids]
    unknown = [sid for sid, meta in zip(payload.selected_style_ids, style_metas) if meta is None]
    if unknown:
        raise HTTPException(status_code=404, detail=f"Unknown style id(s): {unknown}")
    results = await asyncio.gather(
        *(hair_style_generator.generate(photo.original_image_url, meta, analysis, tier="fast") for meta in style_metas),
        return_exceptions=True,
    )

    generations = []
    completed_count = 0
    failed_count = 0

    for style_id, meta, res in zip(payload.selected_style_ids, style_metas, results):
        if isinstance(res, ImageEditError):
            failed_count += 1
            record = StyleGeneration(
                generated_image_url="", prompt_used="", status="FAILED", model_used=res.model,
                identity_score=res.identity_score, hair_consistency_score=res.hair_consistency_score,
                generation_attempt=res.attempts, failure_reason=res.reason[:500])
        elif isinstance(res, Exception):
            failed_count += 1
            record = StyleGeneration(generated_image_url="", prompt_used="", status="FAILED",
                                     failure_reason=f"Unexpected error: {res}"[:500])
        else:
            completed_count += 1
            record = StyleGeneration(
                generated_image_url=res.image_url, prompt_used=res.prompt, status="COMPLETED",
                model_used=res.model, identity_score=res.identity_score,
                hair_consistency_score=res.hair_consistency_score, generation_attempt=res.attempts)
        record.job_id = job_id
        record.recommendation_id = payload.recommendation_id
        record.style_id = style_id
        record.progress_percentage = 100
        db.add(record)
        generations.append(GenerationStatusItem(
            style_id=style_id,
            style_name=meta["name"],
            generated_image_url=record.generated_image_url,
            status=record.status,
            progress=100,
            error=record.failure_reason,
            model_used=record.model_used,
            identity_score=record.identity_score,
            hair_consistency_score=record.hair_consistency_score,
            generation_time=None if isinstance(res, Exception) else res.generation_time
        ))

    db.commit()

    print(f"\n\033[92m\033[1m========================================================================\033[0m", flush=True)
    print(f"\033[92m\033[1m✅ [STYLE-GENERATION BATCH COMPLETED] Completed: {completed_count}/{len(generations)} | Failed: {failed_count}\033[0m", flush=True)
    print(f"\033[92m\033[1m========================================================================\033[0m\n", flush=True)

    return GenerationJobResponse(
        job_id=job_id,
        total_styles=len(generations),
        completed_count=completed_count,
        generations=generations
    )

@router.post("/style-generations/high-fidelity")
async def generate_high_fidelity_selection(
    recommendation_id: int,
    style_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal)
):
    """
    Regenerates the chosen style with the high-quality model and saves it as the customer's reference image.
    """
    rec = db.query(StyleRecommendation).filter(StyleRecommendation.id == recommendation_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    ensure_customer_access(principal, rec.customer_id)

    photo = db.query(CustomerPhoto).filter(CustomerPhoto.id == rec.photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Customer photo not found for this recommendation")

    style_meta = get_style(style_id)
    if not style_meta:
        raise HTTPException(status_code=404, detail=f"Unknown style id: {style_id}")
    analysis = dict(photo.facial_features_json or {})
    analysis.setdefault("face_shape", photo.face_shape)
    analysis.setdefault("hair_length", photo.hair_length)

    try:
        res = await hair_style_generator.generate(photo.original_image_url, style_meta, analysis, tier="hq")
    except ImageEditError as e:
        raise HTTPException(status_code=502, detail=f"Preview generation failed: {e.reason}")

    if photo.customer_id:
        db.add(StyleSelection(
            customer_id=photo.customer_id,
            selected_hairstyle_id=style_id,
            reference_image_url=res.image_url,
            stylist_approved=True,
            status="CONFIRMED"
        ))
        db.commit()

    return {
        "status": "COMPLETED",
        "style_id": style_id,
        "style_name": style_meta["name"],
        "generated_image_url": res.image_url,
        "identity_score": res.identity_score,
        "hair_consistency_score": res.hair_consistency_score,
        "model_used": res.model
    }

@router.get("/style-generations/status/{job_id}", response_model=GenerationJobResponse)
def get_generation_job_status(job_id: str, db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    """
    Polling fallback endpoint for retrieving generation state if WebSocket/SSE connection drops.
    """
    records = db.query(StyleGeneration).filter(StyleGeneration.job_id == job_id).all()
    if not records:
        raise HTTPException(status_code=404, detail=f"Generation job {job_id} not found")
    job_rec = db.query(StyleRecommendation).filter(StyleRecommendation.id == records[0].recommendation_id).first()
    ensure_customer_access(principal, job_rec.customer_id if job_rec else None)

    items = []
    for r in records:
        style_meta = get_style(r.style_id) or {"name": f"Style #{r.style_id}"}
        items.append(GenerationStatusItem(
            style_id=r.style_id,
            style_name=style_meta["name"],
            generated_image_url=r.generated_image_url,
            status=r.status,
            progress=r.progress_percentage,
            error=r.failure_reason,
            model_used=r.model_used,
            identity_score=r.identity_score,
            hair_consistency_score=r.hair_consistency_score
        ))

    return GenerationJobResponse(
        job_id=job_id,
        total_styles=len(records),
        completed_count=len([r for r in records if r.status == "COMPLETED"]),
        generations=items
    )


# -------------------------------------------------------------
# 5. Customer Selection & Haircut Instructions
# -------------------------------------------------------------
@router.post("/style-selections", response_model=SelectionResponse)
def select_style_and_get_instructions(payload: SelectionRequest, db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    ensure_customer_access(principal, payload.customer_id)
    hairstyle = get_style(payload.hairstyle_id)
    if not hairstyle:
        raise HTTPException(status_code=404, detail=f"Unknown style id: {payload.hairstyle_id}")
    selection = StyleSelection(
        customer_id=payload.customer_id,
        selected_hairstyle_id=payload.hairstyle_id,
        selected_beardstyle_id=payload.beard_style_id,
        reference_image_url=payload.reference_image_url,
        status="CONFIRMED"
    )
    db.add(selection)
    db.commit()
    db.refresh(selection)

    raw_instructions = hairstyle["stylist_instructions"].split("\n")
    instructions_list = [inst.strip() for inst in raw_instructions if inst.strip()]

    instruction_record = HaircutInstruction(
        selection_id=selection.id,
        steps_json={"steps": instructions_list},
        audio_instruction_url=f"/api/v1/instructions/audio/{selection.id}"
    )
    db.add(instruction_record)
    db.commit()

    return SelectionResponse(
        selection_id=selection.id,
        customer_id=payload.customer_id,
        selected_hairstyle_name=hairstyle["name"],
        reference_image_url=payload.reference_image_url,
        haircut_instructions=instructions_list,
        audio_instruction_url=f"/api/v1/instructions/audio/{selection.id}"
    )

@router.get("/customer-history/{customer_id}")
def get_customer_history(customer_id: int, db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    ensure_customer_access(principal, customer_id)
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    selections = db.query(StyleSelection).filter(StyleSelection.customer_id == customer_id).order_by(StyleSelection.id.desc()).all()
    visits = db.query(CustomerVisit).filter(CustomerVisit.customer_id == customer_id).all()

    return {
        "customer_id": customer_id,
        "full_name": customer.full_name if customer else "Customer",
        "phone_number": customer.phone_number if customer else "",
        "total_visits": customer.total_visits if customer else 0,
        "total_spent": customer.total_spent if customer else 0.0,
        "selections": [
            {
                "selection_id": sel.id,
                "date": sel.created_at.strftime("%Y-%m-%d"),
                "reference_image_url": sel.reference_image_url
            } for sel in selections
        ],
        "visits": [
            {
                "visit_id": v.id,
                "date": v.visit_date.strftime("%Y-%m-%d"),
                "amount": v.total_amount,
                "status": v.status
            } for v in visits
        ]
    }

# -------------------------------------------------------------
# 6. Service Completion & Confirmation
# -------------------------------------------------------------
@router.post("/service-completion")
def complete_service_confirmation(payload: ServiceCompletionRequest, db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    visit = db.query(CustomerVisit).filter(CustomerVisit.id == payload.visit_id).first()
    if visit:
        visit.status = "COMPLETED"
        db.commit()
    return {"status": "SUCCESS", "message": "Service successfully completed and confirmed!"}

# -------------------------------------------------------------
# 7. Admin Analytics & Capacity Endpoints
# -------------------------------------------------------------
@router.get("/analytics/overview", response_model=DashboardOverview)
def get_dashboard_overview(db: Session = Depends(get_db), principal: Principal = Depends(require_staff)):
    total_cust = db.query(Customer).count() or 148
    return DashboardOverview(
        total_customers=total_cust,
        total_revenue=284500.0,
        total_visits=420,
        avg_spending=677.38,
        capacity_utilization_pct=68.5,
        active_campaigns_count=4
    )

@router.get("/analytics/capacity")
def get_capacity_analytics(principal: Principal = Depends(require_staff)):
    return {
        "heatmap": capacity_engine.get_traffic_heatmap(),
        "peak_hours": ["4:00 PM - 5:00 PM", "5:00 PM - 6:00 PM", "6:00 PM - 7:00 PM"],
        "lean_hours": ["11:00 AM - 12:00 PM", "12:00 PM - 1:00 PM", "1:00 PM - 2:00 PM"],
        "avg_chair_utilization_pct": 68.5
    }

@router.post("/analytics/recommend-offer", response_model=OfferRecommendationResponse)
def get_offer_recommendation(payload: OfferRecommendationRequest, db: Session = Depends(get_db), principal: Principal = Depends(require_staff)):
    customer = db.query(Customer).filter(Customer.id == payload.customer_id).first()
    segment = customer.segment_name if customer else "Rare / At-Risk Customer"

    offer = discount_engine.calculate_discount(
        service_price=600.0,
        min_discount_pct=10.0,
        max_discount_pct=40.0,
        min_margin_pct=30.0,
        capacity_utilization_pct=28.0,
        customer_segment=segment
    )

    coupon = campaign_loyalty_engine.generate_personalized_coupon(
        customer_id=payload.customer_id,
        service_id=payload.service_id,
        discount_pct=offer["calculated_discount_pct"]
    )

    return OfferRecommendationResponse(
        service_name="Hair Cut & Styling",
        customer_segment=segment,
        capacity_level=offer["capacity_state"],
        calculated_discount_pct=offer["calculated_discount_pct"],
        final_price=offer["final_price"],
        coupon_code=coupon["coupon_code"],
        valid_until_days=5,
        explanation=offer["explanation"]
    )

@router.get("/hairstyles")
def list_hairstyles():
    return ALL_STYLES
