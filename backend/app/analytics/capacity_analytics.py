from typing import List, Dict, Any

class CapacityAnalyticsEngine:
    """
    Salon Dual-Resource Capacity & Utilization Analytics engine.
    Models Chair bandwidth + Stylist skill availability + Active vs Idle chemical stage times
    to identify peak/lean periods, hourly utilization, and operational bottlenecks.
    """
    def __init__(self, total_chairs: int = 8, active_stylists: int = 6):
        self.total_chairs = total_chairs
        self.active_stylists = active_stylists
        self.days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        self.hours = list(range(9, 21))  # 9 AM to 8 PM

    def get_traffic_heatmap(self) -> List[Dict[str, Any]]:
        """
        Generates 7x12 traffic matrix with Dual-Resource Chair & Stylist utilization metrics.
        """
        result = []
        for day in self.days:
            for hour in self.hours:
                is_weekend = day in ["Saturday", "Sunday"]
                is_peak_hour = 16 <= hour <= 19

                if is_weekend and is_peak_hour:
                    chair_util = 92.0
                    stylist_util = 96.0
                    traffic = 14
                    bottleneck = "Stylist Availability"
                elif is_weekend or is_peak_hour:
                    chair_util = 75.0
                    stylist_util = 82.0
                    traffic = 9
                    bottleneck = "Chair Capacity"
                elif 11 <= hour <= 15 and day in ["Monday", "Tuesday", "Wednesday"]:
                    chair_util = 28.0  # Lean hours
                    stylist_util = 35.0
                    traffic = 3
                    bottleneck = "Low Demand"
                else:
                    chair_util = 50.0
                    stylist_util = 58.0
                    traffic = 6
                    bottleneck = "Optimal Balance"

                result.append({
                    "day": day,
                    "hour": hour,
                    "traffic": traffic,
                    "utilization_pct": chair_util,
                    "chair_utilization_pct": chair_util,
                    "stylist_utilization_pct": stylist_util,
                    "bottleneck_resource": bottleneck,
                    "is_lean": chair_util < 40.0,
                    "is_peak": chair_util > 80.0
                })
        return result

capacity_engine = CapacityAnalyticsEngine()

