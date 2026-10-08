# Salon AI Personalization Platform — System Documentation

This is the full reference for how the system works: what it does, how it is built, the user flows, the AI pipeline, the API, the data model, configuration and known limitations.

Related documents in the repo:

- [HAIRSTYLE_RECOMMENDATION_GUIDE.md](HAIRSTYLE_RECOMMENDATION_GUIDE.md): face-shape rules, scoring table and the full style catalogue
- [model-to-use.md](model-to-use.md): image-model options and per-image costs
- [ARCHITECTURE.md](ARCHITECTURE.md): original target architecture (parts of it are planned, not built; see [section 13](#13-current-limitations-and-known-gaps))

---

## Contents

1. [What the system does](#1-what-the-system-does)
2. [Technology stack](#2-technology-stack)
3. [Repository layout](#3-repository-layout)
4. [Runtime architecture](#4-runtime-architecture)
5. [Users, roles and authentication](#5-users-roles-and-authentication)
6. [End-to-end flows](#6-end-to-end-flows)
7. [AI pipeline](#7-ai-pipeline)
8. [Customer intelligence, analytics and offers](#8-customer-intelligence-analytics-and-offers)
9. [API reference](#9-api-reference)
10. [Data model](#10-data-model)
11. [Frontend](#11-frontend)
12. [Configuration, setup and operations](#12-configuration-setup-and-operations)
13. [Current limitations and known gaps](#13-current-limitations-and-known-gaps)

---

## 1. What the system does

A tablet-first web app for a multi-branch unisex salon (sample brand "LUXE Styling", branches in Chennai). In the chair, the customer or stylist:

1. Logs in, or a staff member selects the customer.
2. Takes a front photo, plus optional side and back photos.
3. Computer vision measures face shape, hair length, texture, colour, hairline and beard.
4. The customer picks a collection (Men / Women), services (Haircut, Beard, Colour, Smoothening/Perm) and a category (Classic / Trendy / Professional).
5. A rule-based recommendation engine picks the best 4 looks from a fixed catalogue.
6. An image-editing model applies each look to the customer's own photo. Every result is checked automatically: same person, face unchanged, background unchanged, hair colour kept.
7. The customer chooses one look. The stylist gets step-by-step cutting instructions, personalised to the customer's hair, in English, Hindi or Tamil, as text and spoken audio.
8. After the service, the stylist uploads "after" photos. The visit is recorded with a before / AI preview / after comparison.

It also includes customer history and profiles, saved favourite styles, referral share links (WhatsApp/SMS), customer tiers (New → VIP), and an admin area with capacity analytics, campaigns and discount offers.

**Key design rule:** the AI image model never *chooses* a hairstyle and never generates a new person. The recommendation engine picks the style; the image model only edits the customer's own photo; validation rejects any result that changes the person.

---

## 2. Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router 7, TanStack Query, react-hook-form + zod, lucide-react icons |
| Backend | Python 3.11, FastAPI, Uvicorn, Pydantic v2 / pydantic-settings, SQLAlchemy 2.x |
| Database | SQLite (`backend/salon_ai.db`, default) or MySQL 8 (via `DATABASE_URL`) |
| Computer vision | MediaPipe Face Landmarker (478 points), MediaPipe hair segmenter, OpenCV SFace face recognition, OpenCV Haar cascade (small-face fallback) |
| Image editing (pluggable) | Google Gemini (`gemini-2.5-flash-image`, `gemini-3-pro-image-preview`), OpenRouter, Cloudflare Workers AI (FLUX.2-klein-4B), NVIDIA NIM (FLUX), Hugging Face Space (Qwen-Image-Edit, testing only) |
| Translation | Gemini text model `gemini-2.5-flash-lite` |
| Text-to-speech | `edge-tts` (Microsoft Edge neural voices: `en-IN-NeerjaNeural`, `hi-IN-SwaraNeural`, `ta-IN-PallaviNeural`); browser `speechSynthesis` as fallback |
| Images | Pillow, pillow-heif (HEIC/AVIF), NumPy |
| Auth | Self-implemented HS256 JWT, PBKDF2-SHA256 password hashes |
| Deployment (prepared) | Docker, docker-compose (MySQL, Redis, backend, frontend), Nginx |

---

## 3. Repository layout

```
backend/
  app/
    main.py                  App startup: create tables, auto-add columns, seed data, mount media, routers
    api/v1/endpoints.py      All REST endpoints (one router, prefix /api/v1)
    core/
      config.py              Settings (env vars / .env)
      database.py            SQLAlchemy engine, session, Base
      auth.py                Principal, login guards, role sets, seeding of roles and sample accounts
      security.py            JWT create/decode, PBKDF2 password hashing
      storage.py             Local file storage under media_storage/
      reference_data.py      Seeds branches and the price-list services
    ai/
      face_analysis.py       Photo normalisation + face/hair analysis (front and back photos)
      vision_models.py       MediaPipe/OpenCV model wrappers, face-shape, hair length/texture/colour maths
      recommendation_engine.py  Scoring and slot allocation for the 4 recommended looks
      style_catalogue.py     The full catalogue: haircuts, beard, colour, texture looks + edit descriptions
      prompt_engine.py       Builds the controlled image-edit prompts
      image_editing.py       Provider classes, generation loop, validation, caching
      nvidia_nim.py          NVIDIA NIM provider
      instruction_audio.py   Translation (Gemini) + speech (edge-tts) for cutting steps
      errors.py              ImageEditError
    analytics/               capacity_analytics, discount_optimizer, rfm_segmentation
    campaigns/               campaign_manager (coupons, referral codes, loyalty points)
    integrations/            notifications (WhatsApp/SMS/Email stubs)
    models/domain.py         All ORM tables
    schemas/domain_schemas.py Pydantic request/response models
  ai_models/                 face_landmarker.task, hair_segmenter.tflite, SFace .onnx, download_models.py
  media_storage/             Uploaded and generated images, audio, AI cache (served at /static/media)
  scripts/                   migrate_sqlite_to_mysql.py, seed_sample_visits.py
  tests/                     Experimental/diagnostic scripts (not an automated test suite)
frontend/
  src/
    routes/AppRoutes.tsx     All routes and route guards
    api/client.ts            Every backend call
    auth/                    session.ts (localStorage session), RequireAuth.tsx (guards)
    layouts/                 Customer, Admin, Stylist layouts
    pages/customer|staff|stylist|admin|public/
    components/              Camera capture, multi-view capture, comparison viewer, profile, insights...
    utils/                   continueStyle, previousStyle, workBranch
infra/
  docker/                    Dockerfile.backend, Dockerfile.frontend, docker-compose.yml
  nginx/default.conf         Serves the SPA, proxies /api and /static/media to the backend
requirement-analysis/        Original requirement notes and recordings
sample-pic/                  Sample photos for testing
```

---

## 4. Runtime architecture

What actually runs today:

```
 Tablet / phone / desktop browser
            │  (https in dev via `npm run dev:https` so the camera works on LAN)
            ▼
 Vite dev server :5173  ──proxy /api, /static──►  FastAPI (Uvicorn) :8000
 (or Nginx :80 in Docker)                              │
                                                       ├── SQLite salon_ai.db  (or MySQL 8)
                                                       ├── media_storage/  (photos, previews, audio, cache)
                                                       ├── MediaPipe + OpenCV models (in-process, CPU)
                                                       └── HTTPS calls to external AI services:
                                                             - Image edit provider (Gemini / OpenRouter /
                                                               Cloudflare / NVIDIA NIM / HF Space)
                                                             - Gemini text (translation)
                                                             - Microsoft Edge TTS (speech)
```

- **Single process.** All AI work runs inside the FastAPI request (`async` + `asyncio.gather`). There is no job queue. A `Semaphore(MAX_PARALLEL_GENERATIONS)` limits concurrent provider calls. The database connection is released before the provider is called, so a slow preview doesn't hold a connection.
- **`APP_ENV`** (`development` by default, or `production`) changes startup:

  | Step | development | production |
  |---|---|---|
  | Configuration check (`check_settings`) | prints problems | **refuses to start** on the default `SECRET_KEY`, CORS `*`, or a test-only image provider |
  | Create tables / add missing columns ([backend/app/core/migrations.py](backend/app/core/migrations.py)) | automatic | run `python -m app.core.migrations` once before starting (Docker does this) |
  | `seed_auth()` | roles + sample `admin` / `stylist` accounts + a must-change password for demo customers without one | roles only, never a known password |
  | `seed_reference_data()` | branches + price list | same |
  | API docs `/docs` | on | off |

- **Media** under `media_storage/` is not served openly. Every API response passes through `SignedMediaJSONResponse`, which adds an expiring signature to each `/static/media/...` address (`?exp=…&sig=…`, valid `MEDIA_URL_EXPIRE_MINUTES`, default 6 h). The `/static/media/{path}` route serves a file only with a valid signature. When the browser sends an address back, the signature is removed before storing (`media_path()`).

---

## 5. Users, roles and authentication

### Roles

| Kind | Roles | Can do |
|---|---|---|
| Staff (`users` table) | Super Admin, Salon Admin, Receptionist, Stylist | Work with any customer; staff-only actions (`require_staff`): add customers, reset passwords, **confirm and complete a service** |
| Admin (subset of staff) | Super Admin, Salon Admin | Additionally analytics and offers (`require_admin`), the `/admin/*` area, erasing a customer's photos |
| Customer (`customers` table) | Customer | Only their own data (`ensure_customer_access`) |

### Login and passwords

- **Staff:** `POST /api/v1/auth/login` (form: `username`, `password`).
- **Customer:** `POST /api/v1/auth/customer/login` with a mobile number **or** customer ID (`CUST-xxxx`) plus a password. Mobile numbers are normalised to the last 10 digits. Family profiles can share one number (`profile_label`: Self, Spouse, Child, Parent, Other); if the password matches more than one profile, the API returns 409 and asks for the customer ID. This is only reachable with a correct password, so it doesn't reveal which numbers are registered.
- **Self-registration:** `POST /api/v1/auth/customer/register`. Requires a valid Indian mobile (`[6-9]` + 9 digits) and a password of at least `PASSWORD_MIN_LENGTH` (8) characters with both letters and digits. A number that is already registered must log in; family profiles are added by staff.
- **Staff-added customers** get a random **one-time password**, shown once to staff, with `must_change_password` set. A login with it returns a token carrying `mcp: true`, which the server accepts **only** for `POST /auth/customer/change-password`. Every other call returns 403 until the customer picks their own password.
- **Forgotten password:** staff issue a new one-time password (`POST /customers/{id}/reset-password`). There is no SMS/OTP provider yet.
- **Lockout:** after `LOGIN_MAX_FAILURES` (5) failed attempts per account or per client address, logins are refused (429) for `LOGIN_LOCKOUT_MINUTES` (15). This is kept in memory per process; use Redis when running several workers.
- **Hashes:** PBKDF2-SHA256, 600,000 iterations, salted. Older hashes (unsalted SHA-256, or fewer iterations) are still accepted and **re-hashed on the next successful login**.

### Tokens

- HS256 JWT (`python-jose`) signed with `SECRET_KEY`. Staff tokens last `STAFF_TOKEN_EXPIRE_MINUTES` (12 h), customer tokens `CUSTOMER_TOKEN_EXPIRE_MINUTES` (2 h). Subject is `staff:<id>` or `customer:<id>`, with `role`, `name` and optionally `mcp` claims.
- Sent as `Authorization: Bearer <token>`. On any 401 the frontend clears the device session and redirects to the right login page.

### Stylist approval on a customer's session

Confirming and completing a service are staff actions. When a **customer** is logged in on the tablet, those screens show a small stylist sign-in (`StaffApproval`). The stylist's token is used for that one request and is not stored on the device.

### Seeded development accounts

Created only when `APP_ENV=development`, by `seed_auth()` in [backend/app/core/auth.py](backend/app/core/auth.py):

| Username | Role |
|---|---|
| `admin` | Salon Admin |
| `stylist` | Stylist |

### Frontend session

Stored in `localStorage` under `salon_session`. The flow state (photo id, recommendation id, selected style, etc.) is also kept in `localStorage` (`salon_*` keys) and cleared on logout **and whenever staff select another customer** (`clearCustomerContext()`), so data never carries over between customers. A customer's own session ends after **10 minutes without activity** (`useIdleLogout`) on shared tablets.

---

## 6. End-to-end flows

### 6.1 Main in-salon flow (customer or staff-assisted)

```
/customer/login ─► /customer/photo ─► /customer/service ─► /customer/generate ─► /customer/recommendations
                                                                                         │
     /customer/history ◄── /customer/confirmation ◄── /customer/instructions ◄──────────┘
```

| Step | Page | What happens | API calls |
|---|---|---|---|
| 1. Login / identify | `CustomerLoginPage` | Customer logs in or registers. Returning customers can jump straight to "Continue previous style" or reuse their last photo session. | `auth/customer/login`, `auth/customer/register`, `customer-history/{id}` |
| 2. Consent + photos | `PhotoUploadPage` (`ConsentPanel`, `CameraCapture`, `MultiViewCapture`) | Consent is recorded first (see 6.6). Front photo (required), side and back (optional). Backend converts to JPEG, runs CV analysis, rejects photos with no face or a face under 120 px. | `GET/PUT customers/{id}/consent`, `POST customers/{id}/photo` |
| 2b. Confirm analysis | `HairAnalysisCard` | Stylist (or customer) can correct **face shape, texture, length, density and beard**. Density must be chosen, since a photo can't show it. Corrections immediately re-run the service rules on the page. | `PATCH photos/{id}/analysis` |
| 3. Preferences | `ServiceCategoryPage` | Collection (Men/Women), services (multi-select), category. Pre-filled from last visit. Beard is disabled for Women and clean-shaven customers; hair services are disabled for bald customers. **The server enforces the same rules** and returns a 422 with the reason, which is shown on the page. | `customers/{id}/last-preferences`, `POST style-recommendations` |
| 4. Generate | `GeneratePage` | Short transition; marks generation as pending. | — |
| 5. Previews | `RecommendationsPage` | Shows the 4 recommended looks. **Each card calls the generation API separately**, so each preview appears as soon as it is ready. Failed cards show "Preview unavailable" with a Retry button. A catalogue photo, if shown, is labelled "Style Reference" and never presented as the customer's preview. Looks can be saved as favourites. | `POST style-generations` (one style per call), `POST customers/{id}/saved-styles` |
| 6. Choose | `RecommendationsPage` | Saves the selection, then starts side/back previews in the background. | `POST style-selections`, `POST style-selections/{id}/views` |
| 7. Instructions | `CuttingInstructionsPage` | Cutting steps (catalogue steps + personal notes) in en/hi/ta, spoken audio, front/side/back AI previews. **Stylist** taps "Confirm & start haircut" (stylist sign-in if a customer is logged in). | `GET instructions/{style_id}`, `GET instructions/{style_id}/audio`, `GET style-selections/{id}/comparison`, `POST style-selections/{id}/confirm-haircut` (staff) |
| 8. Complete | `BeforeAfterConfirmationPage` | **Stylist** uploads after-photos (front required) and rating 1–5. Allowed only after confirmation and **only once**: the selection is claimed atomically (`CONFIRMED → COMPLETING → COMPLETED`), so a double tap cannot create two visits. Creates the visit (credited to the stylist who completes it), service history and spend totals, and converts a pending referral. | `POST style-selections/{id}/complete` (staff) |
| 9. History | `CustomerHistoryPage` | Visits, latest look, AI previews, saved styles. | `GET customer-history/{id}` |

### 6.2 Staff flow

1. `/staff/login` → `/stylist/customers` (`StaffCustomersPage`).
2. Choose the **working branch** for this tablet (`BranchSelector`, stored as `salon_work_branch_id`; recorded on each completed visit).
3. Search customers by name, customer code or mobile (≥ 4 digits). Phone numbers are never returned in the list; phone matches are flagged `matched_by_phone`. Filter by branch: customers registered at, or who visited, that branch.
4. Add a walk-in customer (`AddCustomerForm`) with an optional profile photo.
5. For the selected customer: **new photo** → `/customer/photo`, **reuse last photos** → `/customer/service`, or **continue previous style** → `/customer/instructions`.
6. From there the flow is the same as 6.1.

The returning-customer view shows a visitor status: `NEW_CUSTOMER`, `CROSS_BRANCH_VISITOR` (first time at this branch), or `RETURNING_BRANCH_CUSTOMER`.

### 6.3 "Continue previous style"

`frontend/src/utils/continueStyle.ts` decides what to continue, in this order:

1. the last chosen style,
2. else the newest saved style,
3. else the newest AI preview,
4. else the last photo session (reuse photos and retry previews).

For a style, `preparePreviousStyle()` records a **new** selection for this visit with the old reference image. The reference must be one of this customer's own previews of that style. The earlier selection's side/back AI previews are copied only while that photo session is still current. The old recommendation is not linked, so the "before" photo is the customer's current one.

**Stale photos:** a photo session can be reused for new previews only while it is newer than `PHOTO_REUSE_MAX_DAYS` (30) **and** no haircut has been completed since. Otherwise "Continue" asks for new photos.

### 6.4 Referral share link

1. Customer requests a link: `POST referrals/share-link` creates a random code once (`LUXE-XXXXXXXX`, not guessable from the customer id).
2. Shared as `${VITE_PUBLIC_APP_URL}/r/<code>` via WhatsApp/SMS.
3. `/r/:code` (`SharedReferralPage`, public) shows the referrer's first name, their latest hairstyle preview and the discount (`REFERRAL_DISCOUNT_PERCENT`, default 15%).
3a. The referrer's photo is shown only if they consented to before/after sharing; otherwise just the style name and offer.
4. A new customer who registers with the code gets a `Referral` row with status `REGISTERED`. Using the referrer's own mobile number (same person or family) is not a referral.
5. The referral becomes `CONVERTED` when the referred customer's first paid visit (≥ `min_spend_required`) is completed. Any reward should be paid at that point.

### 6.5 Admin flow

`/admin/*` (admin roles only): dashboard (`AdminDashboardPage`), customers (`CustomersPage`), capacity heatmap (`CapacityAnalyticsPage`), offers/coupons (`CampaignsPage`). Pages that aren't built yet (catalogue, referrals, membership, loyalty, settings) are not routed or listed.

### 6.6 Consent and erasure (DPDP Act)

[backend/app/core/privacy.py](backend/app/core/privacy.py), `ConsentPanel` on the photo page.

| Consent | Required for |
|---|---|
| Photo analysis | uploading/analysing photos (`403` otherwise) |
| External AI image service | creating any preview (front, side/back, HQ) |
| Parent/guardian (minors: profile "Child" or date of birth under 18) | photos of a minor. Only **staff** can record it, because they can see who is giving it |
| History retention | keeping photos after the visit. Without it, `scripts/purge_media.py` erases them after `MEDIA_RETENTION_DAYS_WITHOUT_CONSENT` (1) day |
| Before/after sharing | showing the look on the public referral page |
| Marketing | offers by WhatsApp/SMS |

- Each change is stored as a new `customer_consents` row (an audit trail with `recorded_by`). Only rows with the current `CONSENT_POLICY_VERSION` count, so changing the consent text asks everyone again.
- **Erasure:** `DELETE /customers/{id}/photos` (the customer, or an admin) deletes every photo, AI preview, after-photo, AI-cache copy and stored face measurement. Visits and bills are kept. Customers find it under Profile → Privacy.

---

## 7. AI pipeline

### 7.1 Photo intake and analysis

[backend/app/ai/face_analysis.py](backend/app/ai/face_analysis.py), [backend/app/ai/vision_models.py](backend/app/ai/vision_models.py)

1. **Normalise:** every upload (JPG, PNG, WebP, HEIC, AVIF) is EXIF-rotated, downscaled to at most 2048 px and saved as JPEG.
2. **Face detection:** MediaPipe Face Landmarker (478 points). For small faces (e.g. full-body photos), a Haar cascade finds the face, then landmarks are re-run on an enlarged crop.
3. **Quality checks:** no face → reject; face width < 120 px (at the 1024 px analysis size; SFace identity checks need about 112 px) → reject; sharpness (Laplacian variance > 30) and brightness (50–220) produce warnings. Previews also require `GENERATION_MIN_FACE_PX` (120).
4. **Face shape:** from the ratios length/cheekbone-width, forehead/cheekbone and jaw/cheekbone → Oval, Round, Square, Oblong, Heart, Diamond. Returns **Unknown** when the head is turned, the face is small, or confidence is below 0.6. The thresholds are in [HAIRSTYLE_RECOMMENDATION_GUIDE.md](HAIRSTYLE_RECOMMENDATION_GUIDE.md).
5. **Hair (from the segmentation mask):**
   - colour: median LAB value → named colour,
   - length: hair end relative to the chin → Short / Medium / Long / Very Long, or Bald,
   - texture: strand orientation coherence → Straight / Wavy / Curly, else Unknown,
   - hairline, and a "current hairstyle" summary.
6. **Beard:** lightness of the lower face vs. cheek skin → Full Beard / Stubble / Clean Shaven.
7. **Density:** not measurable from photos, so it stays **Unknown** until the stylist or the customer chooses it (`PATCH photos/{id}/analysis`). The same endpoint corrects face shape, texture, length and beard when the camera misread them.
8. **Back photo (optional):** fills in texture and colour when the front could not measure them.

The full result is stored in `customer_photos.facial_features_json`.

### 7.2 Recommendation engine

[backend/app/ai/recommendation_engine.py](backend/app/ai/recommendation_engine.py)

- **Catalogue** ([backend/app/ai/style_catalogue.py](backend/app/ai/style_catalogue.py)): 57 looks across 4 services.

  | Service | Ids | Count |
  |---|---|---|
  | Hair (haircuts) | 1–33 (except 7 and 15) | 31 |
  | Beard | 101–110 | 10 |
  | Colour | 7, 201–209 | 10 |
  | Texture (smoothening/perm) | 15, 301–305 | 6 |

- Services picked in the UI are parsed in order (`parse_services`). Beard is removed for the Women's collection.
- Every style of each picked service is **scored**: collection match, face shape, density, texture family, category, requested chemical service, and a heavy penalty for styles longer than the current hair (a haircut cannot add length). Styles from the other collection score −100 and are dropped. The full table is in the recommendation guide.
- Within each service, styles in the **chosen category** come first, then the others, by score. The category is an ordering rule only and is not also added to the score, so a poor fit in the chosen category cannot outrank a perfect fit through double counting.
- Server-side service rules: no Beard for the Women's collection; no hair services (cut, colour, texture) for a bald scalp. If nothing possible remains, the API returns 422 with the reason.
- `STYLE_RECOMMENDATION_COUNT` slots (default 4) are shared round-robin across the picked services (e.g. Hair + Beard → 2 + 2).
- Each look carries a feasibility status (*Achievable Today*, *Needs Extensions / Growth*, *Requires Chemical Service*), an optional chemical add-on (price/time), an explanation, and, if not feasible, a `suggested_alternative`.

### 7.3 Prompt engine

[backend/app/ai/prompt_engine.py](backend/app/ai/prompt_engine.py) (template version `hair-edit-v7`)

- Customers never write prompts. The prompt is built from the catalogue's **literal edit description** (`EDIT_DESCRIPTIONS`). Style names are not sent, because names like "butterfly cut" get drawn literally.
- Fixed blocks: identity preservation, a "do not" list (no new person, no change to skin, clothes, background or camera), and realism (hair must connect naturally to the scalp, same framing).
- Each service only changes its own area: haircut → cut only; Beard → beard only; Colour → colour only; Texture → texture only.
- Guard prompts for impossible edits: a bald customer keeps a bald scalp; a clean-shaven customer is not given a beard (except the Clean Shave look).
- Retries use a **strict** variant ("face pixel-identical; only hair pixels may change").
- Providers with an 800-character limit (Cloudflare, NVIDIA, HF) get a compact prompt.
- Accessories (bindi, earrings, makeup) are deliberately never named, because edit models tend to draw whatever is mentioned.

### 7.4 Image generation and validation

[backend/app/ai/image_editing.py](backend/app/ai/image_editing.py), `HairStyleGenerator.generate()`:

```
customer front photo
  → detect face → head-and-shoulders crop, max side 1024 px, multiples of 16
  → cache source: face embedding (SFace), hair mask, hair LAB, skin LAB
  → for attempt in 1..GENERATION_MAX_ATTEMPTS (default 2):
        last attempt after a validation reject → switch to IMAGE_EDIT_FALLBACK_PROVIDER if set
        build prompt (strict from attempt 2)
        check disk cache (media_storage/ai_cache/<photo-tag>_<sha256>.jpg/.json; key includes prompt
        and validation versions) → return on hit
        call provider (under the semaphore, GENERATION_TIMEOUT_SECONDS)
          on provider error → try IMAGE_EDIT_FALLBACK_PROVIDER if set, else fail
        log token usage and cost per call and per photo
        validate_edit() → if rejected, retry
        add "AI preview" label → write cache → save to media_storage/generated/
  → all attempts failed → ImageEditError (card shows "Preview unavailable" + Retry)
```

`validate_edit()` uses a **profile per service** (`validation_profile()`):

| Service | Identity threshold | Skin checked at | Hair colour may change |
|---|---|---|---|
| Hair, Texture | `IDENTITY_MIN_SIMILARITY` (0.363) | cheeks | no |
| Colour | 0.363 | cheeks | yes |
| Beard | `BEARD_IDENTITY_MIN_SIMILARITY` (0.30), since the lower face legitimately changes | forehead | no |

It rejects a result when:

| Check | Rule |
|---|---|
| Unchanged | fewer than 0.3% of pixels changed |
| No face | no face detected in the edited image |
| Re-framed | background-registered zoom outside 0.8–1.25 |
| Face moved | face shifted more than 0.25 face-widths or resized outside 0.8–1.25 |
| **Identity** | SFace cosine similarity < `IDENTITY_MIN_SIMILARITY` (0.363) |
| Skin tone | skin ΔE > 15 |
| Added marks | something new on the forehead (e.g. a bindi that was not there) |
| Hair missing | hair mask almost empty when the original had hair |
| Background | difference outside the hair region > 35 |
| Hair colour | hair ΔE > `HAIR_COLOUR_MAX_DELTA_E` (18), unless it is a Colour service |
| **Style not applied** (positive check) | Haircut: measured finished length is 2+ classes away from the style's length (e.g. a long result for a short cut). Colour: hair ΔE < 4. Beard: less than 4% of the lower face changed. Anything it can't measure passes. |

Each stored generation records the model, identity score, hair-consistency score (1 − ΔE/40), attempt count and failure reason.

**Never substituted:** if generation fails, the app never shows a catalogue photo or another customer's image as the customer's preview.

**Other generation modes:**

- **High quality** (`POST style-generations/high-fidelity`): the same pipeline with the HQ model (e.g. Gemini 3 Pro Image), saved as the selection's reference.
- **Side/back views** (`generate_view`): edits the side and back photos. There is no full face there, so only the "changed" and hair-colour checks apply. Beard looks skip the back view.

### 7.5 Image-edit providers

Selected with `IMAGE_EDIT_PROVIDER`:

| Value | Provider | Models (fast / HQ) | Notes |
|---|---|---|---|
| `gemini` (default) | Google Gemini API | `gemini-2.5-flash-image` / `gemini-3-pro-image-preview` | Needs a billing-enabled key (the free tier has no image quota). About $0.04 per image. |
| `openrouter` | OpenRouter | `google/gemini-2.5-flash-image` / `google/gemini-3-pro-image` | Pay-per-use credits |
| `cloudflare` | Workers AI | `@cf/black-forest-labs/flux-2-klein-4b` | Free plan about 90 previews/day; low resolution |
| `nvidia` | NVIDIA NIM | FLUX.2-klein-4B / FLUX.1-Kontext-dev | The hosted API only accepts NVIDIA's sample images; needs a self-hosted NIM |
| `huggingface` | Public HF Space (Qwen-Image-Edit-2511) | — | **Testing only**: photos go to a public third-party Space |

Optional `IMAGE_EDIT_FALLBACK_PROVIDER` is tried when the main provider errors. Cost comparison and recommendations: [model-to-use.md](model-to-use.md).

### 7.6 Cutting instructions, translation and audio

[backend/app/ai/instruction_audio.py](backend/app/ai/instruction_audio.py), plus `_customer_notes()` in `endpoints.py`.

- **Base steps** come from the catalogue's `stylist_instructions`.
- **Personal notes** are appended from the customer's analysis. Examples:
  - curly hair: cut dry or leave about 1 cm extra,
  - fine hair: avoid heavy thinning,
  - thick hair: remove bulk,
  - high hairline: keep the front longer,
  - existing fringe: confirm the new length first,
  - beard: current beard length limits what is possible,
  - texture service on curly hair: strand test first.
- **Translation** to Hindi (`hi`) or Tamil (`ta`) with Gemini `gemini-2.5-flash-lite`. Numbers and clipper guards are kept exactly. Results are cached in `instruction_translations`, keyed by style, language and a hash of the source text. If translation is unavailable, English is returned.
- **Audio:** edge-tts MP3s cached in `media_storage/audio/`. If the server voice fails, the frontend uses the browser's `speechSynthesis`.
- On **confirm haircut**, the personalised steps actually used are saved in `haircut_instructions.steps_json`, along with the language.

---

## 8. Customer intelligence, analytics and offers

| Feature | Where | How it works |
|---|---|---|
| Customer type | `_customer_type()` in `endpoints.py` | New (no visits/spend) → Regular → Priority (≥ ₹2,000 **or** ≥ 3 visits) → Premium (≥ ₹5,000, ≥ 6 visits, or an active membership) → VIP (≥ ₹10,000 **or** ≥ 10 visits). Thresholds are in config. |
| Visit insights | `_insights_for()` | Total and average spend, branches visited, top 3 frequent services, customer type |
| Last preferences | `GET customers/{id}/last-preferences` | Pre-selects collection, services, category and last hairstyle for returning customers |
| Dashboard | `GET /analytics/overview` (admin) | Customers, revenue (amount − discount) and visit count from **completed visits**, average spend, utilisation, active campaigns |
| Capacity heatmap | `analytics/capacity_analytics.py`, `GET /analytics/capacity` (admin) | Chair utilisation per weekday × hour (9–20) over the last 90 days: chair-minutes used by completed visits ÷ (chairs × 60 × occurrences of that weekday). Visits without times count 45 min. Optional `branch_id`. Returns peak and lean hours and `has_data`. |
| RFM segmentation | `analytics/rfm_segmentation.py` | Rule segments plus a logistic churn/return probability from recency vs. the customer's own average visit interval |
| Offer engine | `POST /analytics/recommend-offer` (admin) | Uses the **real** service price and cost, the requested slot's utilisation, the customer's RFM segment and membership, and the days since their last discount or coupon. Discount is inversely proportional to demand, +5% for at-risk customers or members, **no automatic discount within a 30-day cooldown**, and a margin guard: `final − cost ≥ 30% of final` (rounded down). The coupon is saved to `coupons`. |
| Notifications | `integrations/notifications.py` | WhatsApp / SMS / Email provider interfaces (currently log only) |

---

## 9. API reference

Base URL `/api/v1`. Interactive docs at `http://localhost:8000/docs`.

Auth column: **public** = no login, **any** = logged-in staff or customer (customers only for their own records), **staff** = staff only.

### Authentication

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/login` | public | Staff login (form data) |
| POST | `/auth/customer/login` | public | Customer login (mobile or customer ID + password) |
| POST | `/auth/customer/register` | public | Customer sign-up; returns a session |
| POST | `/auth/customer/change-password` | customer (also with a one-time password) | Set own password; returns a full session |
| GET | `/auth/me` | any | Current principal |

### Customers and branches

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/customers?query=&branch_id=` | staff | Directory with insights and previous style (no phone numbers) |
| POST | `/customers` | staff | Add a walk-in customer; returns a one-time `temporary_password` once |
| POST | `/customers/{id}/reset-password` | staff | New one-time password |
| GET / PUT | `/customers/{id}/consent` | any (parental consent: staff) | Read / record consent under the current policy |
| DELETE | `/customers/{id}/photos` | the customer or an admin | Erase all photos, previews and face measurements |
| GET | `/customers/lookup/{phone}` | staff | Returning-customer summary by phone |
| GET | `/customers/{id}/summary` | any | Summary used after login |
| GET | `/customers/{id}/profile` | any | Full profile: loyalty, membership, insights |
| GET | `/customers/{id}/last-preferences` | any | Last collection, services, category and style |
| POST | `/customers/{id}/avatar` | any | Profile photo |
| GET | `/branches` | staff | Active branches + the user's home branch |

### Photos and recommendations

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/customers/{id}/photo` | any | Multipart `file` (front), optional `side_file` and `back_file`; returns the analysis |
| PATCH | `/photos/{id}/analysis` | any | Correct face shape, texture, length, density, beard |
| POST | `/style-recommendations` | any | `{customer_id, photo_id, target_service_type, style_category, gender}` → 4 looks |
| GET | `/hairstyles` | public | The full catalogue |

### Generation

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/style-generations` | any (AI consent) | `{recommendation_id, selected_style_ids}` → previews (runs synchronously). Only styles recommended for that photo. |
| POST | `/style-generations/high-fidelity?recommendation_id=&style_id=` | any | HQ preview, saved as a selection |
| GET | `/style-generations/status/{job_id}` | any | Re-fetch a job's results (recovery after a dropped connection) |

### Selections and service

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/style-selections` | any | Choose a look. The recommendation must belong to the customer; the reference image must be the customer's own preview of that style. |
| POST | `/style-selections/{id}/views` | any | Generate side/back AI previews |
| GET | `/style-selections/{id}/comparison` | any | Before / AI / after for front, side, back |
| POST | `/style-selections/{id}/confirm-haircut` | **staff** | Stylist approval, start time, language, final steps |
| POST | `/style-selections/{id}/complete` | **staff** | After-photos (multipart), rating, branch, language → visit + history. Once only (409 afterwards). |
| POST | `/service-completion` | staff | Legacy: mark a visit completed |

### Saved styles and history

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/customers/{id}/saved-styles` | any | Save a favourite look |
| GET | `/customers/{id}/saved-styles` | any | List favourites |
| DELETE | `/saved-styles/{id}` | any | Remove a favourite |
| GET | `/customer-history/{id}` | any | Visits, latest look, AI previews, selections, saved styles, latest photo |

### Instructions

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/instructions/{style_id}?lang=en\|hi\|ta&selection_id=` | any | Cutting steps (personalised when `selection_id` is given) |
| GET | `/instructions/{style_id}/audio?lang=&selection_id=` | any | MP3; header `X-Audio-Language` gives the language used |

### Referrals

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/referrals/share-link` | any | Get or create the customer's share code |
| GET | `/referrals/{code}/public` | public | Data for the public share page |

### Analytics

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/analytics/overview` | admin | Dashboard KPIs from completed visits |
| GET | `/analytics/capacity?branch_id=` | admin | Heatmap, peak and lean hours (last 90 days) |
| POST | `/analytics/recommend-offer` | admin | `{customer_id, service_id, requested_day, requested_hour}` → discount + saved coupon |

Image addresses in every response are signed and expire (see [section 4](#4-runtime-architecture)).

Errors use FastAPI's `{"detail": "..."}` format, written as user-facing messages (e.g. *"Please make sure your face is clearly visible."*). Status codes used: 401, 403, 404, 409, 422, 429 (login lockout), 502 and 503.

---

## 10. Data model

All tables are defined in [backend/app/models/domain.py](backend/app/models/domain.py).

### Core flow tables

```
customers ─┬─< customer_photos ─< style_recommendations ─< style_generations
           │                              │
           ├─< style_selections >─────────┘ (recommendation_id)
           │        ├─< haircut_instructions
           │        ├─< service_photos   (stage: ai|after, view: front|side|back)
           │        └─< customer_visits ─< service_history >── services
           ├─< saved_styles
           ├─< referrals (referrer / referred)
           └── home_branch_id ──> branches
```

| Table | Purpose / key fields |
|---|---|
| `branches` | Salon branches (`branch_code`, name, city, `total_chairs`) |
| `users`, `roles`, `permissions` | Staff accounts; `users.branch_id` is the home branch |
| `customers` | Profile, `customer_code` (CUST-…), `phone_number` (shared by family profiles), `profile_label`, gender, `segment_name`, `total_visits`, `total_spent`, `password_hash`, `must_change_password`, `home_branch_id`, `avatar_url` |
| `customer_consents` | One row per consent change: photo analysis, external AI, retention, marketing, before/after sharing, parental consent, `policy_version`, `recorded_by` |
| `customer_photos` | Front/side/back URLs + analysis (`face_shape`, `hair_length`, `hair_density`, `beard_style_current`, `facial_features_json`) |
| `style_recommendations` | Inputs (services, category) + `recommended_style_ids_json` |
| `style_generations` | One row per preview: `job_id`, `style_id`, image URL, prompt, status, model, identity/hair scores, attempts, failure reason |
| `style_selections` | Chosen look, `style_name` (snapshot at selection time, used in history), `reference_image_url`, `status` (CONFIRMED → COMPLETING → COMPLETED), `stylist_approved` (set by the stylist's confirmation), `instruction_language`, `haircut_confirmed_at` |
| `haircut_instructions` | Steps used for that selection |
| `service_photos` | AI side/back previews and actual after-photos per view |
| `customer_visits` | Visit record: branch, stylist, amount, start/end time, `selection_id`; `notes='SAMPLE DATA'` marks demo rows |
| `service_history` | Service, hairstyle or beard style, reference and final photo, rating |
| `saved_styles` | Favourite looks with image and steps |
| `instruction_translations` | Translation cache |
| `services`, `service_categories` | Price list (seeded: Haircut & Styling ₹500, Beard Trim ₹300, Premium Hair Color ₹1,800, Keratin Smoothening ₹2,500) |

### Supporting / future tables

`customer_preferences`, `customer_segments`, `stylists`, `stylist_skills`, `stylist_shifts`, `appointments`, `hairstyles`, `beard_styles` (DB mirror of the catalogue; **the app reads the catalogue from code**), `payments`, `memberships`, `membership_transactions`, `loyalty_accounts`, `loyalty_transactions`, `campaigns`, `coupons`, `coupon_redemptions`, `referrals`, `notification_logs`, `salon_capacity`, `salon_resources`, `analytics_snapshots`, `ai_feedback`, `audit_logs`.

**Style ids:** `selected_hairstyle_id`, `style_id` etc. refer to **catalogue ids** in `style_catalogue.py`. Beard, colour and texture ids (101+, 201+, 301+) are stored in the same columns.

### Media storage layout (`backend/media_storage/`, served at `/static/media/...`)

| Folder | Contents |
|---|---|
| `original/` | Customer front/side/back photos |
| `generated/` | AI previews (`gen_style_<id>_*.jpg`) |
| `final/` | After-haircut photos |
| `avatars/` | Profile photos |
| `audio/` | Cached instruction MP3s |
| `ai_cache/` | Generation cache (`<photo-tag>_<hash>.jpg` + `.json` scores; the photo tag lets erasure find the copies; removed after `AI_CACHE_MAX_DAYS`) |

---

## 11. Frontend

### Routes ([frontend/src/routes/AppRoutes.tsx](frontend/src/routes/AppRoutes.tsx))

| Path | Guard | Page |
|---|---|---|
| `/` | — | → `/customer/login` |
| `/r/:code` | public | `SharedReferralPage` |
| `/staff/login` | public | `StaffLoginPage` |
| `/customer/login` | public | `CustomerLoginPage` |
| `/customer/photo` | customer-area | `PhotoUploadPage` |
| `/customer/service`, `/customer/style-category` | customer-area | `ServiceCategoryPage` |
| `/customer/generate` | customer-area | `GeneratePage` |
| `/customer/recommendations`, `/customer/style/:styleId` | customer-area | `RecommendationsPage` |
| `/customer/instructions` | customer-area | `CuttingInstructionsPage` |
| `/customer/confirmation` | customer-area | `BeforeAfterConfirmationPage` |
| `/customer/history` | customer-area | `CustomerHistoryPage` |
| `/customer/profile` | customer-area | `CustomerProfilePage` |
| `/stylist/customers` | staff | `StaffCustomersPage` |
| `/stylist/appointments` | staff | `StylistDashboardPage` |
| `/stylist/instructions`, `/stylist/style/:id` | staff | `CuttingInstructionsPage` |
| `/stylist/service-completion` | staff | `BeforeAfterConfirmationPage` |
| `/admin/dashboard` | admin | `AdminDashboardPage` |
| `/admin/customers[/:id]` | admin | `CustomersPage` |
| `/admin/analytics/capacity` | admin | `CapacityAnalyticsPage` |
| `/admin/campaigns` | admin | `CampaignsPage` |
| any other `/admin/*` | admin | → dashboard |

Guards ([frontend/src/auth/RequireAuth.tsx](frontend/src/auth/RequireAuth.tsx)):

- `customer-area`: a logged-in customer (who has replaced any one-time password), or staff who have selected a customer.
- `staff`: any staff role.
- `admin`: Super Admin or Salon Admin.

### Key components

| Component | Purpose |
|---|---|
| `CameraCapture`, `MultiViewCapture` | Live camera capture for front/side/back (needs https or localhost) |
| `HairAnalysisCard` | Shows the analysis; density/length confirmation |
| `ComparisonViewer` | Before / AI / after per view |
| `CustomerFullProfile`, `CustomerInsights` | Profile, tier, spend, branches, frequent services, repeatable styles |
| `AddCustomerForm` | Staff walk-in registration |
| `BranchSelector` | Choose the tablet's working branch |
| `ConsentPanel` | Consent choices before photos (parental consent for minors, staff only) |
| `StaffApproval` | One-off stylist sign-in for confirm/complete on a customer's session |

### Client state

`localStorage` keys carry the flow between pages: `salon_photo_id`, `salon_original_image_url`, `salon_photo_analysis`, `salon_recommendation_id`, `salon_recommended_styles`, `salon_generated_results`, `salon_generation_pending`, `salon_selected_style`, `salon_selection_id`, `salon_customer_id`, `salon_work_branch_id`. All API calls go through `apiFetch()` in [frontend/src/api/client.ts](frontend/src/api/client.ts).

---

## 12. Configuration, setup and operations

### Backend settings ([backend/app/core/config.py](backend/app/core/config.py); set in `backend/.env`)

| Setting | Default | Meaning |
|---|---|---|
| `APP_ENV` | `development` | `production`: strict config check, no sample accounts, no auto-ALTER, no `/docs` |
| `DATABASE_URL` | `sqlite:///./salon_ai.db` | Use `mysql+pymysql://user:pass@host:3306/salon_ai_db` for MySQL |
| `SECRET_KEY` | dev value | JWT and media-link signing key: **32+ random characters in production** (enforced) |
| `STAFF_TOKEN_EXPIRE_MINUTES` / `CUSTOMER_TOKEN_EXPIRE_MINUTES` | 720 / 120 | Token lifetimes |
| `PASSWORD_MIN_LENGTH` | 8 | Customer passwords (letters and digits) |
| `LOGIN_MAX_FAILURES` / `LOGIN_LOCKOUT_MINUTES` | 5 / 15 | Login lockout |
| `MEDIA_URL_EXPIRE_MINUTES` | 360 | Lifetime of signed image links |
| `PHOTO_REUSE_MAX_DAYS` | 30 | Max age of a reusable photo session |
| `MEDIA_RETENTION_DAYS_WITHOUT_CONSENT` / `AI_CACHE_MAX_DAYS` | 1 / 30 | Retention job |
| `BACKEND_CORS_ORIGINS` | localhost:5173 | Extra allowed origins (no `*` in production) |
| `SALON_NAME` | LUXE Styling | Shown on share pages |
| `VIP_/PREMIUM_/PRIORITY_MIN_SPEND/VISITS` | 10000/10, 5000/6, 2000/3 | Customer-type thresholds |
| `REFERRAL_DISCOUNT_PERCENT` | 15 | Referral offer |
| `IMAGE_EDIT_PROVIDER` | `gemini` | `gemini` / `openrouter` / `cloudflare` / `nvidia` / `huggingface` |
| `IMAGE_EDIT_FALLBACK_PROVIDER` | empty | Backup provider |
| `GEMINI_API_KEY`, `GEMINI_FAST_MODEL`, `GEMINI_HQ_MODEL` | — | Gemini image + translation |
| `OPENROUTER_API_KEY`, `OPENROUTER_FAST_MODEL`, `OPENROUTER_HQ_MODEL` | — | OpenRouter |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_MODEL` | — | Cloudflare Workers AI |
| `NVIDIA_NGC_API_KEY`, `NVIDIA_NIM_FAST_URL`, `NVIDIA_NIM_HQ_URL` | — | NVIDIA NIM |
| `HF_SPACE_ID`, `HF_TOKEN`, `HF_SPACE_STEPS` | — | Hugging Face Space |
| `STYLE_RECOMMENDATION_COUNT` | 4 | Looks per customer |
| `MAX_PARALLEL_GENERATIONS` | 4 | Concurrent provider calls |
| `GENERATION_MAX_ATTEMPTS` | 2 | Attempts per preview (the second uses the strict prompt) |
| `GENERATION_TIMEOUT_SECONDS` / `PROVIDER_REQUEST_TIMEOUT_SECONDS` / `PROVIDER_REQUEST_RETRIES` | 240 / 110 / 2 | Per-attempt timeout (semaphore wait excluded) / one HTTP request / tries per attempt. Request × tries must stay below the attempt timeout (checked at startup); the proxy read timeout must exceed attempt × attempts (Nginx: 600 s). |
| `IDENTITY_MIN_SIMILARITY` / `BEARD_IDENTITY_MIN_SIMILARITY` | 0.363 / 0.30 | SFace same-person thresholds |
| `GENERATION_MIN_FACE_PX` | 120 | Smallest face a preview is made from |
| `HAIR_COLOUR_MAX_DELTA_E` | 18 | Allowed hair colour change |
| `USE_STYLE_REFERENCE_IMAGE` | false | Send the catalogue photo as a second image (enable only once the reference photos are curated) |
| `AI_INPUT_MAX_SIDE` | 1024 | Edit input size |
| `STORAGE_LOCAL_DIR` | `./media_storage` | Media root |

Frontend: `frontend/.env` → `VITE_PUBLIC_APP_URL`, the public address used in share links (empty = current origin).

### Local setup

```bash
# Backend
cd backend
python -m venv venv && venv\Scripts\activate         # Windows (source venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
python ai_models/download_models.py                   # only if the model files are missing
copy .env.example .env                                # then set IMAGE_EDIT_PROVIDER + API key
python -m app.main                                    # or: uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev            # http://localhost:5173 (proxies /api and /static to :8000)
npm run dev:https      # https on the LAN, so tablet cameras work
```

To share links with other phones during development, the Vite config allows `*.trycloudflare.com` and `*.ngrok-free.app` tunnel hosts.

### Scripts

| Script | Purpose |
|---|---|
| `python scripts/migrate_sqlite_to_mysql.py [URL] [--replace]` | Creates the MySQL database and tables, copies all rows keeping ids, fills `hairstyles`/`beard_styles` from the catalogue, verifies counts and links. The SQLite file is left untouched. |
| `python scripts/seed_sample_visits.py [--remove]` | Adds (or removes) demo visit history, marked `SAMPLE DATA`. It back-fills visits to match totals that already exist and never changes `total_visits`/`total_spent`, so removing them needs no reversal. |
| `python scripts/purge_media.py` | Retention job (run daily): erases photos of customers without retention consent, prunes old AI cache |
| `python -m app.core.migrations` | Create tables / add new columns (required before starting in production) |
| `python -m pytest` (in `backend/`) | Unit tests in `tests/unit/`: rules, scoring, discounts, security, validation profiles, access control and flow guards. They use a temporary database and never call AI services. |
| `python ai_models/download_models.py` | Downloads the MediaPipe and SFace models |

### Docker

`infra/docker/docker-compose.yml` runs MySQL 8, the backend and the frontend via Nginx (:80), with `APP_ENV=production`. Secrets come from `infra/docker/.env` (`MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `SECRET_KEY`, `PUBLIC_ORIGIN`, provider keys); the stack refuses to start without them. The backend runs migrations, then one Uvicorn worker (the login lockout and generation limits are per process). MySQL is not exposed to the host, and media lives in a named volume. Nginx proxies `/api/` (600 s read timeout, 40 MB uploads) and the signed `/static/media/` links.

### Logs

Generation logs are printed to the console with an `[AI-PIPELINE]` prefix: provider and model, prompt preview, cache hits, validation rejects with the reason, and a token/cost summary per call and per customer photo (USD and INR).

### Adding a new style

Add an entry to `HAIRSTYLE_CATALOGUE` or `BEARD_CATALOGUE` in `style_catalogue.py`, with a literal camera-view description in `EDIT_DESCRIPTIONS` (and in `SERVICE_OVERRIDES` if it is a Colour/Texture look). No other code changes are needed.

---

## 13. Current limitations and known gaps

Resolved in the October 2026 hardening pass:
- shared customer password
- customers approving or completing their own service
- missing ownership checks
- public media
- consent not captured
- analytics open to all staff
- PBKDF2 at 200k iterations, legacy hashes kept, no lockout, 6-character passwords, 7-day tokens, hand-written JWT
- stale photo reuse
- hair-centric validation for beard/colour edits, and no "style applied" check
- category counted twice
- no manual overrides for misread analysis
- fallback provider only on errors
- placeholder analytics and admin routes
- discount margin guard ignoring cost
- seeded passwords and auto-ALTER in production
- Docker compose with old variables

What remains open, roughly in priority order:

- **Committed customer data.** `backend/media_storage/` (photos and previews) and `backend/salon_ai.db` are tracked in git, and `credintials.md` was too. They are now in `.gitignore` and `credintials.md` is untracked, but they stay in the **git history**. Untrack the rest (`git rm -r --cached backend/media_storage backend/salon_ai.db`), and **rotate every secret** that was ever in `credintials.md` or `.env`.
- **No OTP.** Registration accepts any valid-looking mobile number and doesn't verify that the person owns it. Forgotten passwords go through staff. This needs an SMS provider.
- **No job queue.** Generation still runs inside the HTTP request. Login lockout and the generation semaphore are per process, so run one worker or move them to Redis. There is no per-customer daily generation cap yet; "Retry" can be pressed repeatedly.
- **The "style applied" check is coarse.** It catches clear misses (length 2+ classes off, colour unchanged, beard area unchanged), not a bob instead of a pixie. A vision-model judge would be the next step.
- **Edited hair is not composited** back onto the original photo, so face and background preservation relies on validation and retries.
- **Customer tiers use "or" logic** (10 cheap visits make a VIP), and four overlapping classifications exist (customer type, loyalty tier, RFM segment, `segment_name`). This is a business decision to unify.
- **Sample data in analytics.** Visits marked `SAMPLE DATA` are counted. Remove them (`seed_sample_visits.py --remove`) before going live.
- **No chemical-service questionnaire** (previous colour/bleach/keratin, allergies and patch test, scalp conditions), no Kids collection, and no coily texture class from photos.
- **Translations** of the catalogue steps are machine-made (Gemini). They should be reviewed by a person once per style and language.
- **`edge-tts`** uses an unofficial endpoint. Use Azure or Google TTS in production (the browser voice is the fallback).
- **Alembic is not set up.** `python -m app.core.migrations` only adds tables and columns.
- **Notifications are stubs** that only log; nothing is sent via WhatsApp, SMS or email.
- **Catalogue reference photos:** styles 21–33 have none, and the existing Unsplash URLs don't match exactly. Keep `USE_STYLE_REFERENCE_IMAGE` off.
- **Men's smoothening/perm** has only 3 looks.
- **No golden test set.** `backend/tests/unit/` covers rules and access control, but there is no photo set across skin tones, hair types, glasses and beards for detection and validation, and no CI pipeline.
