"""
Cutting instructions in English, Hindi and Tamil, as text and as spoken audio.

  - Translation: Gemini text model (free tier works), cached per style + language in instruction_translations.
  - Speech: Microsoft Edge neural voices via edge-tts (free, needs internet), cached as MP3 files.
If translation is unavailable the English steps are returned (and spoken in the chosen language's voice is skipped).
"""
import asyncio
import hashlib
import logging
import os
import re
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.storage import storage_service
from app.models.domain import InstructionTranslation

logger = logging.getLogger(__name__)

LANGUAGES = {
    "en": {"name": "English", "voice": "en-IN-NeerjaNeural", "intro": "Cutting instructions for {style}."},
    "hi": {"name": "Hindi", "voice": "hi-IN-SwaraNeural", "intro": "{style} के लिए कटिंग निर्देश।"},
    "ta": {"name": "Tamil", "voice": "ta-IN-PallaviNeural", "intro": "{style} க்கான வெட்டும் வழிமுறைகள்."},
}
TRANSLATION_MODEL = "gemini-2.5-flash-lite"


def _clean_steps(raw: str) -> List[str]:
    return [re.sub(r"^\s*\d+[.)]\s*", "", line).strip() for line in (raw or "").split("\n") if line.strip()]


def _source_hash(steps: List[str]) -> str:
    return hashlib.sha256("\n".join(steps).encode("utf-8")).hexdigest()


async def _translate_with_gemini(steps: List[str], language: str) -> Optional[List[str]]:
    use_vertex = getattr(settings, "USE_VERTEX_AI", False) or getattr(settings, "IMAGE_EDIT_PROVIDER", "").lower() in ("vertexai", "vertex")
    key = settings.get_gemini_api_key() if hasattr(settings, "get_gemini_api_key") else os.getenv("GEMINI_API_KEY", "")
    if not use_vertex and not key:
        return None
    from google import genai

    numbered = "\n".join(f"{i + 1}. {s}" for i, s in enumerate(steps))
    prompt = (
        f"Translate these hair salon cutting steps from English into {LANGUAGES[language]['name']}, for a "
        "stylist to listen to. Keep the same number of steps and their order. Keep numbers, measurements "
        "and clipper guard numbers (like #2, 5 mm, 2 inches) exactly. Use natural, simple spoken language. "
        "Reply with only the translated steps, one per line, numbered 1., 2., 3. ...\n\n" + numbered
    )
    try:
        if use_vertex:
            client = genai.Client(
                vertexai=True,
                project=settings.VERTEX_AI_PROJECT,
                location=settings.VERTEX_AI_LOCATION
            )
        else:
            client = genai.Client(api_key=key)
        resp = await client.aio.models.generate_content(model=TRANSLATION_MODEL, contents=prompt)
        lines = _clean_steps(resp.text or "")
        if len(lines) == len(steps):
            return lines
        logger.warning("Translation returned %d steps for %d; ignoring", len(lines), len(steps))
    except Exception as e:
        logger.warning("Translation with Gemini/Vertex AI failed: %s", type(e).__name__)
    return None


async def get_steps(db: Session, style: dict, language: str) -> Tuple[List[str], str]:
    """Returns (steps, language actually used). Falls back to English when a translation is unavailable."""
    steps = _clean_steps(style.get("stylist_instructions", ""))
    if language == "en" or language not in LANGUAGES or not steps:
        return steps, "en"
    source_hash = _source_hash(steps)
    cached = (db.query(InstructionTranslation)
              .filter(InstructionTranslation.style_id == style["id"], InstructionTranslation.language == language,
                      InstructionTranslation.source_hash == source_hash).first())
    if cached:
        return cached.steps_json.get("steps", steps), language
    translated = await _translate_with_gemini(steps, language)
    if not translated:
        return steps, "en"
    db.add(InstructionTranslation(style_id=style["id"], language=language, source_hash=source_hash,
                                  steps_json={"steps": translated}))
    db.commit()
    return translated, language


async def get_audio_file(db: Session, style: dict, language: str) -> Tuple[str, str]:
    """Path of an MP3 reading the style's steps in the language (cached). Returns (path, language used)."""
    import edge_tts

    steps, used = await get_steps(db, style, language)
    lang = LANGUAGES[used]
    text = lang["intro"].format(style=style.get("name", "")) + " " + " ".join(
        f"{i + 1}. {s.rstrip('.')}." for i, s in enumerate(steps))
    folder = os.path.join(storage_service.base_dir, "audio")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"style_{style['id']}_{used}_{hashlib.sha256(text.encode('utf-8')).hexdigest()[:12]}.mp3")
    if not os.path.isfile(path):
        await asyncio.wait_for(edge_tts.Communicate(text, lang["voice"], rate="-5%").save(path), timeout=60)
    return path, used
