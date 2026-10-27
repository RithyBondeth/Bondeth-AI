<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="frontend/public/brand/logo-dark.svg">
  <img src="frontend/public/brand/logo.svg" alt="Bondeth-AI — Bubble B doodle logo" width="380">
</picture>

# Bondeth AI

**An open-source bilingual (Khmer and English) voice intelligence platform with Speech-to-Text, Text-to-Speech, and zero-shot voice cloning.**

![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![PyTorch](https://img.shields.io/badge/PyTorch-EE4C2C?style=for-the-badge&logo=pytorch&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

[![CI](https://github.com/RithyBondeth/Bondeth-AI/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/RithyBondeth/Bondeth-AI/actions/workflows/ci.yml)

</div>

---

## Overview

For the implemented system, see [Current architecture](docs/architecture.md),
[Production operations](docs/operations.md), and [Stripe subscriptions](docs/billing.md).
The original PDF is a historical proposal; its engines, sample code, cost estimates,
and latency targets are not the current implementation or measured guarantees.

**Bondeth AI** takes its name from the Khmer word *បណ្ឌិត* (*Bondeth*), meaning scholar or master of knowledge. It is a self-hosted voice platform that removes typing and accessibility barriers for Khmer speakers.

Typing Khmer is slow: multi-layered keyboard layouts, sub-consonants (*ជើងអក្សរ*), and stacked diacritics all add friction. Everyday communication in Cambodia also mixes Khmer and English freely, and proprietary voice APIs charge per-minute fees that local developers can't afford. Bondeth AI addresses all three with one bilingual suite built on open-source engines.

## Features

| Feature | Engine | What it does |
| --- | --- | --- |
| **Speech-to-Text** | [whisper-turbo-khmer-v9](https://huggingface.co/1morecupofhottea/whisper-turbo-khmer-v9) (Khmer, via CTranslate2) + [faster-whisper](https://github.com/SYSTRAN/faster-whisper) `large-v3-turbo` (English, language detection) | Transcribes recordings or uploads, auto-detects Khmer vs English, returns clean and word-separated Khmer text with timestamps. Long recordings run as queued jobs that stream segments as they're decoded (Server-Sent Events). **Live dictation** streams the microphone over a WebSocket and shows text as you speak (needs a GPU to feel real-time; on CPU-only servers set `BONDETH_STT_LIVE_PARTIALS=false`). **14.5% normalized CER on 24 reserved FLEURS Khmer validation clips**, not a full-test-set guarantee; see [accuracy checks and limitations](docs/local-voice-testing.md#khmer-recognition-accuracy) |
| **Text-to-Speech** | [OmniVoice](https://huggingface.co/k2-fsa/OmniVoice) (quality-first local selection) or [Meta MMS-TTS](https://huggingface.co/facebook/mms-tts-khm) (fast default) | Reads Khmer, English, or both; numbers, currencies (`$25` → ម្ភៃប្រាំដុល្លារ), percentages and dates are spelled out. OmniVoice uses one generic synthetic speaker for bilingual speech, with Khmer-aware timing and 24 kHz output. Repeated phrases are cached. See [quality settings, latency and non-commercial limits](docs/khmer-tts.md) |
| **Voice cloning** | [OmniVoice](https://huggingface.co/k2-fsa/OmniVoice) | Uses a consented 3-30 s sample (5-10 s recommended), native-bandwidth reference preparation, editable transcripts and quality-first generation. Runs as a queued job that survives restarts. See [Khmer cloning quality and limits](docs/khmer-voice-cloning.md) |
| **Accounts & library** | PostgreSQL, Redis, JWT | Sign-in, email verification, password reset by email, account deletion, searchable transcription history with autosaved edits and SRT/VTT subtitle export, saved voices, and a persistent audio library for generated speech and clones |
| **Developer API keys** | PostgreSQL | Per-app keys (`X-API-Key: bdk_...`) for the whole API, revocable, with daily usage metered per key |
| **Usage limits** | Redis | Per-minute rate limits and daily allowances (transcription minutes, characters spoken, clone jobs), shown in the studio sidebar and at `GET /api/v1/usage` |

The web app is a studio-style Next.js UI with a Khmer/English interface, a remembered language preference, light/dark themes, animations and hand-drawn doodles.

## Quick start (Docker)

```bash
cp .env.example .env
# set BONDETH_JWT_SECRET in .env:  python3 -c "import secrets; print(secrets.token_urlsafe(48))"
docker compose --profile app up -d --build
```

The example `.env` runs as `BONDETH_ENV=development`, which is right for a trial on localhost. For a public deployment follow [docs/deploy.md](docs/deploy.md), which starts from `.env.production.example` and puts Caddy (automatic HTTPS) in front. With `BONDETH_ENV=production` the backend refuses to start until `PUBLIC_APP_URL` (and the CORS origin derived from it) is the real `https://` address and `BONDETH_EMAIL_BACKEND=smtp` points at a real relay, so sign-up and password reset can't silently break.

Open **http://localhost:3000** (API docs at http://localhost:8000/docs). The first start downloads about 6 GB of models into `backend/models/` and loads them, which takes a while; later starts reuse them.

On a Linux server with an NVIDIA GPU (and the NVIDIA Container Toolkit), add the GPU override:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile app up -d --build
```

| Service | What it is |
| --- | --- |
| `postgres`, `redis` | Database and job queue (always started) |
| `migrate` | Runs database migrations once, then exits |
| `backend` | FastAPI + models (CPU image by default, CUDA with the GPU override) |
| `frontend` | Next.js standalone server |

## Local development

```bash
docker compose up -d                                   # Postgres + Redis only

cd backend
uv venv --python 3.11 .venv && uv pip install -r requirements-dev.txt
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload                # http://localhost:8000
.venv/bin/python -m pytest                             # uses a separate bondeth_test database

cd ../frontend
npm install && npm run dev                             # http://localhost:3000
```

Real-model tests are opt-in: `BONDETH_RUN_MODEL_TESTS=1 pytest`. Khmer STT accuracy and voice-cloning quality can be re-measured with `python -m scripts.eval_khmer_stt` and `python -m scripts.bench_voice_clone`.

## Usage limits

Every caller (the signed-in user, otherwise the client IP) has a per-minute rate limit for each tool and a daily allowance that resets at midnight Cambodia time (UTC+7):

| | Signed out (or email not confirmed) | Signed in, email confirmed |
| --- | --- | --- |
| Requests per minute, per tool | 10 | 30 |
| Speech-to-text | 10 min of audio | 60 min |
| Text-to-speech | 5,000 characters | 50,000 |
| Voice cloning | needs an account | 20 jobs |

Requests made with a developer API key (created under **API keys** in the studio) have their own rate-limit bucket per key (60/min), share the account's daily allowance, and are metered per key and day in PostgreSQL. New accounts get the signed-out allowance, shared per IP, until they confirm their email, and sign-ups are limited to 5 per IP per hour, so creating accounts doesn't reset anyone's allowance. Going over returns `429` with a `Retry-After` header. Failed requests are refunded. All limits are `BONDETH_RATE_LIMIT_*` / `BONDETH_QUOTA_*` settings (see [backend/.env.example](backend/.env.example)), and `BONDETH_LIMITS_ENABLED=false` keeps counting usage without blocking anything. If a reverse proxy sits in front of the backend, set `FORWARDED_ALLOW_IPS` to its address so limits apply to real client IPs.

## Email

Verification and password-reset emails go through `BONDETH_EMAIL_BACKEND`. The default, `log`, only writes them to the backend log, which is enough for local development (the links are in the log). Before real users sign up, set `smtp` and the `BONDETH_SMTP_*` settings for any SMTP relay (Resend, Amazon SES, Gmail…), and set `PUBLIC_APP_URL` so the links point at your site.

## Search visibility

Public pages include canonical metadata, social cards, structured data, and a sitemap. Private pages are marked `noindex`. Set `PUBLIC_APP_URL` to the real HTTPS origin before building for production, and use `SEO_INDEXING=false` for public staging environments. See [SEO launch checklist](docs/seo.md) for configuration, indexing verification, language scope and tests.

## Architecture

```text
┌──────────────────────────────── Next.js studio (frontend/) ───────────────────────────────┐
│  Recorder + live levels · waveform player · STT / TTS / Clone workspaces · History · Voices│
└──────────────────────────────────────────┬────────────────────────────────────────────────┘
                                           │ REST + JWT
┌──────────────────────────────── FastAPI (backend/) ───────────────────────────────────────┐
│  /auth  /api-keys  /stt(/jobs,/live)  /tts  /clone  /voices  /transcriptions  /usage  …  │
│  Khmer & English normalizers · script splitting for mixed text · rate limits · quotas    │
├──────────────────┬──────────────────┬──────────────────────────┬─────────────────────────┤
│ STT + job worker │ TTS              │ Clone worker (thread)     │ PostgreSQL · Redis      │
│ Khmer Whisper    │ MMS-TTS km + en  │ OmniVoice, jobs in Redis  │ users, transcriptions,  │
│ + faster-whisper │ + Redis cache    │ (re-queued after crashes) │ voices · API keys       │
└──────────────────┴──────────────────┴──────────────────────────┴─────────────────────────┘
```

## Model licenses

The engines' **code** is open source, but some **pretrained weights** are non-commercial:

| Component | License |
| --- | --- |
| faster-whisper, Whisper `large-v3-turbo`, whisper-turbo-khmer-v9 | MIT |
| Meta MMS-TTS weights (`facebook/mms-tts-*`) | CC BY-NC 4.0 (non-commercial) |
| OmniVoice weights | CC BY-NC (non-commercial) |
| VoxCPM2 weights (`openbmb/VoxCPM2`), optional engine | Apache-2.0 (commercial use OK) |

Before any paid offering, switch TTS and voice cloning to [VoxCPM2](https://huggingface.co/openbmb/VoxCPM2): set `BONDETH_TTS_ENGINE=voxcpm` and `BONDETH_CLONE_ENGINE=voxcpm`. It supports Khmer, outputs 48 kHz, and wants a CUDA GPU with ~8 GB of VRAM (the GPU Docker image includes it; locally, `pip install -r backend/requirements-voxcpm.txt`). Standard TTS uses a house voice designed once from `BONDETH_VOXCPM_HOUSE_VOICE`. Speed is passed to VoxCPM2 as a style hint, so it's approximate.

## Documentation

- [Master Project Blueprint (PDF)](docs/Bondeth_AI_Master_Blueprint.pdf): the original proposal, requirements, architecture, business model and infrastructure costs.
- [Current architecture](docs/architecture.md): runtime, persistence, model boundaries and differences from the proposal.
- [Deploying to production](docs/deploy.md): server, DNS, email, HTTPS, backups, monitoring and updates, step by step.
- [Production operations](docs/operations.md): split workers, scaling, migrations, backups and verification.
- [Stripe subscriptions](docs/billing.md): optional Pro plans, Checkout, portal and webhook setup.
- [History search and audio library](docs/audio-library.md): private saved outputs, filtering, downloads and storage.
- [Transcript editing and subtitles](docs/transcript-editing.md): private audio playback, live caption preview, subtitle quality checks, find-and-replace, editable timing, split/merge, undo/redo, autosave, conflict handling and SRT/VTT exports.
- [Local voice testing](docs/local-voice-testing.md): real-model smoke test, audio samples and local engine troubleshooting.
- [frontend/README.md](frontend/README.md): pages and design system.
- [deploy/gpu/README.md](deploy/gpu/README.md): evaluating VoxCPM2 and live-dictation latency on a rented GPU (one command, report with targets).

## Project Structure

```text
Bondeth-AI/
├── backend/              FastAPI app, models, Alembic migrations, tests, eval scripts
├── frontend/             Next.js studio
├── docker/               Postgres init (creates the test database)
├── docker-compose.yml    Postgres + Redis; `--profile app` adds migrate, backend, frontend
├── docker-compose.gpu.yml
└── docs/                 Blueprint
```

## Author

**Rithy Bondeth** — Full Stack Developer & AI Engineer

[![Portfolio](https://img.shields.io/badge/Portfolio-0A0A0A?style=for-the-badge&logo=vercel&logoColor=white)](https://bondeth.dev)
[![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/RithyBondeth)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/rithy-bondeth-484073282/)

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for details.
