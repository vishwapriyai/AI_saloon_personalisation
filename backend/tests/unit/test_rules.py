"""Pure business rules: recommendation services and scoring, customer type, discounts, security helpers."""
import time
from datetime import datetime, timedelta

from app.ai.recommendation_engine import is_bald, parse_services, recommendation_engine
from app.analytics.capacity_analytics import CapacityAnalyticsEngine
from app.analytics.discount_optimizer import AutomaticDiscountEngine
from app.core import security
from app.core.config import Settings, check_settings


# ---------------------------------------------------------------- services and recommendations
def test_parse_services_keeps_order_and_drops_beard_for_women():
    assert parse_services("Beard, Hair", "Men") == ["Beard", "Hair"]
    assert parse_services("Hair, Beard", "Women") == ["Hair"]
    assert parse_services("Beard", "Women") == []
    assert parse_services("", "Men") == ["Hair"]
    assert parse_services("Colour / Balayage, Keratin / Smoothening", "Women") == ["Colour", "Texture"]


def test_bald_customer_gets_no_hair_services():
    assert is_bald("Bald", "Unknown") and is_bald("Short", "Sparse / Bald")
    assert not is_bald("Short", "Medium")
    assert parse_services("Hair, Beard", "Men", bald=True) == ["Beard"]
    assert parse_services("Hair", "Men", bald=True) == []
    assert recommendation_engine.recommend("Oval", "Bald", "Unknown", gender="Men", target_service_type="Hair") == []


def test_chosen_category_comes_first_without_double_counting():
    looks = recommendation_engine.recommend("Oval", "Long", "Medium", gender="Women",
                                            target_service_type="Hair", style_category="Classic")
    assert looks and looks[0]["category"] == "Classic"
    # The category is an ordering rule only: the same style scores the same whatever category is chosen
    style = looks[0]
    common = dict(face_shape="Oval", hair_length="Long", hair_density="Medium", hair_type=None, beard_style=None,
                  user_gender="women", expert_rules={})
    a = recommendation_engine._score(style, style_category="Classic", **common)["score"]
    b = recommendation_engine._score(style, style_category="Trendy", **common)["score"]
    assert a == b


def test_slots_are_shared_between_services():
    looks = recommendation_engine.recommend("Oval", "Medium", "Medium", gender="Men",
                                            target_service_type="Hair, Beard", style_category="Trendy",
                                            beard_style="Full Beard")
    services = [s["service"] for s in looks]
    assert services.count("Hair") == 2 and services.count("Beard") == 2


# ---------------------------------------------------------------- customer type
def test_customer_type_tiers(app_module):
    from app.api.v1.endpoints import _customer_type
    assert _customer_type(0, 0, False) == "New"
    assert _customer_type(500, 1, False) == "Regular"
    assert _customer_type(2000, 1, False) == "Priority"
    assert _customer_type(100, 6, False) == "Premium"
    assert _customer_type(100, 1, True) == "Premium"
    assert _customer_type(10000, 1, False) == "VIP"


# ---------------------------------------------------------------- discounts
def test_margin_guard_uses_cost_price():
    engine = AutomaticDiscountEngine()
    # price 600, cost 360, min margin 30% -> final price must be >= 360 / 0.7 = 514.29 -> max discount ~14.3%
    offer = engine.calculate_discount(600, min_discount_pct=10, max_discount_pct=40, min_margin_pct=30,
                                      capacity_utilization_pct=10, cost_price=360)
    assert offer["final_price"] >= 514.28
    assert offer["calculated_discount_pct"] <= 14.3


def test_cooldown_gives_no_discount_and_demand_drives_depth():
    engine = AutomaticDiscountEngine()
    cooled = engine.calculate_discount(600, days_since_last_discount=5)
    assert cooled["cooldown_applied"] and cooled["calculated_discount_pct"] == 0.0
    lean = engine.calculate_discount(600, capacity_utilization_pct=20, customer_segment="Regular Customer")
    peak = engine.calculate_discount(600, capacity_utilization_pct=90, customer_segment="Regular Customer")
    assert lean["calculated_discount_pct"] > peak["calculated_discount_pct"]


# ---------------------------------------------------------------- capacity
def test_capacity_heatmap_from_visits():
    engine = CapacityAnalyticsEngine()
    monday = datetime(2026, 10, 5, 10, 0)  # a Monday
    visits = [(monday, monday, monday + timedelta(minutes=60))] * 2
    heatmap = engine.get_traffic_heatmap(visits, total_chairs=2, start=monday - timedelta(days=1),
                                         end=monday + timedelta(days=6))
    cell = next(c for c in heatmap if c["day"] == "Monday" and c["hour"] == 10)
    assert cell["utilization_pct"] == 100.0 and cell["traffic"] == 2
    assert engine.summary(heatmap)["has_data"]


# ---------------------------------------------------------------- security helpers
def test_password_hash_and_rehash():
    h = security.get_password_hash("Secret123")
    assert security.verify_password("Secret123", h) and not security.verify_password("wrong", h)
    assert not security.password_needs_rehash(h)
    import hashlib
    legacy = hashlib.sha256(b"Secret123").hexdigest()
    assert security.verify_password("Secret123", legacy) and security.password_needs_rehash(legacy)
    old = "pbkdf2_sha256$200000$" + h.split("$", 2)[2]
    assert security.password_needs_rehash(old)


def test_token_round_trip_and_tamper():
    token = security.create_access_token({"sub": "staff:1", "role": "Stylist"}, timedelta(minutes=5))
    assert security.decode_access_token(token)["sub"] == "staff:1"
    assert security.decode_access_token(token[:-2] + "xx") is None
    expired = security.create_access_token({"sub": "staff:1"}, timedelta(seconds=-5))
    assert security.decode_access_token(expired) is None


def test_media_links_are_signed_and_expire():
    signed = security.sign_media_url("/static/media/original/a.jpg")
    path, query = signed.split("?")
    params = dict(p.split("=") for p in query.split("&"))
    assert security.verify_media_signature(path, params["exp"], params["sig"])
    assert not security.verify_media_signature("/static/media/original/b.jpg", params["exp"], params["sig"])
    assert not security.verify_media_signature(path, str(int(time.time()) - 1), params["sig"])
    assert security.media_path(signed) == "/static/media/original/a.jpg"
    assert security.media_path("http://host:5173" + signed) == "/static/media/original/a.jpg"
    assert security.sign_media_url("https://example.com/x.jpg") == "https://example.com/x.jpg"


def test_production_settings_are_checked():
    problems = check_settings(Settings(APP_ENV="production", IMAGE_EDIT_PROVIDER="huggingface"))
    assert any("SECRET_KEY" in p for p in problems)
    assert any("testing only" in p for p in problems)
    ok = Settings(APP_ENV="production", SECRET_KEY="x" * 40, IMAGE_EDIT_PROVIDER="gemini")
    assert check_settings(ok) == []
