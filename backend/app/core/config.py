import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "Salon AI & Customer Analytics Platform"
    SALON_NAME: str = "LUXE Styling"
    # Customer type shown on the profile and stylist view (VIP > Premium > Priority)
    VIP_MIN_SPEND: float = 10000.0
    VIP_MIN_VISITS: int = 10
    PREMIUM_MIN_SPEND: float = 5000.0
    PREMIUM_MIN_VISITS: int = 6
    PRIORITY_MIN_SPEND: float = 2000.0
    PRIORITY_MIN_VISITS: int = 3
    REFERRAL_DISCOUNT_PERCENT: int = 15
    API_V1_STR: str = "/api/v1"
    # 'development' seeds sample accounts and auto-adds missing DB columns at startup; 'production' does neither,
    # refuses the default SECRET_KEY, and blocks test-only image providers.
    APP_ENV: str = "development"
    SECRET_KEY: str = "super-secret-key-change-in-production-salon-ai-2026"
    ALGORITHM: str = "HS256"
    # Shared salon tablets: keep sessions short (the frontend also logs customers out after inactivity)
    STAFF_TOKEN_EXPIRE_MINUTES: int = 60 * 12
    CUSTOMER_TOKEN_EXPIRE_MINUTES: int = 60 * 2
    PASSWORD_MIN_LENGTH: int = 8
    # Failed logins per account (or per client address) before a temporary lockout
    LOGIN_MAX_FAILURES: int = 5
    LOGIN_LOCKOUT_MINUTES: int = 15
    # Customer photos, previews and after-photos are served only through signed, expiring links
    MEDIA_URL_EXPIRE_MINUTES: int = 60 * 6
    # A photo session can be reused for new previews only while it is recent and no haircut was done since
    PHOTO_REUSE_MAX_DAYS: int = 30
    # Photos of customers who did not consent to history retention are deleted after this many days
    MEDIA_RETENTION_DAYS_WITHOUT_CONSENT: int = 1
    # AI preview cache files (copies of edited customer photos) are removed after this many days
    AI_CACHE_MAX_DAYS: int = 30

    @property
    def is_production(self) -> bool:
        return self.APP_ENV.strip().lower() == "production"

    # Database
    # Supports MySQL or fallback SQLite for immediate local execution
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "sqlite:///./salon_ai.db"
    )

    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    USE_MOCK_REDIS: bool = True  # Allows running without requiring live Redis process if unavailable

    # Object Storage (MinIO / S3)
    STORAGE_TYPE: str = os.getenv("STORAGE_TYPE", "local")  # 'local', 's3', 'minio'
    STORAGE_LOCAL_DIR: str = "./media_storage"
    S3_BUCKET_NAME: str = os.getenv("S3_BUCKET_NAME", "salon-ai-media")
    AWS_ACCESS_KEY_ID: Optional[str] = os.getenv("AWS_ACCESS_KEY_ID", None)
    AWS_SECRET_ACCESS_KEY: Optional[str] = os.getenv("AWS_SECRET_ACCESS_KEY", None)
    AWS_REGION: str = os.getenv("AWS_REGION", "us-east-1")

    # Hairstyle image editing (edits the customer's own photo; never generates a new person)
    # IMAGE_EDIT_PROVIDER: 'cloudflare' (FLUX.2-klein on Workers AI, free daily allowance),
    # 'openrouter' (Gemini image models via OpenRouter), 'gemini' (Google direct),
    # 'nvidia' (self-hosted NIM) or 'huggingface' (public HF Space, testing only)
    IMAGE_EDIT_PROVIDER: str = "gemini"
    GEMINI_API_KEY: str = ""

    def get_gemini_api_key(self) -> str:
        keys = self.get_gemini_api_keys()
        return keys[0] if keys else ""

    def get_gemini_api_keys(self) -> list[str]:
        keys = []
        main_key = os.getenv("GEMINI_API_KEY", "").strip()
        if main_key:
            keys.append(main_key)
        for key, val in sorted(os.environ.items()):
            if key.startswith("GEMINI_API_KEY_") and val and val.strip():
                v = val.strip()
                if v not in keys:
                    keys.append(v)
        if not keys and self.GEMINI_API_KEY:
            keys.append(self.GEMINI_API_KEY.strip())
        return keys

    GEMINI_FAST_MODEL: str = "gemini-2.5-flash-image"        # 8 previews
    GEMINI_HQ_MODEL: str = "gemini-3-pro-image-preview"      # final reference of the chosen style
    NVIDIA_NGC_API_KEY: str = ""
    # NVIDIA's hosted API (ai.api.nvidia.com) only accepts its built-in example images, so real customer
    # photos need a self-hosted NIM container; point these URLs at it (e.g. http://gpu-host:8000/v1/infer).
    NVIDIA_NIM_FAST_URL: str = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b"
    NVIDIA_NIM_HQ_URL: str = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-kontext-dev"
    NVIDIA_FAST_MODEL: str = "FLUX.2-klein-4B"
    NVIDIA_HQ_MODEL: str = "FLUX.1-Kontext-dev"
    # Cloudflare Workers AI: free plan = 10,000 neurons/day, about 110 per preview (~90 previews/day)
    CLOUDFLARE_ACCOUNT_ID: str = ""
    CLOUDFLARE_API_TOKEN: str = ""
    CLOUDFLARE_MODEL: str = "@cf/black-forest-labs/flux-2-klein-4b"
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_FAST_MODEL: str = "google/gemini-2.5-flash-image"   # previews
    OPENROUTER_HQ_MODEL: str = "google/gemini-3-pro-image"         # final reference of the chosen style
    # Hugging Face Space (Qwen-Image-Edit-2511, Apache-2.0). FOR TESTING ONLY: photos are sent to a public
    # third-party Space. Free ZeroGPU quota is small; an HF_TOKEN raises it.
    HF_SPACE_ID: str = "LPX55/Qwen-Image-Edit-2511-Turbo-Lightning"
    HF_TOKEN: str = ""
    HF_SPACE_STEPS: int = 4
    # Number of recommended styles (and therefore personalized previews generated) per customer
    STYLE_RECOMMENDATION_COUNT: int = 4
    MAX_PARALLEL_GENERATIONS: int = 4
    # Free shared GPUs can take 1-2 minutes per image when busy, so allow slow answers before retrying.
    # Keep PROVIDER_REQUEST_TIMEOUT_SECONDS x PROVIDER_REQUEST_RETRIES below GENERATION_TIMEOUT_SECONDS (checked
    # at startup), and the reverse proxy's read timeout above GENERATION_TIMEOUT_SECONDS x GENERATION_MAX_ATTEMPTS.
    GENERATION_TIMEOUT_SECONDS: int = 120          # one edit attempt, including provider retries (semaphore wait excluded)
    PROVIDER_REQUEST_TIMEOUT_SECONDS: int = 45     # one HTTP request to the image provider
    PROVIDER_REQUEST_RETRIES: int = 2              # tries per attempt when the provider hangs or has a transient error
    # Optional second provider tried when the main one is unavailable (e.g. "huggingface"); empty = none
    IMAGE_EDIT_FALLBACK_PROVIDER: str = ""
    GENERATION_MAX_ATTEMPTS: int = 2
    # Send the catalogue reference photo as a second image. Enable only after every style has a
    # curated reference photo that really shows that style (the current Unsplash URLs do not).
    USE_STYLE_REFERENCE_IMAGE: bool = False
    AI_INPUT_MAX_SIDE: int = 1024

    # Computer-vision models (MediaPipe face landmarks + hair segmentation, OpenCV SFace face recognition)
    AI_MODELS_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "ai_models")
    # SFace cosine similarity; 0.35 protects customer facial identity while allowing valid hair edits
    IDENTITY_MIN_SIMILARITY: float = 0.35
    # Beard looks change the lower face (part of what SFace sees), so they use a slightly looser threshold
    BEARD_IDENTITY_MIN_SIMILARITY: float = 0.32
    # Smallest face (px, on the uploaded photo) a preview is made from; matches the upload check
    GENERATION_MIN_FACE_PX: int = 120
    # Minimum hair length in cm required for chemical smoothing, perm, texture services
    TEXTURE_MIN_LENGTH_CM: float = 5.0

    # Max CIE76 colour difference between original and edited hair before the edit is rejected
    HAIR_COLOUR_MAX_DELTA_E: float = 18.0

    # CORS: the app is normally served same-origin (Vite proxy / Nginx); list extra origins here if needed
    BACKEND_CORS_ORIGINS: list[str] = ["http://localhost:5173", "https://localhost:5173"]

    model_config = SettingsConfigDict(case_sensitive=True, env_file=".env", extra="ignore")


