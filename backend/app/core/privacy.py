"""
Consent and data-erasure rules for customer photos (biometric data under India's DPDP Act).

  - A photo may only be analysed after consent under the current policy version is recorded.
  - AI previews send the photo to an external image service, which needs its own consent.
  - Profiles of minors (profile "Child" or date of birth under 18) need a parent's or guardian's consent.
  - Customers can withdraw: erase_customer_media() deletes every photo, preview and after-photo and the
    stored face measurements, keeping the visit and billing records.
"""
import glob
import hashlib
import os
from datetime import datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import MEDIA_PREFIX, media_path
from app.core.storage import storage_service
from app.models.domain import (
    Customer, CustomerConsent, CustomerPhoto, CustomerVisit, SavedStyle, ServiceHistory, ServicePhoto,
    StyleGeneration, StyleRecommendation, StyleSelection,
)

# Bump when the consent text shown to customers changes: everyone is asked again
CONSENT_POLICY_VERSION = "2026-10"
ADULT_AGE = 18


def is_minor(customer: Customer) -> bool:
    if (customer.profile_label or "").strip().lower() == "child":
        return True
    if customer.date_of_birth:
        today = datetime.utcnow().date()
        dob = customer.date_of_birth.date()
        age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        return age < ADULT_AGE
    return False


def current_consent(db: Session, customer_id: int) -> Optional[CustomerConsent]:
    """The latest consent recorded under the current policy version (older records do not count)."""
    return (db.query(CustomerConsent)
            .filter(CustomerConsent.customer_id == customer_id, CustomerConsent.policy_version == CONSENT_POLICY_VERSION)
            .order_by(CustomerConsent.id.desc()).first())


def consent_problem(db: Session, customer: Customer, need_ai: bool) -> Optional[str]:
    """Why photos of this customer may not be processed now, or None when consent is in place."""
    consent = current_consent(db, customer.id)
    if not consent or not consent.consent_photo_analysis:
        return "Photo consent is needed before photos can be analysed."
    if is_minor(customer) and not consent.is_minor_parental_consent:
        return "This is a minor's profile: a parent or guardian must give consent first."
    if need_ai and not consent.consent_third_party_ai:
        return "Consent to create AI previews with the external image service is needed first."
    return None


def consent_dict(db: Session, customer: Customer) -> dict:
    consent = current_consent(db, customer.id)
    fields = ("consent_photo_analysis", "consent_third_party_ai", "consent_history_retention",
              "consent_before_after_share", "consent_marketing", "is_minor_parental_consent")
    return {
        "customer_id": customer.id,
        "policy_version": CONSENT_POLICY_VERSION,
        "recorded": consent is not None,
        "is_minor": is_minor(customer),
        **{f: bool(getattr(consent, f)) if consent else False for f in fields},
        "recorded_by": consent.recorded_by if consent else None,
        "updated_at": (consent.updated_at or consent.created_at).isoformat() if consent else None,
        "missing": consent_problem(db, customer, need_ai=True),
    }


def allows_public_share(db: Session, customer_id: int) -> bool:
    consent = current_consent(db, customer_id)
    return bool(consent and consent.consent_before_after_share)


# ---------------------------------------------------------------------------- erasure
def photo_cache_tag(photo_url: str) -> str:
    """Prefix of the AI cache files made from one customer photo, so they can be deleted with it."""
    return hashlib.sha256(media_path(photo_url).encode()).hexdigest()[:12]


def _delete_file(url: Optional[str]) -> None:
    path = media_path(url)
    if not path.startswith(MEDIA_PREFIX):
        return
    full = os.path.abspath(os.path.join(storage_service.base_dir, *path[len(MEDIA_PREFIX):].split("/")))
    if full.startswith(storage_service.base_dir + os.sep) and os.path.isfile(full):
        os.remove(full)


