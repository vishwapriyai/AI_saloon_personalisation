"""
Authentication and access rules.

Two kinds of login, both returning a signed token (Authorization: Bearer <token>):
  - Staff (users table): Super Admin, Salon Admin, Receptionist, Stylist. Can work with any customer.
  - Customer (customers table): mobile number or customer ID + password. Can only see their own data.
"""
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Deque, Dict, Optional

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_access_token, get_password_hash
from app.models.domain import Customer, Role, User

STAFF_ROLES = {"Super Admin", "Salon Admin", "Receptionist", "Stylist"}
ADMIN_ROLES = {"Super Admin", "Salon Admin"}

# Sample accounts created on first start in development only (APP_ENV=development)
SAMPLE_STAFF = [
    # username, password, full name, role
    ("admin", "Admin@123", "Salon Manager", "Salon Admin"),
    ("stylist", "Stylist@123", "Rahul Sharma", "Stylist"),
]
SAMPLE_CUSTOMER_PASSWORD = "Customer@123"  # development only: demo customers without a password (must change it)


@dataclass
class Principal:
    kind: str            # "staff" or "customer"
    id: int              # users.id or customers.id
    role: str
    name: str
    must_change_password: bool = False  # logged in with a temporary password

    @property
    def is_staff(self) -> bool:
        return self.kind == "staff"

    @property
    def is_admin(self) -> bool:
        return self.kind == "staff" and self.role in ADMIN_ROLES


def principal_from_token(token: str) -> Optional[Principal]:
    payload = decode_access_token(token)
    if not payload or ":" not in str(payload.get("sub", "")):
        return None
    kind, _, raw_id = payload["sub"].partition(":")
    if kind not in ("staff", "customer") or not raw_id.isdigit():
        return None
    return Principal(kind=kind, id=int(raw_id), role=payload.get("role", ""), name=payload.get("name", ""),
                     must_change_password=bool(payload.get("mcp")))


CHANGE_PASSWORD_PATH = "/auth/customer/change-password"


def get_current_principal(request: Request, authorization: Optional[str] = Header(default=None)) -> Principal:
    """Requires a valid login (staff or customer). A temporary-password login may only change the password."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please log in.")
    principal = principal_from_token(authorization.split(" ", 1)[1].strip())
    if principal is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Please log in again.")
    if principal.must_change_password and not request.url.path.endswith(CHANGE_PASSWORD_PATH):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Please choose your own password first.")
    return principal


def require_staff(principal: Principal = Depends(get_current_principal)) -> Principal:
    if not principal.is_staff:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This is available to salon staff only.")
    return principal


def require_admin(principal: Principal = Depends(get_current_principal)) -> Principal:
    if not principal.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This is available to salon admins only.")
    return principal


def ensure_customer_access(principal: Principal, customer_id: Optional[int]) -> None:
    """Customers may only access their own records; staff may access any customer."""
    if principal.is_staff:
        return
    if customer_id is None or principal.id != customer_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only access your own information.")


def seed_auth(db: Session) -> None:
    """
    Creates the staff roles. In development only, also the sample staff accounts and a sample password for
    existing demo customers that have none. Production never creates known passwords.
    """
    roles = {r.name: r for r in db.query(Role).all()}
    for name in ("Super Admin", "Salon Admin", "Receptionist", "Stylist"):
        if name not in roles:
            roles[name] = Role(name=name, description=f"{name} account")
            db.add(roles[name])
    db.flush()
    if not settings.is_production:
        for username, password, full_name, role in SAMPLE_STAFF:
            if not db.query(User).filter(User.username == username).first():
                db.add(User(username=username, hashed_password=get_password_hash(password), full_name=full_name,
                            role_id=roles[role].id, is_active=True))
        for customer in db.query(Customer).filter(Customer.password_hash.is_(None)).all():
            customer.password_hash = get_password_hash(SAMPLE_CUSTOMER_PASSWORD)
            customer.must_change_password = True
    db.commit()


# ---------------------------------------------------------------------------- login throttling
# In-memory, per process: enough for a single-server salon install. Use Redis when running several workers.
_failures: Dict[str, Deque[float]] = defaultdict(deque)
_failures_lock = threading.Lock()


def _recent(key: str, now: float) -> Deque[float]:
    window = settings.LOGIN_LOCKOUT_MINUTES * 60
    q = _failures[key]
    while q and q[0] < now - window:
        q.popleft()
    return q


def check_login_allowed(*keys: str) -> None:
    """Raises 429 while any key (account identifier or client address) is locked out."""
    now = time.monotonic()
    with _failures_lock:
        if any(len(_recent(k, now)) >= settings.LOGIN_MAX_FAILURES for k in keys if k):
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                                f"Too many failed attempts. Please try again in {settings.LOGIN_LOCKOUT_MINUTES} minutes.")


def record_login_failure(*keys: str) -> None:
    now = time.monotonic()
    with _failures_lock:
        for k in keys:
            if k:
                _recent(k, now).append(now)


def clear_login_failures(*keys: str) -> None:
    with _failures_lock:
        for k in keys:
            _failures.pop(k, None)
