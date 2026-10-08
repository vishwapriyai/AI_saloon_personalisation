# Hairstyle Recommendation Guide

How the Salon AI app analyses a customer's photo, chooses hairstyles, and which styles are in the catalogue.
Everything below reflects the current code:

- Face and hair analysis: `backend/app/ai/vision_models.py`, `backend/app/ai/face_analysis.py`
- Style selection: `backend/app/ai/recommendation_engine.py`
- Style catalogue: `backend/app/ai/style_catalogue.py`

---

## 1. Overall flow

```
Customer photo
  → Face analysis (MediaPipe, 478 face points)    → face shape, beard
  → Hair analysis (MediaPipe hair segmentation)    → hair colour, length, texture
  → Customer choices: collection (Women / Men), category (Classic / Trendy / Professional), service
  → Recommendation engine scores every catalogue style → top 4
  → Image-editing model draws ONLY those 4 styles on the customer's own photo
```

The image model never chooses a hairstyle. It only draws the style the recommendation engine selected.

---

## 2. How the face shape is identified

The app places 478 points on the face and measures four distances:

| Measurement | Between |
|---|---|
| **Face length (L)** | mid-forehead (point 10) → chin (point 152) |
| **Cheekbone width (W)** | widest cheekbone points (234 ↔ 454) |
| **Forehead width (F)** | upper forehead sides (54 ↔ 284) |
| **Jaw width (J)** | jaw angles (172 ↔ 397) |

These become three ratios:

- **L/W**: how long the face is
- **F/W**: forehead width compared with the cheekbones
- **J/W**: jaw width compared with the cheekbones

### Classification rules

| Shape | Rule | In plain words |
|---|---|---|
| **Oblong** | L/W ≥ 1.32 | clearly longer than wide |
| **Heart** | forehead wider than jaw by more than 0.12, and L/W < 1.32 | wide forehead, narrow chin |
| **Diamond** | F/W < 0.82 and J/W < 0.78 | cheekbones widest; forehead and jaw narrower |
| **Square** | J/W ≥ 0.86 and L/W < 1.18 | strong, wide jaw; short face |
| **Round** | J/W < 0.86 and L/W < 1.12 | soft jaw; about as wide as long |
| **Oval** | L/W 1.12–1.32, jaw narrower than cheeks, forehead ≈ jaw | balanced proportions |

### When the result is "Unknown"

The app returns **Unknown** instead of guessing when any of these hold:

- the head is turned (the nose is more than 8% of the face width off-centre),
- the face is less than 60 px wide,
- the measurements sit close to the boundary between two shapes (confidence below 0.6).

The face-length point is mid-forehead, not the real hairline, because hair often hides the hairline. That's why the ratios are lower than textbook face-shape ratios.

---

## 3. How the hair is analysed

A hair-segmentation model marks exactly which pixels are hair. From that mask:

| Attribute | How it is measured | Possible results |
|---|---|---|
| **Colour** | median colour of the hair pixels (brightness and warmth) | Black, Dark Brown, Dark Auburn, Brown, Auburn, Light Brown, Blonde, Grey |
| **Length** | where the hair ends compared with the chin, measured in face-lengths | Short (ends near chin or above), Medium (shoulders), Long, Very Long |
| **Texture** | how parallel the hair strands are | Straight / Wavy / Curly, only when clear-cut; otherwise Unknown |
| **Density** | cannot be measured reliably from one photo | always Unknown; the stylist confirms during consultation |
| **Beard** | brightness of the lower face compared with cheek skin | Full Beard / Stubble / Clean Shaven |

If very little hair is visible (tied back or covered), length is reported as **Unknown**. The image prompt then asks the model to show the hair let down in the new cut.

### Photo quality checks

- No face found → rejected: *"Please make sure your face is clearly visible."*
- Face smaller than 80 px → rejected: *"Your face is too small in this photo. Please take a closer, higher-resolution photo."*
- Unreadable file → rejected: *"This photo could not be opened. Please upload a JPG, PNG or HEIC photo."*
- Accepted formats: JPG, PNG, WebP, HEIC and AVIF. Every upload is stored as a standard JPEG.

