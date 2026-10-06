import base64
import logging
from typing import Any, Dict, Optional

import httpx

from app.ai.errors import ImageEditError
from app.core.config import settings

logger = logging.getLogger(__name__)


class NVIDIA_NIM_Client:
    """
    NVIDIA NIM visual GenAI client used as an IMAGE-EDITING service.

    The customer's photo is always sent as the image to edit (base64 data URI), optionally with a
    catalogue style reference as a second image for models that accept several images.

      Fast tier : FLUX.2-klein-4B   (NVIDIA_NIM_FAST_URL) - multi-image edit, 4 steps
      HQ tier   : FLUX.1-Kontext-dev (NVIDIA_NIM_HQ_URL)  - single-image instruction edit

    NVIDIA's hosted endpoints (ai.api.nvidia.com) only accept NVIDIA's built-in example images, so
    customer photos require a self-hosted NIM container. When a call fails the error is raised;
    there is no text-to-image or stock-image fallback.
    """

    name = "nvidia"

    def __init__(self):
        self.api_key = settings.NVIDIA_NGC_API_KEY
        self.fast_url = settings.NVIDIA_NIM_FAST_URL
        self.hq_url = settings.NVIDIA_NIM_HQ_URL
        self.fast_model = settings.NVIDIA_FAST_MODEL
        self.hq_model = settings.NVIDIA_HQ_MODEL

    def model_for(self, tier: str) -> str:
        return self.hq_model if tier == "hq" else self.fast_model

    # NVIDIA's FLUX endpoints reject prompts longer than 800 characters
    max_prompt_chars = 800

    def supports_reference(self, tier: str) -> bool:
        """FLUX.2-klein takes a list of images; FLUX.1-Kontext edits a single image."""
        return "kontext" not in self.model_for(tier).lower()

    def _payload(self, tier: str, prompt: str, photo_jpeg: bytes, reference_jpeg: Optional[bytes]) -> Dict[str, Any]:
        photo_uri = f"data:image/jpeg;base64,{base64.b64encode(photo_jpeg).decode()}"
        if not self.supports_reference(tier):
            return {"prompt": prompt, "image": photo_uri, "aspect_ratio": "match_input_image",
                    "steps": 30, "cfg_scale": 3.5, "seed": 0}
        images = [photo_uri]
        if reference_jpeg:
            images.append(f"data:image/jpeg;base64,{base64.b64encode(reference_jpeg).decode()}")
        return {"prompt": prompt, "image": images, "steps": 4, "seed": 0}

    async def edit_image(self, tier: str, prompt: str, photo_jpeg: bytes,
                         reference_jpeg: Optional[bytes] = None, usage: Optional[Dict[str, Any]] = None) -> bytes:
        """Edits the customer photo and returns the edited image bytes, or raises ImageEditError."""
        from app.ai.image_editing import log_progress, log_api_exceeded_warning

        url = self.hq_url if tier == "hq" else self.fast_url
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        log_progress("NVIDIA-REQUEST", f"Sending image request to NVIDIA NIM ({self.model_for(tier)}) at {url}...")

        try:
            async with httpx.AsyncClient(timeout=settings.GENERATION_TIMEOUT_SECONDS) as client:
                resp = await client.post(url, headers=headers, json=self._payload(tier, prompt, photo_jpeg, reference_jpeg))
        except httpx.HTTPError as e:
            log_api_exceeded_warning("NVIDIA NIM", self.model_for(tier), f"Connection Error: {e}")
            raise ImageEditError(f"NVIDIA NIM unreachable at {url}: {e}")

        if resp.status_code == 422 and "example_id" in resp.text:
            log_api_exceeded_warning(
                provider="NVIDIA NIM (Cloud API)",
                model=self.model_for(tier),
                error_msg="Hosted Cloud API accepts only built-in NVIDIA example images, not customer photos.",
                hint="Set IMAGE_EDIT_PROVIDER=gemini or host NIM container on local GPU."
            )
            raise ImageEditError(
                "NVIDIA's hosted API only accepts NVIDIA's built-in example images, not customer photos. "
                "Run the NIM container on a GPU and set NVIDIA_NIM_FAST_URL / NVIDIA_NIM_HQ_URL to it, "
                "or set IMAGE_EDIT_PROVIDER=gemini."
            )
        if resp.status_code in (429, 401, 403):
            log_api_exceeded_warning(
                provider="NVIDIA NIM",
                model=self.model_for(tier),
                error_msg=f"HTTP {resp.status_code}: Rate Limit Exceeded or Auth Failure",
                hint="Check NVIDIA_NGC_API_KEY or rate limits."
            )
            raise ImageEditError(f"NVIDIA NIM returned HTTP {resp.status_code}: {resp.text[:300]}")
        if resp.status_code != 200:
            log_api_exceeded_warning("NVIDIA NIM", self.model_for(tier), f"HTTP {resp.status_code}: {resp.text[:300]}")
            raise ImageEditError(f"NVIDIA NIM returned HTTP {resp.status_code}: {resp.text[:300]}")

        data = resp.json()
        artifact = (data.get("artifacts") or [{}])[0]
        if artifact.get("finishReason") not in (None, "SUCCESS"):
            raise ImageEditError(f"NVIDIA NIM did not finish the edit: {artifact.get('finishReason')}")
        b64 = artifact.get("base64") or data.get("image")
        if not b64:
            raise ImageEditError(f"NVIDIA NIM returned no image: {str(data)[:300]}")
        log_progress("NVIDIA-SUCCESS", f"Received image from NVIDIA NIM model '{self.model_for(tier)}'!", "SUCCESS")
        return base64.b64decode(b64.split(",")[-1])

    async def generate_fast_preview(
        self,
        original_image_url: str,
        controlled_prompt: str,
        style_metadata: Dict[str, Any],
        customer_analysis: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Fast-tier edit of the customer's photo. Returns the preview URL or raises ImageEditError.
        The prompt is rebuilt by the controlled prompt engine; `controlled_prompt` is kept for compatibility."""
        from app.ai.image_editing import hair_style_generator
        res = await hair_style_generator.generate(
            original_image_url, style_metadata, customer_analysis or {}, tier="fast", provider="nvidia")
        return res.image_url

    async def generate_high_fidelity_edit(
        self,
        customer_image_url: str,
        style_metadata: Dict[str, Any],
        customer_analysis: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """HQ-tier edit of the customer's photo for the final reference image. Raises ImageEditError on failure."""
        from app.ai.image_editing import hair_style_generator
        res = await hair_style_generator.generate(
            customer_image_url, style_metadata, customer_analysis or {}, tier="hq", provider="nvidia")
        return {
            "generated_image_url": res.image_url,
            "identity_score": res.identity_score,
            "hair_consistency_score": res.hair_consistency_score,
            "model_used": res.model,
        }

    async def generate_hairstyle_preview(
        self,
        original_image_url: str,
        controlled_prompt: str,
        style_metadata: Dict[str, Any]
    ) -> str:
        """Legacy wrapper for fast preview generation."""
        return await self.generate_fast_preview(original_image_url, controlled_prompt, style_metadata)


nvidia_nim_client = NVIDIA_NIM_Client()
