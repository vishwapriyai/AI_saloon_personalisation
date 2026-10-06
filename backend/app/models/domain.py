from datetime import datetime
from typing import Optional, List
from sqlalchemy import (
    String, Integer, Float, Boolean, DateTime, ForeignKey, Text, JSON, Enum
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

# 1. Users, Roles & Permissions
class Branch(Base):
    __tablename__ = "branches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    branch_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    address: Mapped[str] = mapped_column(String(255))
    city: Mapped[str] = mapped_column(String(100))
    phone: Mapped[str] = mapped_column(String(20))
    total_chairs: Mapped[int] = mapped_column(Integer, default=8)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

class Role(Base):
    __tablename__ = "roles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, index=True)  # Admin, Stylist, Receptionist, Customer
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

class Permission(Base):
    __tablename__ = "permissions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    branch_id: Mapped[Optional[int]] = mapped_column(ForeignKey("branches.id"), nullable=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

# 2. Customers & Preferences
class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    customer_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(100))
    phone_number: Mapped[str] = mapped_column(String(20), index=True)  # Multiple profiles can share same phone (Family)
    profile_label: Mapped[str] = mapped_column(String(50), default="Self")  # Self, Spouse, Child, Parent
    email: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    gender: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # Female, Male, Unisex/All
    date_of_birth: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    segment_name: Mapped[str] = mapped_column(String(50), default="Regular Customer")
    total_visits: Mapped[int] = mapped_column(Integer, default=0)
    total_spent: Mapped[float] = mapped_column(Float, default=0.0)
    last_visit_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # customer login
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class CustomerConsent(Base):
    __tablename__ = "customer_consents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    consent_photo_analysis: Mapped[bool] = mapped_column(Boolean, default=True)
    consent_history_retention: Mapped[bool] = mapped_column(Boolean, default=True)
    consent_marketing: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_before_after_share: Mapped[bool] = mapped_column(Boolean, default=False)
    is_minor_parental_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    dpdp_act_compliant: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class CustomerPreference(Base):
    __tablename__ = "customer_preferences"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    preferred_stylist_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    preferred_category: Mapped[str] = mapped_column(String(50), default="Trendy")
    hair_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    face_shape: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

class CustomerSegment(Base):
    __tablename__ = "customer_segments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    recency_min_days: Mapped[int] = mapped_column(Integer, default=0)
    recency_max_days: Mapped[int] = mapped_column(Integer, default=365)
    min_frequency: Mapped[int] = mapped_column(Integer, default=1)
    min_spend: Mapped[float] = mapped_column(Float, default=0.0)
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

# 3. Customer Photos & Analysis
class CustomerPhoto(Base):
    __tablename__ = "customer_photos"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    original_image_url: Mapped[str] = mapped_column(String(500))
    face_shape: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    hair_length: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    hair_density: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    beard_style_current: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    facial_features_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

# 4. Stylists & Services
class Stylist(Base):
    __tablename__ = "stylists"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    branch_id: Mapped[Optional[int]] = mapped_column(ForeignKey("branches.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(100))
    phone: Mapped[str] = mapped_column(String(20))
    specialties: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    experience_years: Mapped[int] = mapped_column(Integer, default=3)
    rating: Mapped[float] = mapped_column(Float, default=4.8)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)

class StylistSkill(Base):
    __tablename__ = "stylist_skills"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    stylist_id: Mapped[int] = mapped_column(ForeignKey("stylists.id"))
    skill_name: Mapped[str] = mapped_column(String(100))  # Haircut, Balayage, Keratin, Beard, Spa
    proficiency_level: Mapped[str] = mapped_column(String(50), default="Expert")

class StylistShift(Base):
    __tablename__ = "stylist_shifts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    stylist_id: Mapped[int] = mapped_column(ForeignKey("stylists.id"))
    day_of_week: Mapped[str] = mapped_column(String(20))
    start_time: Mapped[str] = mapped_column(String(10))  # 09:00
    end_time: Mapped[str] = mapped_column(String(10))    # 18:00
    is_on_duty: Mapped[bool] = mapped_column(Boolean, default=True)

class ServiceCategory(Base):
    __tablename__ = "service_categories"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

class Service(Base):
    __tablename__ = "services"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("service_categories.id"))
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    price: Mapped[float] = mapped_column(Float)
    cost_price: Mapped[float] = mapped_column(Float, default=0.0)  # Product + Stylist commission cost for margin calculation
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    requires_chemical: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

