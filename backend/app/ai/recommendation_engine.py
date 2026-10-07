from typing import List, Dict, Any, Optional
from app.ai.style_catalogue import ALL_STYLES, SERVICE_ALIASES
from app.core.config import settings

EXPERT_FACE_SHAPE_RULES = {
    "female": {
        "Oval": "Oval faces have ideal proportional balance. Long interior layers, French bobs, and curtain bangs add natural movement without distorting symmetry.",
        "Round": "Round faces benefit from vertical layering, deep side parts, and lobs that add height to visually slim the cheeks.",
        "Square": "Square faces feature a prominent jawline. Soft face-framing waves, curtain bangs, and feathered U-cuts soften sharp angular jawlines.",
        "Heart": "Heart faces have wider foreheads and pointed chins. Chin-length bobs and side-swept bangs add volume around the lower jawline.",
        "Diamond": "Diamond faces feature high, wide cheekbones. Textured bobs and side fringe soften cheek width while filling in narrow foreheads.",
        "Rectangle": "Oblong/Rectangle faces benefit from curtain bangs and side volume curls to create horizontal balance and shorten vertical length."
    },
    "male": {
        "Square": "Square jawlines thrive with structured fades (mid/low taper) and textured tops to highlight strong masculine jaw angles.",
        "Oval": "Oval symmetry supports versatile cuts like quiffs, side parts, slicked back undercuts, and balanced fade transitions.",
        "Round": "Round faces need high skin fades with vertical top volume (quiffs/pompadours) to add height and slim down full cheeks.",
        "Diamond": "Diamond cheekbones require textured crops or scissor-cut medium layers; low tapers avoid accentuating cheek width.",
        "Heart": "Heart shapes with narrow chins pair best with soft layered fringes, low tapers, and a dense beard to build lower jaw width.",
        "Rectangle": "Oblong faces should avoid extreme top height. Classic side parts and low tapers with forward fringes add side proportion."
    }
}

# Customer hair texture -> leading digit of the catalogue's 1A-4C hair type codes
TEXTURE_FAMILY = {"straight": "1", "wavy": "2", "curly": "3", "coily": "4"}

# Rough length ranks for comparing the customer's current hair with a style's finished length
LENGTH_RANK = {"bald": 0, "sparse": 0, "none": 0, "very short": 1, "short": 2, "bob": 2.5, "lob": 3, "medium": 3, "long": 4, "very long": 5}

# The face analyzer reports "Oblong"; the expert rules and catalogue use "Rectangle"
FACE_SHAPE_ALIASES = {"Oblong": "Rectangle"}


def parse_services(target_service_type: str, gender: str) -> List[str]:
    """Services picked in the app ("Hair, Beard", "Colour / Balayage", ...) as catalogue service names, in order.
    Beard is a men's service; the Women's collection never gets beard looks."""
    services: List[str] = []
    for raw in (target_service_type or "").split(","):
        service = SERVICE_ALIASES.get(raw.strip().lower())
        if service and service not in services:
            services.append(service)
    if (gender or "").lower() in ("women", "female"):
        services = [s for s in services if s != "Beard"]
    return services or ["Hair"]


