"""Access rules and service-flow guards through the HTTP API (no AI providers are called)."""
from datetime import datetime, timedelta

import pytest

from app.core.privacy import CONSENT_POLICY_VERSION
from app.core.security import create_access_token, get_password_hash
from app.models.domain import (
    Customer, CustomerConsent, CustomerPhoto, Referral, Role, StyleRecommendation, StyleSelection, User,
)

_counter = [9000]


def _phone() -> str:
    _counter[0] += 1
    return f"98765{_counter[0]:05d}"


def _customer(db, **extra) -> Customer:
    c = Customer(customer_code=f"CUST-T{_counter[0]}", full_name="Test Customer", phone_number=_phone(),
                 password_hash=get_password_hash("Passw0rd!"), segment_name="New Customer", **extra)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _staff_token(db, role: str) -> str:
    role_row = db.query(Role).filter(Role.name == role).first()
    username = f"{role.lower().replace(' ', '')}_{_counter[0]}"
    _counter[0] += 1
    user = User(username=username, hashed_password=get_password_hash("Staff123!"), full_name=role,
                role_id=role_row.id, is_active=True)
    db.add(user)
    db.commit()
    return create_access_token({"sub": f"staff:{user.id}", "role": role, "name": role})


def _customer_token(c: Customer) -> str:
    return create_access_token({"sub": f"customer:{c.id}", "role": "Customer", "name": c.full_name})


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _selection(db, customer, confirmed=True) -> StyleSelection:
    photo = CustomerPhoto(customer_id=customer.id, original_image_url="/static/media/original/x.jpg",
                          face_shape="Oval", hair_length="Medium", hair_density="Medium", facial_features_json={})
    db.add(photo)
    db.flush()
    rec = StyleRecommendation(customer_id=customer.id, photo_id=photo.id, target_service_type="Hair",
                              style_category="Trendy", recommended_style_ids_json=[1])
    db.add(rec)
    db.flush()
    sel = StyleSelection(customer_id=customer.id, selected_hairstyle_id=1, reference_image_url="",
                         recommendation_id=rec.id, status="CONFIRMED",
                         haircut_confirmed_at=datetime.utcnow() if confirmed else None)
    db.add(sel)
    db.commit()
    db.refresh(sel)
    return sel


JPEG = None


def _jpeg() -> bytes:
    global JPEG
    if JPEG is None:
        import io
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (64, 64), (120, 90, 60)).save(buf, format="JPEG")
        JPEG = buf.getvalue()
    return JPEG


# ---------------------------------------------------------------- login and passwords
def test_staff_created_customer_gets_one_time_password(client, db):
    token = _staff_token(db, "Receptionist")
    phone = _phone()
    res = client.post("/api/v1/customers", json={"full_name": "Walk In", "phone_number": phone}, headers=_auth(token))
    assert res.status_code == 200, res.text
    temp = res.json()["temporary_password"]
    assert temp and temp != "Customer@123"

    login = client.post("/api/v1/auth/customer/login", json={"identifier": phone, "password": temp}).json()
    assert login["must_change_password"] is True
    # the temporary-password session can do nothing except change the password
    cid = login["customer"]["id"]
    assert client.get(f"/api/v1/customer-history/{cid}", headers=_auth(login["access_token"])).status_code == 403
    bad = client.post("/api/v1/auth/customer/change-password", headers=_auth(login["access_token"]),
                      json={"current_password": temp, "new_password": "short"})
    assert bad.status_code == 422
    ok = client.post("/api/v1/auth/customer/change-password", headers=_auth(login["access_token"]),
                     json={"current_password": temp, "new_password": "NewPass123"})
    assert ok.status_code == 200
    assert client.get(f"/api/v1/customer-history/{cid}", headers=_auth(ok.json()["access_token"])).status_code == 200
    again = client.post("/api/v1/auth/customer/login", json={"identifier": phone, "password": "NewPass123"}).json()
    assert again["must_change_password"] is False


def test_login_lockout_after_repeated_failures(client, db):
    c = _customer(db)
    for _ in range(5):
        assert client.post("/api/v1/auth/customer/login",
                           json={"identifier": c.phone_number, "password": "wrong"}).status_code == 401
    locked = client.post("/api/v1/auth/customer/login", json={"identifier": c.phone_number, "password": "Passw0rd!"})
    assert locked.status_code == 429


def test_registration_validates_mobile_and_password(client):
    assert client.post("/api/v1/auth/customer/register", json={
        "full_name": "A", "phone_number": "1234567890", "password": "Passw0rd1"}).status_code == 422
    assert client.post("/api/v1/auth/customer/register", json={
        "full_name": "A", "phone_number": _phone(), "password": "abcdefgh"}).status_code == 422
    assert client.post("/api/v1/auth/customer/register", json={
        "full_name": "A", "phone_number": _phone(), "password": "abcd1234"}).status_code == 200


# ---------------------------------------------------------------- roles and ownership
def test_customer_cannot_approve_or_complete_own_haircut(client, db):
    c = _customer(db)
    sel = _selection(db, c, confirmed=False)
    token = _customer_token(c)
    assert client.post(f"/api/v1/style-selections/{sel.id}/confirm-haircut", json={"language": "en"},
                       headers=_auth(token)).status_code == 403
    assert client.post(f"/api/v1/style-selections/{sel.id}/complete", headers=_auth(token),
                       files={"front_file": ("a.jpg", _jpeg(), "image/jpeg")}).status_code == 403


