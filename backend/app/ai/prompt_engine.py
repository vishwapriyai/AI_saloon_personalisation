from typing import Any, Dict, Optional

from app.ai.recommendation_engine import parse_trim_cm

PROMPT_TEMPLATE_VERSION = "hair-edit-v9"

UNKNOWN = "Unknown"
# Customer lengths (measured) and catalogue finished lengths on one scale; "Any" is deliberately absent
LENGTH_ORDER = {"Bald": 0, "Buzz": 1, "Very Short": 1, "Short": 2, "Bob": 2.5, "Lob": 3, "Medium": 3,
                "Long": 4, "Very Long": 5}

# Finished length in words for the side/back prompts (what the camera sees from any angle)
TARGET_LENGTH_WORDS = {
    "Bald": "clipped very close to the scalp", "Short": "short", "Bob": "chin length",
    "Lob": "just above the shoulders", "Medium": "medium length, around the shoulders",
    "Long": "long, past the shoulders", "Very Long": "very long",
}


# "Long" is the longest finished length in the catalogue: a long cut on very long hair keeps the length
# (the trim decides how much comes off), it is not a "shorter haircut"
CATALOGUE_MAX_RANK = LENGTH_ORDER["Long"]


def _length_change(analysis: Dict[str, Any], style: Dict[str, Any]) -> Optional[str]:
    """'shorter', 'same' or 'longer' for the style's finished length vs the current hair; None if unknown."""
    cur = LENGTH_ORDER.get(str(analysis.get("hair_length") or ""))
    target = LENGTH_ORDER.get(str(style.get("hair_length") or ""))
    if cur is None or target is None:
        return None
    cur = min(cur, CATALOGUE_MAX_RANK)
    return "shorter" if target < cur else ("longer" if target > cur else "same")


def _tied_back(analysis: Dict[str, Any]) -> bool:
    """The front photo shows the hair tied back (its real length was seen on the side/back photo)."""
    return bool(analysis.get("hair_tied_back"))


def _untie_sentence(analysis: Dict[str, Any], style: Dict[str, Any]) -> str:
    """Haircuts on tied-back hair: show it let down. Full length is kept only when the cut keeps the length."""
    if _service(style) != "Hair" or not _tied_back(analysis):
        return ""
    text = "The hair is tied back in the photo: show it untied and let down in the new cut, not in a clip or ponytail."
    if _length_change(analysis, style) != "shorter":
        text += " Keep its full natural length."
    return text


def _is_female(analysis: Dict[str, Any], style: Dict[str, Any]) -> bool:
    """The customer's collection (stored with the analysis); the style's gender only as a fallback."""
    value = str(analysis.get("gender") or style.get("gender") or "").strip().lower()
    return value in ("female", "women", "woman")

TEXTURE_PHRASES = {
    "straight": "straight",
    "wavy": "wavy",
    "curly": "curly",
    "coily": "coily",
}

BLACK_CLOTHING_DISAMBIGUATION_MANDATE = (
    "BLACK CLOTHING & SCARF VS HAIR DISAMBIGUATION MANDATE: "
    "The customer may be wearing black clothing, a black dress, a black scarf, black dupatta, or black shawl draped over their shoulders or back (e.g. over a yellow top or other clothing). "
    "DO NOT MISTAKE BLACK CLOTHING, FABRIC, DUPATTA, OR SCARF FOR HAIR, AND DO NOT MISTAKE BLACK HAIR FOR CLOTHING. "
    "Strictly separate natural hair originating from the scalp from any black fabric or clothing worn on the shoulders or back. "
    "Determine and maintain the true hair length strictly from the natural hair on the head, ignoring any black fabric beneath or behind it. "
    "Preserve the customer's actual clothing and scarf exactly as clothing without blending black fabric into hair strands or vice-versa."
)

MULTI_VIEW_CONSISTENCY_MANDATE = (
    "STRICT MULTI-VIEW & HAIR LENGTH CONSISTENCY MANDATE: "
    "You are provided with customer photos from multiple angles (Front, Side, Back). "
    "The haircut length, style, volume, hair texture, hair colour, and clothing MUST BE 100% IDENTICAL and consistent across all 3 view generations (Front, Side, Back). "
    "Ensure the finished hair length in this view matches the front view generation and the true natural hair length across all photos."
)

