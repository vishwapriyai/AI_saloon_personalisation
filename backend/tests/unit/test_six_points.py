"""
The six preview requirements: white background, accessory removal, same length and texture across views,
no added volume, and correct side / back angles. Prompt rules are checked directly; the image checks use
synthetic masks, plus the real sample photos when the vision models are installed.
"""
import os

import numpy as np
import pytest

from app.ai.image_editing import (
    _clean_person_mask, _hair_extent, _near_white_background, _texture_flip, _view_result_problem,
    _volume_problem,
)
from app.ai.prompt_engine import prompt_engine
from app.ai.style_catalogue import get_style

WOMAN_LONG = {"gender": "Women", "hair_length": "Long", "hair_color_detected": "Black", "hair_type": "Straight"}
MAN_SHORT = {"gender": "Men", "hair_length": "Short", "hair_color_detected": "Black"}
U_CUT, BOB, PIXIE, BUZZ, COLOUR = 10, 6, 12, 4, 201
SAMPLES = os.path.join(os.path.dirname(__file__), "..", "..", "..", "sample-pic")


def _views(analysis, sid, **kw):
    return [prompt_engine.build_view_prompt(analysis, get_style(sid), v, **kw) for v in ("side", "back")]


# ---------------------------------------------------------------- 1. white background asked once, plainly
@pytest.mark.parametrize("max_chars", [None, 800])
def test_every_prompt_asks_for_a_white_background(max_chars):
    prompts = [prompt_engine.build_prompt(WOMAN_LONG, get_style(U_CUT), max_chars=max_chars)]
    prompts += _views(WOMAN_LONG, U_CUT, with_reference_image=True, max_chars=max_chars)
    for p in prompts:
        assert "white" in p.lower()
        if max_chars:
            assert len(p) <= max_chars


def test_prompts_are_short_enough_for_the_description_to_matter():
    front = prompt_engine.build_prompt(WOMAN_LONG, get_style(U_CUT), num_extra_images=2)
    side, back = _views(WOMAN_LONG, U_CUT, num_extra_images=2, with_reference_image=True)
    assert len(front) < 3200 and len(side) < 2200 and len(back) < 2200   # were 5,000-6,200
    assert "MANDATE" not in front + side + back


# ---------------------------------------------------------------- 2. accessories removed; "loose" only for long cuts
def test_accessories_are_removed_for_every_hair_service():
    for sid in (U_CUT, BOB, PIXIE, COLOUR):
        assert "Remove every hair accessory" in prompt_engine.build_prompt(WOMAN_LONG, get_style(sid))
    beard = {"service": "Beard", "id": 101, "edit_description": "Beard trimmed to 8 mm.", "requires_beard": True}
    assert "accessory" not in prompt_engine.build_prompt(dict(MAN_SHORT, beard_style_current="Full Beard"), beard)


@pytest.mark.parametrize("analysis,sid", [(WOMAN_LONG, PIXIE), (WOMAN_LONG, BOB), (MAN_SHORT, BUZZ)])
def test_short_cuts_are_never_shown_loose_over_the_shoulders(analysis, sid):
    for p in [prompt_engine.build_prompt(analysis, get_style(sid))] + _views(analysis, sid):
        assert "let down and loose" not in p and "over the shoulders" not in p.lower()


def test_long_cuts_are_shown_let_down():
    for p in [prompt_engine.build_prompt(WOMAN_LONG, get_style(U_CUT))] + _views(WOMAN_LONG, U_CUT):
        assert "let down and loose" in p


# ---------------------------------------------------------------- 3/4. consistency: correct image numbers
def test_image_numbers_are_filled_in_and_match_what_is_sent():
    side, _ = _views(WOMAN_LONG, U_CUT, num_extra_images=2, with_reference_image=True)
    assert "{ref_idx}" not in side and "Images 2 to 3" in side and "Image 4 is the finished front preview" in side
    one_photo, _ = _views(WOMAN_LONG, U_CUT, num_extra_images=0, with_reference_image=True)
    assert "Image 2 is the finished front preview" in one_photo and "Images 2 to" not in one_photo
    front = prompt_engine.build_prompt(WOMAN_LONG, get_style(U_CUT), num_extra_images=0)
    assert "{ref_idx}" not in front and "Image 2" not in front


def test_views_use_the_target_length_and_front_texture():
    side, back = _views(WOMAN_LONG, BOB, with_reference_image=True)
    for p in (side, back):
        assert "chin length hair, exactly as long as in the front preview" in p
        assert "straight texture as the front" in p


# ---------------------------------------------------------------- 6. angles: gender-neutral, never "turn around"
def test_angle_rules_keep_the_photos_own_angle():
    side, back = _views(MAN_SHORT, BUZZ)
    assert "profile" in side and "Do not turn the person towards the camera" in side
    assert "Show no face" in back
    for p in (side, back):
        assert " her " not in p and "180" not in p and "TURNED" not in p.upper()


