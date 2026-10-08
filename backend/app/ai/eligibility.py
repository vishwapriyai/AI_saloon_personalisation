from typing import Dict, Any, Optional
from app.core.config import settings

def compute_eligible_services(analysis: Dict[str, Any], gender: str = "Women") -> Dict[str, Any]:
    """
    Server-side single source of truth for service eligibility.
    Enforces rules for Bald, Buzz Cut, Stubble, Clean-shaven, and minimum hair length threshold.
    """
    g = (gender or "Women").strip().capitalize()
    is_women = g in ["Women", "Female"]

    hair_length = str(analysis.get("hair_length") or "Medium").strip()
    hair_density = str(analysis.get("hair_density") or "Medium").strip()
    beard_length_class = str(analysis.get("beard_length_class") or "Clean-shaven").strip()
    beard_zones = analysis.get("beard_zones") or {}

    # Check overall beard density coverage from zones
    total_coverage = 0.0
    if beard_zones:
        coverages = [z.get("coverage", 0.0) for z in beard_zones.values() if isinstance(z, dict)]
        if coverages:
            total_coverage = sum(coverages) / len(coverages)

    # Initialize results dictionary
    res: Dict[str, Any] = {
        "HAIR_CUT": {
            "eligible": True,
            "reason": "Eligible for haircut styling.",
            "requires_override": False,
            "lock_code": None
        },
        "BEARD_STYLING": {
            "eligible": True,
            "reason": "Eligible for beard grooming & styling.",
            "requires_override": False,
            "lock_code": None
        },
        "BEARD_SHAVING": {
            "eligible": True,
            "reason": "Eligible for shaving services.",
            "requires_override": False,
            "lock_code": None
        },
        "COLOUR_BALAYAGE": {
            "eligible": True,
            "reason": "Eligible for hair colouring & highlights.",
            "requires_override": False,
            "lock_code": None
        },
        "TEXTURE_SMOOTHENING": {
            "eligible": True,
            "reason": "Eligible for chemical smoothening and texturizing.",
            "requires_override": False,
            "lock_code": None
        }
    }

    # 1. Women's collection rules
    if is_women:
        res["BEARD_STYLING"] = {
            "eligible": False,
            "reason": "Beard services are not applicable for Women's collection.",
            "requires_override": False,
            "lock_code": "WOMEN_NO_BEARD"
        }
        res["BEARD_SHAVING"] = {
            "eligible": False,
            "reason": "Beard services are not applicable for Women's collection.",
            "requires_override": False,
            "lock_code": "WOMEN_NO_BEARD"
        }

    # 2. Haircut & Chemical service rules based on hair length
    hair_length_lower = hair_length.lower()
    if hair_length_lower in ["bald", "very short / bald"]:
        res["HAIR_CUT"] = {
            "eligible": False,
            "reason": "Bald head detected; haircut styling is locked.",
            "requires_override": True,
            "lock_code": "BALD_NO_HAIRCUT"
        }
        res["COLOUR_BALAYAGE"] = {
            "eligible": False,
            "reason": "Hair colouring requires visible hair density.",
            "requires_override": True,
            "lock_code": "BALD_NO_COLOUR"
        }
        res["TEXTURE_SMOOTHENING"] = {
            "eligible": False,
            "reason": f"Chemical smoothening requires minimum {settings.TEXTURE_MIN_LENGTH_CM} cm hair length.",
            "requires_override": False,
            "lock_code": "HAIR_TOO_SHORT"
        }
    elif hair_length_lower in ["buzz cut", "buzzcut", "pixie", "short"]:
        # If buzz cut or short hair below 5.0 cm, check chemical smoothening eligibility
        if hair_length_lower in ["buzz cut", "buzzcut"]:
            res["TEXTURE_SMOOTHENING"] = {
                "eligible": False,
                "reason": f"Chemical smoothening requires hair length >= {settings.TEXTURE_MIN_LENGTH_CM} cm.",
                "requires_override": False,
                "lock_code": "HAIR_TOO_SHORT"
            }
            res["HAIR_CUT"] = {
                "eligible": True,
                "reason": "Buzz cut maintenance & edge trim available.",
                "requires_override": False,
                "lock_code": "BUZZ_CUT_MAINTENANCE"
            }

    # 3. Beard service rules (if not Women)
    if not is_women:
        if beard_length_class == "Clean-shaven" or total_coverage < 0.05:
            res["BEARD_STYLING"] = {
                "eligible": False,
                "reason": "Clean-shaven detected; beard styling is locked.",
                "requires_override": True,
                "lock_code": "CLEAN_SHAVEN_NO_BEARD_STYLING"
            }
            res["BEARD_SHAVING"] = {
                "eligible": False,
                "reason": "Customer is already clean-shaven.",
                "requires_override": True,
                "lock_code": "CLEAN_SHAVEN_ALREADY"
            }
        elif beard_length_class == "Stubble (1-3mm)":
            res["BEARD_STYLING"] = {
                "eligible": True,
                "reason": "Stubble (1-3mm) detected. Please confirm if you wish to proceed with beard styling.",
                "requires_override": True,
                "lock_code": "STUBBLE_CONFIRMATION_REQUIRED"
            }

    return res