DEFAULT_SECRET_KEY = "super-secret-key-change-in-production-salon-ai-2026"
TEST_ONLY_PROVIDERS = {"huggingface"}  # sends customer photos to a public third-party Space


def check_settings(s: "Settings") -> list[str]:
    """Problems that make the configuration unsafe or inconsistent. In production these stop the app."""
    problems = []
    if s.PROVIDER_REQUEST_TIMEOUT_SECONDS * s.PROVIDER_REQUEST_RETRIES >= s.GENERATION_TIMEOUT_SECONDS:
        problems.append("PROVIDER_REQUEST_TIMEOUT_SECONDS x PROVIDER_REQUEST_RETRIES must be below "
                        "GENERATION_TIMEOUT_SECONDS, or the provider's last try is cut off.")
    if s.is_production:
        if s.SECRET_KEY == DEFAULT_SECRET_KEY or len(s.SECRET_KEY) < 32:
            problems.append("Set a random SECRET_KEY of at least 32 characters.")
        if "*" in s.BACKEND_CORS_ORIGINS:
            problems.append("BACKEND_CORS_ORIGINS must list the real origins, not '*'.")
        for name in (s.IMAGE_EDIT_PROVIDER, s.IMAGE_EDIT_FALLBACK_PROVIDER):
            if name.strip().lower() in TEST_ONLY_PROVIDERS:
                problems.append(f"Image provider '{name}' is for testing only and must not get real customer photos.")
    return problems


settings = Settings()
