from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form, status
from sqlalchemy import func, update
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import timedelta
import os
import uuid

from app.core.database import get_db
from app.core.security import (
    create_access_token, get_password_hash, media_path, password_needs_rehash, verify_password,
)
from app.core.auth import (
    Principal, get_current_principal, require_admin, require_staff, ensure_customer_access,
    check_login_allowed, clear_login_failures, record_login_failure,
)
from app.core.storage import storage_service
from app.models.domain import (
    Customer, CustomerPhoto, StyleRecommendation, StyleGeneration, StyleSelection,
    HaircutInstruction, CustomerVisit, ServiceHistory, Hairstyle, Coupon, LoyaltyAccount, Membership, Referral,
    User, Role, MembershipTransaction, ServicePhoto, Branch, Service, Stylist, SavedStyle, CustomerConsent
)
from fastapi.responses import FileResponse
from app.ai import instruction_audio
from app.core.reference_data import service_for_style
from app.core import privacy
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
from app.ai.recommendation_engine import is_bald, parse_services, recommendation_engine
from app.ai.eligibility import compute_eligible_services
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
def login_user(request: Request, username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    """Staff login (stylist / admin) with a username and password from the users table."""
    username = username.strip().lower()
    keys = (f"staff:{username}", _client_key(request))
    check_login_allowed(*keys)
    user = db.query(User).filter(User.username == username).first()
    if not user or not user.is_active or not verify_password(password, user.hashed_password):
        record_login_failure(*keys)
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    clear_login_failures(keys[0])
    if password_needs_rehash(user.hashed_password):
        user.hashed_password = get_password_hash(password)
        db.commit()
    role = db.query(Role).filter(Role.id == user.role_id).first()
    role_name = role.name if role else "Stylist"
    token = create_access_token({"sub": f"staff:{user.id}", "role": role_name, "name": user.full_name},
                                timedelta(minutes=settings.STAFF_TOKEN_EXPIRE_MINUTES))
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
    branch_id: Optional[int] = None   # branch of the tablet the customer registered on


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


INDIAN_MOBILE = re.compile(r"[6-9]\d{9}")


def _client_key(request: Request) -> str:
    return f"ip:{request.client.host}" if request.client else ""


def _normalize_mobile(raw: str) -> str:
    """Last 10 digits of a mobile number typed with spaces, dashes or a +91 / 0 prefix."""
    digits = re.sub(r"\D", "", raw or "")
    return digits[-10:] if len(digits) > 10 else digits


def _require_valid_mobile(phone: str) -> None:
    if not INDIAN_MOBILE.fullmatch(phone):
        raise HTTPException(status_code=422, detail="Please enter a valid 10-digit mobile number.")


def _check_password_strength(password: str) -> None:
    if len(password) < settings.PASSWORD_MIN_LENGTH:
        raise HTTPException(status_code=422, detail=f"Password must be at least {settings.PASSWORD_MIN_LENGTH} characters.")
    if password.isdigit() or password.isalpha():
        raise HTTPException(status_code=422, detail="Password must contain both letters and numbers.")


def _temporary_password() -> str:
    """Readable one-time password handed to the customer by staff; must be changed at first login."""
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8)) + str(secrets.randbelow(10))


def _valid_branch(db: Session, branch_id: Optional[int]) -> Optional[int]:
    return branch_id if branch_id and db.query(Branch).filter(Branch.id == branch_id).first() else None


def _customer_session(db: Session, customer: Customer) -> dict:
    claims = {"sub": f"customer:{customer.id}", "role": "Customer", "name": customer.full_name}
    if customer.must_change_password:
        claims["mcp"] = True  # this token is only accepted for changing the password
    token = create_access_token(claims, timedelta(minutes=settings.CUSTOMER_TOKEN_EXPIRE_MINUTES))
    return {"access_token": token, "token_type": "bearer", "role": "Customer",
            "must_change_password": bool(customer.must_change_password), **_customer_summary(db, customer)}


@router.post("/auth/customer/login")
def customer_login(payload: CustomerLoginRequest, request: Request, db: Session = Depends(get_db)):
    """Customer login with mobile number (or customer ID) and password."""
    ident = payload.identifier.strip()
    if ident.upper().startswith("CUST-"):
        ident_key = ident.upper()
        candidates = db.query(Customer).filter(Customer.customer_code == ident_key).all()
    else:
        ident_key = _normalize_mobile(ident)
        candidates = db.query(Customer).filter(Customer.phone_number == ident_key).all() if ident_key else []
    keys = (f"customer:{ident_key}", _client_key(request))
    check_login_allowed(*keys)
    matches = [c for c in candidates if verify_password(payload.password, c.password_hash)]
    if not matches:
        record_login_failure(*keys)
        raise HTTPException(status_code=401, detail="Incorrect mobile number / customer ID or password")
    if len(matches) > 1:
        # Only reachable with a correct password, so it does not reveal which numbers are registered
        raise HTTPException(status_code=409, detail="More than one profile uses this mobile number. "
                                                    "Please log in with your customer ID (e.g. CUST-1001).")
    clear_login_failures(keys[0])
    customer = matches[0]
    if password_needs_rehash(customer.password_hash):
        customer.password_hash = get_password_hash(payload.password)
        db.commit()
    return _customer_session(db, customer)


@router.post("/auth/customer/register")
def customer_register(payload: CustomerRegisterRequest, request: Request, db: Session = Depends(get_db)):
    """New customer sign-up: creates the profile with a password and logs the customer in."""
    check_login_allowed(_client_key(request))
    phone = _normalize_mobile(payload.phone_number)
    _require_valid_mobile(phone)
    _check_password_strength(payload.password)
    if not payload.full_name.strip():
        raise HTTPException(status_code=422, detail="Please enter your name.")
    if db.query(Customer).filter(Customer.phone_number == phone).first():
        # Family profiles on a shared number are added by staff, who can check who the customer is
        raise HTTPException(status_code=409, detail="This mobile number is already registered. Please log in, "
                                                    "or ask the salon staff to add a family profile.")
    customer = _create_customer(db, CustomerCreate(full_name=payload.full_name.strip(), phone_number=phone,
                                                    gender=payload.gender, referral_code=payload.referral_code),
                                password=payload.password, home_branch_id=_valid_branch(db, payload.branch_id))
    return _customer_session(db, customer)


