import os
import uuid
from typing import Tuple
from app.core.config import settings

class StorageService:
    def __init__(self):
        self.base_dir = os.path.abspath(settings.STORAGE_LOCAL_DIR)
        os.makedirs(self.base_dir, exist_ok=True)
        os.makedirs(os.path.join(self.base_dir, "original"), exist_ok=True)
        os.makedirs(os.path.join(self.base_dir, "generated"), exist_ok=True)
        os.makedirs(os.path.join(self.base_dir, "reference"), exist_ok=True)
        os.makedirs(os.path.join(self.base_dir, "final"), exist_ok=True)

    def save_bytes(self, content: bytes, folder: str = "original", filename_prefix: str = "img") -> Tuple[str, str]:

        ext = "jpg"
        file_id = f"{filename_prefix}_{uuid.uuid4().hex[:10]}.{ext}"
        folder_path = os.path.join(self.base_dir, folder)
        os.makedirs(folder_path, exist_ok=True)
        file_path = os.path.join(folder_path, file_id)

        with open(file_path, "wb") as f:
            f.write(content)

        relative_url = f"/static/media/{folder}/{file_id}"
        return file_id, relative_url

    def get_signed_url(self, file_key: str, expires_in_seconds: int = 3600) -> str:
        # Returns a secure signed image URL for private customer images
        return f"/api/v1/media/secure-access?key={file_key}&expires={expires_in_seconds}"

storage_service = StorageService()
