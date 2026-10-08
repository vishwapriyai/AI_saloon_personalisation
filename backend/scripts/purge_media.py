"""
Retention job for customer photos (run daily, e.g. Windows Task Scheduler or cron):

    cd backend
    python scripts/purge_media.py

  - Photo sessions of customers who did not consent to keeping their history are erased after
    MEDIA_RETENTION_DAYS_WITHOUT_CONSENT days (photos, AI previews and face measurements).
  - AI preview cache files older than AI_CACHE_MAX_DAYS are removed.
Visits and bills are never deleted.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.database import SessionLocal  # noqa: E402
from app.core.privacy import purge_expired_media  # noqa: E402

if __name__ == "__main__":
    with SessionLocal() as db:
        result = purge_expired_media(db)
    print(f"Erased {result['photo_sessions_erased']} photo sessions, removed {result['cache_files_removed']} cache files.")
