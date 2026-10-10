"""
Hairstyle image editing: applies a catalogue style to the customer's OWN uploaded photo.

Pipeline for every style (each one starts again from the same original photo):

  original photo -> face landmarks -> head-and-shoulders crop (source image for the edit model)
                 -> controlled edit prompt -> image-EDITING model (NVIDIA NIM or Gemini)
                 -> validation: same person (SFace face embedding), face position, skin tone,
                    hair present, hair colour unchanged, background unchanged
                 -> retry with a stricter prompt -> FAILED (never a generic or catalogue image)
"""
import asyncio
import hashlib
import io
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import cv2
import httpx
import numpy as np
from PIL import Image, ImageDraw, ImageOps

from app.ai.errors import ImageEditError
from app.ai.nvidia_nim import nvidia_nim_client
from app.ai.prompt_engine import PROMPT_TEMPLATE_VERSION, prompt_engine
from app.ai.vision_models import (
    LM_CHEEK_SKIN, LM_FOREHEAD_CENTER, LM_NOSE_TIP, FaceGeometry, delta_e, get_vision_models, hair_lab, portrait_box,
)
from app.ai.vision_models import hair_length as measure_hair_length, hair_texture
from app.core.config import TEST_ONLY_PROVIDERS, settings
from app.core.privacy import photo_cache_tag
from app.core.security import media_path
from app.core.storage import storage_service

logger = logging.getLogger(__name__)

def log_progress(step: str, details: str, level: str = "INFO"):
    colors = {
        "INFO": "\033[94m",     # Bright Blue
        "SUCCESS": "\033[92m",  # Bright Green
        "WARNING": "\033[93m",  # Bright Yellow
        "ERROR": "\033[91m",    # Bright Red
        "RESET": "\033[0m"
    }
    c = colors.get(level, colors["INFO"])
    reset = colors["RESET"]
    msg = f"{c}[AI-PIPELINE] [{level}] {step}: {details}{reset}"
    try:
        print(msg, flush=True)
    except Exception:
        print(f"[AI-PIPELINE] [{level}] {step}: {details}", flush=True)
    logger.info("%s: %s", step, details)


def log_api_exceeded_warning(provider: str, model: str, error_msg: str, hint: str = ""):
    red = "\033[91m"
    bold = "\033[1m"
    reset = "\033[0m"
    
    border = "=" * 80
    box = (
        f"\n{red}{bold}{border}\n"
        f"[WARNING] [IMAGE API QUOTA / ACCESS PROBLEM]\n"
        f"Provider : {provider.upper()}\n"
        f"Model    : {model}\n"
        f"Error    : {error_msg}\n"
        f"Note     : {hint or 'API quota or rate limit exceeded.'}\n"
        f"{border}{reset}\n"
    )
    try:
        print(box, flush=True)
    except Exception:
        print(f"[API EXCEEDED WARNING] Provider: {provider.upper()} | Model: {model} | Error: {error_msg}", flush=True)
    logger.error("API EXCEEDED: Provider=%s Model=%s Error=%s", provider, model, error_msg)

# Published prices in USD per 1M tokens (mid-2026); used only for the cost estimate printed in the terminal
TOKEN_PRICES = {
    "gemini-2.5-flash-image": (0.30, 30.0),
    "gemini-3-pro-image": (2.0, 120.0),
    "gemini-3.1-flash-image": (0.50, 60.0),
}
CLOUDFLARE_NEURONS_PER_INPUT_TILE = 5.37    # per 512x512 tile, FLUX.2-klein-4B
CLOUDFLARE_NEURONS_PER_OUTPUT_TILE = 26.05


def _token_price(model: str) -> Optional[tuple]:
    name = model.split("/")[-1]
    return next((v for k, v in TOKEN_PRICES.items() if name.startswith(k)), None)


def _usage_line(usage: Dict[str, Any]) -> str:
    if usage.get("total_tokens") is not None:
        line = (f"input {usage.get('input_tokens', 0):,} + output {usage.get('output_tokens', 0):,} = "
                f"{usage['total_tokens']:,} tokens")
    elif usage.get("neurons") is not None:
        line = f"~{usage['neurons']:,.0f} neurons (estimated)"
    else:
        return "usage not reported by this provider"
    if usage.get("cost_usd") is not None:
        line += f" | ~${usage['cost_usd']:.4f}"
    return line


__all__ = ["EditResult", "HairStyleGenerator", "ImageEditError", "hair_style_generator", "log_progress", "log_api_exceeded_warning"]


@dataclass
class EditResult:
    image_url: str
    model: str
    prompt: str
    identity_score: Optional[float] = None
    hair_consistency_score: Optional[float] = None
    attempts: int = 1
    generation_time: float = 0.0


@dataclass
class SourcePhoto:
    """The customer photo prepared once and shared by all 8 style edits."""
    rgb: np.ndarray            # head-and-shoulders crop sent to the edit model
    jpeg: bytes
    face: FaceGeometry
    embedding: np.ndarray
    hair_lab: Optional[np.ndarray]
    hair_mask: np.ndarray
    skin_lab: np.ndarray


# ----------------------------------------------------------------------------
# Image helpers
# ----------------------------------------------------------------------------
def _to_jpeg(img: Image.Image, quality: int = 92) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def prepare_ai_input(raw: bytes) -> Image.Image:
    """Fix phone orientation, drop alpha, and downscale so we never send huge originals."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    img.thumbnail((settings.AI_INPUT_MAX_SIDE, settings.AI_INPUT_MAX_SIDE), Image.Resampling.LANCZOS)
    return img


def _fit_to(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Center-crop the model output to the input aspect ratio, then resize to the input size."""
    return ImageOps.fit(img, size, Image.Resampling.LANCZOS, centering=(0.5, 0.4))


def _skin_lab(rgb: np.ndarray, face: FaceGeometry, points: tuple = LM_CHEEK_SKIN) -> np.ndarray:
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    r = max(3, int(face.width * 0.06))
    samples = []
    for i in points:
        x, y = (int(v) for v in face.pt(i))
        patch = lab[max(0, y - r):y + r, max(0, x - r):x + r].reshape(-1, 3)
        if len(patch):
            samples.append(patch)
    L, a, b = np.median(np.concatenate(samples), axis=0)
    return np.array([L * 100.0 / 255.0, a - 128.0, b - 128.0], dtype=np.float32)


def _forehead_mark_size(rgb: np.ndarray, face: FaceGeometry, hair: np.ndarray) -> float:
    """
    Size (fraction of face width squared) of the largest bindi-like spot on the forehead centre line
    just above the eyebrows: compact, roughly round, and clearly not skin coloured. 0 when none.
    Hair and the eyebrows (outside the narrow centre window) are ignored.
    """
    fw = face.width
    cx, cy = face.pt(LM_FOREHEAD_CENTER[0])
    h, w = rgb.shape[:2]
    y0, y1 = int(max(0, cy - 0.14 * fw)), int(min(h, cy + 0.03 * fw))
    x0, x1 = int(max(0, cx - 0.06 * fw)), int(min(w, cx + 0.06 * fw))
    wx0, wx1 = int(max(0, cx - 0.18 * fw)), int(min(w, cx + 0.18 * fw))
    if y1 <= y0 or x1 <= x0:
        return 0.0
    band = cv2.cvtColor(rgb[y0:y1, wx0:wx1], cv2.COLOR_RGB2LAB).astype(np.float32)
    band_skin = ~hair[y0:y1, wx0:wx1]
    if band_skin.sum() < 50:
        return 0.0
    skin = np.median(band[band_skin], axis=0)
    centre = band[:, x0 - wx0:x1 - wx0]
    spot = (np.linalg.norm(centre - skin, axis=2) > 35) & ~hair[y0:y1, x0:x1]
    spot = cv2.morphologyEx(spot.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(spot, 8)
    best = 0.0
    for i in range(1, n):
        _, _, bw, bh, area = stats[i]
        round_enough = max(bw, bh) / max(1, min(bw, bh)) <= 2.2 and area / (bw * bh) >= 0.45
        if round_enough and max(bw, bh) <= 0.09 * fw:
            best = max(best, area / (fw * fw))
    return best


def _added_forehead_mark(src: "SourcePhoto", edited_rgb: np.ndarray, face: FaceGeometry,
                         edited_hair: np.ndarray) -> bool:
    """True when the edit added a bindi/tilak-like spot that is not in the original photo."""
    grow = np.ones((7, 7), np.uint8)
    before = _forehead_mark_size(src.rgb, src.face, cv2.dilate(src.hair_mask.astype(np.uint8), grow).astype(bool))
    after = _forehead_mark_size(edited_rgb, face, cv2.dilate(edited_hair.astype(np.uint8), grow).astype(bool))
    return after >= 0.001 and before < 0.0005


def _border_difference(a: np.ndarray, b: np.ndarray, hair: np.ndarray) -> float:
    """Mean absolute RGB difference on bottom clothing area, ignoring background replaced by white studio backdrop."""
    h, w = a.shape[:2]
    eh = max(4, int(h * 0.08))
    region = np.zeros((h, w), dtype=bool)
    region[h - eh:, :] = True
    keep = region & ~hair
    if keep.sum() < 0.05 * region.sum():
        return 0.0
    return float(np.abs(a[keep].astype(np.float32) - b[keep].astype(np.float32)).mean())


def _register(src_rgb: np.ndarray, edited_rgb: np.ndarray, src_ignore: np.ndarray) -> Optional[np.ndarray]:
    """
    Similarity transform (scale + rotation + shift) mapping the source photo onto the edited photo,
    estimated from SIFT matches outside the hair (face, clothing, jewellery, background). Edit models
    often zoom or shift the frame slightly; the checks compare the photos in the same frame.
    None when there are too few reliable matches.
    """
    sift = cv2.SIFT_create(4000)
    k1, d1 = sift.detectAndCompute(cv2.cvtColor(src_rgb, cv2.COLOR_RGB2GRAY), (~src_ignore).astype(np.uint8) * 255)
    k2, d2 = sift.detectAndCompute(cv2.cvtColor(edited_rgb, cv2.COLOR_RGB2GRAY), None)
    if d1 is None or d2 is None or len(k1) < 15 or len(k2) < 15:
        return None
    pairs = cv2.BFMatcher(cv2.NORM_L2).knnMatch(d1, d2, k=2)
    good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < 0.75 * p[1].distance]
    if len(good) < 15:
        return None
    p1 = np.float32([k1[m.queryIdx].pt for m in good])
    p2 = np.float32([k2[m.trainIdx].pt for m in good])
    M, inliers = cv2.estimateAffinePartial2D(p1, p2, method=cv2.RANSAC, ransacReprojThreshold=4.0)
    if M is None or inliers is None or int(inliers.sum()) < 15:
        return None
    return M


