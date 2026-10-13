<div align="center">
  <h1><b>BONDETH AI (បណ្ឌិត AI)</b></h1>
  <p><b>Open-Source Bilingual (Khmer & English) Voice Intelligence Suite</b></p>
  
  <p>
    <img src="https://img.shields.io/badge/Status-Active-brightgreen" alt="Status">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License">
    <img src="https://img.shields.io/badge/Python-3.11%2B-blue" alt="Python">
    <img src="https://img.shields.io/badge/FastAPI-Async-005571?logo=fastapi" alt="FastAPI">
  </p>
</div>

---


## 🚀 Overview
**Bondeth AI** (បណ្ឌិត AI) is an advanced, fully open-source voice intelligence platform engineered to eliminate literacy, typing friction, and accessibility barriers in Cambodia. Traditional typing in Khmer script is slowed down by complex, multi-layered keyboard layouts (*ជើងអក្សរ* and stacked diacritics). Bondeth AI bridges this gap by providing a high-performance, bilingual suite supporting **Speech-to-Text (STT)**, **Text-to-Speech (TTS)**, and **Zero-Shot Voice Cloning** for both Khmer and English.

---

## ✨ Core Features

1. **Speech-to-Text (STT):** Powered by `faster-whisper` (`large-v3-turbo`) with automatic language detection and `khmercut` word boundary segmentation.
2. **Text-to-Speech (TTS):** Powered by Meta MMS-TTS (VITS) with built-in text normalization to verbalize numbers, currencies (e.g., `$25` $\rightarrow$ ម្ភៃប្រាំដុល្លារ), and dates.
3. **Zero-Shot Voice Cloning:** Powered by F5-TTS, enabling users to clone any voice from a 15–30 second reference clip to generate custom Khmer or English speech.

---

## 🛠️ Tech Stack

* **Backend:** Python 3.11, FastAPI, Pydantic, Uvicorn
* **STT Engine:** `faster-whisper` (CTranslate2 backend)
* **TTS Engine:** Meta MMS-TTS (`mms-tts-khm`, `mms-tts-eng`)
* **Voice Cloning:** F5-TTS (Flow Matching Diffusion Transformer)
* **NLP Processing:** `khmercut` (Word Segmentation)
* **Database & Cache:** PostgreSQL 16, Redis

---

## 📂 Project Structure

```text
bondeth-ai/
├── backend/
│   ├── main.py             # FastAPI orchestration & endpoints
│   ├── requirements.txt    # Python dependencies
│   └── models/             # Local model caches
├── frontend/               # Next.js / React web interface
├── docker-compose.yml      # Multi-service container orchestration
└── README.md
