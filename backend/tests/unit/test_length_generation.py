"""Hair length through recommendations and edit prompts: shorter cuts, trims, side/back views, buzz vs bald."""
import numpy as np
import pytest

from app.ai.face_analysis import FaceAnalyzer
from app.ai.prompt_engine import prompt_engine
from app.ai.recommendation_engine import (
    allowed_length_drop, is_bald, parse_trim_cm, recommendation_engine,
)
from app.ai.style_catalogue import ALL_STYLES, get_style
from app.ai.vision_models import LM_CHEEK_L, LM_CHEEK_R, LM_CHIN, LM_FOREHEAD_CENTER, LM_FOREHEAD_TOP, FaceGeometry, scalp_hair

LONG_WOMAN = {"hair_length": "Long", "hair_type": "Straight", "hair_color_detected": "Black",
              "hair_density": "Medium", "gender": "Women"}
SHORT_MAN = {"hair_length": "Short", "hair_type": "Straight", "hair_color_detected": "Black", "gender": "Men"}
BOB, BLUNT_BOB, PIXIE, LOB, LONG_LAYERS, BUZZ, FADE, BRAID = 6, 30, 12, 8, 28, 4, 1, 13


# ---------------------------------------------------------------- shorter cuts are not contradicted
@pytest.mark.parametrize("style_id", [BOB, BLUNT_BOB, PIXIE, LOB])
@pytest.mark.parametrize("max_chars", [None, 800])
def test_shorter_cut_for_long_hair_is_not_told_to_keep_length(style_id, max_chars):
    prompt = prompt_engine.build_prompt(LONG_WOMAN, get_style(style_id), max_chars=max_chars)
    assert "SHORTER HAIRCUT" in prompt.upper()
    assert "DO NOT CUT IT SHORTER" not in prompt.upper()
    assert "into a bob" not in prompt.lower()
    if max_chars:
        assert len(prompt) <= max_chars


def test_long_cut_for_long_hair_keeps_the_length():
    prompt = prompt_engine.build_prompt(LONG_WOMAN, get_style(LONG_LAYERS))
    assert "keep the customer's long hair length" in prompt
    assert "Do not make the hair longer" in prompt
    compact = prompt_engine.build_prompt(LONG_WOMAN, get_style(LONG_LAYERS), max_chars=800)
    assert "Keep the current hair length" in compact and "shorter haircut" not in compact


# ---------------------------------------------------------------- trim
def test_trim_parsing():
    assert parse_trim_cm(None) is None and parse_trim_cm("") is None
    assert parse_trim_cm("0 - 1 cm micro-trim") == 1.0
    assert parse_trim_cm("keep") == 1.0
    assert parse_trim_cm("5cm") == 5.0
    assert parse_trim_cm("15 mm") == 1.5
    assert parse_trim_cm("12 cm") == 12.0
    assert allowed_length_drop(1.0) == 0 and allowed_length_drop(12.0) == 1 and allowed_length_drop(30.0) is None


def test_trim_directive_only_when_the_cut_keeps_the_length():
    trim = dict(LONG_WOMAN, trim_preference="5cm")
    assert "about 5 cm off the ends" in prompt_engine.build_prompt(trim, get_style(LONG_LAYERS))
    assert "off the ends" not in prompt_engine.build_prompt(trim, get_style(BOB))
    # a short-haired man getting a buzz cut is never told to "maintain long hair"
    buzz = prompt_engine.build_prompt(dict(SHORT_MAN, trim_preference="0 - 1 cm micro-trim"), get_style(BUZZ))
    assert "long hair" not in buzz.lower() and "TRIM DIRECTIVE" not in buzz


def _women_looks(trim):
    looks = recommendation_engine.recommend("Oval", "Long", "Medium", gender="Women", target_service_type="Hair",
                                            style_category="Classic", trim_preference=trim)
    return [s["hair_length"] for s in looks]


def test_bigger_trims_open_shorter_looks():
    assert set(_women_looks("0 - 1 cm micro-trim")) <= {"Long", "Very Long", "Any"}
    assert set(_women_looks("5cm")) <= {"Long", "Very Long", "Any"}
    twelve = _women_looks("12 cm")
    assert any(length in ("Lob", "Medium") for length in twelve)   # one class shorter is now allowed and favoured
    assert all(length not in ("Short", "Bob") for length in twelve)
    assert any(length in ("Short", "Bob") for length in _women_looks("30 cm"))


def test_trim_does_not_restrict_short_hair():
    looks = recommendation_engine.recommend("Oval", "Short", "Medium", gender="Men", target_service_type="Hair",
                                            style_category="Trendy", trim_preference="0 - 1 cm micro-trim")
    assert len(looks) == 4


# ---------------------------------------------------------------- braids are not offered
def test_braided_styles_are_never_recommended():
    braids = {s["id"] for s in ALL_STYLES if s.get("is_braid_styling")}
    assert BRAID in braids
    for category in ("Classic", "Trendy", "Professional"):
        for trim in (None, "0cm", "30 cm"):
            looks = recommendation_engine.recommend("Oval", "Long", "Medium", gender="Women",
                                                    target_service_type="Hair", style_category=category,
                                                    trim_preference=trim)
            assert not braids & {s["id"] for s in looks}