PERSON_MIN_FRACTION, PERSON_MAX_FRACTION = 0.05, 0.97  # outside this the person was not separated
FACE_KEPT_MIN = 0.97        # share of the face that must survive the background replacement
NEAR_WHITE = 235            # a model background this bright (all channels) already counts as white
MIN_KEPT_COMPONENT = 0.03   # person fragments smaller than this share of the main body are background noise
MAX_FILLED_HOLE = 0.01      # holes inside the person up to this share of the image are filled (not whitened)


def _clean_person_mask(mask: np.ndarray) -> np.ndarray:
    """Removes stray fragments (specks of background labelled as person) and fills small holes."""
    m = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if n <= 1:
        return m.astype(bool)
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = np.zeros_like(m, dtype=bool)
    for i, area in enumerate(areas, start=1):
        if area >= MIN_KEPT_COMPONENT * areas.max():
            keep |= labels == i
    # Fill enclosed holes that are small; a large enclosed gap (e.g. between arm and body) stays background
    inv = (~keep).astype(np.uint8)
    hn, hlabels, hstats, _ = cv2.connectedComponentsWithStats(inv, 4)
    h, w = keep.shape
    for i in range(1, hn):
        x, y, bw, bh, area = hstats[i]
        touches_border = x == 0 or y == 0 or x + bw >= w or y + bh >= h
        if not touches_border and area <= MAX_FILLED_HOLE * h * w:
            keep |= hlabels == i
    return keep


def _near_white_background(rgb: np.ndarray) -> bool:
    """The model already returned a white background (checked on a band along the image border)."""
    h, w = rgb.shape[:2]
    b = max(4, int(min(h, w) * 0.03))
    band = np.concatenate([rgb[:b].reshape(-1, 3), rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)])
    return float((band.min(axis=1) >= NEAR_WHITE).mean()) >= 0.9


def whiten_background(img: Image.Image, face: Optional[FaceGeometry] = None) -> tuple[Image.Image, Optional[str]]:
    """
    Puts the person on a solid white (#FFFFFF) background. The person (hair, face and body skin, clothes and
    accessories such as jewellery) comes from MediaPipe's multi-class segmenter, which also works on side and
    back photos without a face. Returns (image, problem); on a problem the original image is returned and the
    caller decides (a white model background is accepted, otherwise the attempt is retried).
    """
    rgb = np.asarray(img.convert("RGB"))
    mask = get_vision_models().person_mask(rgb)
    if mask is None:
        return img, "background segmentation model missing (run ai_models/download_models.py)"
    mask = _clean_person_mask(mask)
    fraction = float(mask.mean())
    if not PERSON_MIN_FRACTION <= fraction <= PERSON_MAX_FRACTION:
        return img, f"person could not be separated from the background ({fraction:.0%} of the image)"
    if face is not None:
        hull = np.zeros(mask.shape, np.uint8)
        cv2.fillConvexPoly(hull, cv2.convexHull(face.points.astype(np.int32)), 1)
        hull = hull.astype(bool)
        if hull.any() and float(mask[hull].mean()) < FACE_KEPT_MIN:
            return img, "the background replacement would cut into the face"
    soft = cv2.GaussianBlur(mask.astype(np.float32), (5, 5), 0)
    soft[soft < 0.02] = 0.0          # pure #FFFFFF everywhere outside the person
    soft = soft[..., None]
    out = (rgb.astype(np.float32) * soft + 255.0 * (1.0 - soft)).round().clip(0, 255).astype(np.uint8)
    return Image.fromarray(out), None


def apply_pure_white_background(img: Image.Image) -> Image.Image:
    """Compatibility wrapper: the white-background image, or the input unchanged when that is not possible."""
    return whiten_background(img)[0]


def vm_face_of(img: Image.Image) -> Optional[FaceGeometry]:
    return get_vision_models().detect_face(np.asarray(img.convert("RGB")))


def add_preview_label(img: Image.Image) -> Image.Image:
    out = img.copy()
    draw = ImageDraw.Draw(out)
    w, h = out.size
    draw.rectangle([(w - 92, h - 26), (w - 6, h - 6)], fill=(15, 23, 42))
    draw.text((w - 84, h - 22), "AI preview", fill=(245, 158, 11))
    return out


# ----------------------------------------------------------------------------
# Validation
# ----------------------------------------------------------------------------
# Bump when the validation rules change, so cached previews accepted under older rules are not reused
VALIDATION_VERSION = "validate-v7-six-points"


@dataclass
class Validation:
    problem: Optional[str]
    identity_score: Optional[float] = None
    hair_consistency_score: Optional[float] = None


@dataclass(frozen=True)
class ValidationProfile:
    """What an edit for one service may change. A beard edit legitimately changes the lower face, so it is
    checked against forehead skin and a slightly looser identity threshold; only colour looks may recolour hair."""
    service: str
    identity_min: float
    skin_points: tuple
    colour_change_allowed: bool


# Catalogue finished lengths -> rank on the same scale as the measured length (Short / Medium / Long / Very Long)
TARGET_LENGTH_RANK = {"short": 2.0, "bob": 2.5, "lob": 3.0, "medium": 3.0, "long": 4.0, "very long": 5.0}
MEASURED_LENGTH_RANK = {"Short": 2.0, "Medium": 3.0, "Long": 4.0, "Very Long": 5.0}
COLOUR_MIN_DELTA_E = 4.0           # a colour look that leaves the hair colour almost unchanged was not applied
BEARD_MIN_CHANGED_FRACTION = 0.04  # share of the lower face that must change for a beard look


def validation_profile(style: Dict[str, Any]) -> ValidationProfile:
    service = style.get("service") or ("Beard" if str(style.get("style_code", "")).startswith("BEARD") else "Hair")
    if service == "Beard":
        return ValidationProfile("Beard", settings.BEARD_IDENTITY_MIN_SIMILARITY, LM_FOREHEAD_CENTER, False)
    return ValidationProfile(service, settings.IDENTITY_MIN_SIMILARITY, LM_CHEEK_SKIN, service == "Colour")


