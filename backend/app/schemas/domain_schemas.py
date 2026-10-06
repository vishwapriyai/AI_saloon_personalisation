from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

# 1. Customer Schemas
class CustomerBase(BaseModel):
    full_name: str
    phone_number: str
    email: Optional[str] = None
    gender: Optional[str] = "Male"

class CustomerCreate(CustomerBase):
    referral_code: Optional[str] = None  # code from a friend's shared link, if any

class CustomerResponse(CustomerBase):
    id: int
    customer_code: str
    avatar_url: Optional[str] = None
    segment_name: str
    total_visits: int
    total_spent: float
    last_visit_date: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True

# 2. Photo Upload & Face Analysis Schemas
class PhotoUploadResponse(BaseModel):
    photo_id: int
    original_image_url: str
    face_shape: str
    hair_length: str
    hair_density: str
    beard_style_current: str
    facial_features: Dict[str, Any]

# 3. Recommendation Request & Response
class RecommendationRequest(BaseModel):
    customer_id: int
    photo_id: int
    target_service_type: str = Field(..., description="Hair, Beard, Hair + Beard, Shaving")
    style_category: str = Field(..., description="Classic, Trendy, Professional")
    gender: Optional[str] = Field("Women", description="Women, Men, All")

class StyleItem(BaseModel):
    style_id: int
    style_code: str
    name: str
    category: str
    face_shapes: List[str]
    hair_types: List[str] = []
    hair_length: Optional[str] = None
    hair_density: Optional[str] = None
    maintenance_level: Optional[str] = None
    description: str
    stylist_instructions: str
    preview_image_url: Optional[str] = None
    service: str = "Hair"                      # Hair, Beard, Colour or Texture
    feasibility_status: Optional[str] = None
    feasibility_warning: Optional[str] = None
    chemical_addon: Optional[Dict[str, Any]] = None
    expert_analysis: Optional[Dict[str, Any]] = None

class RecommendationResponse(BaseModel):
    recommendation_id: int
    target_service_type: str
    style_category: str
    recommended_styles: List[StyleItem]

# 4. Generation Request & Status
class GenerationRequest(BaseModel):
    recommendation_id: int
    selected_style_ids: List[int]  # Top 8 or selected styles

class GenerationStatusItem(BaseModel):
    style_id: int
    style_name: str
    generated_image_url: str
    status: str
    progress: int
    error: Optional[str] = None
    model_used: Optional[str] = None
    identity_score: Optional[float] = None
    hair_consistency_score: Optional[float] = None
    generation_time: Optional[float] = None

class GenerationJobResponse(BaseModel):
    job_id: str
    total_styles: int
    completed_count: int
    generations: List[GenerationStatusItem]

# 5. Selection & Haircut Instructions
class SelectionRequest(BaseModel):
    customer_id: int
    hairstyle_id: Optional[int] = None
    beard_style_id: Optional[int] = None
    reference_image_url: str

class SelectionResponse(BaseModel):
    selection_id: int
    customer_id: int
    selected_hairstyle_name: Optional[str] = None
    selected_beardstyle_name: Optional[str] = None
    reference_image_url: str
    haircut_instructions: List[str]
    audio_instruction_url: Optional[str] = None

# 6. Service Completion & Confirmation
class ServiceCompletionRequest(BaseModel):
    visit_id: int
    final_photo_url: Optional[str] = None
    customer_rating: int = 5
    notes: Optional[str] = None

# 7. Analytics & Dashboard Schemas
class DashboardOverview(BaseModel):
    total_customers: int
    total_revenue: float
    total_visits: int
    avg_spending: float
    capacity_utilization_pct: float
    active_campaigns_count: int

class TrafficHeatmapPoint(BaseModel):
    day: str
    hour: int
    traffic: int
    utilization_pct: float

class CustomerSegmentStat(BaseModel):
    segment_name: str
    count: int
    avg_spend: float
    churn_risk_count: int

# 8. Campaign & Offer Schemas
class OfferRecommendationRequest(BaseModel):
    customer_id: int
    service_id: int
    requested_day: str = "Monday"
    requested_hour: int = 14

class OfferRecommendationResponse(BaseModel):
    service_name: str
    customer_segment: str
    capacity_level: str
    calculated_discount_pct: float
    final_price: float
    coupon_code: str
    valid_until_days: int
    explanation: str

# 9. Token Schema
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: int
    full_name: str