class Appointment(Base):
    __tablename__ = "appointments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    appointment_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    stylist_id: Mapped[int] = mapped_column(ForeignKey("stylists.id"))
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id"))
    branch_id: Mapped[Optional[int]] = mapped_column(ForeignKey("branches.id"), nullable=True)
    appointment_time: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(50), default="BOOKED")  # BOOKED, IN_CHAIR, COMPLETED, CANCELLED
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

# 5. Hairstyle & Beard Style Catalogue
class Hairstyle(Base):
    __tablename__ = "hairstyles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    style_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(50))  # Classic, Trendy, Professional
    suitable_face_shapes: Mapped[str] = mapped_column(String(255))
    suitable_hair_types: Mapped[str] = mapped_column(String(255))  # 1A-4C textures
    suitable_hair_lengths: Mapped[str] = mapped_column(String(255))  # Pixie, Bob, Lob, Shoulder, Mid-Back, Long
    suitable_hair_densities: Mapped[str] = mapped_column(String(255))
    gender: Mapped[str] = mapped_column(String(20), default="Unisex")
    maintenance_level: Mapped[str] = mapped_column(String(50), default="Medium")
    requires_chemical_service: Mapped[bool] = mapped_column(Boolean, default=False)
    chemical_service_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # Perm, Balayage, Smoothening
    chemical_formula_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    description: Mapped[str] = mapped_column(Text)
    stylist_instructions: Mapped[str] = mapped_column(Text)
    preview_image_url: Mapped[str] = mapped_column(String(500))
    side_image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    back_image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

class BeardStyle(Base):
    __tablename__ = "beard_styles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    style_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(50))
    suitable_face_shapes: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text)
    stylist_instructions: Mapped[str] = mapped_column(Text)
    preview_image_url: Mapped[str] = mapped_column(String(500))

# 6. AI Recommendations & Generations
class StyleRecommendation(Base):
    __tablename__ = "style_recommendations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    photo_id: Mapped[int] = mapped_column(ForeignKey("customer_photos.id"))
    target_service_type: Mapped[str] = mapped_column(String(255))  # several services, e.g. "Hair, Beard, Colour / Balayage"
    style_category: Mapped[str] = mapped_column(String(50))
    recommended_style_ids_json: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class StyleGeneration(Base):
    __tablename__ = "style_generations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    job_id: Mapped[str] = mapped_column(String(100), index=True)
    recommendation_id: Mapped[int] = mapped_column(ForeignKey("style_recommendations.id"))
    style_id: Mapped[int] = mapped_column(ForeignKey("hairstyles.id"))
    generated_image_url: Mapped[str] = mapped_column(String(500))
    prompt_used: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="COMPLETED")
    progress_percentage: Mapped[int] = mapped_column(Integer, default=100)
    model_used: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    identity_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hair_consistency_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    generation_attempt: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    failure_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class StyleSelection(Base):
    __tablename__ = "style_selections"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    selected_hairstyle_id: Mapped[Optional[int]] = mapped_column(ForeignKey("hairstyles.id"), nullable=True)
    selected_beardstyle_id: Mapped[Optional[int]] = mapped_column(ForeignKey("beard_styles.id"), nullable=True)
    reference_image_url: Mapped[str] = mapped_column(String(500))
    stylist_approved: Mapped[bool] = mapped_column(Boolean, default=True)
    stylist_rejection_reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="CONFIRMED")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class HaircutInstruction(Base):
    __tablename__ = "haircut_instructions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    selection_id: Mapped[int] = mapped_column(ForeignKey("style_selections.id"))
    steps_json: Mapped[dict] = mapped_column(JSON)
    audio_instruction_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

# 7. Customer Visits, History & Confirmation
class CustomerVisit(Base):
    __tablename__ = "customer_visits"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    stylist_id: Mapped[int] = mapped_column(ForeignKey("stylists.id"))
    visit_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    service_start_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    service_end_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="COMPLETED")
    total_amount: Mapped[float] = mapped_column(Float)
    discount_amount: Mapped[float] = mapped_column(Float, default=0.0)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

class ServiceHistory(Base):
    __tablename__ = "service_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("customer_visits.id"))
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id"))
    hairstyle_id: Mapped[Optional[int]] = mapped_column(ForeignKey("hairstyles.id"), nullable=True)
    beard_style_id: Mapped[Optional[int]] = mapped_column(ForeignKey("beard_styles.id"), nullable=True)
    reference_image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    final_photo_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    customer_feedback_rating: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("customer_visits.id"))
    amount: Mapped[float] = mapped_column(Float)
    payment_method: Mapped[str] = mapped_column(String(50))
    transaction_reference: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    paid_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

