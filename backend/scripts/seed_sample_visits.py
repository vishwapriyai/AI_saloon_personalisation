"""
Sample visit history for demo customers whose profile has visit totals but no visit records, so the
profile and stylist view can show branches visited and frequent services. Every row is marked
notes='SAMPLE DATA'. Real visits are recorded automatically when a haircut is completed in the app.

    cd backend
    python scripts/seed_sample_visits.py            # add sample visits (only for customers with none)
    python scripts/seed_sample_visits.py --remove   # delete all sample visits again
"""
import argparse
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.database import SessionLocal  # noqa: E402
import app.models.domain  # noqa: E402,F401
from app.models.domain import Branch, Customer, CustomerVisit, Service, ServiceHistory, Stylist  # noqa: E402

MARK = "SAMPLE DATA"
# Services per visit, chosen by how much the customer spends per visit
BASKETS = [
    (0, ["Haircut & Styling"]),
    (700, ["Haircut & Styling", "Beard Trim & Sculpting"]),
    (1500, ["Haircut & Styling", "Charcoal Detox Facial"]),
    (2500, ["Haircut & Styling", "Premium Hair Color"]),
]


def remove(db):
    visits = db.query(CustomerVisit).filter(CustomerVisit.notes == MARK).all()
    ids = [v.id for v in visits]
    if ids:
        db.query(ServiceHistory).filter(ServiceHistory.visit_id.in_(ids)).delete(synchronize_session=False)
        db.query(CustomerVisit).filter(CustomerVisit.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    print(f"Removed {len(ids)} sample visits.")


def add(db):
    services = {s.name: s for s in db.query(Service).all()}
    branches = db.query(Branch).filter(Branch.is_active.is_(True)).order_by(Branch.id).all()
    stylists = db.query(Stylist).order_by(Stylist.id).all()
    if not branches or not stylists:
        sys.exit("Branches and stylists are needed first (start the backend once to create them).")
    added = 0
    for c in db.query(Customer).order_by(Customer.id).all():
        if not c.total_visits or db.query(CustomerVisit).filter(CustomerVisit.customer_id == c.id).count():
            continue
        per_visit = (c.total_spent or 0) / c.total_visits
        basket = [name for limit, names in BASKETS if per_visit >= limit for name in [names]][-1]
        for i in range(c.total_visits):
            # mostly the customer's home branch, sometimes another one
            branch = branches[(c.id + (1 if i % 3 == 2 else 0)) % len(branches)]
            # alternate the extra service so frequent services vary
            names = basket if i % 2 == 0 else basket[:1]
            when = datetime.utcnow() - timedelta(days=21 * (c.total_visits - i))
            visit = CustomerVisit(customer_id=c.id, stylist_id=stylists[(c.id + i) % len(stylists)].id,
                                  branch_id=branch.id, visit_date=when, service_end_time=when, status="COMPLETED",
                                  total_amount=round(per_visit, 2), notes=MARK)
            db.add(visit)
            db.flush()
            for name in names:
                if name in services:
                    db.add(ServiceHistory(visit_id=visit.id, service_id=services[name].id, created_at=when))
            added += 1
    db.commit()
    print(f"Added {added} sample visits.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--remove", action="store_true")
    args = ap.parse_args()
    with SessionLocal() as db:
        remove(db) if args.remove else add(db)
