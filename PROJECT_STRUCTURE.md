# AI Salon Personalization System - Full Project Structure & File Guide

This document provides a comprehensive overview of the entire codebase architecture, directory hierarchy, and the functional role of each file across the backend, frontend, models, and tests.

---

## High-Level System Architecture

```
d:\AI_based_saloon_personalition
├── backend/                  # FastAPI + PyTorch/MediaPipe AI Backend
│   ├── app/                  # Application Modules (AI, API, Core, DB, Models)
│   ├── ai_models/            # Local Neural Network Models & Embeddings
│   ├── media_storage/        # Uploaded & Generated Media Files
│   └── tests/                # Automated Test Suites (Unit & Provider Tests)
├── frontend/                 # React 18 + Vite + TypeScript Frontend
│   └── src/                  # Component Library, Pages, Layouts, API Client
├── sample-pic/               # Test Face & Hairstyle Reference Datasets
└── root docs/                # Architecture & System Documentation
```

---

## 1. Root Directory Files

| File | Purpose |
| :--- | :--- |
| `PROJECT_STRUCTURE.md` | Full directory structure and file reference guide (this document). |
| `ARCHITECTURE.md` | High-level system architecture and architectural decisions. |
| `SYSTEM_DOCUMENTATION.md` | Complete functional specifications and business domain requirements. |
| `HAIRSTYLE_RECOMMENDATION_GUIDE.md` | Technical guide for hairstyle and beard matching rules. |
| `model-to-use.md` | Evaluation and instructions for supported AI models (Gemini, Cloudflare, NVIDIA). |
| `credintials.md` | Security and credential setup guidelines for salon deployment. |
| `.gitignore` | Git exclusion rules for Python caches, node_modules, and media files. |

---

## 2. Backend Structure (`backend/`)

The backend is built with **FastAPI**, **SQLAlchemy ORM**, **MediaPipe**, **OpenCV**, and **Google GenAI SDK**.

```
backend/
├── .env                      # Active environment variables & API keys
├── .env.example              # Template environment configuration
├── pytest.ini                # Pytest configuration and root directory setup
├── requirements.txt          # Python dependencies (FastAPI, OpenCV, MediaPipe, etc.)
├── salon_ai.db               # SQLite database (fallback for local development)
├── app/                      # Main Application Source Code
│   ├── main.py               # FastAPI entrypoint, middleware, static mounts
│   ├── db_seed.py            # POC Database seed script for styles, stylists & services
│   ├── ai/                   # AI Computer Vision, Prompt Engine & Generation
│   ├── analytics/            # Business Intelligence & Retention Algorithms
│   ├── api/                  # API Routers & Endpoint Handlers
│   ├── campaigns/            # Targeted Marketing & Customer Retention
│   ├── core/                 # Config, Security, DB Session & Privacy Policies
│   ├── integrations/         # External Communication (SMS / WhatsApp / Email)
│   ├── models/               # SQLAlchemy ORM Database Schemas
│   └── schemas/              # Pydantic Request/Response Models
└── tests/                    # Backend Test Suite
    ├── unit/                 # 125+ Unit Tests (API, AI rules, validation)
    └── test_*.py             # Specialized Provider & Diagnostic Tests
```

### 2.1 Backend AI Engine (`backend/app/ai/`)

