from typing import Any, Dict, Optional

from app.ai.recommendation_engine import parse_trim_cm

PROMPT_TEMPLATE_VERSION = "hair-edit-v31-six-points"

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

# Short, plain rules. Long capitalised "mandates" drown out the haircut description, and edit models follow the
# description less when most of the prompt is boilerplate. Every rule below is one sentence and is only added
# when it applies to this service, length and view. The white background is also enforced after generation
# (apply_pure_white_background), so the prompt only needs to ask for it once.
WHITE_BACKGROUND = (
    "Replace the whole background with plain solid white (#FFFFFF): no wall, furniture, floor or shadows. "
    "Keep the person, hair, clothing and jewellery exactly as they are."
)

HAIR_ACCESSORIES = ("Remove every hair accessory from the hair: ties, elastic bands, scrunchies, clips, claw clips, "
                    "hairpins, headbands and ribbons.")
LET_DOWN = "Show the hair let down and loose in the new cut, not in a ponytail, bun or braid."

DENSITY_RULE = ("Keep the customer's natural hair density and thickness; do not add volume or extra hair beyond "
                "their own.")

CLOTHING_NOT_HAIR = ("A dark scarf, dupatta or garment on the shoulders is clothing, not hair: judge the hair length only "
                     "from hair growing from the scalp, and keep the clothing as it is.")

SIDE_VIEW_RULE = ("This is a side (profile) view: keep this photo's camera angle, with the face in profile and one ear "
                  "visible. Do not turn the person towards the camera.")
BACK_VIEW_RULE = ("This is a back view: keep the camera behind the head, showing the back of the head, the nape and "
                  "the shoulders. Show no face.")


def _shows_long_cut(analysis: Dict[str, Any], style: Dict[str, Any]) -> bool:
    """The finished look reaches the shoulders or beyond (lob and longer, or a kept long length)."""
    target = LENGTH_ORDER.get(str(style.get("hair_length") or ""))
    if _service(style) == "Hair" and target is not None:
        return target >= LENGTH_ORDER["Lob"]
    current = LENGTH_ORDER.get(str(analysis.get("hair_length") or ""))
    return current is not None and current >= LENGTH_ORDER["Medium"]


def _accessory_rule(analysis: Dict[str, Any], style: Dict[str, Any]) -> str:
    """Accessories are removed for every hair service. "Let down and loose" only when the finished look is long
    enough to hang loose; a pixie or buzz cut must not be told to show hair over the shoulders."""
    if _service(style) == "Beard":
        return ""
    rule = HAIR_ACCESSORIES
    if _shows_long_cut(analysis, style):
        rule += " " + LET_DOWN
    return rule


# Accessories (bindi, earrings, makeup...) are deliberately NOT named: edit models tend to draw whatever the
# prompt mentions, e.g. adding a bindi to a man. Keeping the whole face unchanged preserves any that exist.
IDENTITY_BLOCK = (
    "The person must remain the same person. Apart from the hair and the background, everything stays exactly as "
    "in the photo: face, facial structure, eyes, eyebrows, nose, lips, jawline, skin tone and texture, age, "
    "expression, anything already on the face or body, clothing, pose, camera angle and lighting. Add nothing new "
    "to the face or body."
)

IDENTITY_BLOCK_STRICT = (
    "The face must stay pixel-identical to the input photo; only the hair and the background may change. Do not "
    "redraw, beautify, smooth, slim, age or de-age the face, add nothing to it, and keep skin, clothing and body as "
    "they are."
)

DO_NOT_BLOCK = "Do not generate a new person or a generic model, and do not replace the customer's face."

