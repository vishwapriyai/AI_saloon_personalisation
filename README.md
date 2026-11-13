# Salon AI & Customer Analytics Platform

A web app for unisex salons. A customer takes a photo on a salon tablet. The app analyses their face and hair, recommends hairstyles and beard styles that suit them, and shows AI previews of each look **edited onto the customer's own photo**. The stylist then gets cutting instructions, multi-angle reference views and spoken guidance. Admins get customer analytics, capacity heatmaps and discount campaigns.

## Features

| Area | What it does |
| :--- | :--- |
| **Face & hair analysis** | Face shape, hair texture (1A–4C), density, colour and lighting checks using MediaPipe and OpenCV |
| **Style recommendations** | Ranks looks from a curated hairstyle and beard catalogue by suitability (4–8 looks per customer) |
| **AI previews** | Edits the customer's photo with the chosen style, with identity checks so the face stays the same. Works with several image providers and fallbacks |
| **Stylist station** | Cutting guide, multi-angle AI reference views, voice instructions in English, Hindi and Tamil |
| **Customer accounts** | Login with mobile number or customer ID, visit history, referral links, photo consent and deletion |
| **Admin dashboard** | Customers, appointments, RFM segments, capacity heatmap, campaigns, PDF/Excel exports |
| **Privacy** | Photos are served only through signed, expiring links. Photos without retention consent are purged automatically |

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router
- **Backend:** Python 3.11, FastAPI, SQLAlchemy 2, Pydantic v2
- **Database:** MySQL 8 (recommended) or SQLite (zero-setup fallback)
- **AI / vision:** MediaPipe, OpenCV, scikit-learn; image editing through Gemini, Vertex AI, OpenRouter, Cloudflare Workers AI, NVIDIA NIM or Hugging Face
- **Deployment:** Docker Compose and Nginx (see [infra/](infra/))

## Project layout

```
backend/
  app/
    main.py           FastAPI app; seeds roles and reference data on startup
    api/v1/           REST endpoints (served under /api/v1)
    ai/               face analysis, recommendations, image editing, voice instructions
    analytics/        RFM segmentation, churn, capacity
    campaigns/        discount engine
    core/             settings, database, auth, security
    models/ schemas/  SQLAlchemy models and Pydantic schemas
  scripts/            database migration, sample data, media retention job
  tests/unit/         automated tests
frontend/
  src/                React app: /customer, /stylist, /admin, /staff
infra/
  docker/             Dockerfiles and docker-compose.yml
  nginx/              reverse-proxy config
```

More detail: [ARCHITECTURE.md](ARCHITECTURE.md), [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md), [SYSTEM_DOCUMENTATION.md](SYSTEM_DOCUMENTATION.md), [HAIRSTYLE_RECOMMENDATION_GUIDE.md](HAIRSTYLE_RECOMMENDATION_GUIDE.md), [vertex_ai_setup.md](vertex_ai_setup.md).

## Getting started

### Prerequisites

- Python 3.11
- Node.js 20 or newer
- MySQL 8 (optional; the app falls back to SQLite)
- An API key for at least one image-editing provider, to generate previews

