from typing import Any, Dict, Optional

PROMPT_TEMPLATE_VERSION = "hair-edit-v6"

UNKNOWN = "Unknown"
LENGTH_ORDER = {"Very Short": 0, "Short": 1, "Medium": 2, "Long": 3, "Very Long": 4}

TEXTURE_PHRASES = {
    "straight": "straight",
    "wavy": "wavy",
    "curly": "curly",
    "coily": "coily",
}

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
        max_chars: Optional[int] = None,
    ) -> str:
        prompt = self._full_prompt(customer_analysis, style_metadata, strict, with_reference_image)
        if max_chars and len(prompt) > max_chars:
            prompt = self._compact_prompt(customer_analysis, style_metadata, strict, with_reference_image, max_chars)
        return prompt

    def _compact_prompt(self, analysis: Dict[str, Any], style: Dict[str, Any], strict: bool,
                        with_reference_image: bool, max_chars: int) -> str:
        """Same constraints in short form, for models with a prompt length limit (NVIDIA FLUX: 800 chars)."""
        service = _service(style)
        is_beard = service == "Beard"
        target = "beard and moustache" if is_beard else "hair"
        colour = analysis.get("hair_color_detected")
        texture = _texture_word(analysis.get("hair_type"))
        source = "Use the hairstyle from image 2 only as a style guide. " if with_reference_image else ""
        if is_beard:
            keep = ("Keep the natural beard colour and growth pattern. Do not change the hairstyle."
                    if style.get("requires_beard", True) else "Do not change the hairstyle.")
        elif service == "Colour":
            keep = ("Change only the colour: keep the exact haircut, length, shape, parting, volume and texture, "
                    "and keep the hairline.")
        elif service == "Texture":
            keep = (f"Change only the texture: keep the exact haircut, length and shape, the natural "
                    f"{colour.lower() + ' ' if _known(colour) else ''}hair colour and the hairline.")
        elif style.get("requires_chemical_service"):
            keep = "Keep the natural hairline and density."
        else:
            keep = (f"Keep the hair's natural {colour.lower() + ' ' if _known(colour) else ''}colour and its own "
                    f"{texture + ' ' if texture else ''}texture and wave/curl pattern exactly (do not straighten "
                    f"or smooth it), its density and hairline.")
        if not is_beard and _has_beard(analysis):
            keep += " Keep the beard and moustache exactly as they are."
        identity = ("The face must stay pixel-identical." if strict else
                    f"Everything except the {target} stays exactly as in the photo: same person, face, skin, "
                    "expression, clothing, pose, background and lighting.")
        tail = f" {keep} {identity} Add nothing to the face. Photorealistic, natural hair strands, realistic hairline."
        what = {"Beard": "beard style", "Colour": "salon hair colour", "Texture": "salon hair texture"}.get(service, "salon haircut")
        head = f"Image edit, not text-to-image. {source}Change only the {target} to this {what}: "
        room = max_chars - len(head) - len(tail)
        description = _edit_description(style)
        if len(description) > room:
            description = description[:max(0, room - 1)].rsplit(" ", 1)[0] + "."
        return (head + description + tail)[:max_chars]

    def _full_prompt(
        self,
        customer_analysis: Dict[str, Any],
        style_metadata: Dict[str, Any],
        strict: bool,
        with_reference_image: bool,
    ) -> str:
        service = _service(style_metadata)
        is_beard = service == "Beard"
        description = _edit_description(style_metadata)
        category = style_metadata.get("category")
        maintenance = style_metadata.get("maintenance_level")
        target_len = style_metadata.get("hair_length")

        parts = [
            "EDIT THE PROVIDED CUSTOMER PHOTOGRAPH. This is an IMAGE EDITING task, NOT a text-to-image "
            "generation task.",
        ]
        if with_reference_image:
            parts.append(
                "Image 1 is the customer and is the ONLY source of identity. Image 2 is a hairstyle reference "
                "only: apply the hairstyle characteristics shown in image 2 to the customer's actual hair in "
                "image 1. Never copy the face, skin, body, clothing or background of the person in image 2."
            )
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
            parts.append("ONLY MODIFY THE BEARD AND MOUSTACHE. Do not change the hairstyle.")
            parts.append(f"Target beard style: {description}")
            if style_metadata.get("requires_beard", True):
                parts.append(
                    "Keep the customer's natural beard colour and follow their natural beard growth pattern; "
                    "do not add beard density where there is no growth."
                )
        else:
            parts.append("ONLY MODIFY THE HAIR.")
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
            lines.append(f"This style includes a salon colour/texture service: apply only the colour or texture "
                         f"change described above, keeping natural-looking roots.")
        else:
            lines.append(
                f"Preserve the customer's natural hair colour{f' ({colour.lower()})' if _known(colour) else ''} "
                "and natural root colour exactly; no dye, no highlights, no lighter or darker shade."
            )
            lines.append(
                f"Preserve the customer's natural {texture + ' ' if texture else ''}hair texture and wave/curl "
                "pattern exactly as it appears in the photo; do not straighten, smooth or curl it."
            )
        lines.append(
            "Preserve the customer's natural hair density and realistic hair thickness; do not add extra hair "
            "or artificial volume beyond what their own hair can produce."
        )
        lines.append("Preserve the customer's natural hairline and natural hair growth direction.")

        if _known(current_len) and current_len in LENGTH_ORDER and target_len in LENGTH_ORDER \
                and LENGTH_ORDER[target_len] <= LENGTH_ORDER[current_len]:
            lines.append("Do not make the hair longer than it currently is.")
        if not _known(current_len):
            lines.append("If the hair is tied back or partly hidden, show it let down and cut in the new style, "
                         "using the same hair colour and texture.")
        if _has_beard(analysis):
            lines.append("Keep the beard and moustache exactly as they are.")
        lines.append("Adapt the hairstyle to the customer's actual hair.")
        return " ".join(lines)


prompt_engine = ControlledPromptEngine()