| File | Functionality |
| :--- | :--- |
| [`prompt_engine.py`](file:///d:/AI_based_saloon_personalition/backend/app/ai/prompt_engine.py) | **Controlled Prompt Engine**: Generates strict editing prompts for Front, Side, and Back views. Enforces solid white background (`#FFFFFF`), complete hair accessory removal, natural density locks, and view angle consistency. |
| [`image_editing.py`](file:///d:/AI_based_saloon_personalition/backend/app/ai/image_editing.py) | **Generation & Validation Pipeline**: Manages calls to Gemini, Cloudflare, and NVIDIA. Validates face identity similarity (SFace), skin tone, and hair consistency. Applies automatic GrabCut white background post-processing. |
| [`vision_models.py`](file:///d:/AI_based_saloon_personalition/backend/app/ai/vision_models.py) | **Computer Vision Models**: MediaPipe FaceLandmarker (478 points), MediaPipe Hair Segmenter, OpenCV SFace (128-d cosine similarity), and GrabCut segmentation. |
| [`face_analysis.py`](file:///d:/AI_based_saloon_personalition/backend/app/ai/face_analysis.py) | **Face & Hair Geometry**: Measures face shape (Oval, Round, Square, Heart, Diamond), hair length, curl pattern (1A-4C), density, and beard style. |
| [`recommendation_engine.py`](file:///d:/AI_based_saloon_personalition/backend/app/ai/recommendation_engine.py) | **Style Matchmaker**: Scores and ranks hairstyles from the catalogue against customer face geometry, hair type, and desired service. |
| [`style_catalogue.py`](file:///d:/AI_based_saloon_personalition/backend/app/ai/style_catalogue.py) | **Style Repository**: Master catalogue of women's and men's haircuts, beard styles, and color treatments with technical execution notes. |
| [`eligibility.py`](file:///d:/AI_based_saloon_personalition/backend/app/ai/eligibility.py) | **Service Eligibility**: Verifies if customer hair meets requirements for specific cuts (e.g. bald customers cannot receive fades). |
| [`instruction_audio.py`](file:///d:/AI_based_saloon_personalition/backend/app/ai/instruction_audio.py) | **Audio Instructions**: Stylist step-by-step audio cutting instructions in English, Hindi, and Tamil. |
| [`nvidia_nim.py`](file:///d:/AI_based_saloon_personalition/backend/app/ai/nvidia_nim.py) | **NVIDIA NIM Client**: Connects to self-hosted NVIDIA NIM FLUX microservices. |
| [`errors.py`](file:///d:/AI_based_saloon_personalition/backend/app/ai/errors.py) | **AI Error Definitions**: Custom `ImageEditError` class with failure reasons. |

### 2.2 Backend Core & Security (`backend/app/core/`)

| File | Functionality |
| :--- | :--- |
| [`config.py`](file:///d:/AI_based_saloon_personalition/backend/app/core/config.py) | **Configuration & Environment**: Settings management, dynamic multi-key pool rotation for Gemini keys (`GEMINI_API_KEY*`), model names, and timeouts. |
| [`security.py`](file:///d:/AI_based_saloon_personalition/backend/app/core/security.py) | **Cryptography & Passwords**: PBKDF2-SHA256 password hashing (600,000 iterations), JWT access token minting, and expiring HMAC media URLs. |
| [`auth.py`](file:///d:/AI_based_saloon_personalition/backend/app/core/auth.py) | **Authentication & RBAC**: Route dependency injection (`require_staff`, `require_admin`, `get_current_principal`). |
| [`database.py`](file:///d:/AI_based_saloon_personalition/backend/app/core/database.py) | **Database Session**: SQLAlchemy engine configuration (MySQL with SQLite fallback). |
| [`privacy.py`](file:///d:/AI_based_saloon_personalition/backend/app/core/privacy.py) | **Data Privacy Compliance**: Expiring customer consent policies, automatic photo purge scheduling, and photo cache hashing. |
| [`storage.py`](file:///d:/AI_based_saloon_personalition/backend/app/core/storage.py) | **Media Storage**: Secure filesystem storage for original, analyzed, and generated images. |
| [`reference_data.py`](file:///d:/AI_based_saloon_personalition/backend/app/core/reference_data.py) | **Master Seed Data**: Preconfigured branches, roles, sample stylists, and initial service categories. |
| [`migrations.py`](file:///d:/AI_based_saloon_personalition/backend/app/core/migrations.py) | **Lightweight Migrations**: Dynamic table column verification and index creation on startup. |

### 2.3 Backend API & Business Modules (`backend/app/`)

| File | Functionality |
| :--- | :--- |
| [`api/v1/endpoints.py`](file:///d:/AI_based_saloon_personalition/backend/app/api/v1/endpoints.py) | **FastAPI API Router**: Over 1,900 lines implementing Customer Auth, Photo Upload, Analysis, Style Recommendations, Multi-View Generation, Haircut Confirmation, History, and Admin Analytics. |
| [`models/domain.py`](file:///d:/AI_based_saloon_personalition/backend/app/models/domain.py) | **ORM Entities**: Tables for `Customer`, `CustomerPhoto`, `StyleSelection`, `Hairstyle`, `Stylist`, `CustomerVisit`, `LoyaltyAccount`, etc. |
| [`schemas/domain_schemas.py`](file:///d:/AI_based_saloon_personalition/backend/app/schemas/domain_schemas.py) | **Pydantic Models**: Data validation schemas for customer creation, photo analysis results, and generation responses. |
| [`analytics/capacity_analytics.py`](file:///d:/AI_based_saloon_personalition/backend/app/analytics/capacity_analytics.py) | **Capacity & Heatmaps**: Hourly salon chair utilization and peak-time forecasting. |
| [`analytics/discount_optimizer.py`](file:///d:/AI_based_saloon_personalition/backend/app/analytics/discount_optimizer.py) | **Dynamic Pricing**: Personalized margin-safe discounts based on visit frequency. |
| [`analytics/rfm_segmentation.py`](file:///d:/AI_based_saloon_personalition/backend/app/analytics/rfm_segmentation.py) | **RFM Segmentation**: Classifies customers into Regular, High-Spending, and At-Risk tiers. |
| [`campaigns/campaign_manager.py`](file:///d:/AI_based_saloon_personalition/backend/app/campaigns/campaign_manager.py) | **Targeted Campaigns**: Automated reminders for customers due for a haircut. |
| [`integrations/notifications.py`](file:///d:/AI_based_saloon_personalition/backend/app/integrations/notifications.py) | **Notifications**: WhatsApp and SMS messaging dispatchers. |
| [`db_seed.py`](file:///d:/AI_based_saloon_personalition/backend/app/db_seed.py) | **Database Seeder**: Populates demo salons, stylists, and catalogue styles. |
| [`main.py`](file:///d:/AI_based_saloon_personalition/backend/app/main.py) | **Application Entry**: Mounts `/api/v1`, static media directories, CORS middleware, and startup events. |

---

## 3. Frontend Structure (`frontend/`)

The frontend is built with **React 18**, **TypeScript**, **Vite**, and **Tailwind-free Vanilla CSS** design tokens.

```
frontend/
├── package.json              # Frontend scripts and dependencies
├── vite.config.ts            # Vite bundler, proxy configuration & HTTPS setup
├── tsconfig.json             # TypeScript root configuration
├── index.html                # Single-page application root HTML
└── src/
    ├── main.tsx              # React DOM mounting entrypoint
    ├── App.tsx               # Root component with Toast & Router providers
    ├── index.css             # Design system tokens (glassmorphism, colors, typography)
    ├── api/                  # Axios API client & typed endpoints
    ├── auth/                 # Session management, guards & idle timeout
    ├── components/           # Reusable UI component library
    ├── layouts/              # Role-based layouts (Customer, Stylist, Admin)
    ├── pages/                # Screen implementations grouped by role
    ├── routes/               # Route declarations & navigation rules
    ├── types/                # TypeScript interface definitions
    └── utils/                # Helper formatting and image utilities
```

### 3.1 Frontend Components (`frontend/src/components/`)

| Component | Purpose |
| :--- | :--- |
| [`MultiViewCapture.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/components/MultiViewCapture.tsx) | **3-Angle Capture Widget**: Guided capture for Front, Side, and Back photos with camera angle instructions. |
| [`CameraCapture.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/components/CameraCapture.tsx) | **Webcam Interface**: Real-time webcam stream capture with camera flip and photo upload fallback. |
| [`ComparisonViewer.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/components/ComparisonViewer.tsx) | **Before/After Comparison**: Side-by-side comparison slider for original vs AI preview vs post-cut photos. |
| [`HairAnalysisCard.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/components/HairAnalysisCard.tsx) | **Diagnostic Display**: Shows measured face shape, hair type (1A-4C), density, and beard style. |
| [`ConsentPanel.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/components/ConsentPanel.tsx) | **Privacy & Consent**: Interactive consent checkbox compliant with biometric data privacy laws. |
| [`CustomerFullProfile.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/components/CustomerFullProfile.tsx) | **Customer 360 View**: Visit history, loyalty balance, favorite styles, and personal notes. |
| [`CustomerInsights.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/components/CustomerInsights.tsx) | **Stylist Insights**: Key suggestions and past haircut preferences for the stylist. |
| [`AddCustomerForm.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/components/AddCustomerForm.tsx) | **Registration Modal**: Staff form to register walk-in customers and issue temporary passwords. |
| [`StaffApproval.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/components/StaffApproval.tsx) | **Stylist Confirmation**: Stylist approval badge before a cut begins. |
| [`BranchSelector.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/components/BranchSelector.tsx) | **Location Picker**: Salon branch switch selector. |
| [`BrandLogo.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/components/BrandLogo.tsx) | **Branding**: Salon AI luxury vector logo. |
| [`ServiceIcon.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/components/ServiceIcon.tsx) | **Icons**: Dynamic service category icons (Hair, Beard, Spa, Color). |

### 3.2 Frontend Pages by User Role (`frontend/src/pages/`)

#### Customer Journey (`frontend/src/pages/customer/`)
* [`CustomerLoginPage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/customer/CustomerLoginPage.tsx): Customer login via Mobile Number / Customer ID (`CUST-XXXX`) with temporary password support.
* [`ServiceCategoryPage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/customer/ServiceCategoryPage.tsx): Service catalog selection (Haircut, Beard Sculpting, Coloring, Spa).
* [`PhotoUploadPage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/customer/PhotoUploadPage.tsx): Multi-view photo capture with advice for female users on loose hair and white background.
* [`RecommendationsPage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/customer/RecommendationsPage.tsx): Personalized hairstyle gallery with AI previews, suitability badges, and filters.
* [`CuttingInstructionsPage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/customer/CuttingInstructionsPage.tsx): Multi-view generation (Front, Side, Back) and step-by-step audio instructions.
* [`BeforeAfterConfirmationPage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/customer/BeforeAfterConfirmationPage.tsx): Post-service review comparing original, AI preview, and actual haircut.
* [`CustomerHistoryPage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/customer/CustomerHistoryPage.tsx): Previous salon visits, stylist notes, and loyalty points.
* [`CustomerProfilePage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/customer/CustomerProfilePage.tsx): Personal contact info, preferences, and password change modal.

#### Staff & Receptionist (`frontend/src/pages/staff/`)
* [`StaffLoginPage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/staff/StaffLoginPage.tsx): Secure staff portal login.
* [`StaffCustomersPage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/staff/StaffCustomersPage.tsx): Customer directory, search by phone/ID, walk-in registration, and password reset.

#### Salon Admin & Analytics (`frontend/src/pages/admin/`)
* [`AdminDashboardPage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/admin/AdminDashboardPage.tsx): Executive overview of total visits, revenue, popular styles, and customer tiers.
* [`CapacityAnalyticsPage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/admin/CapacityAnalyticsPage.tsx): Hourly demand heatmap and stylist scheduling optimizer.
* [`CampaignsPage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/admin/CampaignsPage.tsx): Automated SMS/WhatsApp retention campaigns for at-risk customers.
* [`CustomersPage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/admin/CustomersPage.tsx): Admin customer relationship management table.

#### Stylist Dashboard (`frontend/src/pages/stylist/`)
* [`StylistDashboardPage.tsx`](file:///d:/AI_based_saloon_personalition/frontend/src/pages/stylist/StylistDashboardPage.tsx): Active customer queue, selected hairstyles, and cutting confirmation workflow.

---

## 4. Test Suite (`backend/tests/`)

The application includes an automated test suite of **125+ unit tests** validating business logic, AI safety, prompt generation, and access control.

| Test File | Coverage |
| :--- | :--- |
| [`tests/unit/test_api_access.py`](file:///d:/AI_based_saloon_personalition/backend/tests/unit/test_api_access.py) | Authentication guards, token expiry, temporary password handling, and customer session locks. |
| [`tests/unit/test_women_generation.py`](file:///d:/AI_based_saloon_personalition/backend/tests/unit/test_women_generation.py) | Female haircut rules, loose hair enforcement, accessory removal, and no-facial-hair rules. |
| [`tests/unit/test_length_generation.py`](file:///d:/AI_based_saloon_personalition/backend/tests/unit/test_length_generation.py) | Finished length consistency across views, trim rules, and bald/buzz scalp handling. |
| [`tests/unit/test_validation_rules.py`](file:///d:/AI_based_saloon_personalition/backend/tests/unit/test_validation_rules.py) | Image edit validation (SFace face identity, skin tone preservation, length checks). |
| [`tests/unit/test_rules.py`](file:///d:/AI_based_saloon_personalition/backend/tests/unit/test_rules.py) | Service eligibility, RFM tier classification, and discount cooldown periods. |
| [`tests/test_gemini_key.py`](file:///d:/AI_based_saloon_personalition/backend/tests/test_gemini_key.py) | Live Gemini API key connectivity and quota diagnostic script. |
