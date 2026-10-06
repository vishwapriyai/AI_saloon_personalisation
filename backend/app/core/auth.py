"""
Authentication and access rules.

Two kinds of login, both returning a signed token (Authorization: Bearer <token>):
  - Staff (users table): Super Admin, Salon Admin, Receptionist, Stylist. Can work with any customer.
  - Customer (customers table): mobile number or customer ID + password. Can only see their own data.
"""
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token, get_password_hash
from app.models.domain import Customer, Role, User

STAFF_ROLES = {"Super Admin", "Salon Admin", "Receptionist", "Stylist"}
ADMIN_ROLES = {"Super Admin", "Salon Admin"}

# Sample accounts created on first start (change these passwords before real use)
SAMPLE_STAFF = [
    # username, password, full name, role
    ("admin", "Admin@123", "Salon Manager", "Salon Admin"),
    ("stylist", "Stylist@123", "Rahul Sharma", "Stylist"),
]
SAMPLE_CUSTOMER_PASSWORD = "Customer@123"  # given to existing customers that have no password yet


@dataclass
class Principal:
    kind: str            # "staff" or "customer"
    id: int              # users.id or customers.id
    role: str
    name: str

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
    return Principal(kind=kind, id=int(raw_id), role=payload.get("role", ""), name=payload.get("name", ""))


def get_current_principal(authorization: Optional[str] = Header(default=None)) -> Principal:
    """Requires a valid login (staff or customer)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please log in.")
    principal = principal_from_token(authorization.split(" ", 1)[1].strip())
    if principal is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Please log in again.")
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
    """Creates the staff roles and sample accounts, and a sample password for customers without one."""
    roles = {r.name: r for r in db.query(Role).all()}
    for name in ("Super Admin", "Salon Admin", "Receptionist", "Stylist"):
        if name not in roles:
            roles[name] = Role(name=name, description=f"{name} account")
            db.add(roles[name])
    db.flush()
    for username, password, full_name, role in SAMPLE_STAFF:
        if not db.query(User).filter(User.username == username).first():
            db.add(User(username=username, hashed_password=get_password_hash(password), full_name=full_name,
                        role_id=roles[role].id, is_active=True))
    for customer in db.query(Customer).filter(Customer.password_hash.is_(None)).all():
        customer.password_hash = get_password_hash(SAMPLE_CUSTOMER_PASSWORD)
    db.commit()
