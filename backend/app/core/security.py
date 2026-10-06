import hmac
import hashlib
import json
import base64
import os
from datetime import datetime, timedelta, timezone
from typing import Optional, Any
from app.core.config import settings

def _b64_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')

def _b64_decode(data: str) -> bytes:
    padding = '=' * (4 - (len(data) % 4))
    return base64.urlsafe_b64decode(data + padding)

PBKDF2_ITERATIONS = 200_000


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
    # Legacy unsalted SHA-256 hashes
    return hmac.compare_digest(hashlib.sha256(plain_password.encode()).hexdigest(), hashed_password)

def create_access_token(data: dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = data.copy()

    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    payload.update({"exp": int(expire.timestamp())})

    header_b64 = _b64_encode(json.dumps(header).encode())
    payload_b64 = _b64_encode(json.dumps(payload).encode())

    signature_input = f"{header_b64}.{payload_b64}".encode()
    signature = hmac.new(settings.SECRET_KEY.encode(), signature_input, hashlib.sha256).digest()
    signature_b64 = _b64_encode(signature)

    return f"{header_b64}.{payload_b64}.{signature_b64}"

def decode_access_token(token: str) -> Optional[dict[str, Any]]:
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        header_b64, payload_b64, signature_b64 = parts
        signature_input = f"{header_b64}.{payload_b64}".encode()
        expected_sig = _b64_encode(hmac.new(settings.SECRET_KEY.encode(), signature_input, hashlib.sha256).digest())
        if not hmac.compare_digest(signature_b64, expected_sig):
            return None
        payload = json.loads(_b64_decode(payload_b64).decode('utf-8'))
        if int(payload.get("exp", 0)) < int(datetime.now(timezone.utc).timestamp()):
            return None  # expired
        return payload
    except Exception:
        return None
