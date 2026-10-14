<div align="center">

# Bondeth AI (បណ្ឌិត AI)

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

**Bondeth AI** takes its name from the Khmer word *បណ្ឌិត* (*Bondeth*), meaning scholar or master of knowledge. It is a self-hosted voice platform that removes typing and accessibility barriers for Khmer speakers.

Typing Khmer is slow: multi-layered keyboard layouts, sub-consonants (*ជើងអក្សរ*), and stacked diacritics all add friction. Everyday communication in Cambodia also mixes Khmer and English freely, and proprietary voice APIs charge per-minute fees that local developers can't afford. Bondeth AI addresses all three with one bilingual suite built on open-source engines.

## Features

| Feature | Engine | What it does |
| --- | --- | --- |
| **Speech-to-Text** | [whisper-turbo-khmer-v9](https://huggingface.co/1morecupofhottea/whisper-turbo-khmer-v9) (Khmer, via CTranslate2) + [faster-whisper](https://github.com/SYSTRAN/faster-whisper) `large-v3-turbo` (English, language detection) | Transcribes recordings or uploads, auto-detects Khmer vs English, returns clean and word-separated Khmer text with timestamps. About **18% CER** on FLEURS Khmer |
| **Text-to-Speech** | [Meta MMS-TTS](https://huggingface.co/facebook/mms-tts-khm) (VITS) | Reads Khmer, English, or both in one sentence; numbers, currencies (`$25` → ម្ភៃប្រាំដុល្លារ), percentages and dates are spelled out. Repeated phrases are served from a Redis cache |
| **Voice cloning** | [OmniVoice](https://huggingface.co/k2-fsa/OmniVoice) | Clones a voice from a 3-30 s sample (consent required) and speaks any Khmer or English text. Runs as a queued job that survives restarts |
| **Accounts & library** | PostgreSQL, Redis, JWT | Sign-in, transcription history, saved voices |
| **Developer API keys** | PostgreSQL | Per-app keys (`X-API-Key: bdk_...`) for the whole API, revocable, with daily usage metered per key |
| **Usage limits** | Redis | Per-minute rate limits and daily allowances (transcription minutes, characters spoken, clone jobs), shown in the studio sidebar and at `GET /api/v1/usage` |

The web app is a studio-style Next.js UI with light/dark themes, animations and hand-drawn doodles.

## Quick start (Docker)

```bash
cp .env.example .env
# set BONDETH_JWT_SECRET in .env:  python3 -c "import secrets; print(secrets.token_urlsafe(48))"
docker compose --profile app up -d --build
```

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

| | Signed out | Signed in |
| --- | --- | --- |
| Requests per minute, per tool | 10 | 30 |
| Speech-to-text | 10 min of audio | 60 min |
| Text-to-speech | 5,000 characters | 50,000 |
| Voice cloning | needs an account | 20 jobs |

Requests made with a developer API key (created under **API keys** in the studio) have their own rate-limit bucket per key (60/min), share the account's daily allowance, and are metered per key and day in PostgreSQL. Going over returns `429` with a `Retry-After` header. Failed requests are refunded. All limits are `BONDETH_RATE_LIMIT_*` / `BONDETH_QUOTA_*` settings (see [backend/.env.example](backend/.env.example)), and `BONDETH_LIMITS_ENABLED=false` keeps counting usage without blocking anything. If a reverse proxy sits in front of the backend, set `FORWARDED_ALLOW_IPS` to its address so limits apply to real client IPs.

## Architecture

```text
┌──────────────────────────────── Next.js studio (frontend/) ───────────────────────────────┐
│  Recorder + live levels · waveform player · STT / TTS / Clone workspaces · History · Voices│
└──────────────────────────────────────────┬────────────────────────────────────────────────┘
                                           │ REST + JWT
┌──────────────────────────────── FastAPI (backend/) ───────────────────────────────────────┐
│  /auth  /stt  /tts  /clone  /voices  /transcriptions  /text/normalize  /usage  /health   │
│  Khmer & English normalizers · script splitting for mixed text · rate limits · quotas    │
├──────────────────┬──────────────────┬──────────────────────────┬─────────────────────────┤
│ STT              │ TTS              │ Clone worker (thread)     │ PostgreSQL · Redis      │
│ Khmer Whisper    │ MMS-TTS km + en  │ OmniVoice, jobs in Redis  │ users, transcriptions,  │
│ + faster-whisper │                  │ (re-queued after crashes) │ cloned_voices · tokens  │
└──────────────────┴──────────────────┴──────────────────────────┴─────────────────────────┘
```

## Model licenses

The engines' **code** is open source, but some **pretrained weights** are non-commercial:

| Component | License |
| --- | --- |
| faster-whisper, Whisper `large-v3-turbo`, whisper-turbo-khmer-v9 | MIT |
| Meta MMS-TTS weights (`facebook/mms-tts-*`) | CC BY-NC 4.0 (non-commercial) |
| OmniVoice weights | CC BY-NC (non-commercial) |

Before any paid offering, TTS and voice cloning need commercially licensed weights. [VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) (Apache 2.0, supports Khmer) is a candidate on GPU servers; the clone engine is behind a swappable interface.

## Documentation

- [Master Project Blueprint (PDF)](docs/Bondeth_AI_Master_Blueprint.pdf): the original proposal, requirements, architecture, business model and infrastructure costs.
- [frontend/README.md](frontend/README.md): pages and design system.

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
