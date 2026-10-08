from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
HOURS = list(range(9, 21))  # 9 AM to 8 PM
DEFAULT_SERVICE_MINUTES = 45
PEAK_PCT = 80.0
LEAN_PCT = 40.0


def _hour_label(hour: int) -> str:
    def fmt(h: int) -> str:
        return f"{(h - 1) % 12 + 1}:00 {'AM' if h < 12 else 'PM'}"
    return f"{fmt(hour)} - {fmt(hour + 1)}"


class CapacityAnalyticsEngine:
    """
    Chair utilisation per weekday and hour, computed from completed visits.

    Utilisation of a slot = chair-minutes used in that slot / chair-minutes available
    (chairs x 60 minutes x number of times that weekday occurred in the period).
    A visit without start/end times counts as DEFAULT_SERVICE_MINUTES from its visit time.
    """

    def get_traffic_heatmap(self, visits: Iterable[Tuple[datetime, Optional[datetime], Optional[datetime]]],
                            total_chairs: int, start: datetime, end: datetime) -> List[Dict[str, Any]]:
        """visits: (visit_date, service_start_time, service_end_time) of completed visits in [start, end)."""
        used: Dict[Tuple[int, int], float] = {}
        count: Dict[Tuple[int, int], int] = {}
        for visit_date, began, ended in visits:
            began = began or visit_date
            if began is None:
                continue
            ended = ended if ended and ended > began else began + timedelta(minutes=DEFAULT_SERVICE_MINUTES)
            count[(began.weekday(), began.hour)] = count.get((began.weekday(), began.hour), 0) + 1
            t = began
            while t < ended:  # spread the service over the hour slots it occupies
                slot_end = min(ended, t.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1))
                key = (t.weekday(), t.hour)
                used[key] = used.get(key, 0.0) + (slot_end - t).total_seconds() / 60.0
                t = slot_end

        occurrences = [0] * 7
        day = start.date()
        while day < end.date():
            occurrences[day.weekday()] += 1
            day += timedelta(days=1)

        result = []
        chairs = max(1, total_chairs)
        for d, name in enumerate(DAYS):
            for hour in HOURS:
                available = chairs * 60.0 * max(1, occurrences[d])
                pct = round(min(100.0, 100.0 * used.get((d, hour), 0.0) / available), 1)
                result.append({
                    "day": name,
                    "hour": hour,
                    "traffic": count.get((d, hour), 0),
                    "utilization_pct": pct,
                    "chair_utilization_pct": pct,
                    "is_lean": pct < LEAN_PCT,
                    "is_peak": pct > PEAK_PCT,
                })
        return result

    @staticmethod
    def summary(heatmap: List[Dict[str, Any]]) -> Dict[str, Any]:
        by_hour: Dict[int, List[float]] = {}
        for cell in heatmap:
            by_hour.setdefault(cell["hour"], []).append(cell["utilization_pct"])
        hourly = sorted(((sum(v) / len(v), h) for h, v in by_hour.items()), reverse=True)
        busy = [h for avg, h in hourly if avg > 0]
        return {
            "peak_hours": [_hour_label(h) for _, h in hourly[:3] if h in busy],
            "lean_hours": [_hour_label(h) for _, h in sorted(hourly)[:3]],
            "avg_chair_utilization_pct": round(sum(c["utilization_pct"] for c in heatmap) / len(heatmap), 1) if heatmap else 0.0,
            "has_data": any(c["traffic"] for c in heatmap),
        }

    @staticmethod
    def slot_utilization(heatmap: List[Dict[str, Any]], day: str, hour: int) -> Optional[float]:
        for cell in heatmap:
            if cell["day"].lower() == (day or "").lower() and cell["hour"] == hour:
                return cell["utilization_pct"]
        return None


capacity_engine = CapacityAnalyticsEngine()
