import uuid
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

class CampaignLoyaltyEngine:
    """
    Handles Personalized Coupon Generation, Referral Code Tracking,
    Loyalty Points calculations, and Membership benefits.
    """
    def generate_personalized_coupon(
        self,
        customer_id: int,
        service_id: int,
        discount_pct: float,
        validity_days: int = 5
    ) -> Dict[str, Any]:

        coupon_code = f"SALON-{uuid.uuid4().hex[:6].upper()}"
        valid_until = datetime.utcnow() + timedelta(days=validity_days)

        return {
            "coupon_code": coupon_code,
            "customer_id": customer_id,
            "service_id": service_id,
            "discount_percentage": discount_pct,
            "valid_from": datetime.utcnow().isoformat(),
            "valid_until": valid_until.isoformat(),
            "status": "GENERATED"
        }

    def generate_referral_link(self, customer_id: int) -> Dict[str, Any]:
        ref_code = f"REF{customer_id}{uuid.uuid4().hex[:4].upper()}"
        share_url = f"/r/{ref_code}"  # relative: the frontend prefixes the app's public address
        return {
            "referral_code": ref_code,
            "share_url": share_url,
            "reward_points": 50
        }

    def calculate_loyalty_earned(self, amount_spent: float, membership_tier: str = "Standard") -> int:
        multiplier = 1.0
        if membership_tier == "Gold":
            multiplier = 1.5
        elif membership_tier == "Platinum":
            multiplier = 2.0
        
        points = int((amount_spent / 50.0) * multiplier)
        return max(10, points)

campaign_loyalty_engine = CampaignLoyaltyEngine()