NO_HALF_PONYTAIL_MANDATE = (
    "CRITICAL NO HALF-PONYTAIL OR HAIR TIE MANDATE: "
    "Show the hair completely let down and hanging free. "
    "DO NOT gather or tie the hair into a half-up ponytail, half-up tie, ponytail, bun, braid, hair clip, claw clip, or elastic band at the top of the head or crown. "
    "The hair in the back view MUST hang loose and let down, matching the styling of the front view preview."
)

STRICT_BACK_LENGTH_MATCHING_MANDATE = (
    "STRICT BACK VIEW LENGTH MATCHING MANDATE: "
    "The hair length in the back view MUST MATCH the front and side view preview exactly. "
    "If the front view hair ends near the collarbone or upper chest, the back view hair MUST end at upper-back / shoulder blade level, NOT waist level. "
    "DO NOT EXTEND THE HAIR DOWN TO THE WAIST OR LOWER BACK. "
    "DO NOT MISTAKE THE BLACK SCARF, DUPATTA, OR DRESS ON THE SHOULDERS FOR HAIR LENGTH."
)

# Accessories (bindi, earrings, makeup...) are deliberately NOT named: edit models tend to draw whatever the
# prompt mentions, e.g. adding a bindi to a man. Keeping the whole face unchanged preserves any that exist.
IDENTITY_BLOCK = (
    "The person in the input image MUST remain the same person. Everything except the hair must stay exactly "
    "as in the original photo: facial identity, facial structure, face proportions, eyes, eyebrows, nose, "
    "lips, jawline, skin tone, skin texture, age appearance, expression, anything already on the face or "
    "body, clothing, pose, camera angle, background and lighting. Add nothing new to the face or body."
)

IDENTITY_BLOCK_STRICT = (
    "The face must stay pixel-identical to the input photo. Only pixels belonging to the hair may change. "
    "Do not redraw, beautify, smooth, slim, age or de-age the face, do not add anything to it, and do not "
    "alter skin, clothing, body or background in any way."
)

DO_NOT_BLOCK = (
    "Do not generate a new person. Do not replace the customer's face. Do not change the skin tone. "
    "Do not change the facial features. Do not change the clothing. Do not change the background. "
    "Do not change the camera angle. Do not create a generic model."
)

REALISM_BLOCK = (
    "The new haircut must look physically realistic and achievable by a professional salon stylist. The new "
    "hair must naturally connect to the customer's existing scalp and hairline at the forehead, temples, "
    "ears and back of the head. The final image must look like the same customer after receiving the "
    "selected hairstyle. Photorealistic. Natural hair strands. Natural hairline. Natural hair volume. "
    "Natural shadows. Realistic integration between hair and forehead. Return the full photo with the same "
    "framing and aspect ratio as the input."
)


def _edit_description(style: Dict[str, Any]) -> str:
    """Literal description of the finished cut. Style names are not sent: salon names like "butterfly"
    or "U-cut" are metaphors that edit models draw literally."""
    return style.get("edit_description") or style.get("description", "")


def _service(style: Dict[str, Any]) -> str:
    """Hair (haircut), Beard, Colour or Texture."""
    if style.get("service"):
        return style["service"]
    return "Beard" if str(style.get("style_code", "")).startswith("BEARD") else "Hair"


def _has_beard(analysis: Dict[str, Any]) -> bool:
    beard = analysis.get("beard_style_current") or analysis.get("beard_style")
    return _known(beard) and beard != "Clean Shaven"


def _known(value: Optional[str]) -> bool:
    return bool(value) and value != UNKNOWN


def _texture_word(hair_type: Optional[str]) -> Optional[str]:
    """Accepts '1A'-'4C' codes or words like 'Wavy'; None when unknown."""
    if not _known(hair_type):
        return None
    value = hair_type.strip().lower()
    if value[:1] in {"1", "2", "3", "4"}:
        return {"1": "straight", "2": "wavy", "3": "curly", "4": "coily"}[value[0]]
    return next((TEXTURE_PHRASES[k] for k in TEXTURE_PHRASES if k in value), None)


