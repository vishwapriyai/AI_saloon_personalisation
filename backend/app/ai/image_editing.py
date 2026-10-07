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
    LM_CHEEK_SKIN, LM_FOREHEAD_CENTER, FaceGeometry, delta_e, get_vision_models, hair_lab, portrait_box,
)
from app.core.config import settings
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


def _skin_lab(rgb: np.ndarray, face: FaceGeometry) -> np.ndarray:
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    r = max(3, int(face.width * 0.06))
    samples = []
    for i in LM_CHEEK_SKIN:
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
    """Mean absolute RGB difference on the left/right edges (lower 60%) and bottom edge, i.e. background
    and clothing, ignoring pixels that are hair in either image (a new long cut may legitimately cover them)."""
    h, w = a.shape[:2]
    ew, eh = max(4, int(w * 0.08)), max(4, int(h * 0.08))
    region = np.zeros((h, w), dtype=bool)
    region[int(h * 0.4):, :ew] = True
    region[int(h * 0.4):, w - ew:] = True
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
@dataclass
class Validation:
    problem: Optional[str]
    identity_score: Optional[float] = None
    hair_consistency_score: Optional[float] = None


def validate_edit(src: SourcePhoto, edited_rgb: np.ndarray, colour_change_allowed: bool) -> Validation:
    vm = get_vision_models()
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
    if identity < settings.IDENTITY_MIN_SIMILARITY:
        return Validation(f"identity_validation_failed (similarity {identity:.2f})", identity)

    skin_shift = delta_e(src.skin_lab, _skin_lab(edited_rgb, face))
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

    hair_score = None
    edited_lab = hair_lab(edited_rgb, mask)
    if src.hair_lab is not None and edited_lab is not None:
        de = delta_e(src.hair_lab, edited_lab)
        hair_score = float(np.clip(1.0 - de / 40.0, 0.0, 1.0))
        if de > settings.HAIR_COLOUR_MAX_DELTA_E and not colour_change_allowed:
            return Validation(f"hair colour changed (deltaE {de:.1f})", identity, hair_score)
    return Validation(None, identity, hair_score)


