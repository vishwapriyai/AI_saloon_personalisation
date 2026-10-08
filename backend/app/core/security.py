import base64
import hashlib
import hmac
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import quote

from jose import JWTError, jwt

from app.core.config import settings


def _b64_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')


def _b64_decode(data: str) -> bytes:
    padding = '=' * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


# OWASP (2023+) guidance for PBKDF2-HMAC-SHA256
PBKDF2_ITERATIONS = 600_000


def get_password_hash(password: str) -> str:
    """Salted PBKDF2-SHA256 hash, stored as pbkdf2_sha256$<iterations>$<salt>$<hash>."""
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${_b64_encode(salt)}${_b64_encode(digest)}"


def verify_password(plain_password: str, hashed_password: Optional[str]) -> bool:
    if not hashed_password:
        return False
    if hashed_password.startswith("pbkdf2_sha256$"):
        try:
            _, iterations, salt_b64, digest_b64 = hashed_password.split("$")
            digest = hashlib.pbkdf2_hmac("sha256", plain_password.encode(), _b64_decode(salt_b64), int(iterations))
            return hmac.compare_digest(_b64_encode(digest), digest_b64)
        except ValueError:
            return False
    # Legacy unsalted SHA-256 hashes: accepted once, then replaced on login (see password_needs_rehash)
    return hmac.compare_digest(hashlib.sha256(plain_password.encode()).hexdigest(), hashed_password)


def password_needs_rehash(hashed_password: Optional[str]) -> bool:
    """True for legacy unsalted hashes and PBKDF2 hashes with fewer than the current iterations."""
    if not hashed_password or not hashed_password.startswith("pbkdf2_sha256$"):
        return True
    try:
        return int(hashed_password.split("$")[1]) < PBKDF2_ITERATIONS
    except (IndexError, ValueError):
        return True


def create_access_token(data: dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    payload = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.STAFF_TOKEN_EXPIRE_MINUTES))
    payload["exp"] = int(expire.timestamp())
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> Optional[dict[str, Any]]:
    """The token's claims, or None when it is malformed, wrongly signed or expired."""
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None


# ---------------------------------------------------------------------------- signed media links
MEDIA_PREFIX = "/static/media/"


def _media_signature(path: str, expires: int) -> str:
    msg = f"media:{path}:{expires}".encode()
    return _b64_encode(hmac.new(settings.SECRET_KEY.encode(), msg, hashlib.sha256).digest()[:18])


def sign_media_url(url: str) -> str:
    """Adds an expiring signature to a stored /static/media/... address (other addresses are returned as is)."""
    if not isinstance(url, str) or not url.startswith(MEDIA_PREFIX):
        return url
    path = media_path(url)
    expires = int(time.time()) + settings.MEDIA_URL_EXPIRE_MINUTES * 60
    return f"{quote(path)}?exp={expires}&sig={_media_signature(path, expires)}"


def verify_media_signature(path: str, expires: str, signature: str) -> bool:
    if not expires.isdigit() or int(expires) < int(time.time()):
        return False
    return hmac.compare_digest(_media_signature(path, int(expires)), signature)


def media_path(url: Optional[str]) -> str:
    """The stored form of a media address: signature and query removed (as sent back by the browser)."""
    if not url:
        return ""
    url = url.split("?", 1)[0]
    if "://" in url and MEDIA_PREFIX in url:  # absolute address of our own media
        url = url[url.index(MEDIA_PREFIX):]
    return url