def _style_not_applied(src: SourcePhoto, edited_rgb: np.ndarray, face: FaceGeometry, mask: np.ndarray,
                       style: Dict[str, Any], profile: ValidationProfile, hair_de: Optional[float]) -> Optional[str]:
    """
    Positive check that the requested look is visible, not only that nothing else changed. Coarse on purpose:
    it catches clear misses (e.g. a long result for a short cut); anything it cannot measure passes.
    """
    if profile.service == "Hair":
        target = TARGET_LENGTH_RANK.get(str(style.get("hair_length", "")).strip().lower())
        measured, _ = measure_hair_length(mask, face)
        got = MEASURED_LENGTH_RANK.get(measured)
        # Too long by 1.5+ classes (e.g. a bob that came back long) or too short by 2+ classes. Lob vs Long (one
        # class) is tolerated: a lob that touches the shoulders can measure "Long" on the crop.
        if target is not None and got is not None and (got - target >= 1.5 or target - got >= 2.0):
            return f"requested cut not applied (finished length looks {measured}, style is {style.get('hair_length')})"
    elif profile.service == "Colour":
        if hair_de is not None and hair_de < COLOUR_MIN_DELTA_E:
            return f"requested colour not applied (hair colour almost unchanged, deltaE {hair_de:.1f})"
    elif profile.service == "Beard":
        h, w = edited_rgb.shape[:2]
        y0 = int(max(0, src.face.pt(LM_NOSE_TIP)[1]))
        y1 = int(min(h, src.face.chin_y + 0.15 * src.face.height))
        x0 = int(max(0, src.face.center_x - 0.5 * src.face.width))
        x1 = int(min(w, src.face.center_x + 0.5 * src.face.width))
        if y1 > y0 and x1 > x0:
            diff = np.abs(src.rgb[y0:y1, x0:x1].astype(np.int16) - edited_rgb[y0:y1, x0:x1].astype(np.int16))
            if (diff.max(axis=2) > 20).mean() < BEARD_MIN_CHANGED_FRACTION:
                return "requested beard style not applied (lower face almost unchanged)"
    return None


# Hair volume (hair area) the edit may reach, relative to the original, by how the length changes. Letting tied-back
# hair down legitimately shows much more hair, so that case is not limited.
MAX_HAIR_AREA_RATIO = {"shorter": 1.25, "same": 1.40}
MAX_HAIR_AREA_RATIO_KEEP_CUT = 1.30   # colour looks keep the cut


def _length_change_of(analysis: Optional[Dict[str, Any]], style: Dict[str, Any]) -> Optional[str]:
    from app.ai.prompt_engine import _length_change
    return _length_change(analysis or {}, style)


def _volume_problem(before_px: float, after_px: float, analysis: Optional[Dict[str, Any]],
                    style: Dict[str, Any]) -> Optional[str]:
    """Extra volume / density added to the hair, judged from the hair area before and after."""
    if before_px <= 0 or (analysis or {}).get("hair_tied_back"):
        return None
    service = style.get("service", "Hair")
    if service == "Hair":
        limit = MAX_HAIR_AREA_RATIO.get(_length_change_of(analysis, style))
    elif service == "Colour":
        limit = MAX_HAIR_AREA_RATIO_KEEP_CUT
    else:
        limit = None  # texture services (perms, waves) change volume by design; beard looks do not touch it
    ratio = after_px / before_px
    if limit is not None and ratio > limit:
        return f"extra hair volume added ({ratio:.2f}x the original hair area)"
    return None


def _texture_flip(before_rgb: np.ndarray, before_mask: np.ndarray, after_rgb: np.ndarray, after_mask: np.ndarray,
                  width: float, style: Dict[str, Any]) -> Optional[str]:
    """Straight hair turned curly (or the reverse) by a service that must keep the texture."""
    if style.get("service", "Hair") == "Texture":
        return None
    before, _ = hair_texture(before_rgb, before_mask, width)
    after, _ = hair_texture(after_rgb, after_mask, width)
    if {before, after} == {"Straight", "Curly"}:
        return f"hair texture changed ({before.lower()} to {after.lower()})"
    return None


def validate_edit(src: SourcePhoto, edited_rgb: np.ndarray, style: Dict[str, Any],
                  analysis: Optional[Dict[str, Any]] = None) -> Validation:
    vm = get_vision_models()
    profile = validation_profile(style)
    changed = np.abs(src.rgb.astype(np.int16) - edited_rgb.astype(np.int16)).max(axis=2) > 20
    if changed.mean() < 0.003:
        return Validation("model returned the photo unchanged")

    face = vm.detect_face(edited_rgb)
    if face is None:
        return Validation("no face found in the edited photo")

    # Align the original to the edited frame using the background (tolerates a slight zoom/shift)
    h, w = src.rgb.shape[:2]
    old_hair = cv2.dilate(src.hair_mask.astype(np.uint8), np.ones((31, 31), np.uint8)).astype(bool)
    M = _register(src.rgb, edited_rgb, old_hair)
    if M is None:
        M = np.float32([[1, 0, 0], [0, 1, 0]])
    frame_scale = float(np.hypot(M[0, 0], M[1, 0]))
    if not 0.8 < frame_scale < 1.25:
        return Validation(f"photo was re-framed too much (zoom {frame_scale:.2f})")

    # The face must sit where the original face lands in the edited frame
    expected = M @ np.array([src.face.center_x, src.face.top_y, 1.0])
    expected_width = src.face.width * frame_scale
    shift = np.hypot(face.center_x - expected[0], face.top_y - expected[1]) / expected_width
    scale = face.width / expected_width
    if shift > 0.25 or not 0.8 < scale < 1.25:
        return Validation(f"face moved or resized relative to the scene (shift={shift:.2f}, scale={scale:.2f})")

    identity = vm.identity_similarity(src.embedding, vm.face_embedding(edited_rgb, face))
    if identity < profile.identity_min:
        return Validation(f"identity_validation_failed (similarity {identity:.2f})", identity)

    skin_before = src.skin_lab if profile.skin_points == LM_CHEEK_SKIN else _skin_lab(src.rgb, src.face, profile.skin_points)
    skin_shift = delta_e(skin_before, _skin_lab(edited_rgb, face, profile.skin_points))
    if skin_shift > 15:
        return Validation(f"skin tone changed (deltaE {skin_shift:.1f})", identity)

    mask = vm.hair_mask(edited_rgb, face)
    if _added_forehead_mark(src, edited_rgb, face, mask):
        return Validation("something was added to the face (forehead mark)", identity)

    if mask.sum() < 0.05 * face.width ** 2 and src.hair_mask.sum() >= 0.05 * face.width ** 2:
        return Validation("hair missing in the edited photo", identity)

    aligned = cv2.warpAffine(src.rgb, M, (w, h), flags=cv2.INTER_LINEAR)
    outside = cv2.warpAffine(np.ones((h, w), np.uint8), M, (w, h), flags=cv2.INTER_NEAREST) == 0
    src_hair = cv2.warpAffine(src.hair_mask.astype(np.uint8), M, (w, h), flags=cv2.INTER_NEAREST).astype(bool)
    ignore = cv2.dilate((mask | src_hair).astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool) | outside
    if _border_difference(aligned, edited_rgb, ignore) > 35:
        return Validation("background or clothing changed", identity)

    hair_score = hair_de = None
    edited_lab = hair_lab(edited_rgb, mask)
    if src.hair_lab is not None and edited_lab is not None:
        hair_de = delta_e(src.hair_lab, edited_lab)
        hair_score = float(np.clip(1.0 - hair_de / 40.0, 0.0, 1.0))
        if hair_de > settings.HAIR_COLOUR_MAX_DELTA_E and not profile.colour_change_allowed:
            return Validation(f"hair colour changed (deltaE {hair_de:.1f})", identity, hair_score)

    missed = _style_not_applied(src, edited_rgb, face, mask, style, profile, hair_de)
    if missed:
        return Validation(missed, identity, hair_score)
    if profile.service != "Beard":
        problem = (_volume_problem(float(src_hair.sum()), float(mask.sum()), analysis, style)
                   or _texture_flip(src.rgb, src.hair_mask, edited_rgb, mask, src.face.width, style))
        if problem:
            return Validation(problem, identity, hair_score)
    return Validation(None, identity, hair_score)


