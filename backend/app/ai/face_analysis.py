import io
import logging

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.ai.vision_models import (
    LM_CHEEK_SKIN, LM_CHIN, LM_FOREHEAD_CENTER, LM_LOWER_FACE, UNKNOWN, face_shape, get_vision_models, hair_colour_name,
    hair_lab, hair_length, hair_texture, scalp_hair,
)

logger = logging.getLogger(__name__)

# Order of the measured length classes (side/back photos may only lengthen an ambiguous front reading)
LENGTH_ORDER = {"Bald": 0, "Buzz": 1, "Short": 2, "Medium": 3, "Long": 4, "Very Long": 5}

ANALYSIS_MAX_SIDE = 1024
UPLOAD_MAX_SIDE = 2048
# Face width (at the 1024 px analysis size) below which face checks and previews are unreliable: SFace
# identity checks work on 112 px aligned faces, and smaller faces are upscaled a lot for the preview crop.
MIN_FACE_WIDTH_PX = 120


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
                    "message": "Front photo: Please make sure your face is clearly visible.",
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
        length, length_conf = hair_length(mask, face) if hair_visible else ("Bald", 0.95)
        if length == "Bald":
            # Little hair segmented: a bare scalp, or a buzz cut the segmenter missed. A buzz cut must not
            # lock out haircuts, so the scalp is checked separately; the stylist confirms either way.
            length, length_conf = scalp_hair(rgb, mask, face)
            if length == UNKNOWN:
                length, length_conf = "Bald", 0.5

        if length == "Bald":
            length_conf = min(length_conf, 0.6)
            texture, texture_conf = "None", 1.0
            colour = "None"
            hairline = "Bald / High hairline"
        elif length == "Buzz":
            # Too little hair to measure texture; colour only when the segmenter found some hair
            texture, texture_conf = UNKNOWN, 0.0
            colour = hair_colour_name(hair_lab(rgb, mask)) if hair_px >= 150 else UNKNOWN
            hairline = _hairline(mask, face)
        else:
            colour = hair_colour_name(hair_lab(rgb, mask))
            texture, texture_conf = hair_texture(rgb, mask, face.width)
            hairline = _hairline(mask, face)

        # Zone-based landmark coverage for beard detection across 6 zones
        BEARD_ZONE_LANDMARKS = {
            "moustache": [0, 37, 39, 40, 185, 267, 269, 270],
            "chin": [152, 175, 199, 200],
            "cheek_l": [50, 117, 118, 123, 187],
            "cheek_r": [280, 346, 347, 352, 411],
            "jawline": [172, 397, 136, 365],
            "neck": [148, 152, 377],
        }

        lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
        r = max(3, int(face.width * 0.05))
        ref_skin = np.nanmedian([_patch_lightness(lab, face.pt(i), r) for i in LM_CHEEK_SKIN])

        beard_zones = {}
        total_diff_sum = 0.0
        for zone_name, lm_list in BEARD_ZONE_LANDMARKS.items():
            z_vals = [_patch_lightness(lab, face.pt(i), r) for i in lm_list]
            z_lightness = np.nanmedian(z_vals) if z_vals else ref_skin
            z_diff = float(ref_skin - z_lightness) if np.isfinite(ref_skin) and np.isfinite(z_lightness) else 0.0
            z_diff = max(0.0, z_diff)
            coverage = min(1.0, z_diff / 45.0)
            if coverage < 0.1:
                z_density = "none"
            elif coverage < 0.4:
                z_density = "sparse"
            elif coverage < 0.75:
                z_density = "medium"
            else:
                z_density = "dense"

            beard_zones[zone_name] = {
                "coverage": round(coverage, 2),
                "density": z_density,
                "diff": round(z_diff, 1)
            }
            total_diff_sum += z_diff

        avg_diff = total_diff_sum / len(BEARD_ZONE_LANDMARKS)
        avg_coverage = sum(z["coverage"] for z in beard_zones.values()) / len(beard_zones)

        if avg_coverage < 0.05:
            length_class = "Clean-shaven"
            pattern = "None"
        elif avg_diff <= 25.0:
            length_class = "Stubble (1-3mm)"
        elif avg_diff <= 45.0:
            length_class = "Short (3-10mm)"
        elif avg_diff <= 65.0:
            length_class = "Medium (10-25mm)"
        else:
            length_class = "Full (>25mm)"

        if avg_coverage >= 0.05:
            m_cov = beard_zones["moustache"]["coverage"]
            c_cov = beard_zones["chin"]["coverage"]
            l_cov = beard_zones["cheek_l"]["coverage"]
            r_cov = beard_zones["cheek_r"]["coverage"]
            if m_cov > 0.3 and c_cov > 0.3 and l_cov < 0.25 and r_cov < 0.25:
                pattern = "Goatee"
            elif m_cov > 0.3 and c_cov < 0.25 and l_cov < 0.25 and r_cov < 0.25:
                pattern = "Moustache Only"
            elif l_cov > 0.3 and r_cov > 0.3 and c_cov > 0.3:
                pattern = "Full Beard"
            else:
                pattern = "Partial / Custom"

        beard = pattern if pattern != "None" else "Clean Shaven"
        needs_confirmation = (length_class == "Stubble (1-3mm)") or (shape_conf < 0.8)

        face_width_ratio = float(face.width) / float(W) if W else 0.0
        face_height_ratio = float(fy1 - fy0) / float(H) if H else 0.0
        top_boundary_cut = (fy0 < int(H * 0.02)) and (face_height_ratio > 0.55)

        message = None
        if face_width_ratio > 0.62 or face_height_ratio > 0.70 or top_boundary_cut:
            message = "Front photo is too close, cutting off your hair. Please take a picture a little further away with your hair and shoulders visible."
        elif face.width < MIN_FACE_WIDTH_PX:
            message = "Front photo is too far. Please step a little closer so your face and hair are clearly visible."
        elif not is_sharp:
            message = "Front photo is blurry. Please upload a clearer front-facing photo."

        return {
            "face_shape": shape,
            "face_shape_confidence": round(shape_conf, 2),
            "face_measurements": measurements,
            "aspect_ratio": measurements.get("length_to_width"),
            "facial_bounding_box": {"x": fx0, "y": fy0, "w": fx1 - fx0, "h": fy1 - fy0},
            "beard_style": beard,
            "beard_length_class": length_class,
            "beard_pattern": pattern,
            "beard_zones": beard_zones,
            "needs_confirmation": needs_confirmation,
            "hair_color_detected": colour,
            "hair_type": texture,
            "hair_type_confidence": round(texture_conf, 2),
            "hair_length": length,
            "hair_length_confidence": round(length_conf, 2),
            # Bald vs buzz cannot be certain from one photo (light hair on light skin): ask for confirmation
            "hair_length_needs_confirmation": length in ("Bald", "Buzz"),
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

    def analyze_non_front_photo(self, image_bytes: bytes) -> dict:
        """
        Back or Side photo: extracts hair texture, colour, length, and density.
        """
        vm = get_vision_models()
        rgb = _load_rgb(image_bytes)
        H, W = rgb.shape[:2]
        mask = vm.hair_mask(rgb, None)
        hair_px = int(mask.sum())

        if hair_px < 1000:
            return {
                "hair_density": UNKNOWN,
                "hair_type": UNKNOWN,
                "hair_type_confidence": 0.0,
                "hair_length": UNKNOWN,
                "hair_color_detected": UNKNOWN,
                "hair_pixels": hair_px,
            }

        width_estimate = W * 0.25
        texture, texture_conf = hair_texture(rgb, mask, width_estimate)
        colour = hair_colour_name(hair_lab(rgb, mask))

        y_indices, _ = np.nonzero(mask)
        length = UNKNOWN
        density = UNKNOWN
        if len(y_indices) > 0:
            y_min, y_max = y_indices.min(), y_indices.max()
            h_span = float(y_max - y_min) / float(H)
            bottom_ratio = float(y_max) / float(H)
            area_ratio = float(hair_px) / float(H * W)

            if h_span > 0.55 or bottom_ratio > 0.75:
                length = "Very Long"
            elif h_span > 0.35 or bottom_ratio > 0.55:
                length = "Long"
            elif h_span > 0.20 or bottom_ratio > 0.40:
                length = "Medium"
            else:
                length = "Short"

            if area_ratio > 0.12 or hair_px > 25000:
                density = "Thick"
            elif area_ratio > 0.05 or hair_px > 12000:
                density = "Medium"
            else:
                density = "Fine"

        return {
            "hair_density": density,
            "hair_type": texture,
            "hair_type_confidence": round(texture_conf, 2),
            "hair_length": length,
            "hair_color_detected": colour,
            "hair_pixels": hair_px,
        }

    def analyze_photo(self, image_bytes: bytes) -> dict:
        return self.analyze_multi_photos(image_bytes, None, None)

    def analyze_dual_photos(self, front_bytes: bytes, back_bytes: bytes = None) -> dict:
        return self.analyze_multi_photos(front_bytes, back_bytes, None)

    def analyze_multi_photos(self, front_bytes: bytes, back_bytes: bytes = None, side_bytes: bytes = None, gender: str = "Women") -> dict:
        """
        Front photo + optional back & side photos:
        Face shape, beard, hair colour/texture/length/density.
        For female customers, beard checks are cleared to Clean Shaven.
        """
        is_women = (gender or "Women").strip().capitalize() in ["Women", "Female"]
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

        detected_len = front.get("hair_length", UNKNOWN)
        detected_density = front.get("hair_density", UNKNOWN)
        hair_type = front.get("hair_type", UNKNOWN)
        hair_colour = front.get("hair_color_detected", UNKNOWN)

        # Women: almost no visible hair usually means the head is covered (dupatta, saree pallu, scarf) or the
        # hair is pulled tightly back, not a bald scalp. Report it as not measurable so hair services stay
        # available and the stylist confirms; a side/back photo may still fill in the length below.
        head_covered = is_women and detected_len in ("Bald", "Buzz")
        if head_covered:
            detected_len = UNKNOWN
            hair_type = UNKNOWN if hair_type in ("None", UNKNOWN) else hair_type
            hair_colour = UNKNOWN if hair_colour in ("None", UNKNOWN) else hair_colour

        # Process back & side photos to fill hair length, density, texture & colour.
        # Length from a side/back photo has no face for scale (a close-up of short hair fills the frame and would
        # read as "Very Long"), so it only fills in when the front is ambiguous: no reading, or "Short" hair on a
        # woman, which is often long hair tied back. A clear front reading (and Bald / Buzz) is never overridden.
        front_len = detected_len
        extra_photos = [b for b in (back_bytes, side_bytes) if b]
        hair_tied_back = False
        back_suggests_longer = False
        for extra_b in extra_photos:
            try:
                extra = self.analyze_non_front_photo(extra_b)
                extra_len = extra.get("hair_length", UNKNOWN)
                # Only an unclear front reading is replaced: none at all, or "Short" on a woman (often long hair
                # tied back). A clear "Medium" front reading is kept, because a close-up back photo of loose
                # shoulder-length hair can read "Very Long"; a longer back reading then only asks for confirmation.
                ambiguous = front_len == UNKNOWN or (is_women and front_len == "Short")
                longer = LENGTH_ORDER.get(extra_len, -1) > LENGTH_ORDER.get(detected_len, -1)
                if ambiguous and extra_len in ("Medium", "Long", "Very Long") and longer:
                    detected_len = extra_len
                    if is_women and front_len == "Short":
                        hair_tied_back = True
                elif extra_len in ("Long", "Very Long") and longer:
                    back_suggests_longer = True
                if detected_density == UNKNOWN and extra.get("hair_density") and extra.get("hair_density") != UNKNOWN:
                    detected_density = extra["hair_density"]
                if hair_type == UNKNOWN and extra.get("hair_type") and extra.get("hair_type") != UNKNOWN:
                    hair_type = extra["hair_type"]
                if hair_colour in (UNKNOWN, "Brown") and extra.get("hair_color_detected") == "Black":
                    hair_colour = "Black"
                elif hair_colour == UNKNOWN and extra.get("hair_color_detected") and extra.get("hair_color_detected") != UNKNOWN:
                    hair_colour = extra["hair_color_detected"]
            except Exception as e:
                logger.warning(f"Extra photo analysis failed: {e}")


        beard_style = front.get("beard_style", UNKNOWN)
        beard_length = front.get("beard_length_class", "Clean-shaven")
        beard_pat = front.get("beard_pattern", "None")
        beard_z = front.get("beard_zones", {})
        needs_conf = front.get("needs_confirmation", False)

        if is_women:
            beard_style = "Clean Shaven"
            beard_length = "Clean-shaven"
            beard_pat = "None"
            beard_z = {}
            needs_conf = False

        if detected_len == "Bald":
            hair_type = "None"
            hair_colour = "None"

        return {
            "gender": "Women" if is_women else "Men",
            "face_shape": front.get("face_shape", UNKNOWN),
            "face_shape_confidence": front.get("face_shape_confidence", 0.0),
            "face_measurements": front.get("face_measurements", {}),
            "aspect_ratio": front.get("aspect_ratio"),
            "beard_style_current": beard_style,
            "beard_length_class": beard_length,
            "beard_pattern": beard_pat,
            "beard_zones": beard_z,
            "needs_confirmation": needs_conf,
            "hair_density": "Sparse / Bald" if detected_len == "Bald" else detected_density,
            "hair_type": hair_type,
            "hair_length": detected_len,
            "hair_length_needs_confirmation": (bool(front.get("hair_length_needs_confirmation")) or detected_len != front_len
                                               or head_covered or back_suggests_longer),
            # Read by the edit prompts: show tied-back hair let down (only when it really is tied back)
            "hair_tied_back": hair_tied_back,
            "head_covered": head_covered,
            "hair_color_detected": hair_colour,
            "hairline": "Bald / High hairline" if detected_len == "Bald" else front.get("hairline", UNKNOWN),
            "current_hairstyle": ("Bald / Clean Scalp" if detected_len == "Bald" else
                                  "Hair covered or not visible - please confirm the length" if head_covered and detected_len == UNKNOWN else
                                  _current_hairstyle(detected_len, hair_type, hair_colour, front.get("hairline", UNKNOWN))),
            "quality_check": front.get("quality_metrics", {}),
        }


face_analyzer = FaceAnalyzer()
