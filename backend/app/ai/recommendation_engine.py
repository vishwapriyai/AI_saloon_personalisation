import re
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
LENGTH_RANK = {"bald": 0, "sparse": 0, "none": 0, "buzz": 1, "very short": 1, "short": 2, "bob": 2.5, "lob": 3,
               "medium": 3, "long": 4, "very long": 5}

# Trim preference ("how much to take off the ends") -> how many length classes shorter a style may be.
# Applies to customers with long hair, who choose between keeping their length and a real change.
TRIM_KEEP_MAX_CM = 7.0         # up to this much off keeps the same length class (long stays long)
TRIM_ONE_CLASS_MAX_CM = 15.0   # up to this much off may go one class shorter (long -> lob / medium)
LONG_HAIR = ("long", "very long")
CATALOGUE_MAX_LENGTH_RANK = 4  # LENGTH_RANK["long"]


def parse_trim_cm(trim_preference: Optional[str]) -> Optional[float]:
    """
    Centimetres to take off, from the app's trim choice ("0 - 1 cm micro-trim", "2cm", "5cm", "15 mm", "keep", "0cm", "original").
    None when no preference was given. A range counts as its upper end.
    """
    text = (trim_preference or "").strip().lower()
    if not text:
        return None
    if "keep" in text or "micro" in text or "original" in text:
        return 1.0
    numbers = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", text)]
    if not numbers:
        return None
    cm = max(numbers)
    cm = cm / 10.0 if "mm" in text and "cm" not in text else cm
    # "0cm" means keep the length (a micro-trim). Decimals such as "5.0 cm" are read as written.
    return cm if cm > 0 else 1.0


def allowed_length_drop(trim_cm: Optional[float]) -> Optional[float]:
    """Length classes a long-haired customer's chosen trim allows the look to drop; None = no limit."""
    if trim_cm is None:
        return None
    if trim_cm <= TRIM_KEEP_MAX_CM:
        return 0.0
    if trim_cm <= TRIM_ONE_CLASS_MAX_CM:
        return 1.0
    return None


def length_drop(current_length: Optional[str], style: Dict[str, Any]) -> Optional[float]:
    """How many length classes shorter the style is than the current hair (None when either is unknown)."""
    cur = LENGTH_RANK.get((current_length or "").strip().lower())
    target = LENGTH_RANK.get(str(style.get("hair_length", "")).strip().lower())
    if cur is None or target is None:
        return None
    # "Long" is the longest finished length in the catalogue: for very long hair a long cut keeps the length
    # (the trim decides how much comes off), so it is not counted as one class shorter
    return min(cur, CATALOGUE_MAX_LENGTH_RANK) - target


def trim_allows(style: Dict[str, Any], hair_length: Optional[str], trim_preference: Optional[str]) -> bool:
    """False when a customer's trim choice rules this haircut out (e.g. "keep length" vs a bob or medium cut)."""
    if style.get("service", "Hair") != "Hair" or (hair_length or "").strip().lower() not in LONG_HAIR:
        return True
    allowed = allowed_length_drop(parse_trim_cm(trim_preference))
    drop = length_drop(hair_length, style)
    return allowed is None or drop is None or drop <= allowed

# The face analyzer reports "Oblong"; the expert rules and catalogue use "Rectangle"
FACE_SHAPE_ALIASES = {"Oblong": "Rectangle"}


HAIR_SERVICES = ("Hair", "Colour", "Texture")


def is_bald(hair_length: Optional[str], hair_density: Optional[str]) -> bool:
    length = (hair_length or "").strip().lower()
    density = (hair_density or "").strip().lower()
    # "Buzz" (stubble-length scalp hair) is not bald: haircuts and colour stay available
    return length in ("bald", "sparse", "none") or "bald" in density or "sparse" in density


def parse_services(target_service_type: str, gender: str, bald: bool = False) -> List[str]:
    """
    Services picked in the app ("Hair, Beard", "Colour / Balayage", ...) as catalogue service names, in order.
    Enforced here as well as in the app: Beard is a men's service, and a bald scalp gets no hair services.
    Returns [] when none of the picked services is possible (the caller explains why).
    """
    services: List[str] = []
    for raw in (target_service_type or "").split(","):
        service = SERVICE_ALIASES.get(raw.strip().lower())
        if service and service not in services:
            services.append(service)
    if not services:
        services = ["Hair"]
    if (gender or "").lower() in ("women", "female"):
        services = [s for s in services if s != "Beard"]
    if bald:
        services = [s for s in services if s not in HAIR_SERVICES]
    return services


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

        # 4. Category: not scored. recommend() lists the chosen category first; adding points as well would
        #    count it twice and let a poor-fit style in the category outrank a perfect fit elsewhere.

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
                    feasibility_status = "Not Applicable (Bald / Clean Shaved Scalp)"
                    feasibility_warning = ("We don't have hair-based haircut service for you because your photo analysis shows a bald / clean shaved scalp. "
                                           "Please choose Beard & Grooming or Scalp Care service instead, as haircut services are only for customers with hair.")
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
LENGTH_CLASS_LEVELS = {
    "clean-shaven": 0,
    "stubble (1-3mm)": 1,
    "short (3-10mm)": 2,
    "medium (10-25mm)": 3,
    "full (>25mm)": 4,
}

