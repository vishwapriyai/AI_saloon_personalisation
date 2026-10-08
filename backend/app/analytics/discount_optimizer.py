import math
from typing import Any, Dict, Optional


class AutomaticDiscountEngine:
    """
    Rule engine for automatic discounts: deeper discounts for lean (low-demand) hours, a small extra for at-risk
    customers and members, a cooldown so one customer is not discounted repeatedly, and a margin guard so the
    discounted price never falls below cost plus the minimum margin.
    """

    @staticmethod
    def max_discount_for_margin(service_price: float, cost_price: float, min_margin_pct: float) -> float:
        """Largest discount (%) that keeps (final price - cost) / final price >= min_margin_pct."""
        if service_price <= 0:
            return 0.0
        min_final = cost_price / (1.0 - min_margin_pct / 100.0) if min_margin_pct < 100 else float("inf")
        return max(0.0, 100.0 * (1.0 - min_final / service_price))

    def calculate_discount(
        self,
        service_price: float,
        min_discount_pct: float = 10.0,
        max_discount_pct: float = 40.0,
        min_margin_pct: float = 30.0,
        capacity_utilization_pct: float = 30.0,
        customer_segment: str = "Rare / At-Risk Customer",
        is_member: bool = False,
        days_since_last_discount: Optional[int] = None,
        cooldown_threshold_days: int = 30,
        cost_price: float = 0.0,
    ) -> Dict[str, Any]:
        margin_cap = self.max_discount_for_margin(service_price, cost_price, min_margin_pct)

        def result(pct: float, state: str, cooldown: bool, explanation: str) -> Dict[str, Any]:
            # Round down: rounding up could push the price below the margin floor
            pct = math.floor(max(0.0, min(pct, margin_cap)) * 10) / 10
            amount = round(service_price * pct / 100.0, 2)
            return {
                "capacity_state": state,
                "calculated_discount_pct": pct,
                "discount_amount": amount,
                "final_price": round(service_price - amount, 2),
                "margin_respected": True,
                "cooldown_applied": cooldown,
                "explanation": explanation,
            }

        # Anti-cannibalisation cooldown: no automatic discount again within the cooldown period
        if days_since_last_discount is not None and days_since_last_discount < cooldown_threshold_days:
            return result(0.0, "COOLDOWN ACTIVE", True,
                          f"Customer received a discount {days_since_last_discount} days ago (cooldown "
                          f"{cooldown_threshold_days} days), so no automatic discount is offered now.")

        # Base discount inverse to capacity utilisation
        if capacity_utilization_pct < 35.0:
            base_discount = max_discount_pct * 0.85
            capacity_state = "LEAN (Low Demand)"
        elif capacity_utilization_pct < 70.0:
            base_discount = (min_discount_pct + max_discount_pct) / 2.0
            capacity_state = "MODERATE"
        else:
            base_discount = min_discount_pct
            capacity_state = "PEAK (High Demand)"

        if "Rare" in customer_segment or "At-Risk" in customer_segment or is_member:
            base_discount += 5.0

        pct = max(min_discount_pct, min(max_discount_pct, base_discount))
        note = " Limited by the minimum profit margin." if pct > margin_cap else ""
        return result(pct, capacity_state,
                      False,
                      f"Demand is {capacity_state} at {capacity_utilization_pct}% chair utilisation; adjusted for "
                      f"{customer_segment}{' (member)' if is_member else ''}.{note}")


discount_engine = AutomaticDiscountEngine()
