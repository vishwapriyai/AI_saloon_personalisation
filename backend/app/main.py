import os
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import uvicorn

from app.core.config import settings, check_settings
from app.core.migrations import migrate_database
from app.core.security import MEDIA_PREFIX, sign_media_url, verify_media_signature
from app.api.v1.endpoints import router as api_v1_router

_problems = check_settings(settings)
for _p in _problems:
    print(f"[config] {_p}", flush=True)
if _problems and settings.is_production:
    raise RuntimeError("Unsafe production configuration: " + " ".join(_problems))

# Development creates tables and adds new columns automatically; production runs
# `python -m app.core.migrations` once before starting the workers.
if not settings.is_production:
    migrate_database()

# Staff roles (+ sample accounts in development), branches and the price list (only where missing)
from app.core.auth import seed_auth  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402

from app.core.reference_data import seed_reference_data  # noqa: E402

with SessionLocal() as _db:
    seed_auth(_db)
    seed_reference_data(_db)


def _sign_media(value: Any) -> Any:
    """Signs every /static/media/... address in a response, so images load without exposing the media folder."""
    if isinstance(value, str):
        return sign_media_url(value) if value.startswith(MEDIA_PREFIX) else value
    if isinstance(value, dict):
        return {k: _sign_media(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sign_media(v) for v in value]
    return value


class SignedMediaJSONResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        return super().render(_sign_media(content))


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Salon AI & Customer Analytics Platform API",
    version="1.0.0",
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    default_response_class=SignedMediaJSONResponse,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=False,  # the API uses Bearer tokens, not cookies
    allow_methods=["*"],
    allow_headers=["*"],
)

media_dir = os.path.abspath(settings.STORAGE_LOCAL_DIR)
os.makedirs(media_dir, exist_ok=True)


@app.get(MEDIA_PREFIX + "{file_path:path}", include_in_schema=False)
def serve_media(file_path: str, exp: str = "", sig: str = ""):
    """Customer photos and previews: only with a valid, unexpired signature from an API response."""
    if not verify_media_signature(MEDIA_PREFIX + file_path, exp, sig):
        raise HTTPException(status_code=403, detail="This image link has expired. Please reload the page.")
    full = os.path.abspath(os.path.join(media_dir, file_path))
    if not full.startswith(media_dir + os.sep) or not os.path.isfile(full):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(full, headers={"Cache-Control": "private, max-age=3600"})


app.include_router(api_v1_router, prefix=settings.API_V1_STR)


@app.get("/")
def root_status():
    return {"status": "ONLINE", "system": settings.PROJECT_NAME}


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=not settings.is_production)
