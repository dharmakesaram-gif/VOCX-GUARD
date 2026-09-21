# VOCX GUARD — Streaming Voice Integrity Engine

[![SIH 2026](https://img.shields.io/badge/SIH_2026-PS26104-blue)](https://sih.gov.in)

## Problem Statement
With the rise of deepfakes and AI voice cloning, verifying the authenticity of audio streams in real-time has become critical. The challenge is to detect artificially generated voices (spoofing) with high accuracy and low latency during live calls.

## Solution Overview
**Vocx Guard** is an AI-Powered Real-Time Voice Cloning Detection system. It processes audio streams on the fly, extracting acoustic features and evaluating them through a multi-model pipeline. It continuously monitors risk levels and flags suspicious audio segments instantly.

## Architecture

```
[Audio Stream] 
     |
     v
+-----------------------+
|  Feature Extraction   | (LFCC, MFCC)
+-----------------------+
     |
     v
+-----------------------+
|      ML Models        |
| - LFCC-LCNN           |
| - WavLM Detector      |
| - RawNet2             |
+-----------------------+
     |
     v
+-----------------------+
| Speaker Verification  |
+-----------------------+
     |
     v
+-----------------------+
|     Risk Engine       | (Score Fusion, EMA)
+-----------------------+
     |
     v
[Risk Score & Alerts]
```

## Tech Stack
| Component | Technology |
|---|---|
| Backend | FastAPI, Python |
| ML Frameworks | PyTorch, torchaudio, scikit-learn |
| Real-time Comm | WebSockets |
| Audio Processing | librosa, soundfile |

## Getting Started

### Install
```bash
pip install -r requirements.txt
```

### Run Backend
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

## API Documentation

### REST Endpoints
- `GET /` — Health check
- `POST /api/enroll` — Enroll a speaker
- `POST /api/analyze` — Analyze a single audio snippet
- `GET /api/risk-score/{session_id}` — Get risk score for session
- `GET /api/sessions` — List all active sessions
- `DELETE /api/sessions/{session_id}` — Close a session
- `GET /api/enrolled-speakers` — List enrolled speakers

### WebSockets
- `WS /ws/stream` — Real-time streaming analysis endpoint

## Risk Levels

| Level | Range | Description |
|---|---|---|
| LOW | 0 - 29 | Likely genuine human voice |
| MEDIUM | 30 - 69 | Suspicious, further analysis needed |
| HIGH | 70 - 100 | High probability of AI synthesis / spoofing |

## Project Structure
```
vocxguard/
├── backend/
│   ├── __init__.py
│   ├── main.py
│   ├── schemas.py
│   └── session_manager.py
├── ml/
│   ├── models/
│   ├── audio_utils.py
│   ├── feature_extraction.py
│   ├── risk_engine.py
│   ├── speaker_verification.py
│   └── vad.py
├── frontend/
├── mobile/
├── demo/
├── requirements.txt
└── README.md
```

## References
- ASVspoof 2021
- RawNet2 Paper
- CERT-In Guidelines
- DPDP Act 2023

## Team
- Placeholder Team Info