def test_complete_only_once_and_only_after_confirmation(client, db):
    c = _customer(db)
    stylist = _staff_token(db, "Stylist")
    sel = _selection(db, c, confirmed=False)
    files = {"front_file": ("a.jpg", _jpeg(), "image/jpeg")}
    assert client.post(f"/api/v1/style-selections/{sel.id}/complete", headers=_auth(stylist), files=files).status_code == 409
    assert client.post(f"/api/v1/style-selections/{sel.id}/confirm-haircut", json={"language": "en"},
                       headers=_auth(stylist)).status_code == 200
    first = client.post(f"/api/v1/style-selections/{sel.id}/complete", headers=_auth(stylist), files=files)
    assert first.status_code == 200, first.text
    second = client.post(f"/api/v1/style-selections/{sel.id}/complete", headers=_auth(stylist), files=files)
    assert second.status_code == 409
    db.expire_all()
    assert db.get(Customer, c.id).total_visits == 1


def test_other_customers_records_are_off_limits(client, db):
    owner, other = _customer(db), _customer(db)
    sel = _selection(db, owner)
    token = _customer_token(other)
    assert client.get(f"/api/v1/style-selections/{sel.id}/comparison", headers=_auth(token)).status_code == 403
    assert client.get(f"/api/v1/instructions/1?lang=en&selection_id={sel.id}", headers=_auth(token)).status_code == 403
    # a recommendation id from another customer cannot be attached to your own selection
    res = client.post("/api/v1/style-selections", headers=_auth(token), json={
        "customer_id": other.id, "hairstyle_id": 1, "reference_image_url": "", "recommendation_id": sel.recommendation_id})
    assert res.status_code == 403
    # nor can an arbitrary image be used as the reference
    res = client.post("/api/v1/style-selections", headers=_auth(token), json={
        "customer_id": other.id, "hairstyle_id": 1, "reference_image_url": "/static/media/generated/someone_else.jpg"})
    assert res.status_code == 422


def test_analytics_is_admin_only(client, db):
    assert client.get("/api/v1/analytics/overview", headers=_auth(_staff_token(db, "Stylist"))).status_code == 403
    res = client.get("/api/v1/analytics/overview", headers=_auth(_staff_token(db, "Salon Admin")))
    assert res.status_code == 200 and res.json()["total_revenue"] >= 0


# ---------------------------------------------------------------- consent and media
def test_photo_upload_needs_consent_and_minor_needs_parent(client, db):
    c = _customer(db, profile_label="Child")
    token = _customer_token(c)
    files = {"file": ("a.jpg", _jpeg(), "image/jpeg")}
    assert client.post(f"/api/v1/customers/{c.id}/photo", headers=_auth(token), files=files).status_code == 403
    # the customer cannot record a parent's consent themselves
    body = {"consent_photo_analysis": True, "consent_third_party_ai": True, "is_minor_parental_consent": True}
    assert client.put(f"/api/v1/customers/{c.id}/consent", json=body, headers=_auth(token)).status_code == 403
    staff = _staff_token(db, "Stylist")
    state = client.put(f"/api/v1/customers/{c.id}/consent", json=body, headers=_auth(staff)).json()
    assert state["missing"] is None and state["policy_version"] == CONSENT_POLICY_VERSION


def test_media_needs_a_valid_signature(client, app_module):
    import os
    from app.core.config import settings
    folder = os.path.join(os.path.abspath(settings.STORAGE_LOCAL_DIR), "original")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "probe.jpg"), "wb") as f:
        f.write(_jpeg())
    assert client.get("/static/media/original/probe.jpg").status_code == 403
    from app.core.security import sign_media_url
    assert client.get(sign_media_url("/static/media/original/probe.jpg")).status_code == 200
    assert client.get(sign_media_url("/static/media/../../etc/passwd")).status_code in (403, 404)


def test_shared_link_hides_photo_without_sharing_consent(client, db):
    c = _customer(db)
    db.add(StyleSelection(customer_id=c.id, selected_hairstyle_id=1, reference_image_url="/static/media/generated/r.jpg",
                          status="CONFIRMED"))
    db.add(Referral(referral_code=f"LUXE-T{c.id}", referrer_customer_id=c.id, status="SHARE_LINK"))
    db.commit()
    assert client.get(f"/api/v1/referrals/LUXE-T{c.id}/public").json()["reference_image_url"] is None
    db.add(CustomerConsent(customer_id=c.id, policy_version=CONSENT_POLICY_VERSION, consent_photo_analysis=True,
                           consent_before_after_share=True))
    db.commit()
    assert client.get(f"/api/v1/referrals/LUXE-T{c.id}/public").json()["reference_image_url"].startswith("/static/media/")


def test_old_photo_session_is_not_offered_after_a_haircut(app_module, db):
    from app.api.v1.endpoints import _latest_photo
    from app.models.domain import CustomerVisit
    c = _customer(db)
    db.add(CustomerPhoto(customer_id=c.id, original_image_url="/static/media/original/o.jpg", facial_features_json={},
                         created_at=datetime.utcnow() - timedelta(days=2)))
    db.commit()
    assert _latest_photo(db, c.id) is not None
    from app.models.domain import Stylist
    stylist = Stylist(name="Test Stylist", phone="")
    db.add(stylist)
    db.flush()
    db.add(CustomerVisit(customer_id=c.id, stylist_id=stylist.id, status="COMPLETED", total_amount=500,
                         visit_date=datetime.utcnow() - timedelta(days=1)))
    db.commit()
    assert _latest_photo(db, c.id) is None
