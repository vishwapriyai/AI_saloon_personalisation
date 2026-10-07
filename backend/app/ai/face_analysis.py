import io
import logging

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.ai.vision_models import (
    LM_CHEEK_SKIN, LM_CHIN, LM_FOREHEAD_CENTER, LM_LOWER_FACE, UNKNOWN, face_shape, get_vision_models, hair_colour_name,
    hair_lab, hair_length, hair_texture,
)

logger = logging.getLogger(__name__)

ANALYSIS_MAX_SIDE = 1024
UPLOAD_MAX_SIDE = 2048
MIN_FACE_WIDTH_PX = 80   # below this, face checks and previews are unreliable


def normalize_photo(image_bytes: bytes) -> bytes:
    """Decode any supported upload (JPEG, PNG, WebP, HEIC, AVIF), fix phone rotation, and re-encode as
    JPEG so stored photos display in every browser. Raises UnidentifiedImageError for unreadable files."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    img.thumbnail((UPLOAD_MAX_SIDE, UPLOAD_MAX_SIDE), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def _load_rgb(image_bytes: bytes) -> np.ndarray:
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    img.thumbnail((ANALYSIS_MAX_SIDE, ANALYSIS_MAX_SIDE), Image.Resampling.LANCZOS)
    return np.asarray(img)


def _hairline(mask: np.ndarray, face) -> str:
    """Hairline from where the hair starts above the middle of the forehead, relative to brow-to-chin length.
    An estimate for the consultation: Low / Normal / High / Receding, or Covered by fringe."""
    brow = face.pt(LM_FOREHEAD_CENTER[0])
    chin = face.pt(LM_CHIN)
    lower = float(chin[1] - brow[1])
    if lower <= 0:
        return UNKNOWN
    cx, half = int(brow[0]), max(2, int(face.width * 0.08))
    band = mask[:max(0, int(brow[1])), max(0, cx - half):cx + half]
    if band.size == 0:
        return UNKNOWN
    rows = [np.nonzero(band[:, i])[0] for i in range(band.shape[1])]
    starts = [r.max() for r in rows if r.size]
    if len(starts) < band.shape[1] * 0.5:
        return "High / Receding"  # little or no hair above the middle of the forehead
    ratio = (float(brow[1]) - float(np.median(starts))) / lower
    if ratio < 0.2:
        return "Covered by fringe"
    if ratio < 0.38:
        return "Low"
    if ratio < 0.66:
        return "Normal"
    if ratio < 0.8:
        return "High"
    return "High / Receding"


def _current_hairstyle(length: str, texture: str, colour: str, hairline: str) -> str:
    parts = [p for p in (length, texture) if p and p != UNKNOWN]
    text = (" ".join(parts) + " hair") if parts else "Hair length and texture not measurable from this photo"
    if colour and colour != UNKNOWN:
        text += f", {colour.lower()}"
    if hairline == "Covered by fringe":
        text += ", with a fringe"
    return text


def _patch_lightness(lab: np.ndarray, pt: np.ndarray, radius: int) -> float:
    x, y = int(pt[0]), int(pt[1])
    patch = lab[max(0, y - radius):y + radius, max(0, x - radius):x + radius, 0]
    return float(np.median(patch)) if patch.size else float("nan")


class FaceAnalyzer:
    """
    Face & hair analysis on the customer's photo.

    Face: MediaPipe Face Landmarker geometry -> face shape (Oval/Round/Square/Oblong/Heart/Diamond).
    Hair: MediaPipe hair segmentation -> hair colour, texture and length.
    Any measurement that is not reliable is returned as "Unknown" rather than guessed.
    """

    def analyze_front_photo(self, image_bytes: bytes) -> dict:
        vm = get_vision_models()
        rgb = _load_rgb(image_bytes)
        H, W = rgb.shape[:2]
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        face = vm.detect_face(rgb)

        if face is None:
            return {
                "face_shape": UNKNOWN,
                "face_shape_confidence": 0.0,
                "beard_style": UNKNOWN,
                "hair_color_detected": UNKNOWN,
                "hair_type": UNKNOWN,
                "hair_length": UNKNOWN,
                "quality_metrics": {
                    "face_detected": False, "hair_visible": False, "is_sharp": False, "is_well_lit": False,
                    "message": "Please make sure your face is clearly visible.",
                },
            }

        xs, ys = face.points[:, 0], face.points[:, 1]
        fx0, fy0, fx1, fy1 = int(max(0, xs.min())), int(max(0, ys.min())), int(min(W, xs.max())), int(min(H, ys.max()))
        face_gray = gray[fy0:fy1, fx0:fx1]
        sharpness = float(cv2.Laplacian(face_gray, cv2.CV_64F).var()) if face_gray.size else 0.0
        brightness = float(np.mean(face_gray)) if face_gray.size else 0.0
        is_sharp = sharpness > 30.0
        is_well_lit = 50.0 <= brightness <= 220.0

        shape, shape_conf, measurements = face_shape(face)

        mask = vm.hair_mask(rgb, face)
        hair_px = int(mask.sum())
        hair_visible = hair_px >= 0.05 * face.width ** 2
        colour = hair_colour_name(hair_lab(rgb, mask)) if hair_visible else "None"
        texture, texture_conf = hair_texture(rgb, mask, face.width) if hair_visible else ("None", 0.0)
        length, length_conf = hair_length(mask, face) if hair_visible else ("Bald", 0.95)
        hairline = _hairline(mask, face) if hair_visible else "Bald / High hairline"

        # Beard: lower face noticeably darker than cheek skin
        lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
        r = max(3, int(face.width * 0.05))
        cheek = np.nanmedian([_patch_lightness(lab, face.pt(i), r) for i in LM_CHEEK_SKIN])
        lower = np.nanmedian([_patch_lightness(lab, face.pt(i), r) for i in LM_LOWER_FACE])
        diff = float(cheek - lower) if np.isfinite(cheek) and np.isfinite(lower) else 0.0
        beard = "Full Beard" if diff > 35 else ("Stubble / Short Beard" if diff > 15 else "Clean Shaven")

        message = None
        if face.width < MIN_FACE_WIDTH_PX:
            message = "Your face is too small in this photo. Please take a closer, higher-resolution photo."
        elif not is_sharp:
            message = "Please upload a clearer front-facing photo."

        return {
            "face_shape": shape,
            "face_shape_confidence": round(shape_conf, 2),
            "face_measurements": measurements,
            "aspect_ratio": measurements.get("length_to_width"),
            "facial_bounding_box": {"x": fx0, "y": fy0, "w": fx1 - fx0, "h": fy1 - fy0},
            "beard_style": beard,
            "hair_color_detected": colour,
            "hair_type": texture,
            "hair_type_confidence": round(texture_conf, 2),
            "hair_length": length,
            "hair_length_confidence": round(length_conf, 2),
            "hairline": hairline,
            "current_hairstyle": _current_hairstyle(length, texture, colour, hairline),
            "hair_pixels": hair_px,
            "quality_metrics": {
                "face_detected": True,
                "hair_visible": hair_visible,
                "is_sharp": is_sharp,
                "is_well_lit": is_well_lit,
                "sharpness_score": round(sharpness, 1),
                "brightness": round(brightness, 1),
                "face_width_px": round(face.width, 1),
                "message": message,
            },
        }

    def analyze_back_photo(self, image_bytes: bytes) -> dict:
        """
        Back-of-head photo: hair texture and colour from the segmented hair. Length and density need a
        visible face for scale, so they stay Unknown here.
        """
        vm = get_vision_models()
        rgb = _load_rgb(image_bytes)
        mask = vm.hair_mask(rgb, None)
        width_estimate = rgb.shape[1] * 0.25  # head is roughly a quarter of a back-view photo's width
        texture, texture_conf = hair_texture(rgb, mask, width_estimate)
        return {
            "hair_density": UNKNOWN,
            "hair_type": texture,
            "hair_type_confidence": round(texture_conf, 2),
            "hair_length": UNKNOWN,
            "hair_color_detected": hair_colour_name(hair_lab(rgb, mask)),
            "hair_pixels": int(mask.sum()),
        }

    def analyze_photo(self, image_bytes: bytes) -> dict:
        return self.analyze_dual_photos(image_bytes, None)

    def analyze_dual_photos(self, front_bytes: bytes, back_bytes: bytes = None) -> dict:
        """
        Front photo: face shape, beard, hair colour/texture/length. An optional back photo fills in hair
        texture when the front view could not measure it. Density cannot be measured reliably from
        photos, so it is Unknown and should be confirmed during consultation.
        """
        try:
            front = self.analyze_front_photo(front_bytes)
        except UnidentifiedImageError:
            logger.warning("Unreadable photo upload (%d bytes, starts with %r)", len(front_bytes), front_bytes[:12])
            front = {"face_shape": UNKNOWN, "beard_style": UNKNOWN, "hair_color_detected": UNKNOWN,
                     "hair_type": UNKNOWN, "hair_length": UNKNOWN,
                     "quality_metrics": {"face_detected": False, "message": (
                         "This photo could not be opened. Please upload a JPG, PNG or HEIC photo." if front_bytes
                         else "The photo was empty. Please take or choose the photo again.")}}
        except Exception as e:
            logger.error(f"Front photo analysis failed: {e}", exc_info=True)
            front = {"face_shape": UNKNOWN, "beard_style": UNKNOWN, "hair_color_detected": UNKNOWN,
                     "hair_type": UNKNOWN, "hair_length": UNKNOWN,
                     "quality_metrics": {"face_detected": False, "message": "Photo could not be analysed. Please try another photo."}}

        hair_type = front.get("hair_type", UNKNOWN)
        hair_colour = front.get("hair_color_detected", UNKNOWN)
        if back_bytes:
            try:
                back = self.analyze_back_photo(back_bytes)
                if hair_type == UNKNOWN:
                    hair_type = back["hair_type"]
                if hair_colour == UNKNOWN:
                    hair_colour = back["hair_color_detected"]
            except Exception as e:
                logger.warning(f"Back photo analysis failed: {e}")

        detected_len = front.get("hair_length", UNKNOWN)
        return {
            "face_shape": front.get("face_shape", UNKNOWN),
            "face_shape_confidence": front.get("face_shape_confidence", 0.0),
            "face_measurements": front.get("face_measurements", {}),
            "aspect_ratio": front.get("aspect_ratio"),
            "beard_style_current": front.get("beard_style", UNKNOWN),
            "hair_density": "Sparse / Bald" if detected_len == "Bald" else UNKNOWN,
            "hair_type": hair_type,
            "hair_length": detected_len,
            "hair_color_detected": hair_colour,
            "hairline": front.get("hairline", UNKNOWN),
            "current_hairstyle": "Bald / Clean Scalp" if detected_len == "Bald" else _current_hairstyle(detected_len, hair_type, hair_colour, front.get("hairline", UNKNOWN)),
            "quality_check": front.get("quality_metrics", {}),
        }


face_analyzer = FaceAnalyzer()
