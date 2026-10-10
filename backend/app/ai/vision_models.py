"""
Shared computer-vision models used by photo analysis and by generated-image validation.

  - MediaPipe Face Landmarker (478 landmarks)   -> face geometry, face shape, portrait crop
  - MediaPipe hair segmenter                   -> hair mask, hair colour / texture / length
  - OpenCV SFace face recognition (128-d)      -> identity similarity between photos

All three are Apache-2.0 licensed. Model files live in settings.AI_MODELS_DIR.
Every estimate returns "Unknown" when the measurement is not reliable instead of guessing.
"""
import logging
import os
import sys
import threading
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

from app.core.config import settings

# MediaPipe imports TensorFlow only for API-doc generation and treats it as optional. A TensorFlow
# build that is incompatible with the installed numpy crashes that import, so mark it unavailable.
sys.modules.setdefault("tensorflow", None)
import mediapipe as mp  # noqa: E402
from mediapipe.tasks.python import BaseOptions, vision  # noqa: E402

logger = logging.getLogger(__name__)

# Phones often save photos as HEIC (iPhone) or AVIF, which Pillow cannot open on its own
try:
    import pillow_heif

    pillow_heif.register_heif_opener()
    pillow_heif.register_avif_opener()
except ImportError:
    logger.warning("pillow-heif not installed: HEIC/AVIF photos cannot be read")

UNKNOWN = "Unknown"

# MediaPipe face-mesh landmark indices
LM_FOREHEAD_TOP = 10
LM_CHIN = 152
LM_CHEEK_L, LM_CHEEK_R = 234, 454          # widest cheekbone points (image left / right)
LM_FOREHEAD_L, LM_FOREHEAD_R = 54, 284
LM_JAW_L, LM_JAW_R = 172, 397
LM_NOSE_TIP = 1
LM_EYE_L = (33, 133)                       # eye on the image-left side
LM_EYE_R = (362, 263)
LM_MOUTH_L, LM_MOUTH_R = 61, 291
LM_CHEEK_SKIN = (50, 280)
LM_FOREHEAD_CENTER = (9, 151)              # between the eyebrows, and mid-forehead
LM_LOWER_FACE = (199, 175, 136, 365)


@dataclass
class FaceGeometry:
    points: np.ndarray  # (478, 2) pixel coordinates in the analysed image

    def pt(self, idx: int) -> np.ndarray:
        return self.points[idx]

    def dist(self, a: int, b: int) -> float:
        return float(np.linalg.norm(self.points[a] - self.points[b]))

    @property
    def width(self) -> float:
        return self.dist(LM_CHEEK_L, LM_CHEEK_R)

    @property
    def height(self) -> float:
        return self.dist(LM_FOREHEAD_TOP, LM_CHIN)

    @property
    def center_x(self) -> float:
        return float((self.points[LM_CHEEK_L][0] + self.points[LM_CHEEK_R][0]) / 2)

    @property
    def top_y(self) -> float:
        return float(self.points[LM_FOREHEAD_TOP][1])

    @property
    def chin_y(self) -> float:
        return float(self.points[LM_CHIN][1])