---

## 4. How the 4 styles are chosen (scoring)

Every style in the catalogue is scored. **The chosen category decides which styles are shown:** styles from that category fill the 4 slots first (best score first), and styles from other categories only fill slots the category cannot. So Classic, Trendy and Professional each give a different set of looks. The number of looks can be changed with `STYLE_RECOMMENDATION_COUNT` in `backend/app/core/config.py`.

| Rule | Points |
|---|---|
| Matches the chosen collection (Women → Female styles, Men → Male styles) | **+50** |
| Unisex style | +30 |
| Style from the opposite collection | **−100** (effectively excluded) |
| Style suits the customer's face shape | **+35** |
| Face shape not listed, but the style suits Oval (versatile cut) | +15 |
| Suits the customer's hair density | +25 |
| Matches the hair texture family (straight / wavy / curly / coily) | **+15** |
| Needs a different hair texture (and has no chemical service) | **−40** |
| Matches the chosen category (Classic / Trendy / Professional) | not scored: these styles are listed first (see above), so the category is not counted twice |
| A hair service was requested | +10 |
| Colour/balayage or keratin/smoothening requested, and the style includes it | +30 |
| **Longer than the customer's current hair** (a haircut cannot add length) | **−60** |

### Services: what the looks are made of

The services ticked on the style screen decide which kind of looks are shown, and the slots are shared between them in the order picked:

