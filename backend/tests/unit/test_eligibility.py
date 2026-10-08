"""Unit tests for service eligibility, beard fit, multi-photo analysis, and female beard clearing."""
import pytest
from app.ai.eligibility import compute_eligible_services
from app.ai.recommendation_engine import beard_fit, _parse_length_level
from app.ai.face_analysis import face_analyzer


def test_women_eligibility_locks_beard_services():
    res = compute_eligible_services({"hair_length": "Long", "hair_density": "Thick"}, gender="Women")
    assert res["BEARD_STYLING"]["eligible"] is False
    assert res["BEARD_SHAVING"]["eligible"] is False
    assert res["BEARD_STYLING"]["lock_code"] == "WOMEN_NO_BEARD"
    assert res["HAIR_CUT"]["eligible"] is True
    assert res["COLOUR_BALAYAGE"]["eligible"] is True


def test_bald_eligibility_locks_haircut_and_colour():
    res = compute_eligible_services({"hair_length": "Bald", "hair_density": "Sparse / Bald"}, gender="Men")
    assert res["HAIR_CUT"]["eligible"] is False
    assert res["COLOUR_BALAYAGE"]["eligible"] is False
    assert res["TEXTURE_SMOOTHENING"]["eligible"] is False
    assert res["HAIR_CUT"]["lock_code"] == "BALD_NO_HAIRCUT"


def test_beard_fit_parse_length_levels():
    assert _parse_length_level("Full Beard") == 4
    assert _parse_length_level("Medium (10-25mm)") == 3
    assert _parse_length_level("Short (3-10mm)") == 2
    assert _parse_length_level("Stubble (1-3mm)") == 1
    assert _parse_length_level("Clean-shaven") == 0


def test_beard_fit_achievable_when_length_matches():
    style = {"id": 104, "name": "Full Beard", "min_length": "Full (>25mm)", "required_zones": ["moustache", "chin", "cheek_l", "cheek_r"]}
    g_map = {"beard_length_class": "Full (>25mm)", "beard_zones": {}}
    res = beard_fit(style, g_map)
    assert res["status"] == "ACHIEVABLE_TODAY"


def test_female_multi_photo_analysis_clears_beard():
    # Mocking analysis dictionary return for female customer
    analysis = face_analyzer.analyze_multi_photos(
        front_bytes=b"dummy",
        back_bytes=None,
        side_bytes=None,
        gender="Women"
    )
    # Beard should be forced to clean shaven for female gender
    assert analysis["beard_style_current"] == "Clean Shaven"
    assert analysis["beard_length_class"] == "Clean-shaven"
    assert analysis["beard_pattern"] == "None"
    assert analysis["needs_confirmation"] is False