# 8. Memberships, Loyalty & Referrals
class Membership(Base):
    __tablename__ = "memberships"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    price: Mapped[float] = mapped_column(Float)
    duration_days: Mapped[int] = mapped_column(Integer, default=365)
    discount_percentage: Mapped[float] = mapped_column(Float, default=10.0)
    loyalty_multiplier: Mapped[float] = mapped_column(Float, default=1.5)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

class MembershipTransaction(Base):
    __tablename__ = "membership_transactions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    membership_id: Mapped[int] = mapped_column(ForeignKey("memberships.id"))
    start_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    end_date: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(50), default="ACTIVE")

class LoyaltyAccount(Base):
    __tablename__ = "loyalty_accounts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), unique=True)
    points_balance: Mapped[int] = mapped_column(Integer, default=0)
    total_points_earned: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class LoyaltyTransaction(Base):
    __tablename__ = "loyalty_transactions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    loyalty_account_id: Mapped[int] = mapped_column(ForeignKey("loyalty_accounts.id"))
    points: Mapped[int] = mapped_column(Integer)
    transaction_type: Mapped[str] = mapped_column(String(50))
    description: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

# 9. Campaigns, Coupons & Referrals
class Campaign(Base):
    __tablename__ = "campaigns"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(100))
    target_segment: Mapped[str] = mapped_column(String(50))
    channel: Mapped[str] = mapped_column(String(50))
    discount_type: Mapped[str] = mapped_column(String(50), default="PERCENTAGE")
    discount_value: Mapped[float] = mapped_column(Float)
    is_control_group_excluded: Mapped[bool] = mapped_column(Boolean, default=False)  # 5-10% control group for true uplift analytics
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Coupon(Base):
    __tablename__ = "coupons"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    coupon_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    campaign_id: Mapped[Optional[int]] = mapped_column(ForeignKey("campaigns.id"), nullable=True)
    service_id: Mapped[Optional[int]] = mapped_column(ForeignKey("services.id"), nullable=True)
    discount_percentage: Mapped[float] = mapped_column(Float)
    valid_from: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    valid_until: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(50), default="GENERATED")

class CouponRedemption(Base):
    __tablename__ = "coupon_redemptions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    coupon_id: Mapped[int] = mapped_column(ForeignKey("coupons.id"))
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    visit_id: Mapped[int] = mapped_column(ForeignKey("customer_visits.id"))
    redeemed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Referral(Base):
    __tablename__ = "referrals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    referral_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    referrer_customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    referred_customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"), nullable=True)
    coupon_id: Mapped[Optional[int]] = mapped_column(ForeignKey("coupons.id"), nullable=True)
    min_spend_required: Mapped[float] = mapped_column(Float, default=300.0)  # Anti-fraud min spend
    status: Mapped[str] = mapped_column(String(50), default="PENDING")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    redeemed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

class NotificationLog(Base):
    __tablename__ = "notification_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    channel: Mapped[str] = mapped_column(String(50))  # WHATSAPP, SMS
    template_name: Mapped[str] = mapped_column(String(100))
    trai_dlt_template_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # TRAI DLT registration in India
    status: Mapped[str] = mapped_column(String(50), default="SENT")
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

# 10. Salon Capacity & Resources
class SalonCapacity(Base):
    __tablename__ = "salon_capacity"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    day_of_week: Mapped[str] = mapped_column(String(20))
    hour_of_day: Mapped[int] = mapped_column(Integer)
    total_chairs: Mapped[int] = mapped_column(Integer, default=8)
    active_stylists: Mapped[int] = mapped_column(Integer, default=6)
    booked_slots: Mapped[int] = mapped_column(Integer, default=0)
    utilization_percentage: Mapped[float] = mapped_column(Float, default=0.0)

class SalonResource(Base):
    __tablename__ = "salon_resources"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    resource_name: Mapped[str] = mapped_column(String(100))
    resource_type: Mapped[str] = mapped_column(String(50), default="CHAIR")
    is_operational: Mapped[bool] = mapped_column(Boolean, default=True)

# 11. Analytics Snapshots, Feedback & Audit Logs
class AnalyticsSnapshot(Base):
    __tablename__ = "analytics_snapshots"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    snapshot_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    total_revenue: Mapped[float] = mapped_column(Float)
    total_visits: Mapped[int] = mapped_column(Integer)
    avg_spend_per_customer: Mapped[float] = mapped_column(Float)
    capacity_utilization_avg: Mapped[float] = mapped_column(Float)
    top_service_name: Mapped[str] = mapped_column(String(100))
    snapshot_data_json: Mapped[dict] = mapped_column(JSON)

class AIFeedback(Base):
    __tablename__ = "ai_feedback"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    style_id: Mapped[int] = mapped_column(ForeignKey("hairstyles.id"))
    action: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String(100))
    details: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

