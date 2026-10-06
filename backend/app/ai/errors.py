from typing import Optional


class ImageEditError(Exception):
    """A hairstyle preview could not be produced. Never replaced by a generic or catalogue image."""

    def __init__(self, reason: str, attempts: int = 0, identity_score: Optional[float] = None,
                 hair_consistency_score: Optional[float] = None, model: Optional[str] = None):
        super().__init__(reason)
        self.reason = reason
        self.attempts = attempts
        self.identity_score = identity_score
        self.hair_consistency_score = hair_consistency_score
        self.model = model