REALISM_BLOCK = (
    "The cut must be realistic and achievable by a salon stylist, with the hair connecting naturally to the scalp "
    "and hairline. Photorealistic, natural strands and shadows. Return the full photo with the same framing and "
    "aspect ratio."
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
        if not is_beard:
            required.append("Remove hair ties, clips and bands." + (" Show the hair let down and loose."
                                                                     if _shows_long_cut(analysis, style) else ""))
        required.append("The face must stay pixel-identical." if strict else
                        f"Everything except the {target} stays as in the photo: same person, face, skin, clothing, "
                        "pose and light.")
        required.append("Plain solid white background.")

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
        if not is_beard:
            optional.append("Do not add volume or density.")
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
            parts.append("The customer is a woman: add no beard, stubble, moustache or other facial hair; the face, "
                         "cheeks, chin and jawline stay smooth.")
        # Only when the analysis found the hair tied back; loose hair must not be told it is tied (the model
        # would invent length), and a shorter cut must not be told to keep the full length
        untie = _untie_sentence(customer_analysis, style_metadata)
        if untie:
            parts.append(untie)

        # Extra photos (side / back of the same customer) are described only when they are actually sent, and
        # every image number below is the real position of that image in the request.
        total_extras = max(num_extra_images, 1 if with_back_image else 0)
        if total_extras > 0:
            others = "Image 2" if total_extras == 1 else f"Images 2 to {1 + total_extras}"
            parts.append(
                f"Image 1 is the customer photo to edit. {others} show the same customer from other angles, for "
                "reference only: use them to see the real hair length, density and texture. They must not appear "
                "in the result."
            )
            if service == "Hair" and _length_change(customer_analysis, style_metadata) == "shorter":
                parts.append("Then cut the hair to the target length.")

        if with_reference_image:
            ref_idx = f"Image {2 + total_extras}"
            parts.append(
                f"{ref_idx} is a hairstyle reference only: apply its hairstyle to the customer's own hair in image 1. "
                f"Never copy the face, skin, body, clothing or background of the person in {ref_idx}."
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
            parts.append("ONLY MODIFY THE HAIR ON THE HEAD.")
            if not is_female:
                parts.append("This is a haircut only: keep the beard, moustache and stubble exactly as they are.")
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

        accessory = _accessory_rule(customer_analysis, style_metadata)
        if accessory:
            parts.append(accessory)
        if not is_beard:
            parts.append(CLOTHING_NOT_HAIR)
        parts.append(WHITE_BACKGROUND)
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
                f"Keep the exact natural hair colour{f' ({colour.lower()})' if _known(colour) else ''} and root colour: "
                "no dye, highlights or change of tone."
            )
            lines.append(
                f"Keep the natural {texture + ' ' if texture else ''}texture and wave/curl pattern exactly; do not "
                "straighten, smooth or curl the strands."
            )
        lines.append(DENSITY_RULE)
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
        lines.append("Show a clean haircut: do not braid the hair or put it in a ponytail or bun.")
        lines.append("Adapt the hairstyle to the customer's actual hair.")
        return " ".join(lines)



    def build_view_prompt(self, analysis: Dict[str, Any], style: Dict[str, Any], view: str,
                          strict: bool = False, num_extra_images: int = 0,
                          with_reference_image: bool = False,
                          max_chars: Optional[int] = None) -> str:
        """
        Edit prompt for the customer's own side or back photo. It shows the same finished look as the front
        preview: for a haircut the style's TARGET length; colour, texture and beard looks keep the current cut.
        Image order in the request: 1 = this photo, then num_extra_images other photos, then the front preview.
        Built to fit max_chars with the style description always included.
        """
        service = _service(style)
        target = "beard and moustache" if service == "Beard" else "hair"
        what = {"Beard": "beard style", "Colour": "salon hair colour", "Texture": "salon hair texture"}.get(service, "salon haircut")
        angle = "side profile" if view == "side" else "back of the head"
        colour = analysis.get("hair_color_detected")
        texture = _texture_word(analysis.get("hair_type"))
        is_female = _is_female(analysis, style)
        colour_str = f"{colour.lower()} " if _known(colour) else ""
        texture_str = f"{texture} " if texture else ""
        compact = max_chars is not None
        preview_idx = 2 + num_extra_images

        if service == "Hair":
            words = TARGET_LENGTH_WORDS.get(str(style.get("hair_length")))
            look = (f"The finished cut is {words} hair, exactly as long as in the front preview; "
                    f"do not make it longer or shorter." if words else
                    "The finished length is exactly as in the front preview.")
            look += f" Same natural {colour_str}colour and {texture_str}texture as the front."
            keep = "Keep the natural hairline and neckline."
            if _has_beard(analysis) and not is_female:
                keep += " Keep the beard exactly as it is."
        elif service == "Colour":
            look = "Keep the exact cut and length; change only the colour, as in the front preview."
            keep = f"Keep the {texture_str}texture."
        elif service == "Texture":
            look = "Keep the exact cut and length; change only the texture, as in the front preview."
            keep = f"Keep the natural {colour_str}colour."
        else:
            look = "Do not change the hair on the head."
            keep = "Keep the natural beard density and growth area; add no beard where there is none."
        if is_female:
            keep += " Keep the face smooth, with no facial hair."
        accessory = _accessory_rule(analysis, style)
        angle_rule = BACK_VIEW_RULE if view == "back" else SIDE_VIEW_RULE

        refs = []
        if num_extra_images > 0:
            others = "Image 2" if num_extra_images == 1 else f"Images 2 to {1 + num_extra_images}"
            refs.append(f"Image 1 is the {angle} photo to edit; {others} show the same customer from other angles, "
                        "for reference only.")
        if with_reference_image:
            refs.append(f"Image {preview_idx} is the finished front preview of this look: match its hair length, "
                        "colour, texture and volume exactly.")

        if compact:
            identity = "Only the " + target + " changes; same person, skin, clothing and pose."
            density = "No added volume." if service != "Beard" else ""
            short_accessory = ("" if service == "Beard" else "Remove hair ties, clips and bands." +
                               (" Hair let down and loose." if _shows_long_cut(analysis, style) else ""))
            # The background rule sits in the head so the length limit can never cut it off
            head = (f"Image edit of a {angle} photo, not text-to-image. Plain solid white background. {angle_rule} "
                    + " ".join(refs) + f" Change only the {target} to this {what}: ")
            tail = " " + " ".join(x for x in (look, short_accessory, density, keep, identity) if x)
        else:
            single = "Edit only the one person in this photo; no collage, no extra people, no different model."
            identity = ("Only the " + target + " may change; everything else stays pixel-identical." if strict else
                        f"Everything except the {target} and the background stays exactly as in the photo: same "
                        "person, skin, ears, neck, clothing, pose and camera angle.")
            head = (f"Image edit, not text-to-image. This photo shows the {angle} of a salon customer. {single} "
                    f"{angle_rule} " + " ".join(refs) + f" Change only the {target} to this {what}, as seen from "
                    "this angle: ")
            rules = [look, accessory, DENSITY_RULE if service != "Beard" else "",
                     CLOTHING_NOT_HAIR if service != "Beard" else "", keep, identity, WHITE_BACKGROUND,
                     "Photorealistic, no drawn outline lines."]
            tail = " " + " ".join(x for x in rules if x)
        description = _edit_description(style)
        if max_chars and len(head) + len(description) + len(tail) > max_chars:
            room = max(30, max_chars - len(head) - len(tail) - 1)
            cut = description[:room]
            description = (cut.rsplit(" ", 1)[0] if " " in cut and len(cut.rsplit(" ", 1)[0]) >= 15 else cut).rstrip(",;:") + "."
        prompt = head + description + tail
        return prompt[:max_chars] if max_chars else prompt


prompt_engine = ControlledPromptEngine()