def _delete_cache_for(photo_urls: Iterable[str]) -> None:
    cache_dir = os.path.join(storage_service.base_dir, "ai_cache")
    for url in photo_urls:
        if url:
            for f in glob.glob(os.path.join(cache_dir, f"{photo_cache_tag(url)}_*")):
                os.remove(f)


def erase_photos(db: Session, photos: list) -> int:
    """Deletes these photo sessions' images, their AI previews and cache, and the stored face measurements."""
    if not photos:
        return 0
    photo_ids = [p.id for p in photos]
    _delete_cache_for(u for p in photos for u in (p.original_image_url, p.side_image_url, p.back_image_url))
    rec_ids = [r.id for r in db.query(StyleRecommendation.id).filter(StyleRecommendation.photo_id.in_(photo_ids)).all()]
    if rec_ids:
        for g in db.query(StyleGeneration).filter(StyleGeneration.recommendation_id.in_(rec_ids)).all():
            _delete_file(g.generated_image_url)
            g.generated_image_url = ""
    for p in photos:
        for url in (p.original_image_url, p.side_image_url, p.back_image_url):
            _delete_file(url)
        p.original_image_url = ""
        p.side_image_url = p.back_image_url = None
        p.facial_features_json = {"erased": True}
        p.is_active = False
    return len(photos)


def erase_customer_media(db: Session, customer: Customer) -> dict:
    """All of a customer's photos and previews (visit and billing records are kept, without images)."""
    photos = db.query(CustomerPhoto).filter(CustomerPhoto.customer_id == customer.id).all()
    erased = erase_photos(db, photos)
    for sel in db.query(StyleSelection).filter(StyleSelection.customer_id == customer.id).all():
        _delete_file(sel.reference_image_url)
        sel.reference_image_url = ""
        for sp in db.query(ServicePhoto).filter(ServicePhoto.selection_id == sel.id).all():
            _delete_file(sp.image_url)
            db.delete(sp)
    for row in db.query(SavedStyle).filter(SavedStyle.customer_id == customer.id).all():
        _delete_file(row.image_url)
        db.delete(row)
    visit_ids = [v.id for v in db.query(CustomerVisit.id).filter(CustomerVisit.customer_id == customer.id).all()]
    if visit_ids:
        for h in db.query(ServiceHistory).filter(ServiceHistory.visit_id.in_(visit_ids)).all():
            _delete_file(h.final_photo_url)
            h.reference_image_url = h.final_photo_url = None
    _delete_file(customer.avatar_url)
    customer.avatar_url = None
    db.commit()
    return {"customer_id": customer.id, "photo_sessions_erased": erased}


def purge_expired_media(db: Session, now: Optional[datetime] = None) -> dict:
    """
    Retention job: photo sessions of customers without history-retention consent are erased after
    MEDIA_RETENTION_DAYS_WITHOUT_CONSENT days; AI cache files older than AI_CACHE_MAX_DAYS are removed.
    """
    now = now or datetime.utcnow()
    cutoff = now - timedelta(days=settings.MEDIA_RETENTION_DAYS_WITHOUT_CONSENT)
    erased = 0
    old_photos = db.query(CustomerPhoto).filter(CustomerPhoto.created_at < cutoff, CustomerPhoto.is_active.is_(True)).all()
    by_customer: dict = {}
    for p in old_photos:
        by_customer.setdefault(p.customer_id, []).append(p)
    for customer_id, photos in by_customer.items():
        consent = current_consent(db, customer_id)
        if not (consent and consent.consent_history_retention):
            erased += erase_photos(db, photos)
    db.commit()

    cache_dir = os.path.join(storage_service.base_dir, "ai_cache")
    cache_cutoff = (now - timedelta(days=settings.AI_CACHE_MAX_DAYS)).timestamp()
    cache_removed = 0
    for f in glob.glob(os.path.join(cache_dir, "*")):
        if os.path.isfile(f) and os.path.getmtime(f) < cache_cutoff:
            os.remove(f)
            cache_removed += 1
    return {"photo_sessions_erased": erased, "cache_files_removed": cache_removed}