# ----------------------------------------------------------------------------
# Providers
# ----------------------------------------------------------------------------
class GeminiEditor:
    name = "gemini"
    supports_back_image = True  # other providers take one photo (+ optional style reference) only
    supports_extra_images = True

    def __init__(self):
        from google import genai  # imported lazily so the app starts without the key
        keys = settings.get_gemini_api_keys()
        if not keys:
            raise ImageEditError("No GEMINI_API_KEY found in backend/.env")
        self._keys = keys
        self._clients = [genai.Client(api_key=k) for k in keys]
        self._key_counter = 0
        log_progress("GEMINI-INIT", f"Initialized Gemini Editor with Pool of {len(keys)} API Key(s)", "INFO")

    max_prompt_chars = None

    def model_for(self, tier: str) -> str:
        return settings.GEMINI_HQ_MODEL if tier == "hq" else settings.GEMINI_FAST_MODEL

    def supports_reference(self, tier: str) -> bool:
        return True

    def _next_client(self) -> tuple[Any, str]:
        idx = self._key_counter % len(self._clients)
        self._key_counter += 1
        return self._clients[idx], self._keys[idx]

    async def edit_image(self, tier: str, prompt: str, photo: bytes, reference: Optional[bytes],
                         usage: Optional[Dict[str, Any]] = None, back_image: Optional[bytes] = None,
                         extra_images: Optional[list[bytes]] = None) -> bytes:
        from google.genai import types
        from google.genai.errors import APIError

        model_name = self.model_for(tier)

        contents: list[Any] = [types.Part.from_bytes(data=photo, mime_type="image/jpeg")]
        if extra_images:
            for img_b in extra_images:
                if img_b:
                    contents.append(types.Part.from_bytes(data=img_b, mime_type="image/jpeg"))
        elif back_image:
            contents.append(types.Part.from_bytes(data=back_image, mime_type="image/jpeg"))
        if reference:
            contents.append(types.Part.from_bytes(data=reference, mime_type="image/jpeg"))
        contents.append(prompt)

        # Try clients from the pool; if one key hits a rate limit (429 / RESOURCE_EXHAUSTED), failover to next key
        last_error = None
        for key_try in range(len(self._clients)):
            client, key = self._next_client()
            masked_key = key[:6] + "..." + key[-4:] if len(key) > 10 else "***"
            log_progress("GEMINI-REQUEST", f"Sending request using API Key #{key_try + 1}/{len(self._clients)} ({masked_key}) to '{model_name}'...")

            try:
                resp = await client.aio.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]),
                )
                for cand in resp.candidates or []:
                    for part in (cand.content.parts if cand.content else []) or []:
                        if part.inline_data and part.inline_data.data:
                            log_progress("GEMINI-SUCCESS", f"Successfully generated image using Key ({masked_key})!", "SUCCESS")
                            if usage is not None and resp.usage_metadata:
                                um = resp.usage_metadata
                                usage["input_tokens"] = um.prompt_token_count or 0
                                usage["output_tokens"] = um.candidates_token_count or 0
                                usage["total_tokens"] = um.total_token_count or (usage["input_tokens"] + usage["output_tokens"])
                                price = _token_price(model_name)
                                if price:
                                    usage["cost_usd"] = (usage["input_tokens"] * price[0] + usage["output_tokens"] * price[1]) / 1e6
                            return part.inline_data.data
                reason = resp.candidates[0].finish_reason if resp.candidates else getattr(resp, "prompt_feedback", None)
                last_error = f"Gemini returned no image (reason: {reason})"

            except APIError as e:
                is_rate_limit = (e.code == 429 or "RESOURCE_EXHAUSTED" in str(e).upper() or "QUOTA" in str(e).upper())
                if is_rate_limit and key_try < len(self._clients) - 1:
                    log_progress("GEMINI-KEY-ROTATE", f"Key {masked_key} hit rate limit ({e.message}). Rotating to next key in pool...", "WARNING")
                    last_error = f"Gemini API Key hit rate limits / quota exceeded ({e.message})"
                    continue
                else:
                    log_api_exceeded_warning(f"Gemini (Key: {masked_key})", model_name, f"HTTP {e.code}: {e.message}")
                    raise ImageEditError(f"Gemini API error {e.code}: {e.message}")
            except Exception as e:
                err_str = str(e)
                is_rate_limit = ("429" in err_str or "RESOURCE_EXHAUSTED" in err_str.upper() or "QUOTA" in err_str.upper())
                if is_rate_limit and key_try < len(self._clients) - 1:
                    log_progress("GEMINI-KEY-ROTATE", f"Key {masked_key} hit rate limit ({err_str}). Rotating to next key in pool...", "WARNING")
                    last_error = f"Gemini API Key hit rate limit ({err_str})"
                    continue
                raise ImageEditError(f"Gemini error: {err_str}")

        raise ImageEditError(last_error or "Gemini generation failed across key pool")


