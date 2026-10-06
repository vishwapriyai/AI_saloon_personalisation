# Salon AI & Customer Analytics System — Architecture & Verification Document

## Executive Summary
The **Salon AI & Customer Analytics System** is a production-ready, touch-first responsive web application and full-stack Python FastAPI backend. Designed for unisex salons (Women's, Men's, and All/Gender-Neutral collections) on tablet touchscreens, mobile, laptop, and desktop viewports, it integrates Computer Vision, Generative AI (NVIDIA NIM / FLUX.1-Kontext-dev), RFM Customer Intelligence, Capacity Heatmap Analytics, and Margin-Guarded Automated Discounting.

---

## 1. System Architecture

```
                                  INTERNET
                                     │
                                     ▼
                                Nginx / CDN
                                     │
                ┌────────────────────┴────────────────────┐
                ▼                                         ▼
          Customer Web                                Admin Web
         (Tablet Primary)                          (Analytics & Intelligence)
                │                                         │
                └────────────────────┬────────────────────┘
                                     ▼
                            FastAPI REST API
                                     │
          ┌──────────────────────────┼──────────────────────────┐
          ▼                          ▼                          ▼
       MySQL 8.x                   Redis                     RabbitMQ
  (SQLAlchemy 2.x)            (Session/Cache)             (Async Queue)
                                                                │
                                                                ▼
                                                            AI Worker
                                                                │
                                                                ▼
                                                           NVIDIA NIM
                                                   (FLUX.1-Kontext-dev)
                                                                │
                                                                ▼
                                                          Object Storage
                                                      (Signed URLs / Media)
```

---

## 2. Technical Stack Matrix

| Area | Technology Stack |
| :--- | :--- |
| **Frontend Framework** | React 19+, TypeScript, Vite, Tailwind CSS, Lucide React, TanStack Query |
| **Frontend Routes** | `/customer/*` (Tablet Primary), `/admin/*` (Dashboard), `/stylist/*` (Station) |
| **Backend Framework** | Python 3.11+, FastAPI, Uvicorn, Pydantic v2, SQLAlchemy 2.x |
| **Primary Database** | MySQL 8.x / SQLite 3 (ORM Mapped across 38 domain tables) |
| **AI Computer Vision** | MediaPipe, OpenCV (HSV/LAB Color Thresholding, Face Shape, Lighting, Hair Density, 1A-4C Textures) |
| **AI Recommendation** | Content-based ranking against Controlled Hairstyle & Beard Catalogue |
| **Visual Generative AI** | NVIDIA NIM API (`FLUX.1-Kontext-dev`) with Mask-based Identity Preservation Prompts & Watermarking |
| **Customer Analytics** | RFM Segmentation, Churn/Return Probability ML Engine |
| **Yield Management** | Automated Rule + Optimization Discount Engine with Anti-Cannibalization Cooldown Guards |
| **Stylist Assistance** | Multi-Angle Reference Views, Chemical Formulas, In-Person Consultation Sign-off, Speech Synthesis |
| **Containerization** | Docker, Nginx, Docker Compose |

---

## 3. Flaw & Enhancement Resolution Matrix

| # | Domain / Flaw Area | Resolution & Engineering Fix Implemented |
|---|---|---|
| 1 | **Unisex Coverage & Services** | Added Women's, Men's, and All/Gender-Neutral collection selection choices. Catalogued 1A-4C textures, length tiers (Pixie, Bob, Lob, Shoulder, Mid-back, Long), Balayage, Keratin, and Chemical formulas. |
| 2 | **Physical Feasibility Filter** | Added real-time haircut feasibility scoring and status (`Achievable Today`, `Needs Chemical Service`, `Needs Growth/Extensions`). |
| 3 | **Chemical Add-on Services** | Automatically attaches required chemical processing add-on (service name, est. cost, duration, and formula instructions) when a chemical transformation is selected. |
| 4 | **Identity Preservation & Watermarking** | Inpainting mask prompts restrict edits exclusively to the hair region while preserving bounding face features. All generated visual previews feature an immutable AI Disclaimer Watermark. |
| 5 | **Family Sharing & DPDP Privacy** | Supported multiple customer profiles per phone number (Self, Spouse, Child) for shared family numbers in India. Added explicit DPDP Act/GDPR biometric consent controls. |
| 6 | **Async Connection Recovery** | Created `GET /api/v1/style-generations/status/{job_id}` polling fallback endpoint to restore progress if tablet Wi-Fi drops. |
| 7 | **Yield Management Cooldowns** | Enforced customer discount cooldown thresholds (`days_since_last_discount` check) and margin protection guards to prevent promotional price cannibalization. |
| 8 | **Stylist Consultation Sign-off** | Added multi-angle (Front, Side, Back) reference photos and an in-person Stylist Consultation Approval verification toggle on the stylist station guide. |

---

## 4. Operational Status & Verification
- **Backend API**: Online on `http://localhost:8000` (Docs at `/docs`)
- **Frontend App**: Live on `http://localhost:5173`
- **Database**: Mapped across 38 core domain tables and seeded with initial dataset.

