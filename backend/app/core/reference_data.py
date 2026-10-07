"""Reference data the visit workflow needs: salon branches and a price-list entry for every service type."""
from sqlalchemy.orm import Session

from app.models.domain import Branch, Customer, CustomerVisit, Service, ServiceCategory, User

# Sample branches created on first start; rename or replace them with the salon's real branches
SAMPLE_BRANCHES = [
    ("BR-001", "LUXE Anna Nagar", "2nd Avenue, Anna Nagar", "Chennai"),
    ("BR-002", "LUXE T. Nagar", "Usman Road, T. Nagar", "Chennai"),
    ("BR-003", "LUXE Velachery", "100 Feet Road, Velachery", "Chennai"),
]

# Which price-list service each style service maps to (created if missing)
SERVICE_FOR_STYLE = {
    "Hair": ("Haircut & Styling", "Hair Care", 500.0, 30),
    "Beard": ("Beard Trim & Sculpting", "Beard & Grooming", 300.0, 20),
    "Colour": ("Premium Hair Color", "Hair Care", 1800.0, 60),
    "Texture": ("Keratin Smoothening", "Hair Care", 2500.0, 90),
}


def seed_reference_data(db: Session) -> None:
    if db.query(Branch).count() == 0:
        for code, name, address, city in SAMPLE_BRANCHES:
            db.add(Branch(branch_code=code, name=name, address=address, city=city, phone="", total_chairs=8, is_active=True))
        db.flush()
    first_branch = db.query(Branch).filter(Branch.is_active.is_(True)).order_by(Branch.id).first()
    if first_branch:
        for user in db.query(User).filter(User.branch_id.is_(None)).all():
            user.branch_id = first_branch.id
    for name, category, price, minutes in SERVICE_FOR_STYLE.values():
        if not db.query(Service).filter(Service.name == name).first():
            cat = db.query(ServiceCategory).filter(ServiceCategory.name == category).first()
            if not cat:
                cat = ServiceCategory(name=category, description=category)
                db.add(cat)
                db.flush()
            db.add(Service(category_id=cat.id, name=name, description=name, price=price, duration_minutes=minutes,
                           is_active=True))
    # Customers without a home branch: the branch they visited most (customers with no visits get one at
    # registration or at their first completed visit)
    for customer in db.query(Customer).filter(Customer.home_branch_id.is_(None)).all():
        counts: dict = {}
        for (branch_id,) in db.query(CustomerVisit.branch_id).filter(CustomerVisit.customer_id == customer.id,
                                                                    CustomerVisit.branch_id.isnot(None)).all():
            counts[branch_id] = counts.get(branch_id, 0) + 1
        if counts:
            customer.home_branch_id = max(counts, key=counts.get)
    db.commit()


def service_for_style(db: Session, style_service: str) -> Service:
    name = SERVICE_FOR_STYLE.get(style_service, SERVICE_FOR_STYLE["Hair"])[0]
    return db.query(Service).filter(Service.name == name).first()