class CloudflareEditor:
    """
    FLUX.2-klein-4B (Apache-2.0) on Cloudflare Workers AI. Free plan: 10,000 neurons/day, roughly 110 per
    preview. Input images must be under 512x512, so the photo is downscaled for the model while the
    output is requested at the full crop size.
    """
    name = "cloudflare"
    max_prompt_chars = 800
    max_input_side = 496

    def __init__(self):
        if not settings.CLOUDFLARE_ACCOUNT_ID or not settings.CLOUDFLARE_API_TOKEN:
            raise ImageEditError("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set in backend/.env")
        self.url = (f"https://api.cloudflare.com/client/v4/accounts/{settings.CLOUDFLARE_ACCOUNT_ID}"
                    f"/ai/run/{settings.CLOUDFLARE_MODEL}")

    def model_for(self, tier: str) -> str:
        return "FLUX.2-klein-4B (Cloudflare Workers AI)"

    def supports_reference(self, tier: str) -> bool:
        return True

    def _small_jpeg(self, data: bytes) -> bytes:
        img = Image.open(io.BytesIO(data)).convert("RGB")
        img.thumbnail((self.max_input_side, self.max_input_side), Image.Resampling.LANCZOS)
        return _to_jpeg(img, quality=95)

    async def edit_image(self, tier: str, prompt: str, photo: bytes, reference: Optional[bytes],
                         usage: Optional[Dict[str, Any]] = None) -> bytes:
        import base64

        width, height = Image.open(io.BytesIO(photo)).size
        files = {"input_image_0": ("photo.jpg", self._small_jpeg(photo), "image/jpeg")}
        if reference:
            files["input_image_1"] = ("reference.jpg", self._small_jpeg(reference), "image/jpeg")
        data = {"prompt": prompt, "width": str(width // 16 * 16), "height": str(height // 16 * 16)}
        headers = {"Authorization": f"Bearer {settings.CLOUDFLARE_API_TOKEN}"}
        timeout = httpx.Timeout(settings.PROVIDER_REQUEST_TIMEOUT_SECONDS, connect=10.0)

        log_progress("CLOUDFLARE-REQUEST", f"Sending image request to Cloudflare Workers AI ({settings.CLOUDFLARE_MODEL})...")
        problem = "no response"
        for attempt in range(1, settings.PROVIDER_REQUEST_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    resp = await client.post(self.url, headers=headers, data=data, files=files)
            except httpx.TimeoutException:
                problem = f"no response within {settings.PROVIDER_REQUEST_TIMEOUT_SECONDS}s"
            except httpx.HTTPError as e:
                problem = f"connection error ({type(e).__name__})"
            else:
                if "daily free allocation" in resp.text.lower() or resp.status_code == 429:
                    log_api_exceeded_warning(
                        provider="Cloudflare Workers AI",
                        model=settings.CLOUDFLARE_MODEL,
                        error_msg=f"HTTP {resp.status_code}: Daily Free Allowance Exceeded / Rate Limit Hit",
                        hint="Cloudflare free daily allowance used up (~90 previews/day). Resets at 00:00 UTC."
                    )
                    raise ImageEditError("Cloudflare free daily allowance used up; it resets at 00:00 UTC")
                if resp.status_code in (401, 403):
                    log_api_exceeded_warning(
                        provider="Cloudflare Workers AI",
                        model=settings.CLOUDFLARE_MODEL,
                        error_msg=f"HTTP {resp.status_code}: Rejected API Token / Unauthorized",
                        hint="Cloudflare rejected the API token; verify token permissions in backend/.env"
                    )
                    raise ImageEditError("Cloudflare rejected the API token; it needs the 'Workers AI' permission")
                if "flagged" in resp.text.lower() or '"code":3030' in resp.text.replace(" ", ""):
                    # Cloudflare's safety filter refused this photo. It is deterministic for the same photo (new
                    # seeds and simpler prompts are refused too), and commonly triggered by photos of well-known
                    # people or downloaded images, so do not retry or swap in a different, uncontrolled prompt.
                    log_progress("CLOUDFLARE-SAFETY-FILTER", f"Cloudflare's safety filter refused this photo: {resp.text[:160]}", "WARNING")
                    raise ImageEditError(
                        "The image service's safety filter declined to edit this photo. This usually happens with "
                        "photos of well-known people or pictures downloaded from the internet. Please use a real "
                        "photo of the customer taken in the salon.")
                if resp.status_code == 200:
                    log_progress("CLOUDFLARE-SUCCESS", "Cloudflare Workers AI returned image successfully!", "SUCCESS")
                    break
                problem = f"HTTP {resp.status_code}: {resp.text[:200]}"
                if resp.status_code != 429 and resp.status_code < 500:
                    log_progress("CLOUDFLARE-ERROR", problem, "ERROR")
                    raise ImageEditError(f"Cloudflare error {problem}")
            log_progress("CLOUDFLARE-RETRY", f"Attempt {attempt}/{settings.PROVIDER_REQUEST_RETRIES} failed: {problem}", "WARNING")
            if attempt < settings.PROVIDER_REQUEST_RETRIES:
                await asyncio.sleep(2 * attempt)
        else:
            log_progress("CLOUDFLARE-NO-RESPONSE", f"Gave up after {settings.PROVIDER_REQUEST_RETRIES} tries ({problem})", "ERROR")
            raise ImageEditError(f"Cloudflare did not respond after {settings.PROVIDER_REQUEST_RETRIES} tries ({problem}). Please retry.")
        body = resp.json()
        b64 = (body.get("result") or {}).get("image")
        if not b64:
            raise ImageEditError(f"Cloudflare returned no image: {str(body)[:300]}")
        if usage is not None:
            # Cloudflare does not return usage; estimate it from its per-512px-tile pricing.
            # Each input image is downscaled below 512x512 (one tile); the output is requested at full size.
            out_w, out_h = width // 16 * 16, height // 16 * 16
            output_tiles = -(-out_w // 512) * -(-out_h // 512)
            usage["neurons"] = (len(files) * CLOUDFLARE_NEURONS_PER_INPUT_TILE
                                + output_tiles * CLOUDFLARE_NEURONS_PER_OUTPUT_TILE)
            usage["cost_usd"] = 0.0  # inside the free 10,000 neurons/day; $0.011 per 1,000 neurons beyond it
        return base64.b64decode(b64)


class OpenRouterEditor:
    """Image-editing models (Gemini image, GPT image) through OpenRouter's chat completions API."""
    name = "openrouter"
    max_prompt_chars = None
    url = "https://openrouter.ai/api/v1/chat/completions"

    def __init__(self):
        if not settings.OPENROUTER_API_KEY:
            raise ImageEditError("OPENROUTER_API_KEY is not set in backend/.env")

    def model_for(self, tier: str) -> str:
        return settings.OPENROUTER_HQ_MODEL if tier == "hq" else settings.OPENROUTER_FAST_MODEL

    def supports_reference(self, tier: str) -> bool:
        return True

    async def edit_image(self, tier: str, prompt: str, photo: bytes, reference: Optional[bytes],
                         usage: Optional[Dict[str, Any]] = None) -> bytes:
        import base64

        content: list[Dict[str, Any]] = [{"type": "text", "text": prompt}]
        for data in [photo] + ([reference] if reference else []):
            content.append({"type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{base64.b64encode(data).decode()}"}})
        payload = {"model": self.model_for(tier), "modalities": ["image", "text"],
                   "messages": [{"role": "user", "content": content}]}
        headers = {"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}", "X-Title": "Salon AI"}
        try:
            async with httpx.AsyncClient(timeout=settings.GENERATION_TIMEOUT_SECONDS) as client:
                resp = await client.post(self.url, headers=headers, json=payload)
        except httpx.HTTPError as e:
            raise ImageEditError(f"OpenRouter unreachable: {e}")
        if resp.status_code == 402:
            raise ImageEditError("OpenRouter account has no credits for image models; add credits at openrouter.ai")
        if resp.status_code != 200:
            raise ImageEditError(f"OpenRouter error {resp.status_code}: {resp.text[:300]}")
        body = resp.json()
        if usage is not None and body.get("usage"):
            u = body["usage"]
            usage["input_tokens"] = u.get("prompt_tokens", 0)
            usage["output_tokens"] = u.get("completion_tokens", 0)
            usage["total_tokens"] = u.get("total_tokens", usage["input_tokens"] + usage["output_tokens"])
            price = _token_price(self.model_for(tier))
            if u.get("cost") is not None:
                usage["cost_usd"] = float(u["cost"])
            elif price:
                usage["cost_usd"] = (usage["input_tokens"] * price[0] + usage["output_tokens"] * price[1]) / 1e6
        message = ((body.get("choices") or [{}])[0]).get("message") or {}
        for image in message.get("images") or []:
            url = (image.get("image_url") or {}).get("url", "")
            if url.startswith("data:"):
                return base64.b64decode(url.split(",", 1)[1])
            if url.startswith("http"):
                async with httpx.AsyncClient(timeout=60) as client:
                    return (await client.get(url)).content
        raise ImageEditError(f"OpenRouter returned no image (reply: {str(message.get('content'))[:150]})")


class HuggingFaceSpaceEditor:
    """
    Qwen-Image-Edit-2511 through a public Hugging Face Space (gradio API). FOR TESTING ONLY: the customer
    photo is uploaded to a third-party Space. Uses the Space's 4-step Lightning variant with prompt
    rewriting disabled so the controlled prompt is used exactly as written.
    """
    name = "huggingface"
    max_prompt_chars = 800

    def __init__(self):
        from gradio_client import Client
        try:
            self._client = Client(settings.HF_SPACE_ID, token=settings.HF_TOKEN or None, verbose=False)
        except Exception as e:
            raise ImageEditError(f"Hugging Face Space {settings.HF_SPACE_ID} unavailable: {e}")

    def model_for(self, tier: str) -> str:
        return f"Qwen-Image-Edit-2511 ({settings.HF_SPACE_ID})"

    def supports_reference(self, tier: str) -> bool:
        return True

    def _predict(self, prompt: str, photo: bytes, reference: Optional[bytes]) -> bytes:
        import tempfile
        from gradio_client import handle_file

        paths = []
        try:
            for data in [photo] + ([reference] if reference else []):
                f = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
                f.write(data)
                f.close()
                paths.append(f.name)
            width, height = Image.open(io.BytesIO(photo)).size
            result, _seed = self._client.predict(
                images=[{"image": handle_file(p), "caption": None} for p in paths],
                prompt=prompt, seed=0, randomize_seed=False, true_guidance_scale=1.0,
                num_inference_steps=settings.HF_SPACE_STEPS, height=height // 16 * 16, width=width // 16 * 16,
                rewrite_prompt=False, api_name="/infer",
            )
        except Exception as e:
            message = str(e) or type(e).__name__
            if "quota" in message.lower() or "runs limit" in message.lower():
                hint = ("daily free quota used up; it resets within 24 hours (Hugging Face PRO gives more)"
                        if settings.HF_TOKEN else "anonymous free quota used up; add HF_TOKEN to backend/.env")
                raise ImageEditError(f"Hugging Face {hint}")
            raise ImageEditError(f"Hugging Face Space error: {message[:300]}")
        finally:
            for p in paths:
                try:
                    os.remove(p)
                except OSError:
                    pass
        if not result:
            raise ImageEditError("Hugging Face Space returned no image")
        image = result[0]["image"]
        path = image if isinstance(image, str) else image.get("path")
        with open(path, "rb") as f:
            return f.read()

    async def edit_image(self, tier: str, prompt: str, photo: bytes, reference: Optional[bytes],
                         usage: Optional[Dict[str, Any]] = None) -> bytes:
        return await asyncio.to_thread(self._predict, prompt, photo, reference)


# ----------------------------------------------------------------------------
# Orchestrator
# ----------------------------------------------------------------------------
# ---------------------------------------------------------------------------- side / back view checks
FRONTAL_YAW_MAX = 0.12        # nose offset / face width below this = facing the camera
VIEW_LENGTH_TOLERANCE = 0.25  # hair extent may differ this much when the length is kept
VIEW_SHORTER_MAX = 1.10       # a shorter cut may not end lower than the original hair
VIEW_TIED_MAX = 1.35          # tied-back hair let down: the ponytail already shows most of its length


def _frontal_face(rgb: np.ndarray) -> Optional[FaceGeometry]:
    """A face looking roughly at the camera (profiles and backs of heads return None)."""
    face = get_vision_models().detect_face(rgb)
    if face is None:
        return None
    yaw = abs(float(face.pt(LM_NOSE_TIP)[0]) - face.center_x) / max(face.width, 1.0)
    return face if yaw < FRONTAL_YAW_MAX else None


def _view_angle_problem(rgb: np.ndarray, view: str) -> Optional[str]:
    """Back views show no face; side views show a profile, not a face looking at the camera."""
    if view == "back":
        return "shows the face" if get_vision_models().detect_face(rgb) is not None else None
    if view == "side":
        return "shows the face from the front" if _frontal_face(rgb) is not None else None
    return None


def _hair_extent(mask: np.ndarray) -> float:
    """Vertical extent of the main hair region in pixels (top of the head to the lowest hair)."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if n <= 1:
        return 0.0
    main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    rows = np.nonzero((labels == main).any(axis=1))[0]
    return float(rows.max() - rows.min() + 1) if rows.size else 0.0


def _view_result_problem(src_rgb: np.ndarray, src_hair: np.ndarray, edited: np.ndarray, view: str,
                         style: Dict[str, Any], analysis: Dict[str, Any]) -> Optional[str]:
    """
    Checks a side/back result against the customer's own photo of that view (same framing): the angle, the
    finished length (a shorter cut may not end lower; a kept length stays within tolerance), added volume and
    a straight/curly texture flip. The front preview is matched by the prompt; these checks catch clear misses.
    """
    angle = _view_angle_problem(edited, view)
    if angle:
        return f"the generated {view} view {angle}"
    vm = get_vision_models()
    after_hair = vm.hair_mask(edited, None)
    before, after = _hair_extent(src_hair), _hair_extent(after_hair)
    service = style.get("service", "Hair")
    tied = bool(analysis.get("hair_tied_back"))
    if before > 0 and service != "Beard":
        ratio = after / before
        change = _length_change_of(analysis, style) if service == "Hair" else "same"
        if change == "shorter" and ratio > (VIEW_TIED_MAX if tied else VIEW_SHORTER_MAX):
            return f"hair is longer than in the original photo ({ratio:.2f}x) for a shorter cut"
        if change == "same":
            upper = VIEW_TIED_MAX if tied else 1 + VIEW_LENGTH_TOLERANCE
            if not (1 - VIEW_LENGTH_TOLERANCE) <= ratio <= upper:
                return f"hair length changed ({ratio:.2f}x the original) although the length is kept"
    if service != "Beard":
        width = src_rgb.shape[1] * 0.25  # head width estimate without a face, as in the photo analysis
        problem = (_volume_problem(float(src_hair.sum()), float(after_hair.sum()), analysis, style)
                   or _texture_flip(src_rgb, src_hair, edited, after_hair, width, style))
        if problem:
            return problem
    return None


class HairStyleGenerator:
    def __init__(self):
        self._editors: Dict[str, Any] = {}
        self._sem = asyncio.Semaphore(settings.MAX_PARALLEL_GENERATIONS)
        self._source_cache: Dict[str, SourcePhoto] = {}
        self._source_lock = asyncio.Lock()
        self._usage_by_photo: Dict[str, Dict[str, Any]] = {}  # running usage per customer photo URL
        self.cache_dir = os.path.join(storage_service.base_dir, "ai_cache")
        os.makedirs(self.cache_dir, exist_ok=True)

    def _get_editor(self, provider: Optional[str] = None):
        provider = (provider or settings.IMAGE_EDIT_PROVIDER).lower()
        if settings.is_production and provider in TEST_ONLY_PROVIDERS:
            raise ImageEditError(f"The '{provider}' image service is for testing only and is disabled in production.")
        if provider not in self._editors:
            if provider == "nvidia":
                self._editors[provider] = nvidia_nim_client
            elif provider in ("cloudflare", "cloudfare"):
                self._editors[provider] = CloudflareEditor()
            elif provider == "openrouter":
                self._editors[provider] = OpenRouterEditor()
            elif provider == "huggingface":
                self._editors[provider] = HuggingFaceSpaceEditor()
            else:
                self._editors[provider] = GeminiEditor()
        return self._editors[provider]

    async def _load_bytes(self, url: str) -> bytes:
        if media_path(url).startswith("/static/media/"):
            url = media_path(url)
            path = os.path.join(storage_service.base_dir, *url[len("/static/media/"):].split("/"))
            if not os.path.isfile(path):
                raise ImageEditError(f"Customer photo not found: {url}")
            with open(path, "rb") as f:
                return f.read()
        if url.startswith(("http://", "https://")):
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                resp = await client.get(url)
            resp.raise_for_status()
            return resp.content
        raise ImageEditError(f"Unsupported image location: {url}")

    def _prepare_source(self, raw: bytes) -> SourcePhoto:
        vm = get_vision_models()
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
        img.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        face = vm.detect_face(np.asarray(img))
        if face is None:
            raise ImageEditError("Please make sure your face is clearly visible.")
        if face.width < settings.GENERATION_MIN_FACE_PX:
            # The crop would be upscaled a lot, and identity checks (SFace) are unreliable on tiny faces
            raise ImageEditError("Your face is too small in this photo for a reliable preview. "
                                 "Please take a closer photo.")

        crop = img.crop(portrait_box(face, img.size))
        scale = settings.AI_INPUT_MAX_SIDE / max(crop.size)
        # multiples of 16 so diffusion models return exactly the input size
        size = (int(crop.width * scale) // 16 * 16, int(crop.height * scale) // 16 * 16)
        crop = crop.resize(size, Image.Resampling.LANCZOS)
        rgb = np.asarray(crop)
        face = vm.detect_face(rgb)
        if face is None:
            raise ImageEditError("Please make sure your face is clearly visible.")
        mask = vm.hair_mask(rgb, face)
        return SourcePhoto(
            rgb=rgb, jpeg=_to_jpeg(crop), face=face, embedding=vm.face_embedding(rgb, face),
            hair_lab=hair_lab(rgb, mask), hair_mask=mask, skin_lab=_skin_lab(rgb, face),
        )

    async def _source(self, url: str) -> SourcePhoto:
        raw = await self._load_bytes(url)
        key = hashlib.sha256(raw).hexdigest()
        async with self._source_lock:
            if key not in self._source_cache:
                if len(self._source_cache) > 32:
                    self._source_cache.clear()
                self._source_cache[key] = await asyncio.to_thread(self._prepare_source, raw)
            return self._source_cache[key]

    def _report_usage(self, photo_url: str, style_id: Any, attempt: int, model: str, usage: Dict[str, Any]) -> None:
        """Prints this call's usage and the running total for the customer photo (all its previews)."""
        total = self._usage_by_photo.setdefault(photo_url, {"calls": 0, "tokens": 0, "neurons": 0.0, "cost_usd": 0.0})
        total["calls"] += 1
        total["tokens"] += usage.get("total_tokens") or 0
        total["neurons"] += usage.get("neurons") or 0.0
        total["cost_usd"] += usage.get("cost_usd") or 0.0

        cyan = "\033[96m"
        bold = "\033[1m"
        reset = "\033[0m"

        in_tok = usage.get("input_tokens", 0)
        out_tok = usage.get("output_tokens", 0)
        tot_tok = usage.get("total_tokens", 0)
        call_cost = usage.get("cost_usd", 0.0)

        border = "----------------------------------------------------------------------"
        token_box = (
            f"\n{cyan}{bold}{border}\n"
            f"[GEMINI API TOKEN USAGE SUMMARY]\n"
            f"Style Target : Style #{style_id} (Attempt #{attempt})\n"
            f"Model Used   : {model}\n"
            f"Input Tokens : {in_tok:,}\n"
            f"Output Tokens: {out_tok:,}\n"
            f"Total Tokens : {tot_tok:,}\n"
            f"Est. Call Cost: ${call_cost:.5f} USD\n"
            f"--- SESSION ACCUMULATED TOTAL FOR PHOTO ({photo_url.rsplit('/', 1)[-1]}) ---\n"
            f"Total API Calls  : {total['calls']}\n"
            f"Total Tokens Used: {total['tokens']:,}\n"
            f"Total Est. Cost  : ${total['cost_usd']:.5f} USD (~₹{total['cost_usd'] * 85:.2f} INR)\n"
            f"{border}{reset}\n"
        )
        try:
            print(token_box, flush=True)
        except Exception:
            pass

        log_progress("TOKENS", f"Style #{style_id} attempt {attempt} | {model} | Input: {in_tok:,} + Output: {out_tok:,} = Total: {tot_tok:,} tokens (${call_cost:.5f})", "INFO")
        log_progress("TOKENS-PHOTO-TOTAL", f"{photo_url.rsplit('/', 1)[-1]}: Calls={total['calls']} | Cumulative Tokens={total['tokens']:,} | Total Cost=${total['cost_usd']:.5f}", "INFO")

    @staticmethod
    def _sends_back(editor: Any, back_jpeg: Optional[bytes]) -> bool:
        return back_jpeg is not None and getattr(editor, "supports_back_image", False)

    @staticmethod
    def _extras_sent(editor: Any, extra_jpegs: Optional[list]) -> int:
        """How many extra customer photos this provider actually receives (0 for one-photo providers)."""
        return len(extra_jpegs) if extra_jpegs and getattr(editor, "supports_extra_images", False) else 0

    async def _edit(self, editor: Any, tier: str, prompt: str, photo: bytes, reference: Optional[bytes],
                    usage: Dict[str, Any], back_jpeg: Optional[bytes] = None,
                    extra_jpegs: Optional[list[bytes]] = None) -> bytes:
        """Calls the provider. Passes extra reference images if supported."""
        kwargs: Dict[str, Any] = {"usage": usage}
        if getattr(editor, "supports_extra_images", False) and extra_jpegs:
            kwargs["extra_images"] = extra_jpegs
        elif self._sends_back(editor, back_jpeg):
            kwargs["back_image"] = back_jpeg
        return await editor.edit_image(tier, prompt, photo, reference, **kwargs)

    def _save(self, jpeg: bytes, style_id: Any) -> str:
        _, url = storage_service.save_bytes(jpeg, folder="generated", filename_prefix=f"gen_style_{style_id}")
        return url

    async def generate(
        self,
        customer_image_url: str,
        style_metadata: Dict[str, Any],
        customer_analysis: Dict[str, Any],
        tier: str = "fast",
        provider: Optional[str] = None,
    ) -> EditResult:
        started = time.monotonic()
        style_name = style_metadata.get("name", "Unknown Hairstyle")
        style_id = style_metadata.get("id")

        log_progress("GENERATION-START", f"Processing Style #{style_id} ('{style_name}')", "INFO")
        
        src = await self._source(customer_image_url)
        log_progress("STEP 1/4", f"Prepared source photo crop (Face Box: {src.face.width}x{src.face.height})", "INFO")

        editor = self._get_editor(provider)
        model = editor.model_for(tier)
        log_progress("STEP 2/4", f"Selected AI Provider: '{editor.name.upper()}' | Model: '{model}'", "INFO")

        cust_len = str(customer_analysis.get("hair_length", "")).lower()
        cust_den = str(customer_analysis.get("hair_density", "")).lower()
        is_cust_bald = cust_len == "bald" or "bald" in cust_den or "sparse" in cust_den
        is_beard_service = style_metadata.get("service") == "Beard" or str(style_metadata.get("style_code", "")).startswith("BEARD")

        reference_jpeg = None
        if (settings.USE_STYLE_REFERENCE_IMAGE and editor.supports_reference(tier)
                and style_metadata.get("preview_image_url") and not is_cust_bald and not is_beard_service):
            reference_jpeg = _to_jpeg(prepare_ai_input(await self._load_bytes(style_metadata["preview_image_url"])))

        extra_jpegs = []
        for key in ("side_image_url", "back_image_url"):
            url = customer_analysis.get(key)
            if url and url != customer_image_url:
                try:
                    b = await self._load_bytes(url)
                    extra_jpegs.append(_to_jpeg(prepare_ai_input(b)))
                except Exception as e:
                    log_progress("EXTRA-PHOTO-LOAD-WARNING", f"Could not load {key}: {e}", "WARNING")
        back_jpeg = extra_jpegs[-1] if extra_jpegs else None

        last = Validation("generation was not attempted")
        prompt = ""
        attempts = 0
        fallback = settings.IMAGE_EDIT_FALLBACK_PROVIDER.strip().lower()
        rejected = False  # an earlier attempt was answered but failed validation

        for attempt in range(settings.GENERATION_MAX_ATTEMPTS):
            attempts = attempt + 1
            # Last attempt after a rejected preview: give the backup provider a chance instead of repeating
            if (rejected and attempt == settings.GENERATION_MAX_ATTEMPTS - 1 and fallback
                    and editor.name != fallback):
                try:
                    editor = self._get_editor(fallback)
                    model = editor.model_for(tier)
                    reference_jpeg = reference_jpeg if editor.supports_reference(tier) else None
                    log_progress("FALLBACK-AFTER-REJECT", f"Style #{style_id}: last attempt with '{fallback}'", "WARNING")
                except ImageEditError as fe:
                    log_progress("FALLBACK-FAILED", f"Fallback provider '{fallback}' unavailable: {fe.reason}", "WARNING")
            prompt = prompt_engine.build_prompt(
                customer_analysis, style_metadata, strict=attempt > 0, with_reference_image=reference_jpeg is not None,
                with_back_image=self._sends_back(editor, back_jpeg) and not self._extras_sent(editor, extra_jpegs),
                num_extra_images=self._extras_sent(editor, extra_jpegs), max_chars=editor.max_prompt_chars)
            
            log_progress("STEP 3/4", f"Attempt {attempt + 1}/{settings.GENERATION_MAX_ATTEMPTS} | Prompt ({len(prompt)} chars): '{prompt[:80]}...'", "INFO")

            cache_key = hashlib.sha256(
                src.jpeg + (reference_jpeg or b"") + (back_jpeg if self._sends_back(editor, back_jpeg) else b"") + f"|{style_id}|{model}|{PROMPT_TEMPLATE_VERSION}|{VALIDATION_VERSION}|{prompt}".encode()
            ).hexdigest()[:32]
            # Prefixed with the photo's tag so erasing a customer's photos also removes these copies
            cache_name = f"{photo_cache_tag(customer_image_url)}_{cache_key}"
            cache_img = os.path.join(self.cache_dir, f"{cache_name}.jpg")
            cache_meta = os.path.join(self.cache_dir, f"{cache_name}.json")
            if os.path.isfile(cache_img) and os.path.isfile(cache_meta):
                with open(cache_img, "rb") as f, open(cache_meta, encoding="utf-8") as m:
                    meta = json.load(m)
                    saved_url = self._save(f.read(), style_id)
                    log_progress("CACHE-HIT", f"Loaded cached image for Style #{style_id} ('{style_name}') in {round(time.monotonic() - started, 2)}s", "SUCCESS")
                    return EditResult(saved_url, model, prompt,
                                      meta.get("identity_score"), meta.get("hair_consistency_score"),
                                      attempts, round(time.monotonic() - started, 2))

            usage: Dict[str, Any] = {}
            try:
                async with self._sem:
                    raw = await asyncio.wait_for(
                        self._edit(editor, tier, prompt, src.jpeg, reference_jpeg, usage, back_jpeg, extra_jpegs=extra_jpegs),
                        timeout=settings.GENERATION_TIMEOUT_SECONDS,
                    )
            except asyncio.TimeoutError:
                log_progress("TIMEOUT-WARNING", f"Style #{style_id} attempt {attempts} timed out after {settings.GENERATION_TIMEOUT_SECONDS}s", "WARNING")
                last = Validation("the image service took too long to respond")
                continue
            except ImageEditError as e:
                log_progress("PROVIDER-ERROR", f"Style #{style_id}: {editor.name} failed ({e.reason})", "ERROR")
                fallback_handled = False
                if fallback and editor.name != fallback:
                    log_progress("FALLBACK-ATTEMPT", f"Trying fallback provider '{fallback}' for Style #{style_id}", "WARNING")
                    try:
                        editor = self._get_editor(fallback)
                        model = editor.model_for(tier)
                        reference_jpeg = reference_jpeg if editor.supports_reference(tier) else None
                        # The fallback may have a different prompt limit and image support: rebuild its prompt
                        prompt = prompt_engine.build_prompt(
                            customer_analysis, style_metadata, strict=attempt > 0,
                            with_reference_image=reference_jpeg is not None,
                            with_back_image=self._sends_back(editor, back_jpeg) and not self._extras_sent(editor, extra_jpegs),
                num_extra_images=self._extras_sent(editor, extra_jpegs), max_chars=editor.max_prompt_chars)
                        async with self._sem:
                            raw = await asyncio.wait_for(
                                self._edit(editor, tier, prompt, src.jpeg, reference_jpeg, usage, back_jpeg, extra_jpegs=extra_jpegs),
                                timeout=settings.GENERATION_TIMEOUT_SECONDS,
                            )
                            fallback_handled = True
                    except Exception as fe:
                        log_progress("FALLBACK-FAILED", f"Fallback provider '{fallback}' failed: {fe}", "WARNING")

                if not fallback_handled:
                    # Never substitute a catalogue photo or a stored card: a preview must be the customer's own
                    # edited photo, or the card shows "Preview unavailable" with Retry.
                    raise ImageEditError(e.reason, attempts=attempts, model=model)

            # Every answered call is billed, even if the preview is rejected below, so report it now
            self._report_usage(customer_image_url, style_id, attempts, model, usage)

            edited = _fit_to(Image.open(io.BytesIO(raw)).convert("RGB"), (src.rgb.shape[1], src.rgb.shape[0]))
            last = await asyncio.to_thread(validate_edit, src, np.asarray(edited), style_metadata, customer_analysis)
            if last.problem:
                rejected = True
                log_progress("VALIDATION-REJECT", f"Style #{style_id} attempt {attempts} rejected: {last.problem}", "WARNING")
                continue

            # Solid white background. Validation above ran on the model output; the face must survive the cut-out,
            # and if the cut-out fails a background the model already made white is accepted, otherwise retry.
            final, bg_problem = await asyncio.to_thread(whiten_background, edited, vm_face_of(edited))
            if bg_problem:
                if _near_white_background(np.asarray(edited)):
                    final = edited
                else:
                    last = Validation(f"background not replaced: {bg_problem}", last.identity_score, last.hair_consistency_score)
                    rejected = True
                    log_progress("VALIDATION-REJECT", f"Style #{style_id} attempt {attempts}: {last.problem}", "WARNING")
                    continue
            result_jpeg = _to_jpeg(add_preview_label(final))
            with open(cache_img, "wb") as f:
                f.write(result_jpeg)
            with open(cache_meta, "w", encoding="utf-8") as f:
                json.dump({"identity_score": last.identity_score, "hair_consistency_score": last.hair_consistency_score}, f)
            
            saved_url = self._save(result_jpeg, style_id)
            log_progress("STEP 4/4", f"SUCCESS! Style #{style_id} ('{style_name}') generated & validated | Identity Score: {last.identity_score:.2f} | Execution Time: {round(time.monotonic() - started, 2)}s | Saved: {saved_url}", "SUCCESS")

            return EditResult(saved_url, model, prompt, last.identity_score,
                              last.hair_consistency_score, attempts, round(time.monotonic() - started, 2))

        log_progress("GENERATION-FAILED", f"Style #{style_id} ('{style_name}') provider attempts exhausted: {last.problem}", "WARNING")
        raise ImageEditError(last.problem or "generation failed", attempts=attempts,
                             identity_score=last.identity_score,
                             hair_consistency_score=last.hair_consistency_score, model=model)

    async def generate_view(
        self,
        photo_url: str,
        style_metadata: Dict[str, Any],
        customer_analysis: Dict[str, Any],
        view: str,
        tier: str = "fast",
        provider: Optional[str] = None,
    ) -> EditResult:
        """
        Applies the style to the customer's SIDE or BACK photo. Uses all available photos
        (Front, Side, Back) as multi-view references for 100% hair length and style consistency.
        """
        started = time.monotonic()
        style_id = style_metadata.get("id")
        img = prepare_ai_input(await self._load_bytes(photo_url))
        img = img.resize((img.width // 16 * 16, img.height // 16 * 16), Image.Resampling.LANCZOS)
        rgb = np.asarray(img)
        jpeg = _to_jpeg(img)

        extra_jpegs = []
        for key in ("front_image_url", "side_image_url", "back_image_url"):
            url = customer_analysis.get(key)
            if url and url != photo_url:
                try:
                    b = await self._load_bytes(url)
                    extra_jpegs.append(_to_jpeg(prepare_ai_input(b)))
                except Exception as e:
                    log_progress("VIEW-EXTRA-PHOTO-LOAD-WARNING", f"Could not load {key} for {view} view: {e}", "WARNING")

        reference_jpeg = None
        if customer_analysis.get("front_preview_url"):
            try:
                ref_bytes = await self._load_bytes(customer_analysis["front_preview_url"])
                reference_jpeg = _to_jpeg(prepare_ai_input(ref_bytes))
                log_progress("FRONT-PREVIEW-LOADED", f"Loaded AI front preview for {view} view consistency", "INFO")
            except Exception as e:
                log_progress("FRONT-PREVIEW-LOAD-WARNING", f"Could not load AI front preview for {view} view: {e}", "WARNING")

        editor = self._get_editor(provider)
        model = editor.model_for(tier)
        vm = get_vision_models()
        # The view comes from the customer's own photo, so the photo must already be taken from that angle;
        # the model is never asked to invent the back of a head it has not seen.
        wrong_angle = await asyncio.to_thread(_view_angle_problem, rgb, view)
        if wrong_angle:
            raise ImageEditError(f"The {view} photo {wrong_angle}. Please retake it "
                                 f"{'from behind' if view == 'back' else 'in profile (side on)'}.")
        src_hair = await asyncio.to_thread(vm.hair_mask, rgb, None)
        src_lab = hair_lab(rgb, src_hair)
        colour_change_allowed = style_metadata.get("service") == "Colour"
        last_problem = "generation was not attempted"
        prompt = ""
        attempts = 0
        for attempt in range(settings.GENERATION_MAX_ATTEMPTS):
            attempts = attempt + 1
            prompt = prompt_engine.build_view_prompt(
                customer_analysis, style_metadata, view, strict=attempt > 0,
                num_extra_images=self._extras_sent(editor, extra_jpegs),
                with_reference_image=reference_jpeg is not None,
                max_chars=editor.max_prompt_chars
            )
            usage: Dict[str, Any] = {}
            fallback = settings.IMAGE_EDIT_FALLBACK_PROVIDER.strip().lower()
            try:
                async with self._sem:
                    raw = await asyncio.wait_for(
                        self._edit(editor, tier, prompt, jpeg, reference_jpeg, usage, None, extra_jpegs=extra_jpegs),
                        timeout=settings.GENERATION_TIMEOUT_SECONDS
                    )
            except asyncio.TimeoutError:
                last_problem = "the image service took too long to respond"
                continue
            except ImageEditError as e:
                fallback_handled = False
                if fallback and editor.name != fallback:
                    log_progress("VIEW-FALLBACK-ATTEMPT", f"Trying fallback provider '{fallback}' for {view} view of Style #{style_id}", "WARNING")
                    try:
                        editor = self._get_editor(fallback)
                        model = editor.model_for(tier)
                        reference_jpeg = reference_jpeg if editor.supports_reference(tier) else None
                        prompt = prompt_engine.build_view_prompt(
                            customer_analysis, style_metadata, view, strict=attempt > 0,
                            num_extra_images=self._extras_sent(editor, extra_jpegs),
                            with_reference_image=reference_jpeg is not None,
                            max_chars=editor.max_prompt_chars
                        )
                        async with self._sem:
                            raw = await asyncio.wait_for(
                                self._edit(editor, tier, prompt, jpeg, reference_jpeg, usage, None, extra_jpegs=extra_jpegs),
                                timeout=settings.GENERATION_TIMEOUT_SECONDS
                            )
                            fallback_handled = True
                    except Exception as fe:
                        log_progress("VIEW-FALLBACK-FAILED", f"Fallback provider '{fallback}' failed: {fe}", "WARNING")
                if not fallback_handled:
                    raise ImageEditError(e.reason, attempts=attempts, model=model)
            self._report_usage(photo_url, f"{style_id}-{view}", attempts, model, usage)
            edited = np.asarray(_fit_to(Image.open(io.BytesIO(raw)).convert("RGB"), img.size))
            changed = np.abs(rgb.astype(np.int16) - edited.astype(np.int16)).max(axis=2) > 20
            if changed.mean() < 0.003:
                last_problem = "model returned the photo unchanged"
                continue
            hair_score = None
            if src_lab is not None and not colour_change_allowed:
                edited_lab = hair_lab(edited, await asyncio.to_thread(vm.hair_mask, edited, None))
                if edited_lab is not None:
                    de = delta_e(src_lab, edited_lab)
                    hair_score = float(np.clip(1.0 - de / 40.0, 0.0, 1.0))
                    if de > settings.HAIR_COLOUR_MAX_DELTA_E:
                        last_problem = f"hair colour changed (deltaE {de:.1f})"
                        continue
            view_problem = await asyncio.to_thread(
                _view_result_problem, rgb, src_hair, edited, view, style_metadata, customer_analysis)
            if view_problem:
                last_problem = view_problem
                log_progress("VIEW-REJECT", f"Style #{style_id} {view} attempt {attempts}: {view_problem}", "WARNING")
                continue
            final_img, bg_problem = await asyncio.to_thread(whiten_background, Image.fromarray(edited))
            if bg_problem:
                if _near_white_background(edited):
                    final_img = Image.fromarray(edited)
                else:
                    last_problem = f"background not replaced: {bg_problem}"
                    continue
            url = self._save(_to_jpeg(add_preview_label(final_img)), f"{style_id}_{view}")
            log_progress("VIEW-SUCCESS", f"Style #{style_id} {view} view generated -> {url}", "SUCCESS")
            return EditResult(url, model, prompt, None, hair_score, attempts, round(time.monotonic() - started, 2))
        raise ImageEditError(last_problem, attempts=attempts, model=model)


hair_style_generator = HairStyleGenerator()
