"""Service-specific validation rules on synthetic images (no face models needed)."""
import numpy as np

from app.ai.image_editing import SourcePhoto, _style_not_applied, validation_profile
from app.ai.vision_models import LM_CHEEK_L, LM_CHEEK_R, LM_CHIN, LM_FOREHEAD_TOP, LM_NOSE_TIP, FaceGeometry
from app.core.config import settings

H, W = 900, 480


def _face() -> FaceGeometry:
    pts = np.zeros((478, 2), dtype=np.float32)
    pts[:] = (240, 250)
    pts[LM_CHEEK_L], pts[LM_CHEEK_R] = (160, 250), (320, 250)   # width 160
    pts[LM_FOREHEAD_TOP], pts[LM_CHIN] = (240, 150), (240, 350)  # height 200
    pts[LM_NOSE_TIP] = (240, 260)
    return FaceGeometry(pts)


def _src(rgb: np.ndarray) -> SourcePhoto:
    return SourcePhoto(rgb=rgb, jpeg=b"", face=_face(), embedding=np.zeros(1), hair_lab=None,
                       hair_mask=np.zeros((H, W), bool), skin_lab=np.zeros(3))


def _hair_mask(bottom_y: int) -> np.ndarray:
    mask = np.zeros((H, W), bool)
    mask[60:bottom_y, 120:360] = True   # a block of hair from above the head down to bottom_y
    mask[150:350, 160:320] = False      # the face itself is not hair
    return mask


def test_profiles_per_service():
    assert validation_profile({"service": "Beard"}).identity_min == settings.BEARD_IDENTITY_MIN_SIMILARITY
    assert validation_profile({"service": "Colour"}).colour_change_allowed
    assert not validation_profile({"service": "Texture"}).colour_change_allowed
    assert validation_profile({"style_code": "BEARD_X"}).service == "Beard"


def test_long_result_for_a_short_cut_is_rejected():
    rgb = np.zeros((H, W, 3), np.uint8)
    style = {"service": "Hair", "hair_length": "Short"}
    long_hair = _hair_mask(bottom_y=860)    # ends 2.5 face heights below the chin -> "Long"
    problem = _style_not_applied(_src(rgb), rgb, _face(), long_hair, style, validation_profile(style), None)
    assert problem and "not applied" in problem
    style_long = {"service": "Hair", "hair_length": "Long"}
    assert _style_not_applied(_src(rgb), rgb, _face(), _hair_mask(500), style_long,
                              validation_profile(style_long), None) is None


def test_colour_look_must_change_the_colour():
    rgb = np.zeros((H, W, 3), np.uint8)
    style = {"service": "Colour"}
    assert _style_not_applied(_src(rgb), rgb, _face(), np.zeros((H, W), bool), style, validation_profile(style), 1.5)
    assert _style_not_applied(_src(rgb), rgb, _face(), np.zeros((H, W), bool), style, validation_profile(style), 12.0) is None


def test_beard_look_must_change_the_lower_face():
    before = np.full((H, W, 3), 120, np.uint8)
    style = {"service": "Beard"}
    assert _style_not_applied(_src(before), before.copy(), _face(), np.zeros((H, W), bool), style,
                              validation_profile(style), None)
    after = before.copy()
    after[280:370, 180:300] = 40  # beard area darkened
    assert _style_not_applied(_src(before), after, _face(), np.zeros((H, W), bool), style,
                              validation_profile(style), None) is None


def test_bob_that_stays_long_is_rejected_but_lob_is_tolerated():
    rgb = np.zeros((H, W, 3), np.uint8)
    long_hair = _hair_mask(bottom_y=860)     # measures "Long"
    bob = {"service": "Hair", "hair_length": "Bob"}
    assert _style_not_applied(_src(rgb), rgb, _face(), long_hair, bob, validation_profile(bob), None)
    lob = {"service": "Hair", "hair_length": "Lob"}
    assert _style_not_applied(_src(rgb), rgb, _face(), long_hair, lob, validation_profile(lob), None) is None