class HairstyleRecommendationEngine:
    """
    Recommends looks for the services the customer picked (haircut, beard, colour, smoothening/perm).
    Within each service, styles are scored on collection, face shape, hair density and texture, category
    and feasibility; the chosen category fills the slots first. The slots are shared across the picked
    services (e.g. Hair + Beard -> 2 haircuts + 2 beard styles).
    """

    def _score(self, style: Dict[str, Any], *, face_shape: str, hair_length: str, hair_density: str,
               hair_type: Optional[str], beard_style: Optional[str], user_gender: str,
               style_category: str, expert_rules: Dict[str, str]) -> Dict[str, Any]:
        service = style.get("service", "Hair")
        score = 0.0
        style_gender = style.get("gender", "Unisex").lower()

        # 1. Collection (the customer's choice, never inferred)
        if user_gender in ["female", "women"]:
            score += 50.0 if style_gender == "female" else (30.0 if style_gender == "unisex" else -100.0)
        elif user_gender in ["male", "men"]:
            score += 50.0 if style_gender == "male" else (30.0 if style_gender == "unisex" else -100.0)
        else:
            score += 20.0  # All / Gender-Neutral mode

        # 2. Face shape
        supported_shapes = style.get("face_shapes", [])
        face_shape_matched = face_shape in supported_shapes
        if face_shape_matched:
            score += 35.0
        elif "Oval" in supported_shapes:
            score += 15.0  # versatile style
        if face_shape == "Unknown":
            face_rationale = "Face shape could not be measured reliably from this photo; versatile style for most face shapes."
        elif service in ("Colour", "Texture"):
            face_rationale = "Colour and texture services keep your current cut, so they suit your face shape as it is."
        else:
            face_rationale = expert_rules.get(face_shape, f"{style['name']} complements your {face_shape} face shape with balanced geometry.")

        # 3. Hair density and texture (haircuts only; colour/texture services keep the cut)
        density_rationale = (
            "Hair density to be confirmed by the stylist during consultation."
            if hair_density == "Unknown" else
            f"Optimized for {hair_density} hair density; maintains natural shape without unwanted bulk or flatness."
        )
        if service == "Hair":
            if hair_density in style.get("recommended_hair_densities", ["Medium"]):
                score += 25.0
            texture_family = TEXTURE_FAMILY.get((hair_type or "").lower())
            style_families = {code[:1] for code in style.get("hair_types", [])}
            if texture_family and style_families:
                score += 15.0 if texture_family in style_families else -40.0

        # 4. Category
        if style.get("category", "").lower() == (style_category or "").lower():
            score += 20.0

        # 5. Feasibility
        feasibility_status, feasibility_warning, feasibility_score = "Achievable Today", None, 100.0
        if service == "Hair":
            target_length = style.get("hair_length", "Medium").lower()
            current_length = (hair_length or "").lower()
            curr_density = (hair_density or "").lower()

            # Bald or extremely sparse hair density handling
            is_bald = current_length in ("bald", "sparse", "none") or "bald" in curr_density or "sparse" in curr_density
            if is_bald:
                # If current head is bald and style is NOT bald-friendly (e.g. requires medium/long/quiff hair on top)
                if target_length != "bald" and not style.get("is_hair_replacement_unit"):
                    score -= 800.0
                    feasibility_score = 0.0
                    feasibility_status = "Not Feasible (Current Hair Density: Bald / Sparse)"
                    feasibility_warning = ("Based on the uploaded photo, current hair density is Bald / Sparse. "
                                           "This hairstyle requires natural hair growth or a hair replacement toupee unit.")
            elif current_length in LENGTH_RANK and target_length in LENGTH_RANK \
                    and LENGTH_RANK[target_length] > LENGTH_RANK[current_length]:
                score -= 60.0
                feasibility_score = 60.0
                feasibility_status = "Needs Extensions / Growth"
                feasibility_warning = ("Based on your current hair length, this style needs more length than you have "
                                       "today (growth or extensions). We recommend a shorter alternative.")
            # Fine (low-density) hair cannot hold styles that rely on thick hair for their shape on top
            elif hair_density == "Fine" and "Fine" not in style.get("recommended_hair_densities", ["Medium"]):
                score -= 45.0
                feasibility_score = 55.0
                feasibility_status = "Not Suitable for Current Density"
                feasibility_warning = ("Based on the current hair density, this hairstyle may not hold its shape on the "
                                       "top area. We recommend a shorter, lighter alternative.")
        elif service == "Beard":
            # A beard style needs an existing beard; a clean-shaven customer can always have a clean shave
            if style.get("requires_beard", True) and (beard_style or "") == "Clean Shaven":
                score -= 60.0
                feasibility_score = 60.0
                feasibility_status = "Needs Beard Growth"
                feasibility_warning = "Needs a few weeks of beard growth first. We recommend a clean shave or stubble style today."

        chemical_addon = None
        if style.get("requires_chemical_service"):
            chemical_name = style.get("chemical_service_name", "Chemical Texture / Color Service")
            chemical_addon = {
                "required": True,
                "service_name": chemical_name,
                "est_price_addon": 1800.0,
                "est_duration_minutes": 45,
                "chemical_formula": style.get("chemical_formula_instructions", "Standard salon chemical processing formula"),
            }
            feasibility_status = f"Requires Chemical Service ({chemical_name})"

        style_copy = dict(style)
        style_copy.update({
            "feasibility_score": feasibility_score,
            "feasibility_status": feasibility_status,
            "feasibility_warning": feasibility_warning,
            # Achievable with the customer's current hair today; previews are only created for feasible looks
            "feasible": feasibility_score >= 100.0,
            "chemical_addon": chemical_addon,
            "expert_analysis": {
                "face_shape": face_shape,
                "face_shape_matched": face_shape_matched,
                "face_shape_rationale": face_rationale,
                "density_suitability": density_rationale,
                "stylist_tips": style.get("stylist_instructions", ""),
            },
        })
        return {"style": style_copy, "score": score}

    @staticmethod
    def _in_collection(style: Dict[str, Any], user_gender: str) -> bool:
        """Women's collection: Female + Unisex styles; Men's: Male + Unisex; All: everything."""
        style_gender = style.get("gender", "Unisex").lower()
        if user_gender in ("women", "female"):
            return style_gender != "male"
        if user_gender in ("men", "male"):
            return style_gender != "female"
        return True

    def recommend(
        self,
        face_shape: str,
        hair_length: str,
        hair_density: str,
        hair_type: Optional[str] = None,
        gender: str = "Women",
        target_service_type: str = "Hair",
        style_category: str = "Trendy",
        beard_style: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        face_shape = FACE_SHAPE_ALIASES.get(face_shape, face_shape)
        user_gender = (gender or "Women").lower()
        gender_key = "male" if user_gender in ["male", "men"] else "female"
        expert_rules = EXPERT_FACE_SHAPE_RULES.get(gender_key, EXPERT_FACE_SHAPE_RULES["female"])
        services = parse_services(target_service_type, gender)
        wanted = (style_category or "").lower()

        # Rank each picked service's styles: chosen category first, best score first, other collection dropped
        ranked: Dict[str, List[Dict[str, Any]]] = {}
        for service in services:
            scored = [
                self._score(style, face_shape=face_shape, hair_length=hair_length, hair_density=hair_density,
                            hair_type=hair_type, beard_style=beard_style, user_gender=user_gender,
                            style_category=style_category, expert_rules=expert_rules)
                for style in ALL_STYLES
                if style.get("service", "Hair") == service and self._in_collection(style, user_gender)
            ]
            scored.sort(key=lambda x: x["score"], reverse=True)
            usable = [x["style"] for x in scored if x["score"] > -100.0]
            in_category = [s for s in usable if s.get("category", "").lower() == wanted]
            ranked[service] = in_category + [s for s in usable if s.get("category", "").lower() != wanted]

        # Share the slots across the picked services, one at a time in the order picked
        count = settings.STYLE_RECOMMENDATION_COUNT
        result: List[Dict[str, Any]] = []
        positions = {service: 0 for service in services}
        while len(result) < count and any(positions[s] < len(ranked[s]) for s in services):
            for service in services:
                if len(result) >= count:
                    break
                if positions[service] < len(ranked[service]):
                    result.append(ranked[service][positions[service]])
                    positions[service] += 1
        # A look that is not achievable today names the best achievable look of the same service instead
        for style in result:
            if not style.get("feasible", True):
                service = style.get("service", "Hair")
                alt = next((s for s in ranked.get(service, []) if s.get("feasible", True) and s["id"] != style["id"]), None)
                style["suggested_alternative"] = {"id": alt["id"], "name": alt["name"]} if alt else None
        return result


recommendation_engine = HairstyleRecommendationEngine()



