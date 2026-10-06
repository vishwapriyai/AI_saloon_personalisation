from typing import Dict, Any, Optional

class AutomaticDiscountEngine:
    """
    Optimization & Rule Engine for automatic discount calculations.
    Ensures optimal yield management while respecting salon profit margins.
    Enforces customer cooldown rules (e.g. max 1 auto-discount per 30 days) to prevent price cannibalization.
    """
    def calculate_discount(
        self,
        service_price: float,
        min_discount_pct: float = 10.0,
        max_discount_pct: float = 40.0,
        min_margin_pct: float = 30.0,
        capacity_utilization_pct: float = 30.0,
        customer_segment: str = "Rare / At-Risk Customer",
        is_member: bool = False,
        days_since_last_discount: Optional[int] = 45,
        cooldown_threshold_days: int = 30
    ) -> Dict[str, Any]:

        # Anti-Cannibalization Cooldown Check
        if days_since_last_discount is not None and days_since_last_discount < cooldown_threshold_days:
            return {
                "capacity_state": "COOLDOWN ACTIVE",
                "calculated_discount_pct": min_discount_pct,
                "discount_amount": round(service_price * (min_discount_pct / 100.0), 2),
                "final_price": round(service_price * (1 - min_discount_pct / 100.0), 2),
                "margin_respected": True,
                "cooldown_applied": True,
                "explanation": f"Customer received a discount {days_since_last_discount} days ago. Cooldown active ({cooldown_threshold_days} days). Minimum standard discount applied to protect profit margins."
            }

        # Base calculation inverse to capacity utilization
        if capacity_utilization_pct < 35.0:
            base_discount = max_discount_pct * 0.85
            capacity_state = "LEAN (Low Demand)"
        elif capacity_utilization_pct < 70.0:
            base_discount = (min_discount_pct + max_discount_pct) / 2.0
            capacity_state = "MODERATE"
        else:
            base_discount = min_discount_pct
            capacity_state = "PEAK (High Demand)"

        # Segment incentive adjustments
        if "Rare" in customer_segment or "At-Risk" in customer_segment:
            base_discount += 5.0
        elif is_member:
            base_discount += 5.0

        # Enforce hard boundary constraints
        final_discount_pct = max(min_discount_pct, min(max_discount_pct, base_discount))

        # Margin guard constraint check (Maximum discount cannot violate profit margin)
        max_allowable_discount = 100.0 - min_margin_pct
        if final_discount_pct > max_allowable_discount:
            final_discount_pct = max_allowable_discount

        discount_amount = round(service_price * (final_discount_pct / 100.0), 2)
        final_price = round(service_price - discount_amount, 2)

        return {
            "capacity_state": capacity_state,
            "calculated_discount_pct": round(final_discount_pct, 1),
            "discount_amount": discount_amount,
            "final_price": final_price,
            "margin_respected": True,
            "cooldown_applied": False,
            "explanation": f"Demand is {capacity_state} with {capacity_utilization_pct}% capacity. Adjusted for {customer_segment}."
        }

discount_engine = AutomaticDiscountEngine()

