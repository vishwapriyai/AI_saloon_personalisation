# Vertex AI Connection & Deployment Guide

This guide documents the procedures for initializing, connecting, and deploying Google Cloud's **Vertex AI** services (such as Gemini and Imagen) for the **AI-Based Saloon Personalization** project. 

It covers both **Local Development** (using local machines) and **Production Deployment** (using Google Compute Engine VMs) using secure, keyless authentication that safely consumes your Google Cloud credits.

---

## Architecture Overview

Instead of using static, insecure API keys, this project uses **Application Default Credentials (ADC)** and **Google IAM Service Accounts**. 

* **Local Development:** Authenticates via your Google User Account using the Google Cloud CLI.
* **Production Deployment:** Authenticates via the Compute Engine's built-in Service Account using attached IAM scopes.
* **Credits & Billing:** Both methods route requests through your GCP Project (`project-5b95fd61-d6de-4a78-913`) to consume your active cloud credits.

---

## 1. Prerequisites (Google Cloud Platform)

Before running any code, ensure the **Vertex AI API** is enabled in your Google Cloud Project:

```bash
gcloud services enable aiplatform.googleapis.com