# ---------------------------------------------------------------- image checks (synthetic)
def _mask(top, bottom, left=100, right=300, h=800, w=400):
    m = np.zeros((h, w), bool)
    m[top:bottom, left:right] = True
    return m


def test_volume_check_by_length_change():
    shorter = dict(WOMAN_LONG)
    assert _volume_problem(1000, 1200, shorter, get_style(BOB)) is None
    assert "extra hair volume" in _volume_problem(1000, 1400, shorter, get_style(BOB))
    assert _volume_problem(1000, 1350, WOMAN_LONG, get_style(U_CUT)) is None
    assert "extra hair volume" in _volume_problem(1000, 1500, WOMAN_LONG, get_style(U_CUT))
    assert _volume_problem(1000, 2000, dict(WOMAN_LONG, hair_tied_back=True), get_style(U_CUT)) is None
    assert _volume_problem(1000, 3000, WOMAN_LONG, {"service": "Texture"}) is None


def test_texture_flip_is_detected(monkeypatch):
    import app.ai.image_editing as ie
    labels = iter([("Straight", 0.7), ("Curly", 0.6)])
    monkeypatch.setattr(ie, "hair_texture", lambda *a: next(labels))
    assert "texture changed" in _texture_flip(None, None, None, None, 200, {"service": "Hair"})
    assert _texture_flip(None, None, None, None, 200, {"service": "Texture"}) is None


def test_hair_extent_measures_the_main_hair_region():
    m = _mask(100, 500)
    m[700:705, 0:5] = True       # a speck elsewhere is ignored
    assert _hair_extent(m) == 400


@pytest.fixture
def no_face(monkeypatch):
    import app.ai.image_editing as ie

    class VM:
        def detect_face(self, rgb):
            return None

        def hair_mask(self, rgb, face):
            return VM.after

    monkeypatch.setattr(ie, "get_vision_models", lambda: VM())
    monkeypatch.setattr(ie, "hair_texture", lambda *a: ("Unknown", 0.0))
    return VM


def test_view_length_must_match_the_cut(no_face):
    rgb = np.zeros((800, 400, 3), np.uint8)
    before = _mask(100, 600)                                     # long hair in the back photo
    no_face.after = _mask(100, 300)                              # cut to a bob
    assert _view_result_problem(rgb, before, rgb, "back", get_style(BOB), WOMAN_LONG) is None
    no_face.after = _mask(100, 680)                              # came back longer than before
    assert "longer than in the original" in _view_result_problem(rgb, before, rgb, "back", get_style(BOB), WOMAN_LONG)
    no_face.after = _mask(100, 300)                              # a long cut that was chopped short
    assert "length changed" in _view_result_problem(rgb, before, rgb, "back", get_style(U_CUT), WOMAN_LONG)


def test_background_helpers():
    white = np.full((200, 200, 3), 250, np.uint8)
    white[60:200, 70:130] = 40
    assert _near_white_background(white)
    assert not _near_white_background(np.full((200, 200, 3), 120, np.uint8))
    m = np.zeros((200, 200), bool)
    m[50:190, 50:150] = True
    m[100:104, 100:104] = False            # small hole inside the person is filled
    m[5:7, 5:7] = True                     # speck in the background is removed
    cleaned = _clean_person_mask(m)
    assert cleaned[101, 101] and not cleaned[5, 5]


# ---------------------------------------------------------------- real photos (when the vision models are installed)
def _real_models():
    try:
        from app.ai.vision_models import get_vision_models
        vm = get_vision_models()
        return vm if getattr(vm, "_person_segmenter", None) is not None else None
    except Exception:
        return None


@pytest.mark.skipif(not os.path.isdir(SAMPLES), reason="sample photos not present")
def test_real_photos_white_background_and_angles():
    if _real_models() is None:
        pytest.skip("vision models not available in this environment")
    from app.ai.image_editing import _view_angle_problem, prepare_ai_input, vm_face_of, whiten_background

    def load(name):
        with open(os.path.join(SAMPLES, name), "rb") as f:
            return prepare_ai_input(f.read())

    for name in ("face1-women/front.png", "face1-women/side.png", "face1-women/back.png"):
        img = load(name)
        out, problem = whiten_background(img, vm_face_of(img))
        assert problem is None
        rgb, src = np.asarray(out), np.asarray(img)
        assert (rgb[:8] == 255).all(axis=2).mean() > 0.95       # top border is pure white
        kept = ~(rgb == 255).all(axis=2)
        assert (np.abs(rgb.astype(int) - src.astype(int)).max(axis=2)[kept] <= 2).mean() > 0.95
    front = np.asarray(load("face1-women/front.png"))
    assert _view_angle_problem(front, "back") and _view_angle_problem(front, "side")
    assert _view_angle_problem(np.asarray(load("face1-women/back.png")), "back") is None
    assert _view_angle_problem(np.asarray(load("face1-women/side.png")), "side") is None