# ----------------------------------------------------------------------------
# Providers
# ----------------------------------------------------------------------------
class GeminiEditor:
    name = "gemini"

    def __init__(self):
        from google import genai  # imported lazily so the app starts without the key
        key = settings.get_gemini_api_key()
        if not key:
            raise ImageEditError("No GEMINI_API_KEY found in backend/.env")
        self._key = key
        self._client = genai.Client(api_key=key)
        masked = key[:6] + "..." + key[-4:] if len(key) > 10 else "***"
        log_progress("GEMINI-INIT", f"Initialized Gemini Editor with single API Key ({masked})", "INFO")

    max_prompt_chars = None

    def model_for(self, tier: str) -> str:
        return settings.GEMINI_HQ_MODEL if tier == "hq" else settings.GEMINI_FAST_MODEL

    def supports_reference(self, tier: str) -> bool:
        return True

    async def edit_image(self, tier: str, prompt: str, photo: bytes, reference: Optional[bytes],
                         usage: Optional[Dict[str, Any]] = None) -> bytes:
        from google.genai import types
        from google.genai.errors import APIError

        model_name = self.model_for(tier)
        masked_key = self._key[:6] + "..." + self._key[-4:] if len(self._key) > 10 else "***"

        contents: list[Any] = [types.Part.from_bytes(data=photo, mime_type="image/jpeg")]
        if reference:
            contents.append(types.Part.from_bytes(data=reference, mime_type="image/jpeg"))
        contents.append(prompt)

        log_progress("GEMINI-REQUEST", f"Sending request using Single Key ({masked_key}) to '{model_name}'...")

        try:
            resp = await self._client.aio.models.generate_content(
                model=model_name,
                contents=contents,
                config=types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]),
            )
            for cand in resp.candidates or []:
                for part in (cand.content.parts if cand.content else []) or []:
                    if part.inline_data and part.inline_data.data:
                        log_progress("GEMINI-SUCCESS", f"Successfully generated image using Single Key ({masked_key})!", "SUCCESS")
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
            raise ImageEditError(f"Gemini returned no image (reason: {reason})")

        except APIError as e:
            is_rate_limit = (e.code == 429 or "RESOURCE_EXHAUSTED" in str(e).upper() or "QUOTA" in str(e).upper())
            if is_rate_limit:
                log_api_exceeded_warning(
                    provider=f"Gemini (Key: {masked_key})",
                    model=model_name,
                    error_msg=f"HTTP 429 Rate Limit / Quota Exceeded ({e.message})",
                    hint="Gemini API Key quota limit reached. Please check quota or wait for reset."
                )
                raise ImageEditError("Gemini API Key hit rate limits / quota exceeded.")
            else:
                log_api_exceeded_warning(f"Gemini (Key: {masked_key})", model_name, f"HTTP {e.code}: {e.message}")
                raise ImageEditError(f"Gemini API error {e.code}: {e.message}")
        except Exception as e:
            err_str = str(e)
            is_rate_limit = ("429" in err_str or "RESOURCE_EXHAUSTED" in err_str.upper() or "QUOTA" in err_str.upper())
            if is_rate_limit:
                log_api_exceeded_warning(
                    provider=f"Gemini (Key: {masked_key})",
                    model=model_name,
                    error_msg=f"Quota Exceeded: {err_str}",
                    hint="Gemini API Key rate limit hit."
                )
                raise ImageEditError("Gemini API Key hit rate limit.")
            raise ImageEditError(f"Gemini error: {err_str}")


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
        if url.startswith("/static/media/"):
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

        reference_jpeg = None
        if settings.USE_STYLE_REFERENCE_IMAGE and editor.supports_reference(tier) and style_metadata.get("preview_image_url"):
            reference_jpeg = _to_jpeg(prepare_ai_input(await self._load_bytes(style_metadata["preview_image_url"])))

        # Only a colour service may change the hair colour; smoothening/perm and beard edits must keep it
        colour_change_allowed = style_metadata.get("service") == "Colour"
        last = Validation("generation was not attempted")
        prompt = ""
        attempts = 0

        for attempt in range(settings.GENERATION_MAX_ATTEMPTS):
            attempts = attempt + 1
            prompt = prompt_engine.build_prompt(
                customer_analysis, style_metadata, strict=attempt > 0, with_reference_image=reference_jpeg is not None,
                max_chars=editor.max_prompt_chars)
            
            log_progress("STEP 3/4", f"Attempt {attempt + 1}/{settings.GENERATION_MAX_ATTEMPTS} | Prompt ({len(prompt)} chars): '{prompt[:80]}...'", "INFO")

            cache_key = hashlib.sha256(
                src.jpeg + (reference_jpeg or b"") + f"|{style_id}|{model}|{PROMPT_TEMPLATE_VERSION}|{prompt}".encode()
            ).hexdigest()[:32]
            cache_img = os.path.join(self.cache_dir, f"{cache_key}.jpg")
            cache_meta = os.path.join(self.cache_dir, f"{cache_key}.json")
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
                        editor.edit_image(tier, prompt, src.jpeg, reference_jpeg, usage=usage),
                        timeout=settings.GENERATION_TIMEOUT_SECONDS,
                    )
            except asyncio.TimeoutError:
                log_progress("TIMEOUT-WARNING", f"Style #{style_id} attempt {attempts} timed out after {settings.GENERATION_TIMEOUT_SECONDS}s", "WARNING")
                last = Validation("the image service took too long to respond")
                continue
            except ImageEditError as e:
                log_progress("PROVIDER-ERROR", f"Style #{style_id}: {editor.name} failed ({e.reason})", "ERROR")
                fallback_handled = False
                fallback = settings.IMAGE_EDIT_FALLBACK_PROVIDER.strip().lower()
                if fallback and editor.name != fallback:
                    log_progress("FALLBACK-ATTEMPT", f"Trying fallback provider '{fallback}' for Style #{style_id}", "WARNING")
                    try:
                        editor = self._get_editor(fallback)
                        model = editor.model_for(tier)
                        reference_jpeg = reference_jpeg if editor.supports_reference(tier) else None
                        async with self._sem:
                            raw = await asyncio.wait_for(
                                editor.edit_image(tier, prompt, src.jpeg, reference_jpeg, usage=usage),
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
            last = await asyncio.to_thread(validate_edit, src, np.asarray(edited), colour_change_allowed)
            if last.problem:
                log_progress("VALIDATION-REJECT", f"Style #{style_id} attempt {attempts} rejected: {last.problem}", "WARNING")
                continue

            result_jpeg = _to_jpeg(add_preview_label(edited))
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
        Applies the style to the customer's SIDE or BACK photo. These views have no full face to verify,
        so the checks are: the photo really changed, and (unless it is a colour service) the hair colour
        stayed the same. The front preview keeps its full identity checks in generate().
        """
        started = time.monotonic()
        style_id = style_metadata.get("id")
        img = prepare_ai_input(await self._load_bytes(photo_url))
        img = img.resize((img.width // 16 * 16, img.height // 16 * 16), Image.Resampling.LANCZOS)
        rgb = np.asarray(img)
        jpeg = _to_jpeg(img)
        editor = self._get_editor(provider)
        model = editor.model_for(tier)
        vm = get_vision_models()
        src_hair = await asyncio.to_thread(vm.hair_mask, rgb, None)
        src_lab = hair_lab(rgb, src_hair)
        colour_change_allowed = style_metadata.get("service") == "Colour"
        last_problem = "generation was not attempted"
        prompt = ""
        attempts = 0
        for attempt in range(settings.GENERATION_MAX_ATTEMPTS):
            attempts = attempt + 1
            prompt = prompt_engine.build_view_prompt(customer_analysis, style_metadata, view, strict=attempt > 0,
                                                     max_chars=editor.max_prompt_chars)
            usage: Dict[str, Any] = {}
            try:
                async with self._sem:
                    raw = await asyncio.wait_for(editor.edit_image(tier, prompt, jpeg, None, usage=usage),
                                                 timeout=settings.GENERATION_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                last_problem = "the image service took too long to respond"
                continue
            except ImageEditError as e:
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
            url = self._save(_to_jpeg(add_preview_label(Image.fromarray(edited))), f"{style_id}_{view}")
            log_progress("VIEW-SUCCESS", f"Style #{style_id} {view} view generated -> {url}", "SUCCESS")
            return EditResult(url, model, prompt, None, hair_score, attempts, round(time.monotonic() - started, 2))
        raise ImageEditError(last_problem, attempts=attempts, model=model)


hair_style_generator = HairStyleGenerator()