class ControlledPromptEngine:
    """
    Builds the image-EDITING prompt for one catalogue style from the catalogue metadata and the
    customer's measured photo analysis. Customers never write prompt text; the recommendation
    engine decides WHICH style, and this prompt only tells the edit model HOW to apply it.
    """

    def build_prompt(
        self,
        customer_analysis: Dict[str, Any],
        style_metadata: Dict[str, Any],
        strict: bool = False,
        with_reference_image: bool = False,
        with_back_image: bool = False,
        num_extra_images: int = 0,
        max_chars: Optional[int] = None,
    ) -> str:
        cust_len = str(customer_analysis.get("hair_length", "")).lower()
        cust_den = str(customer_analysis.get("hair_density", "")).lower()
        is_cust_bald = cust_len == "bald" or "bald" in cust_den or "sparse" in cust_den
        service = _service(style_metadata)

        if is_cust_bald and service != "Beard":
            p = ("IMAGE EDIT ONLY. THE CUSTOMER IS 100% BALD. DO NOT GENERATE OR SYNTHESIZE ANY TOP HAIR OR BUZZ CUT ON THE HEAD. "
                 "Keep the scalp completely bald, smooth, and clean with natural skin texture as in the photo. Do not draw hair strands on top. "
                 "Keep the customer's exact face, beard, skin tone, clothing, and background identical.")
            return p[:max_chars] if max_chars else p

        if service == "Beard" and not _has_beard(customer_analysis) and style_metadata.get("requires_beard", True):
            p = ("IMAGE EDIT ONLY. THE CUSTOMER IS CLEAN SHAVEN WITH NO BEARD. DO NOT GENERATE OR DRAW A BEARD OR GOATEE ON A CLEAN SHAVEN FACE. "
                 "Maintain the customer's natural clean-shaven skin texture and face. Keep the top scalp, skin tone, clothing, and background identical.")
            return p[:max_chars] if max_chars else p

        prompt = self._full_prompt(customer_analysis, style_metadata, strict, with_reference_image, with_back_image, num_extra_images)
        if max_chars and len(prompt) > max_chars:
            prompt = self._compact_prompt(customer_analysis, style_metadata, strict, with_reference_image, max_chars)
        return prompt

    def _compact_prompt(self, analysis: Dict[str, Any], style: Dict[str, Any], strict: bool,
                        with_reference_image: bool, max_chars: int) -> str:
        """
        Same constraints in short form, for models with a prompt length limit (FLUX providers: 800 chars).
        Built by priority: the length rule, the untie instruction and the FULL style description always fit;
        the less important preservation sentences are added only while there is room.
        """
        service = _service(style)
        is_beard = service == "Beard"
        cust_len = str(analysis.get("hair_length", "")).lower()
        cust_den = str(analysis.get("hair_density", "")).lower()
        is_cust_bald = cust_len == "bald" or "bald" in cust_den or "sparse" in cust_den

        target = "beard and moustache" if is_beard else "hair"
        colour = analysis.get("hair_color_detected")
        texture = _texture_word(analysis.get("hair_type"))
        colour_word = colour.lower() + " " if _known(colour) else ""
        is_female = _is_female(analysis, style)
        change = _length_change(analysis, style) if service == "Hair" else None
        trim_cm = parse_trim_cm(analysis.get("trim_preference"))

        # Length rule: only haircuts change length, and only a cut that keeps the length is told to keep it.
        # (The app always sends a trim choice, so "keep length" must never override a chosen shorter cut.)
        length_rule = ""
        if change == "shorter":
            length_rule = "This is a deliberately shorter haircut: cut the hair to the new length."
        elif service == "Hair" and cust_len in ("medium", "long", "very long"):
            length_rule = "Keep the current hair length; do not cut it shorter."
            if trim_cm:
                length_rule += f" Take only about {trim_cm:g} cm off the ends."

        required = ["Image edit, not text-to-image."]
        if is_female:
            required.append("Woman: no beard, stubble or facial hair.")
        if is_cust_bald:
            required.append("The scalp is bald: add no hair on top.")
        if length_rule:
            required.append(length_rule)
        untie = _untie_sentence(analysis, style)
        if untie:
            required.append(untie)
        if with_reference_image:
            required.append("Use image 2 only as a style guide.")
        what = {"Beard": "beard style", "Colour": "salon hair colour", "Texture": "salon hair texture"}.get(service, "salon haircut")
        required.append(f"Change only the {target} to this {what}: {_edit_description(style)}")
        required.append("The face must stay pixel-identical." if strict else
                        f"Everything except the {target} stays as in the photo: same person, face, skin, clothing, "
                        "pose, background and light.")

        if is_beard:
            keep = "Keep the natural beard density and growth area; add no beard where there is none."
        elif service == "Colour":
            keep = "Keep the exact cut, length, shape, parting, texture and hairline."
        elif service == "Texture":
            keep = f"Keep the exact cut, length and shape and the natural {colour_word}colour."
        else:
            keep = (f"Keep the hair's natural {colour_word}colour and {texture + ' ' if texture else ''}texture "
                    "(do not straighten or smooth it), its density and hairline.")
        optional = [keep]
        if not is_beard and _has_beard(analysis) and not is_female:
            optional.append("Keep the beard and moustache exactly as they are.")
        optional += ["Add nothing to the face.", "Photorealistic, natural skin texture."]

        prompt = " ".join(required)
        if len(prompt) > max_chars:
            # Last resort (very long description): shorten the description, never the rules around it
            over = len(prompt) - max_chars + 1
            desc = _edit_description(style)
            cut = desc[:max(0, len(desc) - over)]
            short_desc = (cut.rsplit(" ", 1)[0] if " " in cut else cut).rstrip(",;:") + "."
            prompt = prompt.replace(desc, short_desc, 1)
        for sentence in optional:
            if len(prompt) + 1 + len(sentence) <= max_chars:
                prompt += " " + sentence
        return prompt[:max_chars]

    def _full_prompt(
        self,
        customer_analysis: Dict[str, Any],
        style_metadata: Dict[str, Any],
        strict: bool,
        with_reference_image: bool,
        with_back_image: bool = False,
        num_extra_images: int = 0,
    ) -> str:
        service = _service(style_metadata)
        is_beard = service == "Beard"
        description = _edit_description(style_metadata)
        category = style_metadata.get("category")
        maintenance = style_metadata.get("maintenance_level")
        target_len = style_metadata.get("hair_length")
        is_female = _is_female(customer_analysis, style_metadata)

        parts = [
            "EDIT THE PROVIDED CUSTOMER PHOTOGRAPH. This is an IMAGE EDITING task, NOT a text-to-image "
            "generation task.",
        ]
        if is_female:
            parts.append(
                "CRITICAL FEMALE CUSTOMER MANDATE: THE CUSTOMER IS A WOMAN / FEMALE. DO NOT GENERATE ANY BEARD, "
                "STUBBLE, MOUSTACHE, SIDEBURNS, GOATEE, OR MASCULINE FACIAL HAIR ON THE FACE OR JAWLINE OR CHIN. "
                "THE FACE, CHEEKS, CHIN, LIPS, AND JAWLINE MUST REMAIN 100% FEMININE, SMOOTH, AND CLEAN-SHAVEN "
                "WITHOUT ANY BEARD OR FACIAL HAIR."
            )
        # Only when the analysis found the hair tied back; loose hair must not be told it is tied (the model
        # would invent length), and a shorter cut must not be told to keep the full length
        untie = _untie_sentence(customer_analysis, style_metadata)
        if untie:
            parts.append(untie)

        total_extras = max(num_extra_images, 1 if with_back_image else 0)
        if total_extras > 0:
            extra_idx_end = 1 + total_extras
            parts.append(
                f"Image 1 is the customer and the primary image to edit. "
                f"Images 2 through {extra_idx_end} show the same customer from other angles (Side/Back/Front view): "
                f"use all of them to see the customer's real hair length, hair density, hair texture, and clothing from all angles. "
                f"They are multi-view references for accuracy and must not appear in the final result."
            )
            if service == "Hair" and _length_change(customer_analysis, style_metadata) == "shorter":
                parts.append("Cut the hair to the target length.")

        if with_reference_image:
            ref_idx = f"Image {2 + total_extras}"
            parts.append(
                f"Image 1 is the customer and is the ONLY source of identity. {ref_idx} is a hairstyle reference "
                f"only: apply the hairstyle characteristics shown in {ref_idx} to the customer's actual hair in "
                f"image 1. Never copy the face, skin, body, clothing or background of the person in {ref_idx}."
            )

        parts.append(BLACK_CLOTHING_DISAMBIGUATION_MANDATE)
        parts.append(MULTI_VIEW_CONSISTENCY_MANDATE)
        parts.append(IDENTITY_BLOCK_STRICT if strict else IDENTITY_BLOCK)

        if service == "Colour":
            parts.append("ONLY CHANGE THE HAIR COLOUR. Keep the exact haircut, length, shape, parting, volume, "
                         "texture and hairline as they are; this is a colour service, not a haircut.")
            parts.append(f"Target colour: {description}")
            parts.append("Make the colour look like a professional salon result: natural dimension, even coverage "
                         "and natural-looking roots.")
            if _has_beard(customer_analysis):
                parts.append("Keep the beard and moustache exactly as they are.")
        elif service == "Texture":
            parts.append("ONLY CHANGE THE HAIR TEXTURE. Keep the exact haircut, length, shape and hairline as they "
                         "are; this is a smoothening / perm service, not a haircut.")
            parts.append(f"Target texture: {description}")
            colour = customer_analysis.get("hair_color_detected")
            parts.append(f"Preserve the customer's natural hair colour{f' ({colour.lower()})' if _known(colour) else ''} "
                         "and root colour exactly.")
            if _has_beard(customer_analysis):
                parts.append("Keep the beard and moustache exactly as they are.")
        elif is_beard:
            parts.append("ONLY MODIFY THE BEARD AND MOUSTACHE. Do not change the top hairstyle.")
            parts.append(f"Target beard style: {description}")
            cust_len = str(customer_analysis.get("hair_length", "")).lower()
            cust_den = str(customer_analysis.get("hair_density", "")).lower()
            if cust_len == "bald" or "bald" in cust_den or "sparse" in cust_den:
                parts.append("CRITICAL SCALP RULE: The customer in the photo is completely bald. DO NOT GENERATE OR ADD ANY HAIR ON TOP OF THE HEAD. The scalp MUST remain 100% bald, smooth, and clean with zero hair on top.")
            parts.append(
                "CRITICAL DENSITY RULE FOR BEARD: Preserve the customer's exact natural facial hair density, "
                "stubble thickness, and growth area from the photo. DO NOT ADD HEAVY BEARD DENSITY, DO NOT DRAW "
                "ARTIFICIAL DARK BEARD VOLUME, AND DO NOT ADD BEARD HAIR WHERE THERE IS NO NATURAL GROWTH. "
                "If the customer has light stubble or sparse facial hair, shape or trim only their existing stubble "
                "without adding thick fake beard hair or artificial dark density."
            )
        else:
            parts.append("ONLY MODIFY THE HAIR.")
            if not is_female:
                parts.append(
                    "CRITICAL BEARD & FACIAL HAIR LOCK MANDATE: THE SELECTED SERVICE IS HAIRCUT ONLY. DO NOT MODIFY, "
                    "TRIM, SHAVE, SHAPE, OR EDIT THE CUSTOMER'S BEARD, MUSTACHE, STUBBLE OR FACIAL HAIR IN ANY WAY. "
                    "KEEP THE CUSTOMER'S EXACT EXISTING BEARD, MUSTACHE, STUBBLE AND FACIAL HAIR 100% UNCHANGED AND UNTOUCHED."
                )
            style_line = f"Target hairstyle (a normal salon haircut): {description}"
            details = [d for d in (
                f"category {category}" if category else None,
                f"target length {target_len.lower()}" if target_len else None,
                f"{maintenance.lower()} maintenance" if maintenance else None,
            ) if d]
            if details:
                style_line += f" ({', '.join(details)})."
            parts.append(style_line)
            parts.append(self._hair_preservation(customer_analysis, style_metadata))

        parts.append(DO_NOT_BLOCK)
        parts.append(REALISM_BLOCK)
        return " ".join(parts)

    def _hair_preservation(self, analysis: Dict[str, Any], style: Dict[str, Any]) -> str:
        colour = analysis.get("hair_color_detected")
        texture = _texture_word(analysis.get("hair_type"))
        density = analysis.get("hair_density")
        current_len = analysis.get("hair_length")
        target_len = style.get("hair_length")
        chemical = bool(style.get("requires_chemical_service"))

        lines = []
        known = [f"hair colour {colour.lower()}" if _known(colour) else None,
                 f"{texture} texture" if texture else None,
                 f"{current_len.lower()} length" if _known(current_len) else None,
                 f"{density.lower()} density" if _known(density) else None]
        known = [k for k in known if k]
        if known:
            lines.append(f"The customer's current hair: {', '.join(known)}.")

        if chemical:
            lines.append(f"This style includes a salon colour/texture service: apply only the specific colour or texture "
                         f"change described in the target style, keeping natural-looking roots.")
        else:
            lines.append(
                f"STRICT HAIR COLOUR PRESERVATION: Preserve the customer's exact natural hair colour{f' ({colour.lower()})' if _known(colour) else ''} "
                "and natural root colour exactly; do not alter the shade, do not add dye or highlights, and do not change the natural tone."
            )
            lines.append(
                f"STRICT HAIR TEXTURE PRESERVATION: Preserve the customer's natural {texture + ' ' if texture else ''}hair texture and wave/curl "
                "pattern exactly as it appears in the photo; do not alter, straighten, smooth or curl the hair strands."
            )
        lines.append(
            f"STRICT HAIR DENSITY PRESERVATION: Preserve the customer's natural hair density{f' ({density.lower()})' if _known(density) else ''} "
            "and realistic hair thickness; do not add extra hair volume, do not increase hair density, and do not add artificial hair volume beyond their own natural hair."
        )
        lines.append("Preserve the customer's natural hairline and natural hair growth direction.")

        is_female = _is_female(analysis, style)

        change = _length_change(analysis, style)
        trim_cm = parse_trim_cm(analysis.get("trim_preference"))
        if change == "shorter":
            lines.append(f"LENGTH: this is a deliberate shorter haircut. Cut the hair to the target length "
                         f"({str(target_len).lower()}); do not keep the old length.")
        elif str(current_len).lower() in ("long", "very long"):
            lines.append(
                "LENGTH: keep the customer's long hair length from the photo, extending past the shoulders. "
                "Do not cut it into a bob or anything shorter."
                + (f" Take only about {trim_cm:g} cm off the ends." if trim_cm else ""))
        elif change == "same" and trim_cm:
            lines.append(f"LENGTH: keep the current length class; take only about {trim_cm:g} cm off the ends.")
        if change in ("shorter", "same") or (trim_cm is not None and trim_cm <= 5.0) or (change is None and str(current_len).lower() in ("medium", "long", "very long")):
            lines.append("Do not make the hair longer than it currently is.")
        if not _known(current_len):
            lines.append("If the hair is tied back or partly hidden, show it let down and cut in the new style, "
                         "using the same hair colour and texture.")
        if _has_beard(analysis) and not is_female:
            lines.append("Keep the beard and moustache exactly as they are.")
        lines.append("NO BRAID DIRECTIVE: Show the hair let down and styled as a clean haircut. Do not braid the hair or put it in a ponytail.")
        lines.append("Adapt the hairstyle to the customer's actual hair.")
        return " ".join(lines)



    def build_view_prompt(self, analysis: Dict[str, Any], style: Dict[str, Any], view: str,
                          strict: bool = False, num_extra_images: int = 0,
                          with_reference_image: bool = False,
                          max_chars: Optional[int] = None) -> str:
        """
        Edit prompt for the customer's side or back photo. It shows the same finished look as the front preview:
        for a haircut that is the style's TARGET length (not the current one); colour, texture and beard looks
        keep the current cut. Built to fit max_chars with the style description always included.
        """
        service = _service(style)
        target = "beard and moustache" if service == "Beard" else "hair"
        what = {"Beard": "beard style", "Colour": "salon hair colour", "Texture": "salon hair texture"}.get(service, "salon haircut")
        angle = "side profile" if view == "side" else ("back of the head" if view == "back" else "front view")
        colour = analysis.get("hair_color_detected")
        texture = _texture_word(analysis.get("hair_type"))
        is_female = _is_female(analysis, style)
        colour_str = f"{colour.lower()} " if _known(colour) else ""
        texture_str = f"{texture} " if texture else ""
        compact = max_chars is not None

        if service == "Hair":
            target_len = style.get("hair_length")
            words = TARGET_LENGTH_WORDS.get(str(target_len))
            look = (f"Show the same finished haircut as the front view: {words} hair" if words
                    else "Show the same finished haircut as the front view")
            look += f", same natural {colour_str}colour and {texture_str}texture."
            if LENGTH_ORDER.get(str(target_len), 0) >= 3:  # lob and longer: tied-back hair is shown let down
                look += " If the hair is tied back or in a clip, remove all hair clips/ties and show it let down in the new cut."
            keep = "Keep the natural hairline and neckline."
            if _has_beard(analysis) and not is_female:
                keep += " Keep the beard exactly as it is."
        elif service == "Colour":
            look = "Keep the exact cut and length; change only the colour, as in the front view."
            keep = f"Keep the {texture_str}texture."
        elif service == "Texture":
            look = "Keep the exact cut and length; change only the texture, as in the front view."
            keep = f"Keep the natural {colour_str}colour."
        else:
            look = "Do not change the hair on the head."
            keep = "Keep the natural beard density and growth area; add no beard where there is none."
        if is_female:
            keep += " Keep the face smooth, with no facial hair; remove any hair clip, claw clip or ponytail tie."

        multi_ref_clause = ""
        if num_extra_images > 0:
            multi_ref_clause = (
                f"Image 1 is the primary {angle} photo of the customer to edit. "
                f"Images 2 through {1 + num_extra_images} show the same customer from other angles (Front/Back/Side view): "
                f"use all of them to ensure 100% hair length, haircut style, volume, texture, colour, and clothing consistency across all views."
            )

        ref_clause = ""
        if with_reference_image:
            ref_idx = 2 + num_extra_images
            ref_clause = (
                f"Image {ref_idx} is the AI-generated FRONT view preview of this haircut on the customer. "
                f"You MUST match the haircut in Image {ref_idx} EXACTLY: match the exact finished hair length, "
                f"hair volume, curl structure, and styling (loose hair let down, NO half-ponytail)."
            )

        if compact:
            single = "Edit only the one person in this photo; no collage, no extra people."
            identity = ("Only the " + target + " may change." if strict else
                        "Same person, skin, ears, clothing, pose, background and light.")
            mandates_str = "Distinguish hair from black dress/clothing. Keep length consistent across views. Loose hair let down: no half-ponytail or hair tie."
        else:
            single = ("Edit only the single person in this photograph. Do not create a collage or add people, "
                      "and do not replace the person with a different model.")
            identity = ("Only the " + target + " may change; everything else must stay pixel-identical." if strict else
                        f"Everything except the {target} stays exactly as in the photo: same person, skin, ears, neck, "
                        "clothing, pose, camera angle, background and lighting.")
            mandates_str = f"{BLACK_CLOTHING_DISAMBIGUATION_MANDATE} {MULTI_VIEW_CONSISTENCY_MANDATE} {NO_HALF_PONYTAIL_MANDATE} {STRICT_BACK_LENGTH_MATCHING_MANDATE}"

        head = (f"Image edit, not text-to-image. This photo shows the {angle} of a salon customer. {single} "
                f"{multi_ref_clause} {ref_clause} {mandates_str} "
                f"Change only the {target} to this {what}, as seen from this angle: ")
        tail = f" {look} {keep} {identity} Photorealistic, no drawn outline lines."
        description = _edit_description(style)
        if max_chars and len(head) + len(description) + len(tail) > max_chars:
            room = max(0, max_chars - len(head) - len(tail) - 1)
            cut = description[:room]
            description = (cut.rsplit(" ", 1)[0] if " " in cut else cut).rstrip(",;:") + "."
        prompt = head + description + tail
        return prompt[:max_chars] if max_chars else prompt


prompt_engine = ControlledPromptEngine()