# ---------------------------------------------------------------- side / back views
@pytest.mark.parametrize("style_id", [BUZZ, FADE, BOB, LONG_LAYERS])
@pytest.mark.parametrize("view", ["side", "back"])
def test_view_prompt_fits_and_keeps_the_description(style_id, view):
    style = get_style(style_id)
    analysis = SHORT_MAN if style.get("gender") == "Male" else LONG_WOMAN
    prompt = prompt_engine.build_view_prompt(analysis, style, view, max_chars=800)
    assert len(prompt) <= 800
    assert style["edit_description"].split(":")[0][:25] in prompt   # the cut itself is described
    assert "Do NOT shorten" not in prompt and "down the shoulders" not in prompt


def test_view_prompt_uses_the_target_length_not_the_current_one():
    prompt = prompt_engine.build_view_prompt(LONG_WOMAN, get_style(BOB), "back")
    assert "chin length hair" in prompt and "let down" not in prompt
    long_prompt = prompt_engine.build_view_prompt(dict(LONG_WOMAN, hair_length="Short"), get_style(LONG_LAYERS), "back")
    assert "long, past the shoulders" in long_prompt and "let down" in long_prompt


# ---------------------------------------------------------------- gender from the customer, not the style
def test_women_get_the_no_facial_hair_rule_on_unisex_looks():
    unisex = next(s for s in ALL_STYLES if s.get("gender") == "Unisex" and s.get("service") == "Hair")
    assert "FEMALE CUSTOMER" in prompt_engine.build_prompt(LONG_WOMAN, unisex).upper()
    assert "FEMALE" not in prompt_engine.build_prompt(SHORT_MAN, unisex).upper()


# ---------------------------------------------------------------- buzz vs bald
H, W = 600, 480


def _face() -> FaceGeometry:
    pts = np.zeros((478, 2), dtype=np.float32)
    pts[:] = (240, 330)
    pts[LM_CHEEK_L], pts[LM_CHEEK_R] = (160, 330), (320, 330)
    pts[LM_FOREHEAD_TOP], pts[LM_CHIN] = (240, 230), (240, 430)   # face height 200
    pts[LM_FOREHEAD_CENTER[1]] = (240, 245)                        # mid-forehead skin sample
    return FaceGeometry(pts)


def _head(scalp_lightness: int) -> np.ndarray:
    img = np.full((H, W, 3), 230, np.uint8)                        # light background
    img[120:460, 150:330] = (200, 160, 140)                        # skin
    img[140:215, 170:310] = scalp_lightness                        # scalp above the forehead
    return img


def test_dark_scalp_is_buzz_and_bare_scalp_is_bald():
    empty = np.zeros((H, W), bool)
    assert scalp_hair(_head(40), empty, _face())[0] == "Buzz"
    assert scalp_hair(_head(205), empty, _face())[0] == "Bald"
    covered = empty.copy()
    covered[140:215, 170:310] = True
    assert scalp_hair(_head(205), covered, _face())[0] == "Buzz"
    assert not is_bald("Buzz", "Unknown")
    looks = recommendation_engine.recommend("Oval", "Buzz", "Unknown", gender="Men", target_service_type="Hair")
    assert len(looks) == 4                                         # a buzz cut keeps haircuts


# ---------------------------------------------------------------- side/back photos and measured length
def _analyze(monkeypatch, front_len, extra_len, gender):
    analyzer = FaceAnalyzer()
    monkeypatch.setattr(analyzer, "analyze_front_photo", lambda b: {"hair_length": front_len, "quality_metrics": {}})
    monkeypatch.setattr(analyzer, "analyze_non_front_photo", lambda b: {"hair_length": extra_len})
    return analyzer.analyze_multi_photos(b"front", b"back", None, gender=gender)["hair_length"]


def test_back_photo_cannot_turn_a_mans_short_hair_long(monkeypatch):
    assert _analyze(monkeypatch, "Short", "Very Long", "Men") == "Short"


def test_back_photo_fills_in_tied_back_hair_for_women(monkeypatch):
    assert _analyze(monkeypatch, "Short", "Long", "Women") == "Long"


def test_short_haired_woman_with_back_photo_stays_short(monkeypatch):
    assert _analyze(monkeypatch, "Short", "Short", "Women") == "Short"


def test_back_photo_never_overrides_bald_or_buzz_for_men(monkeypatch):
    assert _analyze(monkeypatch, "Buzz", "Long", "Men") == "Buzz"
    assert _analyze(monkeypatch, "Bald", "Medium", "Men") == "Bald"


def test_womans_covered_head_is_not_bald(monkeypatch):
    # little visible hair on a woman = covered (dupatta / pallu) or pulled back: the back photo fills it in
    assert _analyze(monkeypatch, "Buzz", "Long", "Women") == "Long"
    assert _analyze(monkeypatch, "Bald", "Unknown", "Women") == "Unknown"
