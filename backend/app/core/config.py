import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "Salon AI & Customer Analytics Platform"
    SALON_NAME: str = "LUXE Styling"
    REFERRAL_DISCOUNT_PERCENT: int = 15
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = "super-secret-key-change-in-production-salon-ai-2026"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

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
    GEMINI_API_KEY_2: str = ""
    GEMINI_API_KEY_3: str = ""
    GEMINI_API_KEY_4: str = ""

    def get_gemini_api_keys(self) -> list[str]:
        keys = [
            os.getenv("GEMINI_API_KEY", self.GEMINI_API_KEY),
            os.getenv("GEMINI_API_KEY_2", self.GEMINI_API_KEY_2),
            os.getenv("GEMINI_API_KEY_3", self.GEMINI_API_KEY_3),
            os.getenv("GEMINI_API_KEY_4", self.GEMINI_API_KEY_4),
        ]
        return [k.strip() for k in keys if k and k.strip()]

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
    # Free shared GPUs can take 1-2 minutes per image when busy, so allow slow answers before retrying
    GENERATION_TIMEOUT_SECONDS: int = 330          # whole edit attempt, including provider retries
    PROVIDER_REQUEST_TIMEOUT_SECONDS: int = 150    # one HTTP request to the image provider
    PROVIDER_REQUEST_RETRIES: int = 2              # retries when the provider hangs or has a transient error
    # Optional second provider tried when the main one is unavailable (e.g. "huggingface"); empty = none
    IMAGE_EDIT_FALLBACK_PROVIDER: str = ""
    GENERATION_MAX_ATTEMPTS: int = 2
    # Send the catalogue reference photo as a second image. Enable only after every style has a
    # curated reference photo that really shows that style (the current Unsplash URLs do not).
    USE_STYLE_REFERENCE_IMAGE: bool = False
    AI_INPUT_MAX_SIDE: int = 1024

    # Computer-vision models (MediaPipe face landmarks + hair segmentation, OpenCV SFace face recognition)
    AI_MODELS_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "ai_models")
    # SFace cosine similarity; 0.363 is the model authors' same-person threshold
    IDENTITY_MIN_SIMILARITY: float = 0.363
    # Max CIE76 colour difference between original and edited hair before the edit is rejected
    HAIR_COLOUR_MAX_DELTA_E: float = 18.0

    # CORS
    BACKEND_CORS_ORIGINS: list[str] = ["*"]

    model_config = SettingsConfigDict(case_sensitive=True, env_file=".env", extra="ignore")

settings = Settings()