@router.post("/auth/customer/change-password")
def change_customer_password(payload: ChangePasswordRequest, request: Request, db: Session = Depends(get_db),
                             principal: Principal = Depends(get_current_principal)):
    """Customer sets their own password (required after a temporary password from staff)."""
    if principal.is_staff:
        raise HTTPException(status_code=403, detail="Staff reset customer passwords from the customer directory.")
    customer = db.query(Customer).filter(Customer.id == principal.id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    keys = (f"customer:{customer.customer_code}", _client_key(request))
    check_login_allowed(*keys)
    if not verify_password(payload.current_password, customer.password_hash):
        record_login_failure(*keys)
        raise HTTPException(status_code=401, detail="The current password is not correct.")
    _check_password_strength(payload.new_password)
    if payload.new_password == payload.current_password:
        raise HTTPException(status_code=422, detail="Please choose a new password that is different from the current one.")
    customer.password_hash = get_password_hash(payload.new_password)
    customer.must_change_password = False
    db.commit()
    return _customer_session(db, customer)  # a full session replaces the temporary-password one


@router.post("/customers/{customer_id}/reset-password")
def reset_customer_password(customer_id: int, db: Session = Depends(get_db), principal: Principal = Depends(require_staff)):
    """Staff issue a new one-time password (e.g. a forgotten password); the customer must change it at login."""
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    temporary = _temporary_password()
    customer.password_hash = get_password_hash(temporary)
    customer.must_change_password = True
    db.commit()
    return {"customer_id": customer.id, "customer_code": customer.customer_code, "temporary_password": temporary}


@router.get("/auth/me")
def who_am_i(principal: Principal = Depends(get_current_principal)):
    return {"kind": principal.kind, "id": principal.id, "role": principal.role, "name": principal.name}

@router.get("/customers")
def get_customers_list(query: Optional[str] = None, branch_id: Optional[int] = None, db: Session = Depends(get_db), principal: Principal = Depends(require_staff)):
    """
    Staff customer directory (salon / stylist / admin). Phone numbers are never returned here; staff can still
    find a customer by typing their mobile number, and matches by phone are flagged as `matched_by_phone`.
    """
    db_query = db.query(Customer)
    phone_digits = ""
    if branch_id:
        # Strictly this branch's customers: registered at this branch OR visited this branch
        visited = db.query(CustomerVisit.customer_id).filter(CustomerVisit.branch_id == branch_id)
        db_query = db_query.filter((Customer.home_branch_id == branch_id) | Customer.id.in_(visited))
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
    insights = _insights_for(db, customers)
    branch_names = {b.id: b.name for b in db.query(Branch).all()}
    visits_here: dict = {}
    if branch_id and customers:
        for (cid,) in db.query(CustomerVisit.customer_id).filter(
                CustomerVisit.branch_id == branch_id, CustomerVisit.customer_id.in_([c.id for c in customers])).all():
            visits_here[cid] = visits_here.get(cid, 0) + 1
    results = []
    for c in customers:
        photo = db.query(CustomerPhoto).filter(CustomerPhoto.customer_id == c.id).order_by(CustomerPhoto.id.desc()).first()
        last_selection = db.query(StyleSelection).filter(StyleSelection.customer_id == c.id).order_by(StyleSelection.id.desc()).first()
        avatar_url = c.avatar_url or None
        if not avatar_url and photo and photo.original_image_url:
            avatar_url = photo.original_image_url
        if not avatar_url and last_selection and last_selection.reference_image_url:
            avatar_url = last_selection.reference_image_url
        avatar_url = avatar_url or None
            
        hairstyle_name = None
        if last_selection and last_selection.selected_hairstyle_id:
            h = get_style(last_selection.selected_hairstyle_id)
            if h:
                hairstyle_name = h["name"]
                
        home_b_id = c.home_branch_id or (next(iter(branch_names.keys()), 1) if branch_names else 1)
        results.append({
            "id": c.id,
            "customer_code": c.customer_code,
            "full_name": c.full_name,
            "matched_by_phone": bool(phone_digits) and phone_digits in (c.phone_number or ""),
            "gender": c.gender or "Female",
            "segment_name": c.segment_name or ("New Customer" if (c.total_visits or 0) == 0 else "Regular Customer"),
            "total_visits": c.total_visits,
            "total_spent": c.total_spent,
            "avatar_url": avatar_url,
            "home_branch_id": home_b_id,
            "home_branch": branch_names.get(home_b_id, "LUXE Flagship - Downtown"),
            "visits_at_branch": visits_here.get(c.id, 0) if branch_id else None,
            **insights[c.id],
            "previous_style": {
                "selection_id": last_selection.id if last_selection else None,
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
        "avatar_url": _avatar_url(db, customer),
        "segment_name": customer.segment_name,
        "total_visits": customer.total_visits or 0,
        "total_spent": customer.total_spent or 0.0,
        "last_visit_date": customer.last_visit_date.date().isoformat() if customer.last_visit_date else None,
        "member_since": customer.created_at.date().isoformat() if customer.created_at else None,
        "loyalty_points": loyalty.points_balance if loyalty else 0,
        "membership": membership,
        **_visit_insights(db, customer, membership),
    }


CUSTOMER_TYPES = ("New", "Regular", "Priority", "Premium", "VIP")


def _customer_type(total_spent: float, total_visits: int, has_membership: bool) -> str:
    """New (0 visits) -> Regular -> Priority -> Premium -> VIP from spend and visits."""
    if (total_visits or 0) == 0 and (total_spent or 0.0) == 0.0 and not has_membership:
        return "New"
    if total_spent >= settings.VIP_MIN_SPEND or total_visits >= settings.VIP_MIN_VISITS:
        return "VIP"
    if has_membership or total_spent >= settings.PREMIUM_MIN_SPEND or total_visits >= settings.PREMIUM_MIN_VISITS:
        return "Premium"
    if total_spent >= settings.PRIORITY_MIN_SPEND or total_visits >= settings.PRIORITY_MIN_VISITS:
        return "Priority"
    return "Regular"


def _insights_for(db: Session, customers: List[Customer]) -> dict:
    """Visit insights for many customers with a few queries: {customer_id: insights}."""
    ids = [c.id for c in customers]
    if not ids:
        return {}
    visits = db.query(CustomerVisit.id, CustomerVisit.customer_id, CustomerVisit.branch_id) \
        .filter(CustomerVisit.customer_id.in_(ids)).all()
    branch_names = {b.id: b.name for b in db.query(Branch).all()}
    fallback_branch_id = next(iter(branch_names.keys()), 1) if branch_names else 1
    fallback_branch_name = branch_names.get(fallback_branch_id, "LUXE Flagship - Downtown")

    visit_owner = {v.id: v.customer_id for v in visits}
    branches: dict = {}
    for v in visits:
        if v.branch_id in branch_names:
            branches.setdefault(v.customer_id, set()).add(branch_names[v.branch_id])
    counts: dict = {}
    if visit_owner:
        rows = (db.query(ServiceHistory.visit_id, Service.name).join(Service, ServiceHistory.service_id == Service.id)
                .filter(ServiceHistory.visit_id.in_(list(visit_owner))).all())
        for visit_id, name in rows:
            per = counts.setdefault(visit_owner[visit_id], {})
            per[name] = per.get(name, 0) + 1
    now = datetime.utcnow()
    members = {t.customer_id for t in db.query(MembershipTransaction)
               .filter(MembershipTransaction.customer_id.in_(ids), MembershipTransaction.status == "ACTIVE").all()
               if t.end_date is None or t.end_date >= now}
    out = {}
    for c in customers:
        total_visits = c.total_visits or 0
        total_spent = c.total_spent or 0.0
        names_set = set(branches.get(c.id, set()))
        home_bname = branch_names.get(c.home_branch_id) if c.home_branch_id else None
        if home_bname:
            names_set.add(home_bname)
        if not names_set:
            names_set.add(fallback_branch_name)
        names = sorted(names_set)
        top = sorted(counts.get(c.id, {}).items(), key=lambda x: (-x[1], x[0]))[:3]
        out[c.id] = {
            "total_spent": total_spent,
            "average_spend": round(total_spent / total_visits, 2) if total_visits else 0.0,
            "branches_visited_count": max(1, len(names)),
            "branches_visited": names,
            "customer_type": _customer_type(total_spent, total_visits, c.id in members),
            "frequent_services": [{"name": n, "count": k} for n, k in top],
        }
    return out


def _visit_insights(db: Session, customer: Customer, membership: Optional[dict]) -> dict:
    insights = _insights_for(db, [customer])[customer.id]
    if membership and insights["customer_type"] in ("Regular", "Priority"):
        insights["customer_type"] = "Premium"
    return insights


def _avatar_url(db: Session, customer: Customer) -> Optional[str]:
    """Profile photo: the photo taken when the customer was added, else their latest front photo."""
    if customer.avatar_url:
        return customer.avatar_url
    photo = db.query(CustomerPhoto).filter(CustomerPhoto.customer_id == customer.id).order_by(CustomerPhoto.id.desc()).first()
    if photo and photo.original_image_url:
        return photo.original_image_url
    last_selection = db.query(StyleSelection).filter(StyleSelection.customer_id == customer.id).order_by(StyleSelection.id.desc()).first()
    if last_selection and last_selection.reference_image_url:
        return last_selection.reference_image_url
    return None


@router.get("/customers/lookup/{phone_number}")
def lookup_customer(phone_number: str, branch_id: Optional[int] = None, db: Session = Depends(get_db), principal: Principal = Depends(require_staff)):
    customer = db.query(Customer).filter(Customer.phone_number == phone_number).first()
    if not customer:
        return {"found": False, "message": "New customer"}
    current_b = branch_id
    if not current_b and principal and hasattr(principal, "id"):
        user = db.query(User).filter(User.id == principal.id).first()
        if user:
            current_b = user.branch_id
    return _customer_summary(db, customer, current_branch_id=current_b)


def _customer_summary(db: Session, customer: Customer, current_branch_id: Optional[int] = None) -> dict:
    """Profile, previous style and last choices for the returning-customer screen."""
    last_selection = db.query(StyleSelection).filter(StyleSelection.customer_id == customer.id).order_by(StyleSelection.id.desc()).first()
    hairstyle_name = None
    if last_selection and last_selection.selected_hairstyle_id:
        h = get_style(last_selection.selected_hairstyle_id)
        if h:
            hairstyle_name = h["name"]

    last_preferences = _last_preferences(db, customer)
    insights = _insights_for(db, [customer])[customer.id]
    branch_names = {b.id: b.name for b in db.query(Branch).all()}
    
    current_branch_visits = 0
    if current_branch_id:
        current_branch_visits = db.query(CustomerVisit).filter(
            CustomerVisit.customer_id == customer.id,
            CustomerVisit.branch_id == current_branch_id
        ).count()

    total_visits = customer.total_visits or 0
    if total_visits == 0:
        visitor_status = "NEW_CUSTOMER"
        status_label = "First-time Customer"
    elif current_branch_id and current_branch_visits == 0:
        visitor_status = "CROSS_BRANCH_VISITOR"
        status_label = "First Time at THIS Branch (Visited Other Salons)"
    else:
        visitor_status = "RETURNING_BRANCH_CUSTOMER"
        status_label = "Returning Branch Customer"

    home_b_id = customer.home_branch_id or (next(iter(branch_names.keys()), 1) if branch_names else 1)
    home_branch_name = branch_names.get(home_b_id, "LUXE Flagship - Downtown")

    return {
        "found": True,
        "customer": {
            "id": customer.id,
            "customer_code": customer.customer_code,
            "full_name": customer.full_name,
            "phone_number": customer.phone_number,
            "gender": customer.gender,
            "segment_name": customer.segment_name,
            "customer_type": insights["customer_type"],
            "visitor_status": visitor_status,
            "visitor_status_label": status_label,
            "home_branch_id": home_b_id,
            "home_branch_name": home_branch_name,
            "branches_visited": insights["branches_visited"],
            "current_branch_visits": current_branch_visits,
            "total_visits": total_visits,
            "total_spent": customer.total_spent,
            "last_visit_date": customer.last_visit_date.isoformat() if customer.last_visit_date else None,
            "previous_style": {
                "selection_id": last_selection.id if last_selection else None,
                "reference_image_url": last_selection.reference_image_url if last_selection else None,
                "hairstyle_id": last_selection.selected_hairstyle_id if last_selection else None,
                "hairstyle_name": hairstyle_name or "Previous Hairstyle"
            } if last_selection else None,
            "last_preferences": last_preferences
        }
    }


PROFILE_LABELS = ("Self", "Spouse", "Child", "Parent", "Other")


class StaffCustomerCreate(BaseModel):
    full_name: str
    phone_number: str
    customer_code: Optional[str] = None   # salon's own customer ID; generated when empty
    email: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[str] = None   # YYYY-MM-DD
    branch_id: Optional[int] = None       # branch the customer is registered at (the tablet's working branch)
    profile_label: Optional[str] = None   # Self, Spouse, Child, Parent (family profiles on one number)


@router.post("/customers", response_model=CustomerResponse)
def create_customer(payload: StaffCustomerCreate, db: Session = Depends(get_db), principal: Principal = Depends(require_staff)):
    """
    Staff add a walk-in customer. A one-time password is returned once (show it to the customer); they must
    choose their own password at first login.
    """
    name = payload.full_name.strip()
    phone = _normalize_mobile(payload.phone_number)
    if not name:
        raise HTTPException(status_code=422, detail="Please enter the customer's name.")
    _require_valid_mobile(phone)
    code = (payload.customer_code or "").strip().upper() or None
    if code:
        if not re.fullmatch(r"[A-Z0-9-]{3,30}", code):
            raise HTTPException(status_code=422, detail="Customer ID can use letters, numbers and '-' (3-30 characters).")
        if db.query(Customer).filter(Customer.customer_code == code).first():
            raise HTTPException(status_code=409, detail=f"Customer ID {code} is already used.")
    # The same mobile can hold family profiles, but not the same person twice
    same = [c for c in db.query(Customer).filter(Customer.phone_number == phone).all()
            if (c.full_name or "").strip().lower() == name.lower()]
    if same:
        raise HTTPException(status_code=409, detail=f"{name} is already registered as {same[0].customer_code}.")
    dob = None
    if payload.date_of_birth:
        try:
            dob = datetime.strptime(payload.date_of_birth, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="Date of birth must be YYYY-MM-DD.")
    if payload.profile_label and payload.profile_label not in PROFILE_LABELS:
        raise HTTPException(status_code=422, detail=f"Profile must be one of: {', '.join(PROFILE_LABELS)}.")
    temporary = _temporary_password()
    customer = _create_customer(db, CustomerCreate(full_name=name, phone_number=phone, email=payload.email or None,
                                                   gender=payload.gender), password=temporary, code=code,
                                home_branch_id=_valid_branch(db, payload.branch_id)
                                or (db.query(User).filter(User.id == principal.id).first() or User()).branch_id)
    customer.must_change_password = True
    if payload.profile_label:
        customer.profile_label = payload.profile_label
    if dob:
        customer.date_of_birth = dob
    db.commit()
    db.refresh(customer)
    response = CustomerResponse.model_validate(customer)
    response.temporary_password = temporary
    return response


@router.post("/customers/{customer_id}/avatar")
async def upload_customer_avatar(customer_id: int, file: UploadFile = File(...), db: Session = Depends(get_db),
                                 principal: Principal = Depends(get_current_principal)):
    """Profile photo taken when the customer is added (shown on the customer cards)."""
    ensure_customer_access(principal, customer_id)
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    try:
        data = normalize_photo(await file.read())
    except UnidentifiedImageError:
        raise HTTPException(status_code=422, detail="This photo could not be opened. Please upload a JPG, PNG or HEIC photo.")
    _, url = storage_service.save_bytes(data, folder="avatars", filename_prefix=f"cust_{customer_id}_avatar")
    customer.avatar_url = url
    db.commit()
    return {"customer_id": customer_id, "avatar_url": url}


@router.get("/branches")
def list_branches(db: Session = Depends(get_db), principal: Principal = Depends(require_staff)):
    """Active branches; staff pick the branch they are working at (recorded on each visit)."""
    user = db.query(User).filter(User.id == principal.id).first()
    return {
        "home_branch_id": user.branch_id if user else None,
        "branches": [{"id": b.id, "code": b.branch_code, "name": b.name, "city": b.city}
                     for b in db.query(Branch).filter(Branch.is_active.is_(True)).order_by(Branch.id).all()],
    }


def _create_customer(db: Session, payload: CustomerCreate, password: str, code: Optional[str] = None,
                     home_branch_id: Optional[int] = None) -> Customer:
    if not home_branch_id:
        first_b = db.query(Branch).order_by(Branch.id).first()
        home_branch_id = first_b.id if first_b else 1
    code = code or f"CUST-{uuid.uuid4().hex[:6].upper()}"
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
        segment_name="New Customer",
        password_hash=get_password_hash(password),
        home_branch_id=home_branch_id,
    )
    db.add(new_cust)
    db.commit()
    db.refresh(new_cust)

    # Track who referred this new customer (one row per conversion; the share-link row stays reusable).
    # Not a referral when the "friend" uses the referrer's own mobile number (same person or family profile).
    referrer = db.query(Customer).filter(Customer.id == referrer_link.referrer_customer_id).first() if referrer_link else None
    if referrer and referrer.id != new_cust.id and referrer.phone_number != new_cust.phone_number:
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
        # The customer's face is shown publicly only if they agreed to before/after sharing
        "reference_image_url": selection.reference_image_url
        if selection and selection.reference_image_url and privacy.allows_public_share(db, link.referrer_customer_id)
        else None,
        "discount_percent": settings.REFERRAL_DISCOUNT_PERCENT,
    }

# -------------------------------------------------------------
# 1c. Consent (DPDP Act) and photo erasure
# -------------------------------------------------------------
class ConsentUpdate(BaseModel):
    consent_photo_analysis: bool
    consent_third_party_ai: bool = False
    consent_history_retention: bool = False
    consent_before_after_share: bool = False
    consent_marketing: bool = False
    is_minor_parental_consent: bool = False


def _customer_or_404(db: Session, customer_id: int) -> Customer:
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


def _require_consent(db: Session, customer_id: int, need_ai: bool) -> None:
    problem = privacy.consent_problem(db, _customer_or_404(db, customer_id), need_ai=need_ai)
    if problem:
        raise HTTPException(status_code=403, detail=problem)


@router.get("/customers/{customer_id}/consent")
def get_consent(customer_id: int, db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    ensure_customer_access(principal, customer_id)
    return privacy.consent_dict(db, _customer_or_404(db, customer_id))


@router.put("/customers/{customer_id}/consent")
def record_consent(customer_id: int, payload: ConsentUpdate, db: Session = Depends(get_db),
                   principal: Principal = Depends(get_current_principal)):
    """Records the customer's choices under the current policy text. Every change is a new row (audit trail)."""
    ensure_customer_access(principal, customer_id)
    customer = _customer_or_404(db, customer_id)
    if payload.is_minor_parental_consent and not principal.is_staff:
        # A parent's consent is taken in the salon, where staff can see who is giving it
        raise HTTPException(status_code=403, detail="A parent's or guardian's consent is recorded by salon staff.")
    now = datetime.utcnow()
    db.add(CustomerConsent(
        customer_id=customer.id, policy_version=privacy.CONSENT_POLICY_VERSION, created_at=now, updated_at=now,
        recorded_by=principal.name if principal.is_staff else "customer", dpdp_act_compliant=True,
        **payload.model_dump(),
    ))
    db.commit()
    return privacy.consent_dict(db, customer)


@router.delete("/customers/{customer_id}/photos")
def erase_customer_photos(customer_id: int, db: Session = Depends(get_db),
                          principal: Principal = Depends(get_current_principal)):
    """
    Right to erasure: deletes all of the customer's photos, AI previews, after-photos and face measurements.
    Visits and bills stay (without images). The customer or an admin can do this.
    """
    if principal.is_staff and not principal.is_admin:
        raise HTTPException(status_code=403, detail="Only the customer or a salon admin can erase photos.")
    ensure_customer_access(principal, customer_id)
    customer = _customer_or_404(db, customer_id)
    result = privacy.erase_customer_media(db, customer)
    db.add(CustomerConsent(customer_id=customer.id, policy_version=privacy.CONSENT_POLICY_VERSION,
                           consent_photo_analysis=False, consent_third_party_ai=False,
                           consent_history_retention=False, consent_before_after_share=False,
                           recorded_by=principal.name if principal.is_staff else "customer",
                           updated_at=datetime.utcnow()))
    db.commit()
    return result


# -------------------------------------------------------------
# 2. Photo Upload & Computer Vision Analysis
# -------------------------------------------------------------
@router.post("/customers/{customer_id}/photo", response_model=PhotoUploadResponse)
async def upload_customer_photo(
    customer_id: int,
    principal: Principal = Depends(get_current_principal),
    file: UploadFile = File(...),
    back_file: Optional[UploadFile] = File(None),
    side_file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    ensure_customer_access(principal, customer_id)
    _require_consent(db, customer_id, need_ai=False)
    # Store every photo as a standard JPEG (phones may send HEIC/AVIF that browsers cannot display)
    try:
        contents = normalize_photo(await file.read())
        back_contents = normalize_photo(await back_file.read()) if back_file else None
        side_contents = normalize_photo(await side_file.read()) if side_file else None
    except UnidentifiedImageError:
        raise HTTPException(status_code=422, detail="This photo could not be opened. Please upload a JPG, PNG or HEIC photo.")

    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    gender = customer.gender if customer else "Women"

    # Computer Vision Analysis on Front, Back, and Side photos
    analysis = face_analyzer.analyze_multi_photos(contents, back_contents, side_contents, gender=gender)
    quality = analysis.get("quality_check", {})
    if not quality.get("face_detected"):
        raise HTTPException(status_code=422, detail=quality.get("message") or "Please make sure your face is clearly visible.")
    if quality.get("message"):
        raise HTTPException(status_code=422, detail=quality.get("message"))

    file_id, image_url = storage_service.save_bytes(contents, folder="original", filename_prefix=f"cust_{customer_id}_front")

    back_url = side_url = None
    if back_contents:
        _, back_url = storage_service.save_bytes(back_contents, folder="original", filename_prefix=f"cust_{customer_id}_back")
    if side_contents:
        _, side_url = storage_service.save_bytes(side_contents, folder="original", filename_prefix=f"cust_{customer_id}_side")

    eligible = compute_eligible_services(analysis, gender=gender)

    photo_record = CustomerPhoto(
        customer_id=customer_id,
        original_image_url=image_url,
        side_image_url=side_url,
        back_image_url=back_url,
        face_shape=analysis["face_shape"],
        hair_length=analysis["hair_length"],
        hair_density=analysis["hair_density"],
        beard_style_current=analysis["beard_style_current"],
        beard_length_class=analysis.get("beard_length_class", "Clean-shaven"),
        beard_pattern=analysis.get("beard_pattern", "None"),
        beard_zones_json=analysis.get("beard_zones", {}),
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
        beard_length_class=analysis.get("beard_length_class", "Clean-shaven"),
        beard_pattern=analysis.get("beard_pattern", "None"),
        beard_zones=analysis.get("beard_zones", {}),
        eligible_services=eligible,
        needs_confirmation=analysis.get("needs_confirmation", False),
        facial_features=analysis
    )


class AnalysisUpdate(BaseModel):
    """Manual corrections of the photo analysis."""
    hair_density: Optional[str] = None
    hair_length: Optional[str] = None
    hair_type: Optional[str] = None
    beard_style_current: Optional[str] = None
    beard_length_class: Optional[str] = None
    beard_pattern: Optional[str] = None
    beard_zones: Optional[dict] = None
    face_shape: Optional[str] = None
    hair_color_detected: Optional[str] = None


ANALYSIS_CHOICES = {
    "hair_density": ("Fine", "Medium", "Thick", "Sparse / Bald"),
    "hair_length": ("Bald", "Buzz", "Short", "Medium", "Long", "Very Long"),
    "hair_type": ("Straight", "Wavy", "Curly", "Coily", "None", "Not Applicable (Bald)"),
    "beard_style_current": ("Clean Shaven", "Stubble / Short Beard", "Full Beard"),
    "beard_length_class": ("Clean-shaven", "Stubble (1-3mm)", "Short (3-10mm)", "Medium (10-25mm)", "Full (>25mm)"),
    "face_shape": ("Oval", "Round", "Square", "Oblong", "Heart", "Diamond"),
}
# Columns on customer_photos that mirror a value in facial_features_json
ANALYSIS_COLUMNS = {"hair_density", "hair_length", "beard_style_current", "beard_length_class", "beard_pattern", "face_shape"}


@router.patch("/photos/{photo_id}/analysis")
def confirm_photo_analysis(photo_id: int, payload: AnalysisUpdate, db: Session = Depends(get_db),
                           principal: Principal = Depends(get_current_principal)):
    """
    Stylist (or the customer, in self-service) confirms or corrects the analysis before recommendations are made.
    """
    photo = db.query(CustomerPhoto).filter(CustomerPhoto.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    ensure_customer_access(principal, photo.customer_id)
    customer = db.query(Customer).filter(Customer.id == photo.customer_id).first()
    features = dict(photo.facial_features_json or {})
    source = "stylist" if principal.is_staff else "customer"
    for field, value in payload.model_dump(exclude_none=True).items():
        if isinstance(value, str):
            value = value.strip()
            choices = ANALYSIS_CHOICES.get(field)
            if choices and value not in choices:
                raise HTTPException(status_code=422, detail=f"{field.replace('_', ' ').capitalize()} must be one of: {', '.join(choices)}.")
            if not value or len(value) > 50:
                raise HTTPException(status_code=422, detail=f"Please choose a value for {field.replace('_', ' ')}.")
        features[field] = value
        features[f"{field}_source"] = source
        if field == "hair_length":
            # A confirmed length replaces the camera's guess: no more "please confirm", and hair confirmed as
            # short (or bald / buzz) is not tied back, so previews must not show it let down long
            features["hair_length_needs_confirmation"] = False
            if value in ("Bald", "Buzz", "Short"):
                features["hair_tied_back"] = False
        if field in ANALYSIS_COLUMNS and hasattr(photo, field):
            setattr(photo, field, value)
    is_women = (customer.gender if customer and customer.gender else "Women").strip().capitalize() in ["Women", "Female"]
    features["gender"] = "Women" if is_women else "Men"
    if is_women:
        features["beard_style_current"] = "Clean Shaven"
        features["beard_length_class"] = "Clean-shaven"
        features["beard_pattern"] = "None"
        features["beard_zones"] = {}
        features["needs_confirmation"] = False

    if features.get("hair_length") == "Bald" or features.get("hair_density") == "Sparse / Bald":
        features["hair_type"] = "Not Applicable (Bald)"
        features["hair_color_detected"] = "None"
        features["current_hairstyle"] = "Bald / Clean Scalp"
        features["hairline"] = "Bald / High hairline"

    eligible = compute_eligible_services(features, gender=customer.gender if customer else "Women")
    features["eligible_services"] = eligible
    photo.facial_features_json = features
    db.commit()
    return {
        "photo_id": photo.id,
        "hair_density": photo.hair_density,
        "hair_length": photo.hair_length,
        "beard_style_current": photo.beard_style_current,
        "beard_length_class": photo.beard_length_class,
        "beard_pattern": photo.beard_pattern,
        "beard_zones": photo.beard_zones_json,
        "eligible_services": eligible,
        "facial_features": features
    }


# -------------------------------------------------------------
# 3. Controlled Hairstyle Recommendations
# -------------------------------------------------------------
@router.post("/style-recommendations", response_model=RecommendationResponse)
def get_style_recommendations(payload: RecommendationRequest, db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    ensure_customer_access(principal, payload.customer_id)
    photo = db.query(CustomerPhoto).filter(CustomerPhoto.id == payload.photo_id).first()
    if not photo or not photo.is_active or not photo.original_image_url:
        raise HTTPException(status_code=404, detail="Photo not found. Please take the photos again.")
    if photo.customer_id != payload.customer_id:
        raise HTTPException(status_code=403, detail="This photo belongs to a different customer.")
    customer = db.query(Customer).filter(Customer.id == payload.customer_id).first()

    face_shape = photo.face_shape if photo else "Oval"
    feat = dict(photo.facial_features_json or {}) if photo else {}
    hair_length = photo.hair_length if (photo and photo.hair_length and photo.hair_length != "Unknown") else feat.get("hair_length", "Medium")
    hair_density = photo.hair_density if (photo and photo.hair_density and photo.hair_density != "Unknown") else feat.get("hair_density", "Medium")
    gender = payload.gender or (customer.gender if customer and customer.gender else "Women")
    # Remember the collection the customer chose (Men/Women) for their next visit
    chosen_gender = {"men": "Male", "male": "Male", "women": "Female", "female": "Female"}.get((payload.gender or "").lower())
    if customer and chosen_gender and customer.gender != chosen_gender:
        customer.gender = chosen_gender
        db.commit()

    feat_beard = feat.get("beard_style_current") or photo.beard_style_current
    eligible_map = compute_eligible_services(feat, gender=gender)

    # Validate target service eligibility against matrix
    requested_list = parse_services(payload.target_service_type, gender, bald=is_bald(hair_length, hair_density))
    if not requested_list:
        if (gender or "").lower() in ("women", "female") and "beard" in payload.target_service_type.lower():
            detail = "Beard grooming is in the Men's collection. Please choose another service."
        else:
            detail = ("The photo shows a bald or clean-shaved scalp, so hair services are not possible. Choose "
                      "Beard Grooming, or correct the hair length in the analysis if the photo was misread.")
        raise HTTPException(status_code=422, detail=detail)

    # Check eligibility for each parsed service
    SERVICE_MATRIX_KEYS = {
        "Hair": "HAIR_CUT",
        "Beard": "BEARD_STYLING",
        "Colour": "COLOUR_BALAYAGE",
        "Texture": "TEXTURE_SMOOTHENING"
    }
    ineligible_reasons = []
    all_requested_ineligible = True
    for s_name in requested_list:
        m_key = SERVICE_MATRIX_KEYS.get(s_name)
        if m_key and m_key in eligible_map:
            s_info = eligible_map[m_key]
            if s_info["eligible"]:
                all_requested_ineligible = False
            else:
                ineligible_reasons.append(f"{s_name}: {s_info['reason']}")
        else:
            all_requested_ineligible = False

    if all_requested_ineligible and ineligible_reasons:
        raise HTTPException(status_code=422, detail=" ".join(ineligible_reasons))

    stylist_assist_required = all(not v.get("eligible", True) for v in eligible_map.values())

    growth_map = {
        "beard_length_class": feat.get("beard_length_class") or photo.beard_length_class or "Clean-shaven",
        "beard_zones": feat.get("beard_zones") or photo.beard_zones_json or {}
    }

    top_styles = recommendation_engine.recommend(
        face_shape=face_shape,
        hair_length=hair_length,
        hair_density=hair_density,
        hair_type=(photo.facial_features_json or {}).get("hair_type") if photo else None,
        gender=gender,
        target_service_type=payload.target_service_type,
        style_category=payload.style_category,
        beard_style=feat_beard,
        growth_map=growth_map,
        trim_preference=payload.trim_preference,
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
            "feasible": s.get("feasible", True),
            "suggested_alternative": s.get("suggested_alternative"),
            "chemical_addon": s.get("chemical_addon"),
            "expert_analysis": s.get("expert_analysis"),
        } for s in top_styles
    ]

    return RecommendationResponse(
        recommendation_id=rec_record.id,
        target_service_type=payload.target_service_type,
        style_category=payload.style_category,
        recommended_styles=formatted_styles,
        eligible_services=eligible_map,
        stylist_assist_required=stylist_assist_required
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
    _require_consent(db, rec.customer_id, need_ai=True)
    photo = db.query(CustomerPhoto).filter(CustomerPhoto.id == rec.photo_id).first()
    if not photo or not photo.original_image_url:
        raise HTTPException(status_code=404, detail="Customer photo not found for this recommendation")

    analysis = _analysis_for_generation(db, photo)
    analysis.setdefault("face_shape", photo.face_shape)
    analysis.setdefault("hair_length", photo.hair_length)
    analysis.setdefault("hair_density", photo.hair_density)
    if payload.trim_preference:
        analysis["trim_preference"] = payload.trim_preference

    # Only looks recommended for this photo session can be previewed. Unknown ids are an error: never fall
    # back to a different style (that would preview the wrong look).
    allowed = set(rec.recommended_style_ids_json or [])
    not_recommended = [sid for sid in payload.selected_style_ids if sid not in allowed]
    if not_recommended:
        raise HTTPException(status_code=422, detail=f"Style(s) {not_recommended} were not recommended for this photo.")
    style_metas = [get_style(style_id) for style_id in payload.selected_style_ids]
    unknown = [sid for sid, meta in zip(payload.selected_style_ids, style_metas) if meta is None]
    if unknown:
        raise HTTPException(status_code=404, detail=f"Unknown style id(s): {unknown}")
    photo_url = photo.original_image_url
    # End the read transaction so the connection is not held for the minutes the image service may take
    db.commit()
    results = await asyncio.gather(
        *(hair_style_generator.generate(photo_url, meta, analysis, tier="fast") for meta in style_metas),
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
    _require_consent(db, rec.customer_id, need_ai=True)

    photo = db.query(CustomerPhoto).filter(CustomerPhoto.id == rec.photo_id).first()
    if not photo or not photo.original_image_url:
        raise HTTPException(status_code=404, detail="Customer photo not found for this recommendation")

    style_meta = get_style(style_id)
    if not style_meta:
        raise HTTPException(status_code=404, detail=f"Unknown style id: {style_id}")
    if style_id not in set(rec.recommended_style_ids_json or []):
        raise HTTPException(status_code=422, detail="This style was not recommended for this photo.")
    analysis = _analysis_for_generation(db, photo)
    analysis.setdefault("face_shape", photo.face_shape)
    analysis.setdefault("hair_length", photo.hair_length)
    photo_url = photo.original_image_url
    db.commit()

    try:
        res = await hair_style_generator.generate(photo_url, style_meta, analysis, tier="hq")
    except ImageEditError as e:
        raise HTTPException(status_code=502, detail=f"Preview generation failed: {e.reason}")

    if photo.customer_id:
        db.add(StyleSelection(
            customer_id=photo.customer_id,
            selected_hairstyle_id=style_id,
            style_name=style_meta["name"],
            reference_image_url=res.image_url,
            recommendation_id=recommendation_id,
            stylist_approved=False,
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
def _analysis_for_generation(db: Session, photo: CustomerPhoto) -> dict:
    """
    The photo analysis used to build edit prompts. The collection the customer last chose (Men / Women, saved on
    their profile by /style-recommendations) wins over the gender stored with the analysis: that one is fixed at
    upload time and may be stale, and a woman analysed as a man gets "keep the beard" prompts (the beard check
    reads lip and jaw shading as a beard) and bearded previews.
    """
    analysis = dict(photo.facial_features_json or {})
    if photo.original_image_url:
        analysis["front_image_url"] = photo.original_image_url
    if photo.back_image_url:
        analysis["back_image_url"] = photo.back_image_url
    if photo.side_image_url:
        analysis["side_image_url"] = photo.side_image_url
    customer = db.query(Customer).filter(Customer.id == photo.customer_id).first()
    gender = (customer.gender or "").lower() if customer else ""
    if gender in ("female", "women"):
        analysis["gender"] = "Women"
    elif gender in ("male", "men"):
        analysis["gender"] = "Men"
    if analysis.get("gender") == "Women":
        analysis.update(beard_style_current="Clean Shaven", beard_style="Clean Shaven",
                        beard_length_class="Clean-shaven", beard_pattern="None", beard_zones={})
    return analysis


def _is_customer_preview(db: Session, customer_id: int, style_id: int, url: str) -> bool:
    """True when url is an AI preview of this style made for this customer (new, chosen before, or saved)."""
    rec_ids = db.query(StyleRecommendation.id).filter(StyleRecommendation.customer_id == customer_id)
    return bool(
        db.query(StyleGeneration.id).filter(StyleGeneration.recommendation_id.in_(rec_ids),
                                            StyleGeneration.style_id == style_id,
                                            StyleGeneration.generated_image_url == url).first()
        or db.query(StyleSelection.id).filter(StyleSelection.customer_id == customer_id,
                                              StyleSelection.selected_hairstyle_id == style_id,
                                              StyleSelection.reference_image_url == url).first()
        or db.query(SavedStyle.id).filter(SavedStyle.customer_id == customer_id, SavedStyle.style_id == style_id,
                                          SavedStyle.image_url == url).first()
    )


def _last_completed_visit(db: Session, customer_id: int) -> Optional[datetime]:
    return db.query(func.max(CustomerVisit.visit_date)).filter(
        CustomerVisit.customer_id == customer_id, CustomerVisit.status == "COMPLETED").scalar()


def _photo_is_current(db: Session, photo: Optional[CustomerPhoto]) -> bool:
    """A photo session still shows the customer's hair: recent, not erased, and no haircut done since."""
    if not photo or not photo.is_active or not photo.original_image_url or not photo.created_at:
        return False
    if photo.created_at < datetime.utcnow() - timedelta(days=settings.PHOTO_REUSE_MAX_DAYS):
        return False
    last_visit = _last_completed_visit(db, photo.customer_id)
    return last_visit is None or last_visit < photo.created_at


@router.post("/style-selections", response_model=SelectionResponse)
def select_style_and_get_instructions(payload: SelectionRequest, db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    ensure_customer_access(principal, payload.customer_id)
    hairstyle = get_style(payload.hairstyle_id)
    if not hairstyle:
        raise HTTPException(status_code=404, detail=f"Unknown style id: {payload.hairstyle_id}")
    if payload.recommendation_id:
        rec = db.query(StyleRecommendation).filter(StyleRecommendation.id == payload.recommendation_id).first()
        if not rec or rec.customer_id != payload.customer_id:
            raise HTTPException(status_code=403, detail="This recommendation belongs to a different customer.")
    reference = media_path(payload.reference_image_url)
    if reference and not _is_customer_preview(db, payload.customer_id, hairstyle["id"], reference):
        raise HTTPException(status_code=422, detail="The reference image must be this customer's own preview of this style.")
    selection = StyleSelection(
        customer_id=payload.customer_id,
        selected_hairstyle_id=payload.hairstyle_id,
        selected_beardstyle_id=payload.beard_style_id,
        style_name=hairstyle["name"],
        reference_image_url=reference,
        recommendation_id=payload.recommendation_id,
        stylist_approved=False,  # set when the stylist confirms the haircut
        status="CONFIRMED"
    )
    db.add(selection)
    db.commit()
    db.refresh(selection)

    if not payload.recommendation_id and reference:
        # "Continue previous style": reuse the side/back AI previews of the earlier selection with the same
        # preview, but only while that photo session still shows the customer's current hair. The earlier
        # recommendation is not linked: the "before" photo must be the customer's current one.
        earlier = (db.query(StyleSelection)
                   .filter(StyleSelection.customer_id == payload.customer_id, StyleSelection.id != selection.id,
                           StyleSelection.selected_hairstyle_id == payload.hairstyle_id,
                           StyleSelection.reference_image_url == reference)
                   .order_by(StyleSelection.id.desc()).first())
        if earlier and _photo_is_current(db, _selection_photo(db, earlier)):
            for p in db.query(ServicePhoto).filter(ServicePhoto.selection_id == earlier.id, ServicePhoto.stage == "ai").all():
                db.add(ServicePhoto(selection_id=selection.id, customer_id=p.customer_id, stage="ai", view=p.view, image_url=p.image_url))
            db.commit()

    raw_instructions = hairstyle["stylist_instructions"].split("\n")
    instructions_list = [inst.strip() for inst in raw_instructions if inst.strip()]

    instruction_record = HaircutInstruction(
        selection_id=selection.id,
        steps_json={"steps": instructions_list},
        audio_instruction_url=f"/api/v1/instructions/{hairstyle['id']}/audio?selection_id={selection.id}"
    )
    db.add(instruction_record)
    db.commit()

    return SelectionResponse(
        selection_id=selection.id,
        customer_id=payload.customer_id,
        selected_hairstyle_name=hairstyle["name"],
        reference_image_url=reference,
        haircut_instructions=instructions_list,
        audio_instruction_url=instruction_record.audio_instruction_url
    )

class SaveStyleRequest(BaseModel):
    style_id: int
    image_url: str
    recommendation_id: Optional[int] = None


def _saved_style_dict(row: SavedStyle) -> dict:
    return {"id": row.id, "style_id": row.style_id, "style_name": row.style_name, "service": row.service,
            "image_url": row.image_url, "stylist_instructions": row.stylist_instructions,
            "saved_by": row.saved_by, "date": row.created_at.strftime("%Y-%m-%d")}


@router.post("/customers/{customer_id}/saved-styles")
def save_favourite_style(customer_id: int, payload: SaveStyleRequest, db: Session = Depends(get_db),
                         principal: Principal = Depends(get_current_principal)):
    """Save Style: keeps the AI preview, style and cutting steps in the customer's history for future visits."""
    ensure_customer_access(principal, customer_id)
    style = get_style(payload.style_id)
    if not style:
        raise HTTPException(status_code=404, detail="Unknown style")
    image_url = media_path(payload.image_url)
    if not image_url:
        raise HTTPException(status_code=422, detail="Only a look with a ready AI preview can be saved.")
    if not _is_customer_preview(db, customer_id, style["id"], image_url):
        raise HTTPException(status_code=422, detail="Only this customer's own AI preview of this style can be saved.")
    row = db.query(SavedStyle).filter(SavedStyle.customer_id == customer_id, SavedStyle.style_id == payload.style_id,
                                      SavedStyle.image_url == image_url).first()
    if not row:
        row = SavedStyle(customer_id=customer_id, style_id=style["id"], style_name=style["name"],
                         service=style.get("service", "Hair"), image_url=image_url,
                         stylist_instructions=style.get("stylist_instructions"),
                         recommendation_id=payload.recommendation_id, saved_by=principal.name)
        db.add(row)
        db.commit()
        db.refresh(row)
    return _saved_style_dict(row)


@router.get("/customers/{customer_id}/saved-styles")
def list_saved_styles(customer_id: int, db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    ensure_customer_access(principal, customer_id)
    rows = db.query(SavedStyle).filter(SavedStyle.customer_id == customer_id).order_by(SavedStyle.id.desc()).all()
    return [_saved_style_dict(r) for r in rows]


@router.delete("/saved-styles/{saved_id}")
def delete_saved_style(saved_id: int, db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    row = db.query(SavedStyle).filter(SavedStyle.id == saved_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Saved style not found")
    ensure_customer_access(principal, row.customer_id)
    db.delete(row)
    db.commit()
    return {"deleted": saved_id}


# -------------------------------------------------------------
# 5b. Multi-view previews, after-haircut photos, comparison, translated / spoken instructions
# -------------------------------------------------------------
VIEWS = ("front", "side", "back")


def _selection_for(db: Session, selection_id: int, principal: Principal) -> StyleSelection:
    selection = db.query(StyleSelection).filter(StyleSelection.id == selection_id).first()
    if not selection:
        raise HTTPException(status_code=404, detail="Selection not found")
    ensure_customer_access(principal, selection.customer_id)
    return selection


def _selection_photo(db: Session, selection: StyleSelection) -> Optional[CustomerPhoto]:
    rec = db.query(StyleRecommendation).filter(StyleRecommendation.id == selection.recommendation_id).first() \
        if selection.recommendation_id else None
    if rec:
        return db.query(CustomerPhoto).filter(CustomerPhoto.id == rec.photo_id).first()
    # Selections without a recommendation link ("continue previous style"): the customer's latest photo taken
    # before the selection, and only if no haircut was completed in between (that photo shows old hair)
    photo = (db.query(CustomerPhoto).filter(CustomerPhoto.customer_id == selection.customer_id,
                                            CustomerPhoto.created_at <= selection.created_at,
                                            CustomerPhoto.is_active.is_(True))
             .order_by(CustomerPhoto.id.desc()).first())
    if photo and selection.created_at:
        done_between = db.query(CustomerVisit.id).filter(
            CustomerVisit.customer_id == selection.customer_id, CustomerVisit.status == "COMPLETED",
            CustomerVisit.visit_date > photo.created_at, CustomerVisit.visit_date < selection.created_at).first()
        if done_between:
            return None
    return photo


def _comparison(db: Session, selection: StyleSelection) -> dict:
    photo = _selection_photo(db, selection)
    shots = db.query(ServicePhoto).filter(ServicePhoto.selection_id == selection.id).order_by(ServicePhoto.id).all()
    latest = {(p.stage, p.view): p.image_url for p in shots}  # later rows win
    style = get_style(selection.selected_hairstyle_id) or {}
    return {
        "selection_id": selection.id,
        "status": selection.status,
        "haircut_confirmed": selection.haircut_confirmed_at is not None,
        "style": {"id": style.get("id"), "name": style.get("name"), "service": style.get("service", "Hair")},
        "before": {"front": photo.original_image_url if photo else None,
                   "side": photo.side_image_url if photo else None,
                   "back": photo.back_image_url if photo else None},
        "ai": {"front": selection.reference_image_url or None,
               "side": latest.get(("ai", "side")), "back": latest.get(("ai", "back"))},
        "after": {v: latest.get(("after", v)) for v in VIEWS},
    }


@router.post("/style-selections/{selection_id}/views")
async def generate_selection_views(selection_id: int, db: Session = Depends(get_db),
                                   principal: Principal = Depends(get_current_principal)):
    """AI preview of the chosen style on the customer's side and back photos (front already exists)."""
    selection = _selection_for(db, selection_id, principal)
    _require_consent(db, selection.customer_id, need_ai=True)
    photo = _selection_photo(db, selection)
    style = get_style(selection.selected_hairstyle_id)
    if not photo or not style:
        raise HTTPException(status_code=404, detail="No photo session found for this selection")
    analysis = _analysis_for_generation(db, photo)
    if selection.reference_image_url:
        analysis["front_preview_url"] = selection.reference_image_url
    existing = {p.view for p in db.query(ServicePhoto).filter(ServicePhoto.selection_id == selection.id,
                                                              ServicePhoto.stage == "ai").all()}
    sources = {
        "side": photo.side_image_url or photo.original_image_url,
        "back": photo.back_image_url or photo.original_image_url,
    }
    if style.get("service") == "Beard":
        sources.pop("back", None)  # a beard is not visible from behind
    errors = {}

    async def one(view: str, url: str):
        try:
            res = await hair_style_generator.generate_view(url, style, analysis, view)
            return view, res.image_url, None
        except ImageEditError as e:
            return view, None, e.reason

    jobs = [one(v, u) for v, u in sources.items() if u and v not in existing]
    db.commit()  # do not hold the connection while the image service works
    for view, url, error in await asyncio.gather(*jobs):
        if url:
            db.add(ServicePhoto(selection_id=selection.id, customer_id=selection.customer_id, stage="ai", view=view, image_url=url))
        else:
            errors[view] = error
    db.commit()
    result = _comparison(db, selection)
    result["errors"] = errors
    result["missing_photos"] = [v for v in ("side", "back") if not (photo.side_image_url if v == "side" else photo.back_image_url)]
    return result


@router.get("/style-selections/{selection_id}/comparison")
def get_selection_comparison(selection_id: int, db: Session = Depends(get_db),
                             principal: Principal = Depends(get_current_principal)):
    """Before / AI-generated / actual after-haircut photos for front, side and back."""
    return _comparison(db, _selection_for(db, selection_id, principal))


class ConfirmHaircutRequest(BaseModel):
    language: Optional[str] = "en"


@router.post("/style-selections/{selection_id}/confirm-haircut")
def confirm_haircut(selection_id: int, payload: ConfirmHaircutRequest, db: Session = Depends(get_db),
                    principal: Principal = Depends(require_staff)):
    """Stylist confirms the look and starts the haircut; the instruction language is kept with the service."""
    selection = _selection_for(db, selection_id, principal)
    if selection.status != "CONFIRMED":
        raise HTTPException(status_code=409, detail="This service is already completed.")
    selection.stylist_approved = True
    selection.haircut_confirmed_at = selection.haircut_confirmed_at or datetime.utcnow()
    if payload.language in instruction_audio.LANGUAGES:
        selection.instruction_language = payload.language
    # Keep the steps the stylist actually followed (catalogue steps + this customer's notes) with the service
    style = get_style(selection.selected_hairstyle_id)
    record = db.query(HaircutInstruction).filter(HaircutInstruction.selection_id == selection.id).first()
    if style and record:
        personal = _style_for_customer(db, style, selection.id, principal)["stylist_instructions"]
        record.steps_json = {"steps": [line.strip() for line in personal.split("\n") if line.strip()]}
    db.commit()
    return {"selection_id": selection.id, "haircut_confirmed_at": selection.haircut_confirmed_at.isoformat(),
            "language": selection.instruction_language}


@router.post("/style-selections/{selection_id}/complete")
async def complete_selection_service(
    selection_id: int,
    front_file: Optional[UploadFile] = File(None),
    side_file: Optional[UploadFile] = File(None),
    back_file: Optional[UploadFile] = File(None),
    rating: int = Form(5),
    branch_id: Optional[int] = Form(None),
    language: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_staff),
):
    """
    After the haircut: stores the actual post-service photos, records the visit (branch, stylist, service,
    amount) in the customer's history, and returns the before / AI / after comparison.
    """
    selection = _selection_for(db, selection_id, principal)
    if selection.status == "COMPLETED":
        raise HTTPException(status_code=409, detail="This service was already completed and recorded.")
    if not selection.haircut_confirmed_at:
        raise HTTPException(status_code=409, detail="Please confirm the haircut with the stylist before completing it.")
    files = {"front": front_file, "side": side_file, "back": back_file}
    if not files["front"]:
        raise HTTPException(status_code=422, detail="Please add at least the front photo of the finished haircut.")
    uploads = {}
    for view, upload in files.items():
        if upload:
            try:
                uploads[view] = normalize_photo(await upload.read())
            except UnidentifiedImageError:
                raise HTTPException(status_code=422, detail=f"The {view} photo could not be opened. Please use a JPG, PNG or HEIC photo.")

    # Claim the selection atomically: of two simultaneous requests (double tap, retry), only one records a visit
    claimed = db.execute(update(StyleSelection)
                         .where(StyleSelection.id == selection.id, StyleSelection.status == "CONFIRMED")
                         .values(status="COMPLETING")).rowcount
    db.commit()
    if not claimed:
        raise HTTPException(status_code=409, detail="This service is already being completed.")
    db.refresh(selection)
    try:
        _record_completed_visit(db, selection, uploads, rating, branch_id, language, principal)
    except Exception:
        db.rollback()
        db.execute(update(StyleSelection).where(StyleSelection.id == selection.id).values(status="CONFIRMED"))
        db.commit()
        raise
    return _comparison(db, selection)


def _record_completed_visit(db: Session, selection: StyleSelection, uploads: dict, rating: int,
                            branch_id: Optional[int], language: Optional[str], principal: Principal) -> None:
    for view, data in uploads.items():
        _, url = storage_service.save_bytes(data, folder="final", filename_prefix=f"cust_{selection.customer_id}_after_{view}")
        db.add(ServicePhoto(selection_id=selection.id, customer_id=selection.customer_id, stage="after", view=view, image_url=url))
    db.flush()

    style = get_style(selection.selected_hairstyle_id) or {}
    service = service_for_style(db, style.get("service", "Hair"))
    user = db.query(User).filter(User.id == principal.id).first() if principal.is_staff else None
    # The visit is credited to the staff member who completes it (their stylist record is created if missing)
    stylist = db.query(Stylist).filter(Stylist.name == user.full_name).first() if user else None
    if user and not stylist:
        stylist = Stylist(name=user.full_name, phone=user.phone or "", branch_id=user.branch_id)
        db.add(stylist)
        db.flush()
    # The branch the stylist is working at today (chosen on the tablet), else their home branch
    chosen = db.query(Branch).filter(Branch.id == branch_id).first() if branch_id else None
    branch_id = chosen.id if chosen else (user.branch_id if user and user.branch_id else
                                          (db.query(Branch).filter(Branch.is_active.is_(True)).order_by(Branch.id).first() or Branch(id=None)).id)
    if language in instruction_audio.LANGUAGES:
        selection.instruction_language = language
    amount = service.price if service else 0.0
    visit = CustomerVisit(customer_id=selection.customer_id, stylist_id=stylist.id if stylist else None,
                          branch_id=branch_id, selection_id=selection.id, status="COMPLETED",
                          total_amount=amount, service_start_time=selection.haircut_confirmed_at,
                          service_end_time=datetime.utcnow())
    db.add(visit)
    db.flush()
    after_front = db.query(ServicePhoto).filter(ServicePhoto.selection_id == selection.id, ServicePhoto.stage == "after",
                                                ServicePhoto.view == "front").order_by(ServicePhoto.id.desc()).first()
    is_beard = style.get("service") == "Beard"
    db.add(ServiceHistory(visit_id=visit.id, service_id=service.id if service else None,
                          hairstyle_id=None if is_beard else selection.selected_hairstyle_id,
                          beard_style_id=selection.selected_hairstyle_id if is_beard else None,
                          reference_image_url=selection.reference_image_url,
                          final_photo_url=after_front.image_url if after_front else None,
                          customer_feedback_rating=max(1, min(5, rating))))
    customer = db.query(Customer).filter(Customer.id == selection.customer_id).first()
    customer.total_visits = (customer.total_visits or 0) + 1
    customer.total_spent = (customer.total_spent or 0.0) + amount
    if not customer.home_branch_id and branch_id:
        customer.home_branch_id = branch_id
    customer.last_visit_date = datetime.utcnow()
    selection.status = "COMPLETED"
    # A referral counts once the referred customer's first paid visit is completed
    referral = db.query(Referral).filter(Referral.referred_customer_id == customer.id,
                                         Referral.status == "REGISTERED").first()
    if referral and amount >= (referral.min_spend_required or 0):
        referral.status = "CONVERTED"
        referral.redeemed_at = datetime.utcnow()
    db.commit()


def _customer_notes(style: dict, analysis: dict) -> List[str]:
    """Extra cutting steps from this customer's hair (texture, density, hairline, beard, face shape)."""
    service = style.get("service", "Hair")
    notes: List[str] = []
    if service == "Hair":
        texture = (analysis.get("hair_type") or "").lower()
        density = analysis.get("hair_density")
        hairline = analysis.get("hairline")
        if texture in ("curly", "coily"):
            notes.append("Curly hair shrinks when dry: cut dry or leave about 1 cm extra length on top and the fringe.")
        elif texture == "wavy":
            notes.append("Wavy hair: leave slightly extra length so the wave sits naturally, and check the shape once dry.")
        if density == "Fine":
            notes.append("Fine hair: point-cut lightly and avoid heavy thinning on top so it keeps its volume.")
        elif density == "Thick":
            notes.append("Thick hair: remove bulk at the crown and sides with texturising or thinning shears.")
        if hairline in ("High", "High / Receding"):
            notes.append("Higher hairline: keep the front slightly longer with a soft fringe to balance the forehead.")
        elif hairline == "Covered by fringe":
            notes.append("The customer wears a fringe now: confirm the new fringe length with them before cutting the front.")
        face = analysis.get("face_shape")
        if face and face != "Unknown":
            notes.append(f"Follow the customer's {face.lower()} face shape and head shape; check symmetry in the mirror before finishing.")
    elif service == "Beard":
        current = analysis.get("beard_style_current")
        if current == "Stubble / Short Beard":
            notes.append("Short beard today: shape the cheek line and neckline without taking off length.")
        elif current == "Clean Shaven":
            notes.append("Clean-shaven today: only a clean shave or light stubble shaping is possible now.")
    elif service == "Texture" and (analysis.get("hair_type") or "").lower() in ("curly", "coily"):
        notes.append("Curly hair: do a strand test first and allow extra processing time.")
    return notes


def _style_for_customer(db: Session, style: dict, selection_id: Optional[int], principal: Principal) -> dict:
    """The style with this customer's notes appended to its cutting steps (when a selection is given)."""
    if not selection_id:
        return style
    selection = _selection_for(db, selection_id, principal)
    photo = _selection_photo(db, selection)
    if not photo:
        return style
    analysis = dict(photo.facial_features_json or {})
    analysis.setdefault("hair_density", photo.hair_density)
    analysis.setdefault("beard_style_current", photo.beard_style_current)
    notes = _customer_notes(style, analysis)
    if not notes:
        return style
    return {**style, "stylist_instructions": style.get("stylist_instructions", "").rstrip() + "\n" + "\n".join(notes)}


@router.get("/instructions/{style_id}")
async def get_style_instructions(style_id: int, lang: str = "en", selection_id: Optional[int] = None,
                                 db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    """Cutting steps in English (en), Hindi (hi) or Tamil (ta), with this customer's notes when selection_id is given."""
    style = get_style(style_id)
    if not style:
        raise HTTPException(status_code=404, detail="Unknown style")
    style = _style_for_customer(db, style, selection_id, principal)
    steps, used = await instruction_audio.get_steps(db, style, lang)
    return {"style_id": style_id, "requested_language": lang, "language": used, "steps": steps,
            "translated": used == lang}


@router.get("/instructions/{style_id}/audio")
async def get_style_instruction_audio(style_id: int, lang: str = "en", selection_id: Optional[int] = None,
                                      db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    """Spoken cutting steps (MP3) in the chosen language."""
    style = get_style(style_id)
    if not style:
        raise HTTPException(status_code=404, detail="Unknown style")
    style = _style_for_customer(db, style, selection_id, principal)
    try:
        path, used = await instruction_audio.get_audio_file(db, style, lang)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Audio is unavailable right now ({type(e).__name__}). Please try again.")
    return FileResponse(path, media_type="audio/mpeg", headers={"X-Audio-Language": used})


def _latest_photo(db: Session, customer_id: int) -> Optional[dict]:
    """
    The customer's latest photo session, so a returning customer can continue without new photos. None once a
    haircut was completed after it or it is older than PHOTO_REUSE_MAX_DAYS: the hair in it is out of date.
    """
    photo = db.query(CustomerPhoto).filter(CustomerPhoto.customer_id == customer_id).order_by(CustomerPhoto.id.desc()).first()
    if not _photo_is_current(db, photo):
        return None
    features = dict(photo.facial_features_json or {})
    features.setdefault("hair_density", photo.hair_density)
    return {"photo_id": photo.id, "original_image_url": photo.original_image_url,
            "date": photo.created_at.strftime("%Y-%m-%d"), "facial_features": features}


@router.get("/customer-history/{customer_id}")
def get_customer_history(customer_id: int, db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)):
    """Service history (date, branch, services, stylist, bill, rating, language, before / AI / after photos,
    cutting steps), style history and saved styles."""
    ensure_customer_access(principal, customer_id)
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    selections = db.query(StyleSelection).filter(StyleSelection.customer_id == customer_id).order_by(StyleSelection.id.desc()).all()
    visits = db.query(CustomerVisit).filter(CustomerVisit.customer_id == customer_id).order_by(CustomerVisit.visit_date.desc()).all()
    branches = {b.id: b.name for b in db.query(Branch).all()}
    stylists = {st.id: st.name for st in db.query(Stylist).all()}
    services = {sv.id: sv.name for sv in db.query(Service).all()}
    history_rows = db.query(ServiceHistory).filter(ServiceHistory.visit_id.in_([v.id for v in visits])).all() if visits else []
    by_visit: dict = {}
    for h in history_rows:
        by_visit.setdefault(h.visit_id, []).append(h)
    selection_by_id = {sel.id: sel for sel in selections}
    steps_by_selection = {i.selection_id: (i.steps_json or {}).get("steps", []) for i in db.query(HaircutInstruction)
                          .filter(HaircutInstruction.selection_id.in_(list(selection_by_id))).all()} if selections else {}

    def style_name(style_id):
        st = get_style(style_id) if style_id else None
        return st["name"] if st else None

    visit_items = []
    for v in visits:
        rows = by_visit.get(v.id, [])
        sel = selection_by_id.get(v.selection_id) if v.selection_id else None
        comparison = _comparison(db, sel) if sel else None
        rating = next((h.customer_feedback_rating for h in rows if h.customer_feedback_rating), None)
        visit_items.append({
            "visit_id": v.id,
            "date": v.visit_date.strftime("%Y-%m-%d"),
            "branch": branches.get(v.branch_id),
            "stylist": stylists.get(v.stylist_id),
            "services": [services.get(h.service_id) for h in rows if services.get(h.service_id)],
            "amount": v.total_amount,
            "status": v.status,
            "rating": rating,
            "style_name": (sel.style_name or style_name(sel.selected_hairstyle_id)) if sel else
            next((style_name(h.hairstyle_id or h.beard_style_id) for h in rows if h.hairstyle_id or h.beard_style_id), None),
            "language": sel.instruction_language if sel else None,
            "instructions": steps_by_selection.get(sel.id, []) if sel else [],
            "selection_id": sel.id if sel else None,
            "images": {k: comparison[k] for k in ("before", "ai", "after")} if comparison else None,
            "is_sample": v.notes == "SAMPLE DATA",
        })

    # AI previews made for this customer (also ones not chosen), newest first
    recs = db.query(StyleRecommendation).filter(StyleRecommendation.customer_id == customer_id) \
        .order_by(StyleRecommendation.id.desc()).all()
    gens = db.query(StyleGeneration).filter(StyleGeneration.recommendation_id.in_([r.id for r in recs])) \
        .order_by(StyleGeneration.id.desc()).all() if recs else []
    # one preview per style (the newest), so a style tried several times is listed once
    ai_previews, seen_styles = [], set()
    for g in gens:
        if g.status == "COMPLETED" and g.generated_image_url and g.style_id not in seen_styles:
            seen_styles.add(g.style_id)
            ai_previews.append({"style_id": g.style_id, "style_name": style_name(g.style_id),
                                "image_url": g.generated_image_url, "date": g.created_at.strftime("%Y-%m-%d")})
    ai_previews = ai_previews[:12]

    # Latest look: the latest chosen style (before / AI / after), else the latest photo session
    latest_look = None
    if selections:
        sel = selections[0]
        latest_look = {"source": "selection", "style_name": sel.style_name or style_name(sel.selected_hairstyle_id),
                       "date": sel.created_at.strftime("%Y-%m-%d"), "status": sel.status,
                       "images": {k: v for k, v in _comparison(db, sel).items() if k in ("before", "ai", "after")},
                       "ai_failed": False}
    else:
        photo = db.query(CustomerPhoto).filter(CustomerPhoto.customer_id == customer_id).order_by(CustomerPhoto.id.desc()).first()
        if photo:
            session_recs = [r.id for r in recs if r.photo_id == photo.id]
            session_gens = [g for g in gens if g.recommendation_id in session_recs]
            done = next((g for g in session_gens if g.status == "COMPLETED" and g.generated_image_url), None)
            latest_look = {"source": "photo", "style_name": style_name(done.style_id) if done else None,
                           "date": photo.created_at.strftime("%Y-%m-%d"), "status": "NOT_SELECTED",
                           "images": {"before": {"front": photo.original_image_url, "side": photo.side_image_url,
                                                 "back": photo.back_image_url},
                                      "ai": {"front": done.generated_image_url if done else None, "side": None, "back": None},
                                      "after": {"front": None, "side": None, "back": None}},
                           "ai_failed": bool(session_gens) and not done}

    return {
        "customer_id": customer_id,
        "full_name": customer.full_name,
        "total_visits": customer.total_visits or 0,
        "total_spent": customer.total_spent or 0.0,
        "latest_look": latest_look,
        "latest_photo": _latest_photo(db, customer_id),
        "ai_previews": ai_previews,
        "selections": [
            {
                "selection_id": sel.id,
                "date": sel.created_at.strftime("%Y-%m-%d"),
                "style_id": sel.selected_hairstyle_id,
                "style_name": sel.style_name or style_name(sel.selected_hairstyle_id),
                "status": sel.status,
                "reference_image_url": sel.reference_image_url,
            } for sel in selections if sel.reference_image_url
        ],
        "saved_styles": [_saved_style_dict(r) for r in db.query(SavedStyle).filter(SavedStyle.customer_id == customer_id)
                         .order_by(SavedStyle.id.desc()).all()],
        "visits": visit_items,
    }

# -------------------------------------------------------------
# 6. Service Completion & Confirmation
# -------------------------------------------------------------
@router.post("/service-completion")
def complete_service_confirmation(payload: ServiceCompletionRequest, db: Session = Depends(get_db), principal: Principal = Depends(require_staff)):
    visit = db.query(CustomerVisit).filter(CustomerVisit.id == payload.visit_id).first()
    if visit:
        visit.status = "COMPLETED"
        db.commit()
    return {"status": "SUCCESS", "message": "Service successfully completed and confirmed!"}

# -------------------------------------------------------------
# 7. Admin Analytics & Capacity Endpoints
# -------------------------------------------------------------
ANALYTICS_WINDOW_DAYS = 90


def _capacity_heatmap(db: Session, branch_id: Optional[int] = None) -> list:
    """Chair utilisation per weekday/hour over the last ANALYTICS_WINDOW_DAYS days of completed visits."""
    end = datetime.utcnow()
    start = end - timedelta(days=ANALYTICS_WINDOW_DAYS)
    q = db.query(CustomerVisit.visit_date, CustomerVisit.service_start_time, CustomerVisit.service_end_time) \
        .filter(CustomerVisit.status == "COMPLETED", CustomerVisit.visit_date >= start)
    branches = db.query(Branch).filter(Branch.is_active.is_(True))
    if branch_id:
        q = q.filter(CustomerVisit.branch_id == branch_id)
        branches = branches.filter(Branch.id == branch_id)
    chairs = sum(b.total_chairs or 0 for b in branches.all()) or 1
    return capacity_engine.get_traffic_heatmap(q.all(), chairs, start, end)


@router.get("/analytics/overview", response_model=DashboardOverview)
def get_dashboard_overview(db: Session = Depends(get_db), principal: Principal = Depends(require_admin)):
    """Totals from completed visits (all time) and chair utilisation over the last 90 days."""
    from app.models.domain import Campaign
    visits = db.query(CustomerVisit).filter(CustomerVisit.status == "COMPLETED")
    total_visits = visits.count()
    revenue = db.query(func.coalesce(func.sum(CustomerVisit.total_amount - func.coalesce(CustomerVisit.discount_amount, 0)), 0.0)) \
        .filter(CustomerVisit.status == "COMPLETED").scalar() or 0.0
    heatmap = _capacity_heatmap(db)
    return DashboardOverview(
        total_customers=db.query(Customer).count(),
        total_revenue=round(float(revenue), 2),
        total_visits=total_visits,
        avg_spending=round(float(revenue) / total_visits, 2) if total_visits else 0.0,
        capacity_utilization_pct=capacity_engine.summary(heatmap)["avg_chair_utilization_pct"],
        active_campaigns_count=db.query(Campaign).filter(Campaign.is_active.is_(True)).count(),
    )


@router.get("/analytics/capacity")
def get_capacity_analytics(branch_id: Optional[int] = None, db: Session = Depends(get_db),
                           principal: Principal = Depends(require_admin)):
    heatmap = _capacity_heatmap(db, branch_id)
    return {"heatmap": heatmap, "window_days": ANALYTICS_WINDOW_DAYS, **capacity_engine.summary(heatmap)}


@router.post("/analytics/recommend-offer", response_model=OfferRecommendationResponse)
def get_offer_recommendation(payload: OfferRecommendationRequest, db: Session = Depends(get_db),
                             principal: Principal = Depends(require_admin)):
    """Personal offer from the customer's real history, the service's price and margin, and the slot's demand."""
    from app.models.domain import Coupon
    customer = db.query(Customer).filter(Customer.id == payload.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    service = db.query(Service).filter(Service.id == payload.service_id, Service.is_active.is_(True)).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    now = datetime.utcnow()
    visits = db.query(CustomerVisit).filter(CustomerVisit.customer_id == customer.id,
                                            CustomerVisit.status == "COMPLETED").order_by(CustomerVisit.visit_date).all()
    recency = (now - visits[-1].visit_date).days if visits else 365
    gaps = [(b.visit_date - a.visit_date).days for a, b in zip(visits, visits[1:])]
    avg_interval = int(sum(gaps) / len(gaps)) if gaps else 30
    is_member = bool(db.query(MembershipTransaction).filter(
        MembershipTransaction.customer_id == customer.id, MembershipTransaction.status == "ACTIVE",
        MembershipTransaction.end_date >= now).first())
    spend = sum(v.total_amount or 0 for v in visits)
    segment = rfm_engine.segment_customer(recency, len(visits), spend, is_member)
    churn = rfm_engine.predict_churn_risk(recency, avg_interval)
    last_discount = next((v.visit_date for v in reversed(visits) if (v.discount_amount or 0) > 0), None)
    last_coupon = db.query(func.max(Coupon.valid_from)).filter(Coupon.customer_id == customer.id).scalar()
    latest = max([d for d in (last_discount, last_coupon) if d], default=None)
    days_since_discount = (now - latest).days if latest else None

    utilization = capacity_engine.slot_utilization(_capacity_heatmap(db), payload.requested_day, payload.requested_hour)
    offer = discount_engine.calculate_discount(
        service_price=service.price,
        min_discount_pct=10.0,
        max_discount_pct=40.0,
        min_margin_pct=30.0,
        cost_price=service.cost_price or 0.0,
        capacity_utilization_pct=utilization if utilization is not None else 50.0,
        customer_segment=segment,
        is_member=is_member,
        days_since_last_discount=days_since_discount,
    )
    coupon = campaign_loyalty_engine.generate_personalized_coupon(
        customer_id=customer.id, service_id=service.id, discount_pct=offer["calculated_discount_pct"])
    if offer["calculated_discount_pct"] > 0:
        db.add(Coupon(coupon_code=coupon["coupon_code"], customer_id=customer.id, service_id=service.id,
                      discount_percentage=offer["calculated_discount_pct"],
                      valid_from=now, valid_until=now + timedelta(days=5), status="GENERATED"))
        db.commit()
    return OfferRecommendationResponse(
        service_name=service.name,
        customer_segment=segment,
        capacity_level=offer["capacity_state"],
        calculated_discount_pct=offer["calculated_discount_pct"],
        final_price=offer["final_price"],
        coupon_code=coupon["coupon_code"] if offer["calculated_discount_pct"] > 0 else "",
        valid_until_days=5,
        explanation=f"{offer['explanation']} Churn risk: {churn['risk_level']}.",
    )


@router.get("/hairstyles")
def list_hairstyles():
    return ALL_STYLES
