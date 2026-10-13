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


def test_colour_and_texture_looks_remove_accessories_but_keep_the_cut():
    # request: accessories are removed on every uploaded photo; colour/texture looks still keep the cut
    for sid in (201, 304):
        prompt = prompt_engine.build_prompt(VERY_LONG_TIED, get_style(sid))
        assert "Remove every hair accessory" in prompt and "untied and let down in the new cut" not in prompt
        assert "Keep the exact haircut, length" in prompt


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


def test_front_photo_cut_off_by_the_frame_is_lengthened_by_the_back_photo(monkeypatch):
    analyzer = FaceAnalyzer()
    monkeypatch.setattr(analyzer, "analyze_front_photo", lambda b: {
        "hair_length": "Medium", "hair_length_cut_off_by_frame": True, "quality_metrics": {}})
    monkeypatch.setattr(analyzer, "analyze_non_front_photo", lambda b: {"hair_length": "Very Long"})
    result = analyzer.analyze_multi_photos(b"front", b"back", None, gender="Women")
    # capped at "Long": the back photo has no face for scale
    assert result["hair_length"] == "Long" and result["hair_tied_back"] is False
    assert result["hair_length_needs_confirmation"] is True


# ---------------------------------------------------------------- no facial hair words for women
FACIAL_HAIR_WORDS = ("beard", "stubble", "moustache", "mustache", "goatee", "facial hair")
STALE_MAN_ANALYSIS = {"gender": "Men", "hair_length": "Medium", "hair_type": "Curly", "hair_density": "Thick",
                      "beard_style_current": "Partial / Custom"}


@pytest.mark.parametrize("style", WOMEN_HAIRCUTS + [get_style(201), get_style(304)], ids=lambda s: str(s["id"]))
def test_women_prompts_never_name_facial_hair(style):
    # edit models (FLUX has no negative prompt) draw what the prompt names: "no beard" puts a beard on a woman
    woman = dict(WOMAN, hair_length="Medium", hair_type="Curly")
    prompts = [prompt_engine.build_prompt(woman, style, max_chars=m, strict=st) for m in (None, 800) for st in (0, 1)]
    prompts += [prompt_engine.build_view_prompt(woman, style, v, max_chars=m) for v in ("side", "back") for m in (None, 800)]
    for prompt in prompts:
        assert not any(w in prompt.lower() for w in FACIAL_HAIR_WORDS), prompt


def test_woman_keeps_smooth_skin_even_if_a_beard_was_misdetected():
    woman = dict(WOMAN, beard_style_current="Partial / Custom", hair_length="Medium")
    prompt = prompt_engine.build_prompt(woman, get_style(32))
    assert "smooth, bare skin" in prompt and "beard" not in prompt.lower()


def test_clean_shaven_man_is_not_told_to_keep_a_beard():
    man = {"gender": "Men", "hair_length": "Short", "beard_style_current": "Clean Shaven"}
    style = next(s for s in ALL_STYLES if s.get("gender") == "Male" and s.get("service") == "Hair")
    prompt = prompt_engine.build_prompt(man, style)
    assert "keep the beard" not in prompt.lower() and "clean-shaven" in prompt


def test_curly_hair_is_told_to_stay_curly():
    woman = dict(WOMAN, hair_length="Medium", hair_type="Curly")
    assert "curl size, tightness" in prompt_engine.build_prompt(woman, get_style(32))
    assert "curls" in prompt_engine.build_prompt(woman, get_style(32), max_chars=800)


def test_generation_uses_the_chosen_collection_over_a_stale_analysis_gender():
    from types import SimpleNamespace
    from app.api.v1.endpoints import _analysis_for_generation

    class _Query:
        def __init__(self, row):
            self.row = row

        def filter(self, *a):
            return self

        def first(self):
            return self.row

    db = SimpleNamespace(query=lambda model: _Query(SimpleNamespace(gender="Female")))
    photo = SimpleNamespace(facial_features_json=dict(STALE_MAN_ANALYSIS), original_image_url="/f.jpg",
                            back_image_url=None, side_image_url=None, customer_id=9)
    analysis = _analysis_for_generation(db, photo)
    assert analysis["gender"] == "Women" and analysis["beard_style_current"] == "Clean Shaven"
    prompt = prompt_engine.build_prompt(analysis, get_style(32), max_chars=800)
    assert "beard" not in prompt.lower()


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


# ---------------------------------------------------------------- texture-matched recommendations
@pytest.mark.parametrize("texture", ["Curly", "Coily"])
@pytest.mark.parametrize("length", ["Medium", "Long"])
@pytest.mark.parametrize("category", ["Classic", "Trendy", "Professional"])
def test_curly_women_are_only_offered_curly_cuts(texture, length, category):
    looks = recommendation_engine.recommend("Oval", length, "Thick", hair_type=texture, gender="Women",
                                            target_service_type="Hair", style_category=category,
                                            trim_preference="0 - 1 cm micro-trim")
    family = {"Curly": "3", "Coily": "4"}[texture]
    assert len(looks) == 4 and all(family in {c[:1] for c in s["hair_types"]} for s in looks)


def test_straight_women_are_not_offered_curly_cuts():
    looks = recommendation_engine.recommend("Oval", "Medium", "Medium", hair_type="Straight", gender="Women",
                                            target_service_type="Hair", style_category="Trendy")
    assert looks and all("1" in {c[:1] for c in s["hair_types"]} for s in looks)


def test_catalogue_ids_are_unique_and_haircuts_never_resolve_to_beards():
    assert len({s["id"] for s in ALL_STYLES}) == len(ALL_STYLES)
    for style in ALL_STYLES:
        assert get_style(style["id"]) is style
        if style["service"] != "Beard":
            assert "beard" not in style["edit_description"].lower() or "beard" in style["name"].lower()


# ---------------------------------------------------------------- provider choice
def test_reference_photo_only_from_the_customers_own_collection():
    from app.ai.image_editing import _reference_matches_customer
    assert _reference_matches_customer({"gender": "Female"}, {"gender": "Women"})
    assert not _reference_matches_customer({"gender": "Unisex"}, {"gender": "Women"})
    assert not _reference_matches_customer({"gender": "Male"}, {"gender": "Women"})
    assert not _reference_matches_customer({"gender": "Female"}, {})


def test_weaker_fallback_is_not_used_after_a_rejected_preview_by_default():
    from app.core.config import settings
    assert settings.FALLBACK_AFTER_REJECTED_PREVIEW is False