class VisionModels:
    def __init__(self):
        d = settings.AI_MODELS_DIR
        self._lock = threading.Lock()
        self._landmarker = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=os.path.join(d, "face_landmarker.task")),
            num_faces=1, min_face_detection_confidence=0.5,
        ))
        self._hair_segmenter = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
            base_options=BaseOptions(model_asset_path=os.path.join(d, "hair_segmenter.tflite")),
            output_category_mask=True,
        ))
        self._recognizer = cv2.FaceRecognizerSF.create(os.path.join(d, "face_recognition_sface_2021dec.onnx"), "")
        self._haar = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        # Person vs background (classes: 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 accessories).
        # Optional so older installs without the file keep working (the white background then needs the model).
        person_model = os.path.join(d, "selfie_multiclass_256x256.tflite")
        self._person_segmenter = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
            base_options=BaseOptions(model_asset_path=person_model), output_category_mask=True,
        )) if os.path.isfile(person_model) else None

    # ------------------------------------------------------------------ face
    def _landmarks_on(self, rgb: np.ndarray) -> Optional[np.ndarray]:
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        with self._lock:
            res = self._landmarker.detect(img)
        if not res.face_landmarks:
            return None
        h, w = rgb.shape[:2]
        return np.array([[p.x * w, p.y * h] for p in res.face_landmarks[0]], dtype=np.float32)

    def detect_face(self, rgb: np.ndarray) -> Optional[FaceGeometry]:
        """Landmarks on the full image; for small faces (full-body photos) retry on a face crop."""
        pts = self._landmarks_on(rgb)
        if pts is not None:
            return FaceGeometry(pts)

        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        faces = self._haar.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40))
        if len(faces) == 0:
            return None
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        m = int(w * 0.9)
        x0, y0 = max(0, x - m), max(0, y - m)
        x1, y1 = min(rgb.shape[1], x + w + m), min(rgb.shape[0], y + h + m)
        crop = rgb[y0:y1, x0:x1]
        scale = 512.0 / max(crop.shape[:2])
        crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        pts = self._landmarks_on(crop)
        if pts is None:
            return None
        return FaceGeometry(pts / scale + np.array([x0, y0], dtype=np.float32))

    def face_embedding(self, rgb: np.ndarray, face: FaceGeometry) -> np.ndarray:
        p = face.points
        xs, ys = p[:, 0], p[:, 1]
        row = np.array([[
            xs.min(), ys.min(), xs.max() - xs.min(), ys.max() - ys.min(),
            *p[list(LM_EYE_L)].mean(axis=0), *p[list(LM_EYE_R)].mean(axis=0),
            *p[LM_NOSE_TIP], *p[LM_MOUTH_L], *p[LM_MOUTH_R], 1.0,
        ]], dtype=np.float32)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        with self._lock:
            aligned = self._recognizer.alignCrop(bgr, row)
            return self._recognizer.feature(aligned).copy()

    def identity_similarity(self, emb_a: np.ndarray, emb_b: np.ndarray) -> float:
        with self._lock:
            return float(self._recognizer.match(emb_a, emb_b, cv2.FaceRecognizerSF_FR_COSINE))

    # ------------------------------------------------------------------ hair
    def head_region(self, face: FaceGeometry, size: tuple[int, int]) -> tuple[int, int, int, int]:
        """Region around the head that can contain hair (down to mid-chest for long hair)."""
        w, h = size
        fw, fh = face.width, face.height
        x0 = int(max(0, face.center_x - 1.7 * fw))
        x1 = int(min(w, face.center_x + 1.7 * fw))
        y0 = int(max(0, face.top_y - 1.2 * fh))
        y1 = int(min(h, face.chin_y + 3.0 * fh))
        return x0, y0, x1, y1

    def person_mask(self, rgb: np.ndarray) -> Optional[np.ndarray]:
        """
        Boolean mask of the person: hair, face and body skin, clothes and accessories (jewellery, clips), i.e.
        everything except the background. Works without a visible face (side / back photos). None when the
        segmentation model is not installed (run ai_models/download_models.py).
        """
        if self._person_segmenter is None:
            return None
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        with self._lock:
            cat = np.squeeze(self._person_segmenter.segment(img).category_mask.numpy_view())
        if cat.shape[:2] != rgb.shape[:2]:
            cat = cv2.resize(cat.astype(np.uint8), (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_NEAREST)
        return cat > 0

    def hair_mask(self, rgb: np.ndarray, face: Optional[FaceGeometry]) -> np.ndarray:
        """Boolean hair mask at full image size. Segments a padded square head crop for small faces."""
        H, W = rgb.shape[:2]
        x0, y0, x1, y1 = self.head_region(face, (W, H)) if face else (0, 0, W, H)
        crop = rgb[y0:y1, x0:x1]
        side = max(crop.shape[:2])
        square = np.zeros((side, side, 3), dtype=np.uint8)
        square[:crop.shape[0], :crop.shape[1]] = crop
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(square))
        with self._lock:
            cat = self._hair_segmenter.segment(img).category_mask.numpy_view()
        cat = np.squeeze(cat)
        if cat.shape[0] != side:
            cat = cv2.resize(cat.astype(np.uint8), (side, side), interpolation=cv2.INTER_NEAREST)
        mask = np.zeros((H, W), dtype=bool)
        mask[y0:y1, x0:x1] = cat[:crop.shape[0], :crop.shape[1]] > 0
        return mask


_models: Optional[VisionModels] = None
_models_lock = threading.Lock()


def get_vision_models() -> VisionModels:
    global _models
    with _models_lock:
        if _models is None:
            _models = VisionModels()
        return _models


# ---------------------------------------------------------------------- measurements
def hair_lab(rgb: np.ndarray, mask: np.ndarray) -> Optional[np.ndarray]:
    """Median CIE L*a*b* of hair pixels (mask eroded to avoid skin/background at the edges)."""
    m = cv2.erode(mask.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=2).astype(bool)
    if m.sum() < 150:
        m = mask
    if m.sum() < 150:
        return None
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)[m].astype(np.float32)
    L, a, b = np.median(lab, axis=0)
    return np.array([L * 100.0 / 255.0, a - 128.0, b - 128.0], dtype=np.float32)