| Services picked | 4 looks shown | What the image changes |
|---|---|---|
| Hair Cut & Styling | 4 haircuts | the haircut only |
| Beard Grooming (Men's collection only) | 4 beard styles | the beard and moustache only; hair unchanged |
| Colour & Balayage | 4 colour looks | the hair colour only; the cut stays the same |
| Smoothening & Perms | up to 4 smoothening / perm looks | the hair texture only; cut and colour stay the same |
| Two services (e.g. Hair + Beard) | 2 + 2 | each look changes only its own service |

- Beard Grooming is disabled for the Women's collection.
- A clean-shaven customer can always get the **Clean Shave** look; other beard styles show *"Needs a few weeks of beard growth first."*
- Only colour looks may change the hair colour; the hair-colour check still applies to every other service.
- If a service has fewer than 4 matching looks, fewer cards are shown (e.g. men's smoothening currently has 3).

### Returning customers

For a returning customer, the style-preferences screen pre-selects the collection (Men / Women), services and category they chose last time, with the note *"Pre-selected from your last visit"*. If the hairstyle they chose last time is among the new looks, that card is pre-selected too. Everything can still be changed. This comes from `GET /api/v1/customers/{id}/last-preferences`.

Each recommended style also includes:

- a short explanation of why it suits the customer's face shape,
- a feasibility status: *Achievable Today*, *Needs Extensions / Growth*, or *Requires Chemical Service*,
- any chemical add-on, with its price and time.

---

## 5. Hairstyle catalogue (33 hairstyles + 2 beard styles)

Every collection has at least 5 styles in each category (Classic, Trendy, Professional).

**Hair type codes:** 1 = straight, 2 = wavy, 3 = curly, 4 = coily. The letters A–C go from finer/looser to tighter.

### Men's styles

| # | Style | Category | Suits face shapes | Hair types | Length | Density | Upkeep |
|---|---|---|---|---|---|---|---|
| 1 | Low Taper Fade + Textured Top | Trendy | Oval, Square, Round, Diamond | 1A–2B | Short | Fine–Thick | Medium |
| 2 | Classic Executive Side Part | Classic | Oval, Round, Heart | 1A–1C | Medium | Fine–Medium | Low |
| 3 | Mid Skin Fade + Textured Quiff | Trendy | Oval, Square, Diamond | 1B–2B | Short | Medium–Thick | High |
| 4 | Modern Buzz Cut + Precision Line Up | Professional | Oval, Square | 1A–4A | Short | Fine–Thick | Low |
| 16 | Slicked Back Undercut | Classic | Oval, Square | 1A–2A | Medium | Medium–Thick | Medium |
| 17 | Messy Textured Fringe + Drop Fade | Trendy | Heart, Oval, Round | 2A–3A | Short | Fine–Thick | Medium |
| 18 | Executive Pompadour Fade | Professional | Oval, Round, Square | 1B–2A | Medium | Medium–Thick | High |
| 19 | Natural Curly High Top Fade | Trendy | Oval, Square, Diamond | 3A–4A | Medium | Medium–Thick | Medium |
| 21 | Classic Crew Cut | Classic | Oval, Square, Rectangle, Round | 1A–2B | Short | Fine–Thick | Low |
| 22 | Ivy League Cut | Classic | Oval, Square, Heart, Rectangle | 1A–2A | Short | Medium–Thick | Medium |
| 23 | Short Back & Sides | Classic | Oval, Round, Square, Diamond | 1A–2B | Short | Fine–Thick | Low |
| 24 | Short Business Side Part | Professional | Oval, Round, Heart, Rectangle | 1A–2A | Short | Fine–Thick | Low |
| 25 | Clean Comb-Over Taper | Professional | Oval, Square, Round | 1A–2A | Short | Medium–Thick | Medium |
| 26 | Caesar Cut | Professional | Oval, Rectangle, Heart | 1A–3A | Short | Fine–Thick | Low |
| 27 | Textured French Crop | Trendy | Oval, Square, Round, Rectangle | 1A–2B | Short | Medium–Thick | Low |

### Women's styles

| # | Style | Category | Suits face shapes | Hair types | Length | Density | Upkeep | Chemical service |
|---|---|---|---|---|---|---|---|---|
| 5 | Curtain Bangs + Soft Layered Waves | Trendy | Oval, Round, Heart, Square | 1B–2C | Long | Medium–Thick | Medium | — |
| 6 | Classic Chic French Bob | Classic | Oval, Heart, Diamond | 1A–2A | Bob (chin) | Fine–Medium | Low | — |
| 7 | Honey Balayage + Beach Curls | Trendy | Oval, Round, Square | 2B–3B | Long | Medium–Thick | High | Balayage lightening & gloss |
| 8 | Sleek Executive Straight Lob | Professional | Round, Oval, Square | 1A–1C | Lob (collarbone) | Medium–Thick | Low | — |
| 10 | Layered Feathered U-Cut | Classic | Oval, Round, Heart | 1A–2A | Long | Medium–Thick | Low | — |
| 11 | Face-Framing Butterfly Cut | Trendy | Oval, Square, Heart, Diamond | 1B–2B | Medium | Fine–Thick | Medium | — |
| 12 | Textured Pixie Cut + Side Bangs | Trendy | Oval, Heart, Diamond | 1A–2B | Short | Fine–Medium | Low | — |
| 13 | South Asian Traditional Braided Crown | Classic | Oval, Round, Square, Heart | 1C–3A | Long | Medium–Thick | Medium | — |
| 14 | Glamorous Volume Blowout + Soft Layers | Professional | Oval, Round, Heart, Square | 1A–2A | Long | Medium–Thick | Low | — |
| 15 | Silk Keratin Smoothening + Glass Shine | Professional | Oval, Round, Square | 2A–3B | Medium | Medium–Thick | High | Keratin treatment |
| 28 | Long Layers + Side-Swept Fringe | Classic | Oval, Round, Square, Rectangle | 1A–2B | Long | Fine–Thick | Low | — |
| 29 | Classic Layered Lob | Classic | Oval, Round, Heart, Square | 1A–2B | Lob (shoulders) | Fine–Thick | Low | — |
| 30 | Polished Blunt Bob | Professional | Oval, Heart, Rectangle | 1A–2A | Bob (chin) | Medium–Thick | Low | — |
| 31 | Sleek Step Cut | Professional | Oval, Round, Rectangle | 1A–2A | Long | Medium–Thick | Low | — |
| 32 | Korean C-Curl Layers | Trendy | Oval, Round, Heart, Square | 1A–2A | Medium | Fine–Thick | Medium | — |
| 33 | Soft Wolf Cut | Trendy | Oval, Heart, Diamond, Rectangle | 1C–2C | Medium | Medium–Thick | Medium | — |

### Unisex styles

| # | Style | Category | Suits face shapes | Hair types | Length | Density | Upkeep |
|---|---|---|---|---|---|---|---|
| 9 | Coily Afro Crown + Tapered Sides | Trendy | Oval, Square, Diamond | 4A–4C | Medium | Medium–Thick | Medium |
| 20 | Textured Shag Cut + Wispy Fringe | Trendy | Oval, Heart, Diamond | 1C–2C | Medium | Fine–Thick | Low |

### Beard styles

| # | Style | Category | Suits face shapes | Stylist steps |
|---|---|---|---|---|
| 101 | Sharp Boxed Beard | Professional | Oval, Round | Trim to 8 mm → sharp 45° cheek lines → neckline 1 inch above the Adam's apple |
| 102 | Designer Heavy Stubble | Trendy | Oval, Square, Heart, Diamond | 3 mm guard all over → smooth neck taper |

---

## 6. Stylist cutting steps

These are shown to the stylist after the customer chooses a style, and read aloud by the audio button.

| # | Style | Steps |
|---|---|---|
| 1 | Low Taper Fade + Textured Top | #1 guard low taper at sideburns and nape → blend into #2 moving upward → point-cut 2 in on top for texture → matte clay |
| 2 | Classic Executive Side Part | Side part along the natural swirl → scissor-over-comb sides down to #3 → layer top to 3 in, tapering back → water-based pomade |
| 3 | Mid Skin Fade + Textured Quiff | Mid skin fade starting at the temples → blow-dry top upward with a round brush → high-hold texture powder |
| 4 | Modern Buzz Cut + Precision Line Up | #2 guard all over → detail the hairline with an open-razor line-up |
| 16 | Slicked Back Undercut | Disconnected undercut on sides at #1.5 → comb 4 in on top straight back with gloss pomade |
| 17 | Messy Textured Fringe + Drop Fade | Drop fade curved around the ear to the nape → point-cut forward fringe for messy texture |
| 18 | Executive Pompadour Fade | Blow-dry front pomp 3 in high → taper sides cleanly |
| 19 | Natural Curly High Top Fade | High skin fade → shape curls on top with a curl sponge and leave-in cream |
| 5 | Curtain Bangs + Soft Layered Waves | Centre-parted curtain bangs at 45° sweeping past the cheekbones → 90° interior long layers from the collarbone down → point-cut ends → blow-dry outward with a large round brush → light shine serum |
| 6 | Classic Chic French Bob | Perimeter baseline parallel to the jawline → elevate crown sections to 90° for volume → thin weight behind the ears → smooth blow-dry, flat-iron bevel at the ends |
| 7 | Honey Balayage + Beach Curls | Hand-painted V-section balayage starting 3 in from the roots → long 180° interior layers for curl bounce → diffuse-dry with curl cream and argan oil |
| 8 | Sleek Executive Straight Lob | Sharp 0° blunt line at the collarbone → slight bevel layering on the front 2 in → heat protector and flat-iron straight → anti-humidity spray |
| 10 | Layered Feathered U-Cut | U-shaped perimeter baseline at mid-back → slide-cut front layers from the chin down → blow-dry inward with a large round brush |
| 11 | Face-Framing Butterfly Cut | Shorter top layer framing the cheekbones → connect to the longer bottom layer with point-cutting → root volume spray |
| 12 | Textured Pixie Cut + Side Bangs | Taper nape and sides with shears → razor-cut top layers for piecey texture → lightweight texturizing paste |
| 13 | South Asian Traditional Braided Crown | Tease the crown gently for height → neat three-strand braid down the back → secure with a silk band, smooth flyaways with serum |
| 14 | Glamorous Volume Blowout + Soft Layers | Volumizing mousse on damp roots → section-by-section blow-dry with a 2 in ceramic round brush → Velcro rollers on the front for 10 min |
| 15 | Silk Keratin Smoothening + Glass Shine | Apply keratin evenly → flat-iron micro-sections 7–10 times at 230 °C |
| 9 | Coily Afro Crown + Tapered Sides | Pick and shape the coily crown into a balanced round shape → low clipper taper #1–#2 at sideburns and nape → leave-in curl conditioner and twist sponge |
| 20 | Textured Shag Cut + Wispy Fringe | Razor-cut choppy crown layers → connect to a light curtain fringe → scrunch-dry with sea salt spray |
| 21 | Classic Crew Cut | #2 guard on sides and back, tapering to #1 at the neckline → scissor-cut top to 1–1.5 in, longer at the front → blend top into sides → light matte paste |
| 22 | Ivy League Cut | #2–#3 taper on sides and back → 1.5–2 in on top, longest at the front → side part on the natural parting → light pomade |
| 23 | Short Back & Sides | Scissor-over-comb or #3 guard on back and sides → square neckline, tidy around ears → top 1.5–2 in following head shape → light cream |
| 24 | Short Business Side Part | #2 on sides tapering to #1 at the nape → top 1.5–2 in, longer to the front → hard-defined side part → low-shine pomade |
| 25 | Clean Comb-Over Taper | Low taper #1 at the neckline to #2 on the sides → 2 in on top → blow-dry over to one side → medium-hold pomade |
| 26 | Caesar Cut | #3 on sides and back → top about 1 in, brushed forward → straight blunt short fringe → light point-cut texture |
| 27 | Textured French Crop | Low or mid fade on the sides → 1.5 in on top, point-cut for texture → short blunt fringe → matte texture powder |
| 28 | Long Layers + Side-Swept Fringe | Keep perimeter length, 90° layers from the chin down → long side-swept fringe from a deep side part → point-cut ends → round-brush blow-dry |
| 29 | Classic Layered Lob | Perimeter just above the shoulders → long internal layers at 45° → soft face-framing pieces → smooth blow-dry with a slight bend |
| 30 | Polished Blunt Bob | 0° blunt perimeter at chin level → no interior layers → side or centre parting → flat-iron smooth |
| 31 | Sleek Step Cut | Keep perimeter length → 3–4 distinct steps at the front and sides from the chin → keep each step blunt → blow-dry straight |
| 32 | Korean C-Curl Layers | Medium layers from the collarbone → soft see-through face-framing pieces → blow-dry ends under (C-curl) → light hair oil |
| 33 | Soft Wolf Cut | Razor-cut short choppy crown layers → keep and thin the length at back and sides → curtain fringe → scrunch-dry with texture spray |

---

## 7. Known gaps

- **Men's smoothening/perm has only 3 looks** (Men's Keratin Smoothening, Men's Texture Perm, Hair Botox Frizz Control), so that service shows 3 cards.
- **Catalogue size:** 31 haircuts, 10 beard styles, 10 colour looks and 6 smoothening/perm looks (57 in total). Honey Balayage (#7) and Keratin Smoothening (#15) now count as colour and smoothening looks, not haircuts. The full list is in `backend/app/ai/style_catalogue.py`; the tables in section 5 cover the haircut list.
- **The 13 newer styles (21–33) have no catalogue reference photo yet.** Their personalized previews work normally; only the small "Style Reference" thumbnail is missing.
- **Hair density is always Unknown**, so the density points (+25) never apply until a stylist enters the density.
- Adding a style only needs a new catalogue entry plus a plain description for the image model (`EDIT_DESCRIPTIONS`); no code changes.
