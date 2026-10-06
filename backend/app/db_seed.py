import sys
import os
sys.path.append(os.path.abspath("."))

from datetime import datetime, timedelta
import random
from app.core.database import SessionLocal, engine, Base
from app.models.domain import (
    Customer, ServiceCategory, Service, Stylist, Hairstyle, BeardStyle,
    CustomerVisit, ServiceHistory, Payment, Membership, LoyaltyAccount, Campaign
)
from app.ai.style_catalogue import HAIRSTYLE_CATALOGUE, BEARD_CATALOGUE

def seed_database():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        # Check if already seeded
        if db.query(Customer).count() > 0:
            print("Database already contains data. Skipping seed.")
            return

        print("Seeding Salon AI Database with initial POC dataset...")

        # 1. Service Categories
        cat_hair = ServiceCategory(name="Hair Care", description="Haircuts, styling, and treatments")
        cat_beard = ServiceCategory(name="Beard & Grooming", description="Beard trimming, shaping, and shaving")
        cat_facial = ServiceCategory(name="Skin & Facial", description="Deep cleansing and radiance facials")
        cat_spa = ServiceCategory(name="Spa & Wellness", description="Head and shoulder relaxation massage")
        db.add_all([cat_hair, cat_beard, cat_facial, cat_spa])
        db.commit()

        # 2. Services
        s1 = Service(category_id=cat_hair.id, name="Haircut & Styling", price=500.0, duration_minutes=30)
        s2 = Service(category_id=cat_hair.id, name="Premium Hair Color", price=1800.0, duration_minutes=60)
        s3 = Service(category_id=cat_beard.id, name="Beard Trim & Sculpting", price=300.0, duration_minutes=20)
        s4 = Service(category_id=cat_facial.id, name="Charcoal Detox Facial", price=1200.0, duration_minutes=45)
        s5 = Service(category_id=cat_spa.id, name="Pedicure & Manicure Combo", price=1500.0, duration_minutes=60)
        db.add_all([s1, s2, s3, s4, s5])
        db.commit()

        # 3. Stylists
        st1 = Stylist(name="Rahul Sharma", phone="9876543210", specialties="Fade Specialist, Modern Hairstyles", experience_years=6, rating=4.9)
        st2 = Stylist(name="Priya Patel", phone="9876543211", specialties="Hair Color, Styling & Spa", experience_years=8, rating=4.8)
        st3 = Stylist(name="Vikram Singh", phone="9876543212", specialties="Classic Cuts & Beard Sculpting", experience_years=5, rating=4.7)
        db.add_all([st1, st2, st3])
        db.commit()

        # 4. Hairstyles Catalogue Seed
        for item in HAIRSTYLE_CATALOGUE:
            h = Hairstyle(
                style_code=item["style_code"],
                name=item["name"],
                category=item["category"],
                suitable_face_shapes=",".join(item["face_shapes"]),
                suitable_hair_types=",".join(item["hair_types"]),
                suitable_hair_lengths=item["hair_length"],
                suitable_hair_densities=item["hair_density"],
                maintenance_level=item["maintenance_level"],
                description=item["description"],
                stylist_instructions=item["stylist_instructions"],
                preview_image_url=item["preview_image_url"]
            )
            db.add(h)
        db.commit()

        # 5. Sample Customers
        sample_customers = [
            ("Alex Mercer", "9876500001", "Regular Customer", 5, 2500.0),
            ("David Miller", "9876500002", "High-Spending Customer", 8, 8400.0),
            ("Rohan Kapoor", "9876500003", "Occasional Customer", 3, 1500.0),
            ("Karan Verma", "9876500004", "Rare / At-Risk Customer", 1, 500.0),
            ("Siddharth Malhotra", "9876500005", "High-Spending Member", 12, 14200.0),
        ]

        for idx, (name, phone, segment, visits, spent) in enumerate(sample_customers):
            c = Customer(
                customer_code=f"CUST-100{idx+1}",
                full_name=name,
                phone_number=phone,
                segment_name=segment,
                total_visits=visits,
                total_spent=spent,
                last_visit_date=datetime.utcnow() - timedelta(days=random.randint(2, 45))
            )
            db.add(c)
            db.flush()

            # Create Loyalty Account
            loyalty = LoyaltyAccount(customer_id=c.id, points_balance=int(spent/50.0), total_points_earned=int(spent/50.0))
            db.add(loyalty)

        db.commit()
        print("Database seed completed successfully!")

    except Exception as e:
        db.rollback()
        print(f"Error seeding database: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()
