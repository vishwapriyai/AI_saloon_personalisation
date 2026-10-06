from typing import Dict, Any, List
import math

class RFMSegmentationEngine:
    """
    Customer Segmentation & Return/Churn Prediction engine.
    Uses RFM (Recency, Frequency, Monetary) rules and Machine Learning features.
    """
    def segment_customer(self, recency_days: int, frequency: int, total_spend: float, has_membership: bool) -> str:
        if has_membership and total_spend > 5000:
            return "High-Spending Member"
        elif total_spend > 7500:
            return "High-Spending Customer"
        elif recency_days > 60:
            return "Rare / At-Risk Customer"
        elif frequency >= 5:
            return "Regular Customer"
        elif frequency >= 2:
            return "Occasional Customer"
        else:
            return "Haircut-only Customer"

    def predict_churn_risk(self, recency_days: int, avg_visit_interval_days: int = 30) -> Dict[str, Any]:
        """
        Calculates return probability and churn risk score.
        """
        if avg_visit_interval_days <= 0:
            avg_visit_interval_days = 30

        ratio = recency_days / avg_visit_interval_days
        # Logistic curve calculation for return probability
        churn_prob = 1.0 / (1.0 + math.exp(-1.5 * (ratio - 1.2)))
        return_prob = max(0.05, min(0.95, round(1.0 - churn_prob, 2)))

        risk_level = "LOW"
        if churn_prob > 0.65:
            risk_level = "HIGH"
        elif churn_prob > 0.35:
            risk_level = "MEDIUM"

        return {
            "return_probability": return_prob,
            "churn_probability": round(churn_prob, 2),
            "risk_level": risk_level,
            "next_expected_visit_days": max(1, int(avg_visit_interval_days - recency_days))
        }

rfm_engine = RFMSegmentationEngine()
