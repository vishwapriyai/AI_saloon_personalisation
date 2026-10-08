"""Women's image generation: tied-back hair, very long hair, 800-char prompts, covered heads, provider calls."""
import asyncio

import pytest

from app.ai.face_analysis import FaceAnalyzer
from app.ai.image_editing import GeminiEditor, HairStyleGenerator
from app.ai.prompt_engine import prompt_engine
from app.ai.recommendation_engine import parse_trim_cm, recommendation_engine
from app.ai.style_catalogue import ALL_STYLES, get_style

WOMAN = {"gender": "Women", "hair_color_detected": "Black", "hair_density": "Thick", "hair_type": "Unknown",
         "beard_style_current": "Clean Shaven"}
VERY_LONG_TIED = dict(WOMAN, hair_length="Very Long", hair_tied_back=True)
LOOSE_MEDIUM = dict(WOMAN, hair_length="Medium", hair_tied_back=False)
U_CUT, BUTTERFLY, BOB, PIXIE = 10, 11, 6, 12
WOMEN_HAIRCUTS = [s for s in ALL_STYLES if s.get("gender") in ("Female", "Unisex") and s.get("service") == "Hair"
                  and not s.get("is_braid_styling")]


# ---------------------------------------------------------------- untie only when the hair is tied back
def test_loose_hair_is_never_told_it_is_tied_back():
    for style in WOMEN_HAIRCUTS:
        for max_chars in (None, 800):
            prompt = prompt_engine.build_prompt(LOOSE_MEDIUM, style, max_chars=max_chars).lower()
            assert "tied back" not in prompt and "untied" not in prompt


def test_tied_back_hair_is_let_down_and_keeps_length_only_for_long_cuts():
    long_cut = prompt_engine.build_prompt(VERY_LONG_TIED, get_style(U_CUT))
    assert "untied and let down" in long_cut and "Keep its full natural length" in long_cut
    bob = prompt_engine.build_prompt(VERY_LONG_TIED, get_style(BOB))
    assert "untied and let down" in bob and "full natural length" not in bob


def test_colour_and_texture_looks_are_not_untied():
    for sid in (201, 304):
        assert "untied" not in prompt_engine.build_prompt(VERY_LONG_TIED, get_style(sid))


# ---------------------------------------------------------------- very long hair vs the catalogue's "Long"
def test_long_cut_on_very_long_hair_is_not_a_shorter_haircut():
    prompt = prompt_engine.build_prompt(VERY_LONG_TIED, get_style(U_CUT))
    assert "shorter haircut" not in prompt and "keep the customer's long hair length" in prompt


@pytest.mark.parametrize("category", ["Classic", "Trendy", "Professional"])
def test_very_long_hair_keep_length_gets_only_long_looks(category):
    looks = recommendation_engine.recommend("Oval", "Very Long", "Thick", gender="Women", target_service_type="Hair",
                                            style_category=category, trim_preference="0 - 1 cm micro-trim")
    assert looks and all(s["hair_length"] == "Long" for s in looks)


# ---------------------------------------------------------------- compact (800-char) prompts
@pytest.mark.parametrize("style", WOMEN_HAIRCUTS, ids=lambda s: str(s["id"]))
@pytest.mark.parametrize("analysis", [VERY_LONG_TIED, LOOSE_MEDIUM], ids=["tied", "loose"])
def test_compact_prompt_keeps_full_description_and_untie(style, analysis):
    prompt = prompt_engine.build_prompt(analysis, style, max_chars=800)
    assert len(prompt) <= 800
    assert style["edit_description"] in prompt
    assert ("untied and let down" in prompt) == bool(analysis.get("hair_tied_back"))


def test_compact_keep_length_never_overrides_a_shorter_cut():
    # the app always sends a trim choice; a micro-trim must not stop a chosen bob or pixie
    for sid in (BOB, PIXIE):
        prompt = prompt_engine.build_prompt(dict(LOOSE_MEDIUM, trim_preference="0 - 1 cm micro-trim"),
                                            get_style(sid), max_chars=800)
        assert "shorter haircut" in prompt and "do not cut it shorter" not in prompt.lower()
    beard = next(s for s in ALL_STYLES if s.get("service") == "Beard")
    man = {"gender": "Men", "hair_length": "Short", "beard_style_current": "Full Beard", "trim_preference": "0cm"}
    assert "cut it shorter" not in prompt_engine.build_prompt(man, beard, max_chars=800)


def test_butterfly_keeps_its_no_decorative_shapes_phrase():
    prompt = prompt_engine.build_prompt(LOOSE_MEDIUM, get_style(BUTTERFLY), max_chars=800)
    assert "no decorative shapes" in prompt


# ---------------------------------------------------------------- trim parsing
def test_decimal_trims_are_read_as_written():
    assert parse_trim_cm("5.0 cm") == 5.0
    assert parse_trim_cm("15.0 cm") == 15.0
    assert parse_trim_cm("0cm") == 1.0


# ---------------------------------------------------------------- analysis: back photo and covered head
def _analyze(monkeypatch, front_len, extra_len, gender="Women"):
    analyzer = FaceAnalyzer()
    monkeypatch.setattr(analyzer, "analyze_front_photo", lambda b: {"hair_length": front_len, "quality_metrics": {}})
    monkeypatch.setattr(analyzer, "analyze_non_front_photo", lambda b: {"hair_length": extra_len})
    return analyzer.analyze_multi_photos(b"front", b"back", None, gender=gender)


def test_tied_back_flag_reaches_the_analysis(monkeypatch):
    result = _analyze(monkeypatch, "Short", "Very Long")
    assert result["hair_length"] == "Very Long" and result["hair_tied_back"] is True


def test_clear_medium_front_is_not_overridden_by_a_close_up_back_photo(monkeypatch):
    result = _analyze(monkeypatch, "Medium", "Very Long")
    assert result["hair_length"] == "Medium" and result["hair_tied_back"] is False
    assert result["hair_length_needs_confirmation"] is True


def test_covered_head_keeps_hair_services(monkeypatch):
    result = _analyze(monkeypatch, "Bald", "Unknown")
    assert result["hair_length"] == "Unknown" and result["head_covered"] is True
    assert result["hair_density"] != "Sparse / Bald" and result["hair_length_needs_confirmation"] is True
    looks = recommendation_engine.recommend("Oval", result["hair_length"], result["hair_density"], gender="Women",
                                            target_service_type="Hair")
    assert len(looks) == 4


# ---------------------------------------------------------------- provider calls
class _OnePhotoEditor:
    name = "fake"
    max_prompt_chars = 800

    def __init__(self):
        self.calls = []

    async def edit_image(self, tier, prompt, photo, reference, usage=None):  # no back_image argument
        self.calls.append(prompt)
        return b"ok"


def test_back_photo_only_goes_to_providers_that_accept_it():
    gen = HairStyleGenerator.__new__(HairStyleGenerator)
    editor = _OnePhotoEditor()
    out = asyncio.run(gen._edit(editor, "fast", "p", b"img", None, {}, b"back-photo"))
    assert out == b"ok" and editor.calls == ["p"]
    assert not HairStyleGenerator._sends_back(editor, b"back-photo")
    assert HairStyleGenerator._sends_back(GeminiEditor.__new__(GeminiEditor), b"back-photo")
    assert not HairStyleGenerator._sends_back(GeminiEditor.__new__(GeminiEditor), None)