def _parse_length_level(val: Optional[str]) -> int:
    if not val:
        return 0
    s = val.lower().strip()
    if "full" in s:
        return 4
    if "medium" in s:
        return 3
    if "short" in s:
        return 2
    if "stubble" in s:
        return 1
    if "clean" in s:
        return 0
    return LENGTH_CLASS_LEVELS.get(s, 0)

def beard_fit(style: Dict[str, Any], growth_map: Dict[str, Any]) -> Dict[str, Any]:
    """
    Evaluates whether a beard catalogue style is achievable today given the customer's beard growth map.
    Returns dict with 'status' (ACHIEVABLE_TODAY, PARTIAL, NEEDS_GROWTH), 'warning', and 'missing_zones'.
    """
    min_len = (style.get("min_length") or "Clean-shaven").strip()
    if min_len.lower() == "clean-shaven" or style.get("id") == 105:
        return {"status": "ACHIEVABLE_TODAY", "warning": None, "missing_zones": []}

    req_zones = style.get("required_zones") or []
    beard_zones = growth_map.get("beard_zones") or {}
    curr_len_class = (growth_map.get("beard_length_class") or "Clean-shaven").strip()

    missing_zones = []
    if beard_zones:
        for zone in req_zones:
            z_info = beard_zones.get(zone) or {}
            cov = z_info.get("coverage", 0.0)
            if cov < 0.25:
                missing_zones.append(zone)

    curr_level = _parse_length_level(curr_len_class)
    req_level = _parse_length_level(min_len)

    if missing_zones:
        zones_str = ", ".join(missing_zones)
        return {
            "status": "NEEDS_GROWTH",
            "warning": f"This style requires beard growth in the following areas: {zones_str}.",
            "missing_zones": missing_zones,
        }

    if curr_level < req_level:
        gap = req_level - curr_level
        if gap == 1:
            return {
                "status": "PARTIAL",
                "warning": f"Current growth is slightly short for this style (requires {min_len}). A trim or stubble line-up is available today.",
                "missing_zones": [],
            }
        return {
            "status": "NEEDS_GROWTH",
            "warning": f"Current beard length is too short for this style (requires {min_len}).",
            "missing_zones": [],
        }

    return {"status": "ACHIEVABLE_TODAY", "warning": None, "missing_zones": []}