def hair_colour_name(lab: Optional[np.ndarray]) -> str:
    if lab is None:
        return UNKNOWN
    L, a, b = (float(v) for v in lab)
    chroma = float(np.hypot(a, b))
    if L < 38:
        return "Dark Auburn" if a > 14 and chroma > 20 else "Black"
    if L < 48:
        return "Auburn" if a > 15 else "Dark Brown"
    if L < 62:
        return "Grey" if chroma < 8 else "Brown"
    if L < 75:
        return "Grey" if chroma < 8 else "Light Brown"
    return "Grey / White" if chroma < 8 else "Blonde"


def delta_e(lab_a: np.ndarray, lab_b: np.ndarray) -> float:
    return float(np.linalg.norm(lab_a - lab_b))


def hair_texture(rgb: np.ndarray, mask: np.ndarray, face_width: float) -> tuple[str, float]:
    """
    Straight / Wavy / Curly from strand-orientation coherence (structure tensor) inside the hair mask,
    measured at a fixed scale (face width normalised to 200 px).

    This single measure overlaps a lot between textures (e.g. dense wavy hair can look as coherent as
    tied-back straight hair), so only clear-cut values get a label and everything in between is
    Unknown. A wrong label is worse than none: the edit prompt would push the hair toward it.
    """
    if mask.sum() < 2500 or face_width < 80:
        return UNKNOWN, 0.0
    scale = 200.0 / face_width
    small = cv2.resize(rgb, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    small_mask = cv2.resize(mask.astype(np.uint8), (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
    inner = cv2.erode(small_mask, np.ones((5, 5), np.uint8), iterations=2).astype(bool)
    if inner.sum() < 3000:
        return UNKNOWN, 0.0
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    jxx = cv2.GaussianBlur(gx * gx, (0, 0), 4)
    jyy = cv2.GaussianBlur(gy * gy, (0, 0), 4)
    jxy = cv2.GaussianBlur(gx * gy, (0, 0), 4)
    coherence = np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / (jxx + jyy + 1e-6)
    c = float(np.mean(coherence[inner]))
    if c >= 0.75:
        return "Straight", 0.7
    if c < 0.35:
        return "Curly", 0.6
    if 0.42 <= c < 0.55:
        return "Wavy", 0.6
    return UNKNOWN, 0.0


def hair_length(mask: np.ndarray, face: FaceGeometry) -> tuple[str, float]:
    """Length from where the visible hair ends relative to the chin, in face heights."""
    fh = face.height
    visible = int(mask.sum())
    if visible < 0.05 * face.width ** 2:
        return "Bald", 0.95

    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    keep = np.zeros_like(mask)
    for i in range(1, n):
        top = stats[i, cv2.CC_STAT_TOP]
        if top < face.chin_y and stats[i, cv2.CC_STAT_AREA] > 0.02 * visible:
            keep |= labels == i
    if not keep.any():
        return "Bald", 0.95
    bottom = float(np.nonzero(keep)[0].max())
    r = (bottom - face.chin_y) / fh
    if r < 0.3:
        return "Short", 0.7
    if r < 1.3:
        return "Medium", 0.7
    if r < 2.6:
        return "Long", 0.7
    return "Very Long", 0.6


# Bald vs buzz cut: the hair segmenter often misses stubble-length scalp hair, so the scalp above the forehead
# is also compared with forehead skin. Tuned on the cases in tests; confirm on real photos (see golden-set notes).
# Band from 0.38 to 0.15 face heights above the mid-forehead landmark: on the scalp for most heads, but low
# enough not to reach the background above the crown (a dark background would look like hair)
SCALP_BAND = (0.38, 0.15)
SCALP_HALF_WIDTH = 0.30          # band half-width, in face widths
BUZZ_MIN_MASK_COVER = 0.25       # share of the band the hair mask covers -> short hair present
BUZZ_MIN_DARKER_L = 12.0         # scalp this much darker (L*) than forehead skin -> short dark hair present


def scalp_hair(rgb: np.ndarray, mask: np.ndarray, face: FaceGeometry) -> tuple[str, float]:
    """
    For photos where little hair is segmented: "Buzz" (very short hair covers the scalp) or "Bald".
    Light hair on light skin cannot be told from a bare scalp, so "Bald" has moderate confidence and should be
    confirmed by the stylist.
    """
    fh, fw = face.height, face.width
    h, w = mask.shape[:2]
    y0 = int(max(0, face.top_y - SCALP_BAND[0] * fh))
    y1 = int(max(0, face.top_y - SCALP_BAND[1] * fh))
    x0 = int(max(0, face.center_x - SCALP_HALF_WIDTH * fw))
    x1 = int(min(w, face.center_x + SCALP_HALF_WIDTH * fw))
    if y1 - y0 < 4 or x1 - x0 < 4:
        return UNKNOWN, 0.0  # the photo is cut off above the forehead
    band_cover = float(mask[y0:y1, x0:x1].mean())
    if band_cover >= BUZZ_MIN_MASK_COVER:
        return "Buzz", 0.7
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    scalp_l = float(np.median(lab[y0:y1, x0:x1, 0])) * 100.0 / 255.0
    fx, fy = (int(v) for v in face.pt(LM_FOREHEAD_CENTER[1]))
    r = max(3, int(fw * 0.05))
    skin = lab[max(0, fy - r):fy + r, max(0, fx - r):fx + r, 0]
    if skin.size == 0:
        return UNKNOWN, 0.0
    skin_l = float(np.median(skin)) * 100.0 / 255.0
    if skin_l - scalp_l >= BUZZ_MIN_DARKER_L:
        return "Buzz", 0.6
    return "Bald", 0.6


def face_shape(face: FaceGeometry) -> tuple[str, float, dict]:
    """
    Face shape from landmark proportions: length vs cheekbone width, and forehead / cheekbone / jaw widths.
    Returns Unknown for turned heads or when the proportions sit between shapes.
    """
    W = face.width
    L = face.height
    F = face.dist(LM_FOREHEAD_L, LM_FOREHEAD_R)
    J = face.dist(LM_JAW_L, LM_JAW_R)
    yaw = abs(face.pt(LM_NOSE_TIP)[0] - face.center_x) / W
    m = {
        "face_width_px": round(W, 1), "face_height_px": round(L, 1),
        "forehead_width_px": round(F, 1), "jaw_width_px": round(J, 1),
        "length_to_width": round(L / W, 3), "forehead_to_cheek": round(F / W, 3),
        "jaw_to_cheek": round(J / W, 3), "head_turn": round(yaw, 3),
    }
    if yaw > 0.08 or W < 60:
        return UNKNOWN, 0.0, m

    lw, fc, jc = L / W, F / W, J / W
    # (shape, how strongly the rule holds); the margins are distances from the rule thresholds
    candidates = []
    if lw >= 1.32:
        candidates.append(("Oblong", (lw - 1.32) / 0.08))
    if fc - jc > 0.12 and lw < 1.32:
        candidates.append(("Heart", (fc - jc - 0.12) / 0.06))
    if fc < 0.82 and jc < 0.78 and lw < 1.32:
        candidates.append(("Diamond", min(0.82 - fc, 0.78 - jc) / 0.05))
    if jc >= 0.86 and lw < 1.18:
        candidates.append(("Square", min(jc - 0.86, 1.18 - lw) / 0.05))
    if jc < 0.86 and lw < 1.12:
        candidates.append(("Round", min(0.86 - jc, 1.12 - lw) / 0.05))
    if 1.12 <= lw < 1.32 and jc < 0.86 and abs(fc - jc) <= 0.12:
        candidates.append(("Oval", min(lw - 1.12, 1.32 - lw, 0.86 - jc) / 0.05))
    if not candidates:
        return UNKNOWN, 0.0, m
    shape, strength = max(candidates, key=lambda c: c[1])
    confidence = float(np.clip(0.5 + 0.5 * strength, 0.0, 1.0))
    return (shape, confidence, m) if confidence >= 0.6 else (UNKNOWN, confidence, m)


def portrait_box(face: FaceGeometry, size: tuple[int, int], aspect: float = 0.8) -> tuple[int, int, int, int]:
    """Head-and-shoulders 4:5 crop with room above the head for volume and below the chin for long hair."""
    W, H = size
    fh = face.height
    bh = 4.4 * fh
    bw = bh * aspect
    if bw > W or bh > H:
        scale = min(W / bw, H / bh)
        bw, bh = bw * scale, bh * scale
    x0 = min(max(0.0, face.center_x - bw / 2), W - bw)
    y0 = min(max(0.0, face.top_y - 1.3 * fh), H - bh)
    return int(x0), int(y0), int(x0 + bw), int(y0 + bh)
