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

</div>

---

## Overview

**Bondeth AI** takes its name from the Khmer word *បណ្ឌិត* (*Bondeth*), meaning scholar or master of knowledge. It is a planned, self-hosted voice platform that aims to remove typing and accessibility barriers for Khmer speakers.

Typing Khmer is slow: multi-layered keyboard layouts, sub-consonants (*ជើងអក្សរ*), and stacked diacritics all add friction. Everyday communication in Cambodia also mixes Khmer and English freely, and proprietary voice APIs charge per-minute fees that local developers can't afford. Bondeth AI plans to address all three with one bilingual suite built on open-source engines.

> **Status: pre-production.** This repository currently holds the [Master Project Blueprint](docs/Bondeth_AI_Master_Blueprint.pdf), which covers the proposal, requirements, architecture, and business model. Implementation has not started yet.

## Planned Features

| Feature | Engine | What it will do |
| --- | --- | --- |
| **Speech-to-Text (STT)** | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (`large-v3-turbo`) | Transcribe microphone input or uploaded audio (`.wav`, `.mp3`, `.m4a`) in Khmer and English, with automatic language detection and Khmer word segmentation through [khmercut](https://github.com/seanghay/khmercut) |
| **Text-to-Speech (TTS)** | [Meta MMS-TTS](https://huggingface.co/facebook/mms-tts-khm) (VITS) | Generate natural speech from text, with Khmer normalization that reads out numbers, currencies (`$25` → ម្ភៃប្រាំដុល្លារ), and dates |
| **Zero-shot voice cloning** | [F5-TTS](https://github.com/SWivid/F5-TTS) (flow matching) | Clone a voice from a 10–30 second reference clip, with no training, and speak custom Khmer or English text in that voice |

### Goals

- A self-hosted stack with no licensing fees for self-hosters.
- Response times under 2 seconds for transcription and speech generation.
- Voice cloning from under 30 seconds of reference audio.

## Planned Architecture

```text
┌────────────────────────────────────────────────────────────────────┐
│                         NEXT.JS FRONTEND                           │
│  • Audio recorder (MediaRecorder)   • Waveform visualizer          │
│  • Khmer-aware text editor          • Custom web audio player      │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ REST / multipart requests
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│                          FASTAPI BACKEND                           │
│  • Routes: /stt, /tts, /clone      • Khmer text normalizer         │
│  • JWT auth and rate limiting      • Redis caching                 │
└─────────┬──────────────────────────┬───────────────────────┬───────┘
          ▼                          ▼                       ▼
 ┌──────────────────┐      ┌──────────────────┐     ┌──────────────────┐
 │   STT WORKER     │      │   TTS WORKER     │     │  CLONE WORKER    │
 │  faster-whisper  │      │   Meta MMS-TTS   │     │     F5-TTS       │
 │  (CTranslate2)   │      │     (VITS)       │     │  (flow matching) │
 └──────────────────┘      └──────────────────┘     └──────────────────┘
```

### Planned API

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/v1/stt` | Upload audio → detected language and transcribed text |
| `POST` | `/api/v1/tts` | Text and language (`km` or `en`) → WAV audio |
| `POST` | `/api/v1/clone` | Reference audio, target text, and language → cloned speech |

The planned PostgreSQL schema stores `users`, `transcriptions`, and `cloned_voices`. See the blueprint for details.

## Planned Tech Stack

| Area | Technology |
| --- | --- |
| Backend | Python 3.11, FastAPI, Pydantic, Uvicorn |
| Speech-to-Text | faster-whisper (CTranslate2) |
| Text-to-Speech | Meta MMS-TTS (`mms-tts-khm`, `mms-tts-eng`) via Transformers and PyTorch |
| Voice cloning | F5-TTS |
| Khmer NLP | khmercut (word segmentation) |
| Frontend | Next.js, React |
| Data | PostgreSQL 16, Redis |
| Deployment | Docker Compose, with a GPU option (NVIDIA T4) for real-time cloning |

## Model Licenses

The engines' **code** is open source, but some **pretrained weights** are licensed for non-commercial use only:

| Component | License |
| --- | --- |
| faster-whisper, Whisper `large-v3-turbo` weights | MIT |
| khmercut | Apache 2.0 |
| Meta MMS-TTS weights (`facebook/mms-tts-*`) | CC BY-NC 4.0 (non-commercial) |
| F5-TTS pretrained weights | CC BY-NC 4.0 (non-commercial) |

Any paid or commercial offering will need commercially licensed or self-trained TTS and voice-cloning weights.

## Documentation

- [Master Project Blueprint (PDF)](docs/Bondeth_AI_Master_Blueprint.pdf): proposal, requirements, architecture, reference backend code, database schema, business model, and infrastructure costs.

## Project Structure

```text
Bondeth-AI/
└── docs/
    └── Bondeth_AI_Master_Blueprint.pdf
```

## Author

**Rithy Bondeth** — Full Stack Developer & AI Engineer

[![Portfolio](https://img.shields.io/badge/Portfolio-0A0A0A?style=for-the-badge&logo=vercel&logoColor=white)](https://bondeth.dev)
[![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/RithyBondeth)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/rithy-bondeth-484073282/)