class HairstyleRecommendationEngine:
    """
    Recommends looks for the services the customer picked (haircut, beard, colour, smoothening/perm).
    Within each service, styles are scored on collection, face shape, hair density and texture, category
    and feasibility; the chosen category fills the slots first. The slots are shared across the picked
    services (e.g. Hair + Beard -> 2 haircuts + 2 beard styles).
    """

    def _score(self, style: Dict[str, Any], *, face_shape: str, hair_length: str, hair_density: str,
               hair_type: Optional[str], beard_style: Optional[str], user_gender: str,
               style_category: str, expert_rules: Dict[str, str],
               growth_map: Optional[Dict[str, Any]] = None,
               trim_preference: Optional[str] = None) -> Dict[str, Any]:
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
            # Trim preference (long hair): looks the trim rules out are filtered before scoring; among the
            # rest, a bigger trim favours the shorter looks it allows, "keep length" favours keeping the length
            if (hair_length or "").strip().lower() in LONG_HAIR:
                allowed = allowed_length_drop(parse_trim_cm(trim_preference))
                drop = length_drop(hair_length, style)
                if drop is not None:
                    if allowed is not None:
                        score += 40.0 if drop == allowed else (20.0 if 0 <= drop < allowed else 0.0)
                    elif drop >= 1:
                        score += 100.0 if drop >= 1.5 else 40.0

        # 4. Feasibility
        feasibility_status, feasibility_warning, feasibility_score = "Achievable Today", None, 100.0
        if service == "Hair":
            target_length = style.get("hair_length", "Medium").lower()
            current_length = (hair_length or "").lower()
            curr_density = (hair_density or "").lower()

            # Bald or extremely sparse hair density handling
            is_bald = current_length in ("bald", "sparse", "none") or "bald" in curr_density or "sparse" in curr_density
            if is_bald:
                if target_length != "bald" and not style.get("is_hair_replacement_unit"):
                    score -= 800.0
                    feasibility_score = 0.0
                    feasibility_status = "Not Applicable (Bald / Clean Shaved Scalp)"
                    feasibility_warning = ("We don't have hair-based haircut service for you because your photo analysis shows a bald / clean shaved scalp. "
                                           "Please choose Beard & Grooming or Scalp Care service instead, as haircut services are only for customers with hair.")
            elif target_length == "bald":
                score -= 800.0
                feasibility_score = 0.0
                feasibility_status = "Not Recommended (Customer Has Full Hair)"
                feasibility_warning = "Clean shaved scalp is only for customers with bald scalps or requesting a full head shave."
            elif current_length in LENGTH_RANK and target_length in LENGTH_RANK \
                    and LENGTH_RANK[target_length] > LENGTH_RANK[current_length]:
                score -= 60.0
                feasibility_score = 60.0
                feasibility_status = "Needs Extensions / Growth"
                feasibility_warning = ("Based on your current hair length, this style needs more length than you have "
                                       "today (growth or extensions). We recommend a shorter alternative.")
            elif hair_density == "Fine" and "Fine" not in style.get("recommended_hair_densities", ["Medium"]):
                score -= 45.0
                feasibility_score = 55.0
                feasibility_status = "Not Suitable for Current Density"
                feasibility_warning = ("Based on the current hair density, this hairstyle may not hold its shape on the "
                                       "top area. We recommend a shorter, lighter alternative.")
        elif service == "Beard":
            g_map = growth_map or {
                "beard_length_class": beard_style or "Clean-shaven",
                "beard_zones": {}
            }
            fit_res = beard_fit(style, g_map)
            fit_status = fit_res["status"]
            if fit_status == "NEEDS_GROWTH":
                score -= 300.0
                feasibility_score = 40.0
                feasibility_status = "Needs Beard Growth"
                feasibility_warning = fit_res["warning"]
            elif fit_status == "PARTIAL":
                score -= 50.0
                feasibility_score = 70.0
                feasibility_status = "Partial Fit / Trim Available"
                feasibility_warning = fit_res["warning"]
            else:
                feasibility_status = "Achievable Today"
                feasibility_warning = None

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

    @staticmethod
    def _texture_matches(styles: List[Dict[str, Any]], hair_type: Optional[str]) -> List[Dict[str, Any]]:
        """
        Haircuts made for the customer's texture, when there are enough of them to fill the page. A haircut keeps
        the texture: offering a sleek blow-dried look to curly hair (or a curly shag to straight hair) shows a
        result the cut cannot give, and the edit model changes the hair's structure to match the description.
        Styles without texture tags count as matching.
        """
        family = TEXTURE_FAMILY.get((hair_type or "").strip().lower())
        if not family:
            return styles
        matching = [s for s in styles if not s.get("hair_types") or family in {c[:1] for c in s["hair_types"]}]
        return matching if len(matching) >= settings.STYLE_RECOMMENDATION_COUNT else styles

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
        growth_map: Optional[Dict[str, Any]] = None,
        trim_preference: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        face_shape = FACE_SHAPE_ALIASES.get(face_shape, face_shape)
        user_gender = (gender or "Women").lower()
        gender_key = "male" if user_gender in ["male", "men"] else "female"
        expert_rules = EXPERT_FACE_SHAPE_RULES.get(gender_key, EXPERT_FACE_SHAPE_RULES["female"])
        services = parse_services(target_service_type, gender, bald=is_bald(hair_length, hair_density))
        wanted = (style_category or "").lower()

        # Rank each picked service's styles: chosen category first, best score first, other collection dropped
        ranked: Dict[str, List[Dict[str, Any]]] = {}
        for service in services:
            # Eligibility before scoring: the right service and collection, no braided updos (they are styling,
            # not haircuts, and are not offered), and nothing the customer's trim choice rules out. If the trim
            # leaves no look at all, it is not applied rather than showing an empty page.
            candidates = [style for style in ALL_STYLES
                          if style.get("service", "Hair") == service and self._in_collection(style, user_gender)
                          and not style.get("is_braid_styling")]
            trimmed = [style for style in candidates if trim_allows(style, hair_length, trim_preference)]
            if not trimmed and candidates:
                # Nothing fits the trim exactly: keep the looks closest to the customer's length rather than
                # dropping the trim choice (which used to put bobs in front of a "keep my length" customer)
                drops = {id(st): length_drop(hair_length, st) for st in candidates}
                known = [d for d in drops.values() if d is not None and d >= 0]
                if known:
                    closest = min(known)
                    trimmed = [st for st in candidates if drops[id(st)] is None or drops[id(st)] <= closest]
            pool = trimmed or candidates
            if service == "Hair":
                pool = self._texture_matches(pool, hair_type)
            scored = [
                self._score(style, face_shape=face_shape, hair_length=hair_length, hair_density=hair_density,
                            hair_type=hair_type, beard_style=beard_style, user_gender=user_gender,
                            style_category=style_category, expert_rules=expert_rules, growth_map=growth_map,
                            trim_preference=trim_preference)
                for style in pool
            ]
            scored.sort(key=lambda x: x["score"], reverse=True)
            usable = [x["style"] for x in scored if x["score"] > -100.0]
            in_category = [s for s in usable if s.get("category", "").lower() == wanted]
            trim_cm = parse_trim_cm(trim_preference)
            if trim_cm is not None and trim_cm > TRIM_ONE_CLASS_MAX_CM:
                ranked[service] = usable
            else:
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