### 1. Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env          # macOS/Linux: cp .env.example .env
```

Edit `backend/.env` (see [Configuration](#configuration)), then start the API:

```powershell
uvicorn app.main:app --reload --port 8000
```

- API: http://localhost:8000/api/v1
- Interactive API docs: http://localhost:8000/docs

### 2. Frontend

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server forwards `/api` requests to the backend on port 8000, so **the backend must be running** or every login will fail.

If another app is already using port 5173, Vite moves to 5174. Open the URL Vite prints, and make sure it's this project and not another one.

### 3. Log in

| Who | URL | Sample login (development only) |
| :--- | :--- | :--- |
| Admin | `/staff/login` | `admin` / `Admin@123` |
| Stylist | `/staff/login` | `stylist` / `Stylist@123` |
| Customer | `/customer/login` | mobile number or customer ID (e.g. `CUST-1001`) / `Customer@123` |

These accounts are created only when `APP_ENV=development`. Customers are asked to change the sample password after their first login. Five failed attempts lock an account for 15 minutes.

## Configuration

All settings live in `backend/.env`. The defaults are in [backend/app/core/config.py](backend/app/core/config.py).

| Variable | Purpose |
| :--- | :--- |
| `APP_ENV` | `development` seeds sample accounts and adds missing DB columns at startup. `production` does neither and refuses the default secret key |
| `SECRET_KEY` | Signs login tokens and media links. **Change it for any shared or production deployment** |
| `DATABASE_URL` | e.g. `mysql+pymysql://user:password@127.0.0.1:3306/salon_ai_db`. Leave unset to use `backend/salon_ai.db` (SQLite) |
| `IMAGE_EDIT_PROVIDER` | `gemini`, `openrouter`, `cloudflare`, `nvidia` or `huggingface` (testing only) |
| `IMAGE_EDIT_FALLBACK_PROVIDER` | Provider to try when the main one fails |
| `GEMINI_API_KEY` (`GEMINI_API_KEY_1`, `_2`, …) | Google Gemini keys; extra keys are rotated |
| `USE_VERTEX_AI`, `VERTEX_AI_PROJECT`, `VERTEX_AI_LOCATION` | Use Gemini through Google Cloud Vertex AI instead (see [vertex_ai_setup.md](vertex_ai_setup.md)) |
| `OPENROUTER_API_KEY` | OpenRouter key |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (free daily allowance) |
| `NVIDIA_NGC_API_KEY` | NVIDIA NIM key |
| `HF_TOKEN` | Hugging Face token |
| `MAX_PARALLEL_GENERATIONS` | How many previews are generated at the same time |

Frontend: copy `frontend/.env.example` to `frontend/.env` and set `VITE_PUBLIC_APP_URL` if share links (WhatsApp/SMS) should use a public address.

Never commit `.env` files or API keys.

## Database

- **SQLite:** nothing to set up. Tables are created on first start.
- **MySQL:** create a user, set `DATABASE_URL`, and start the backend; tables are created automatically. To copy existing data from the SQLite file:

  ```powershell
  cd backend
  python scripts/migrate_sqlite_to_mysql.py            # uses DATABASE_URL from .env
  python scripts/migrate_sqlite_to_mysql.py --replace  # re-run, emptying MySQL tables first
  ```

- A MySQL dump is also included: [salon_ai_db.sql](salon_ai_db.sql).

## Useful scripts

Run from the `backend` folder:

| Command | What it does |
| :--- | :--- |
| `python scripts/seed_sample_visits.py` | Adds demo visit history (`--remove` deletes it again) |
| `python scripts/purge_media.py` | Retention job: deletes photos without consent and old AI cache files. Schedule it daily |

## Tests

```powershell
cd backend
pytest
```

This runs only `tests/unit`. The other scripts in `backend/tests/` are manual diagnostics that call paid AI services; run them on purpose, not in CI.

Frontend checks:

```powershell
cd frontend
npm run lint
npm run build
```

## Docker

```powershell
cd infra/docker
docker compose up --build
```

This starts MySQL, the backend and the frontend behind Nginx at http://localhost. Set `SECRET_KEY`, `APP_ENV=production` and your provider keys before deploying.

## Troubleshooting

| Problem | Fix |
| :--- | :--- |
| Every login says the password is wrong | Check the backend is running on port 8000, and that `localhost:5173` is this project (another Vite app may be using the port) |
| "Too many failed attempts" | Wait 15 minutes, or restart the backend |
| "Cannot reach the salon server" | Start the backend: `uvicorn app.main:app --reload --port 8000` |
| Previews fail or time out | Check the provider key in `.env` and look in `backend/logs/image_generation.log` |
| Can't connect to MySQL | Make sure MySQL is running and `DATABASE_URL` is correct, or remove it to use SQLite |
