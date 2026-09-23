import sys
import os
from pathlib import Path
import uuid
import base64
import logging
import datetime
from typing import Optional, Tuple
from contextlib import asynccontextmanager
import numpy as np
import torch
torch.set_num_threads(4)
import json

# Add parent directory to sys.path to allow importing from ml
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Security, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader, APIKeyQuery

from backend.schemas import (
    EnrollRequest, EnrollResponse, AnalyzeRequest, AnalyzeResponse,
    SessionInfo, SessionListResponse, RiskScoreResponse
)
from backend.session_manager import SessionManager

# ML package imports
from ml.models.lfcc_lcnn import LCNN
from ml.models.wavlm_detector import WavLMDetector
from ml.models.rawnet2 import RawNet2
from ml.feature_extraction import extract_lfcc, extract_log_mel, extract_mfcc
from ml.audio_utils import decode_audio, normalize_audio
from ml.speaker_verification import SpeakerVerifier
from ml.risk_engine import RiskEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Constants & Limits
MAX_AUDIO_BASE64_BYTES = 10 * 1024 * 1024  # 10 MB payload cap
MAX_AUDIO_DURATION_SECONDS = 60            # 60 seconds audio cap
SAMPLE_RATE = 16000
OWNER_BYPASS_SIMILARITY_THRESHOLD = 0.75   # Strict owner match threshold

# API Key Security Configuration
API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)
API_KEY_QUERY = APIKeyQuery(name="api_key", auto_error=False)
VOCXGUARD_API_KEY = os.getenv("VOCXGUARD_API_KEY", "").strip()

# ML Model singletons
lfcc_lcnn_model: Optional[LCNN] = None
wavlm_model: Optional[WavLMDetector] = None
rawnet2_model: Optional[RawNet2] = None
speaker_verifier: Optional[SpeakerVerifier] = None
risk_engine: Optional[RiskEngine] = None
session_manager = SessionManager()

def _safe_torch_load(path: Path) -> dict:
    """Safely loads PyTorch checkpoint with weights_only when supported."""
    try:
        return torch.load(path, map_location="cpu", weights_only=True)
    except TypeError:
        return torch.load(path, map_location="cpu")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Modern lifespan handler for model loading and resource management."""
    global lfcc_lcnn_model, wavlm_model, rawnet2_model, speaker_verifier, risk_engine
    logger.info("Initializing Vocx Guard neural models...")
    
    lfcc_lcnn_model = LCNN()
    lfcc_lcnn_model.eval()
    wavlm_model = WavLMDetector()
    wavlm_model.eval()
    rawnet2_model = RawNet2()
    rawnet2_model.eval()

    checkpoint_dir = Path(__file__).parent.parent / "checkpoints"

    # 1. LFCC-LCNN
    lcnn_path = checkpoint_dir / "lfcc_lcnn_best.pt"
    if lcnn_path.exists():
        try:
            ckpt = _safe_torch_load(lcnn_path)
            lfcc_lcnn_model.load_state_dict(ckpt.get("model_state_dict", ckpt))
            logger.info("Loaded trained weights for LFCC-LCNN.")
        except Exception as e:
            logger.warning(f"Could not load LFCC-LCNN weights: {e}")

    # 2. RawNet2
    rawnet_path = checkpoint_dir / "rawnet2_best.pt"
    if rawnet_path.exists():
        try:
            ckpt = _safe_torch_load(rawnet_path)
            rawnet2_model.load_state_dict(ckpt.get("model_state_dict", ckpt))
            logger.info("Loaded trained weights for RawNet2.")
        except Exception as e:
            logger.warning(f"Could not load RawNet2 weights: {e}")

    # 3. WavLM
    wavlm_path = checkpoint_dir / "wavlm_best.pt"
    if wavlm_path.exists():
        try:
            ckpt = _safe_torch_load(wavlm_path)
            wavlm_model.load_state_dict(ckpt.get("model_state_dict", ckpt))
            logger.info("Loaded trained weights for WavLM.")
        except Exception as e:
            logger.warning(f"Could not load WavLM weights: {e}")

    speaker_verifier = SpeakerVerifier()
    risk_engine = RiskEngine()
    
    if VOCXGUARD_API_KEY:
        logger.info("API Key protection enabled.")
    else:
        logger.warning("VOCXGUARD_API_KEY not set. Running in development mode (unrestricted access).")

    logger.info("Models initialized successfully. Application ready.")
    yield
    logger.info("Application shutting down.")

app = FastAPI(
    title="Vocx Guard API",
    description="Real-Time Deepfake Voice Defense & Biomechanical Authentication Engine",
    version="2.0.0",
    lifespan=lifespan
)

# CORS Configuration
allowed_origins = [
    "https://vocx-guard.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
extra_origins = os.getenv("CORS_ALLOWED_ORIGINS", "")
if extra_origins:
    allowed_origins.extend([o.strip() for o in extra_origins.split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def verify_api_key(
    header_key: Optional[str] = Security(API_KEY_HEADER),
    query_key: Optional[str] = Security(API_KEY_QUERY),
) -> bool:
    """
    Enforces API key authentication when VOCXGUARD_API_KEY is configured.
    In local dev mode (unset or empty key), requests are permitted.
    """
    if not VOCXGUARD_API_KEY:
        return True

    provided_key = header_key or query_key
    if not provided_key or provided_key != VOCXGUARD_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key. Provide a valid 'X-API-Key' header or '?api_key=' query parameter."
        )
    return True

@app.get("/")
def health_check():
    return {
        "status": "ok",
        "name": "Vocx Guard API",
        "version": "2.0.0",
        "auth_enabled": bool(VOCXGUARD_API_KEY)
    }

@app.get("/health")
@app.get("/api/health")
def health_check_alt():
    return health_check()

@app.post("/api/enroll", response_model=EnrollResponse, dependencies=[Depends(verify_api_key)])
def enroll_speaker(request: EnrollRequest):
    if not request.audio_base64:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Audio data is required.")
    
    if len(request.audio_base64) > MAX_AUDIO_BASE64_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Audio payload exceeds maximum permitted size of {MAX_AUDIO_BASE64_BYTES // (1024 * 1024)}MB."
        )

    speaker_id = request.speaker_id.strip()
    if not speaker_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Speaker ID cannot be blank.")

    # Guard against unauthorized voiceprint overwrites (prevents bypass attacks)
    if speaker_id in speaker_verifier.voiceprints:
        if not request.allow_overwrite:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Speaker ID '{speaker_id}' is already enrolled. Re-enrollment requires explicit allow_overwrite authorization."
            )
        logger.warning(f"Voiceprint for speaker '{speaker_id}' is being overwritten with explicit authorization.")

    try:
        audio = decode_audio(request.audio_base64)
    except Exception as e:
        logger.error(f"Audio decoding error in enroll: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed audio payload.")

    if len(audio) > MAX_AUDIO_DURATION_SECONDS * SAMPLE_RATE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Audio duration exceeds maximum limit of {MAX_AUDIO_DURATION_SECONDS} seconds."
        )

    try:
        audio = normalize_audio(audio)
        mel_spec = extract_log_mel(audio)
        speaker_verifier.enroll(speaker_id, [mel_spec])
    except Exception as e:
        logger.exception(f"Speaker enrollment failed for '{speaker_id}'.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Speaker enrollment processing failed.")
    
    return EnrollResponse(
        speaker_id=speaker_id,
        status="success",
        message=f"Speaker '{speaker_id}' successfully enrolled.",
        embedding_dim=192
    )

def evaluate_neural_models(audio: np.ndarray, sr: int = SAMPLE_RATE) -> Tuple[float, float, float]:
    """
    Multi-Scale Neural Anti-Spoofing Inference.
    - If audio <= 3.5s: Evaluate directly (optimized for real-time live call chunks).
    - If audio > 3.5s: Select up to 2 key representative slices (highest speech energy slice
      and center slice) to retain full forensic sensitivity while completing inference in < 200ms.
    """
    if len(audio) < sr:
        audio = np.pad(audio, (0, sr - len(audio)))

    total_len = len(audio)

    # Fast single pass for real-time live call chunks (<= 3.5s)
    if total_len <= int(3.5 * sr):
        c_norm = normalize_audio(audio)
        lfcc = extract_lfcc(c_norm, sr=sr).unsqueeze(0)
        audio_tensor = torch.tensor(c_norm, dtype=torch.float32).unsqueeze(0)
        with torch.no_grad():
            lfcc_prob = lfcc_lcnn_model.predict(lfcc).item()
            wavlm_prob = wavlm_model.predict(audio_tensor).item()
            rawnet2_prob = rawnet2_model.predict(audio_tensor).item()
        return lfcc_prob, wavlm_prob, rawnet2_prob

    # Representative slice selection for longer recordings (snapshots/forensics)
    win_samples = int(2.5 * sr)
    step = int(0.5 * sr)
    best_start = 0
    max_energy = -1.0

    # Scan for the highest speech energy window
    for st in range(0, total_len - win_samples + 1, step):
        seg = audio[st:st + win_samples]
        seg_energy = float(np.mean(seg ** 2))
        if seg_energy > max_energy:
            max_energy = seg_energy
            best_start = st

    candidates = [best_start]

    # Secondary representative slice (center or distinct segment)
    center_start = max(0, (total_len - win_samples) // 2)
    if abs(center_start - best_start) >= int(1.25 * sr):
        candidates.append(center_start)
    elif best_start > win_samples:
        candidates.append(0)
    elif best_start + 2 * win_samples <= total_len:
        candidates.append(total_len - win_samples)

    chunk_lfccs = []
    chunk_wls = []
    chunk_rns = []
    chunk_weights = []

    for start in candidates:
        chunk = audio[start:start + win_samples]
        if len(chunk) < sr:
            continue
        c_rms = float(np.sqrt(np.mean(chunk ** 2)))
        c_norm = normalize_audio(chunk)
        c_lfcc = extract_lfcc(c_norm, sr=sr).unsqueeze(0)
        c_tensor = torch.tensor(c_norm, dtype=torch.float32).unsqueeze(0)
        with torch.no_grad():
            p_lfcc = lfcc_lcnn_model.predict(c_lfcc).item()
            p_wl = wavlm_model.predict(c_tensor).item()
            p_rn = rawnet2_model.predict(c_tensor).item()
        chunk_lfccs.append(p_lfcc)
        chunk_wls.append(p_wl)
        chunk_rns.append(p_rn)
        chunk_weights.append(max(c_rms, 0.01))

    if not chunk_lfccs:
        c_norm = normalize_audio(audio[:win_samples])
        lfcc = extract_lfcc(c_norm, sr=sr).unsqueeze(0)
        audio_tensor = torch.tensor(c_norm, dtype=torch.float32).unsqueeze(0)
        with torch.no_grad():
            return (
                lfcc_lcnn_model.predict(lfcc).item(),
                wavlm_model.predict(audio_tensor).item(),
                rawnet2_model.predict(audio_tensor).item()
            )

    weights = np.array(chunk_weights) / (np.sum(chunk_weights) + 1e-6)
    weighted_lfcc = float(np.sum(np.array(chunk_lfccs) * weights))
    weighted_wl = float(np.sum(np.array(chunk_wls) * weights))
    weighted_rn = float(np.sum(np.array(chunk_rns) * weights))

    # Threat preservation: If any key segment exhibits strong spoofing artifacts, elevate threat
    if any(l >= 0.70 or (w >= 0.70 and r >= 0.70) or (w >= 0.75 and l >= 0.50)
           for l, w, r in zip(chunk_lfccs, chunk_wls, chunk_rns)):
        weighted_lfcc = max(weighted_lfcc, max(chunk_lfccs))
        weighted_wl = max(weighted_wl, max(chunk_wls))
        weighted_rn = max(weighted_rn, max(chunk_rns))

    return weighted_lfcc, weighted_wl, weighted_rn

@app.post("/api/analyze", response_model=AnalyzeResponse, dependencies=[Depends(verify_api_key)])
def analyze_audio(request: AnalyzeRequest):
    if len(request.audio_base64) > MAX_AUDIO_BASE64_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Audio payload exceeds maximum permitted size of {MAX_AUDIO_BASE64_BYTES // (1024 * 1024)}MB."
        )

    session_id = request.session_id
    if not session_id:
        default_speaker = request.speaker_id or "Snapshot Voice Analysis"
        session_id = session_manager.create_session(default_speaker)
        session = session_manager.get_session(session_id)
    else:
        session = session_manager.get_session(session_id)
        if not session:
            default_speaker = request.speaker_id or "Live Call Monitor"
            session_id = session_manager.create_session(default_speaker, session_id=session_id)
            session = session_manager.get_session(session_id)
        
    try:
        try:
            audio = decode_audio(request.audio_base64)
        except Exception as decode_err:
            logger.error(f"Failed to decode audio base64: {decode_err}")
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid audio base64 data.")

        if len(audio) > MAX_AUDIO_DURATION_SECONDS * SAMPLE_RATE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Audio duration exceeds maximum limit of {MAX_AUDIO_DURATION_SECONDS} seconds."
            )

        peak = float(np.max(np.abs(audio))) if len(audio) > 0 else 0.0
        
        # Room ambient silence gate: if pure room tone and no voice activity, report low baseline
        if peak < 0.012:
            session_manager.update_session(session_id, 8.0, speaker_id=request.speaker_id)
            return AnalyzeResponse(
                session_id=session_id,
                risk_score=8.0,
                risk_level="LOW",
                acoustic_score=8.0,
                speaker_score=7.0,
                context_score=0.0,
                is_spoofed=False,
                details={
                    "status": "ambient_silence",
                    "peak_amplitude": peak,
                    "confidence": 0.98
                },
                timestamp=datetime.datetime.now().isoformat()
            )
            
        # Peak-normalize audio to standard range
        audio = normalize_audio(audio)
        log_mel = extract_log_mel(audio)

        # Owner Voice Filtering: Strictly requires both verified match AND high similarity (>= 0.75)
        if request.filter_owner and request.owner_speaker_id:
            owner_id = request.owner_speaker_id.strip()
            if owner_id in speaker_verifier.voiceprints:
                try:
                    is_owner_match, owner_sim = speaker_verifier.verify(owner_id, log_mel)
                    if is_owner_match and owner_sim >= OWNER_BYPASS_SIMILARITY_THRESHOLD:
                        logger.info(f"Local device owner verified (similarity={owner_sim:.3f} >= {OWNER_BYPASS_SIMILARITY_THRESHOLD}). Deepfake scan safely bypassed.")
                        return AnalyzeResponse(
                            session_id=session_id,
                            risk_score=session.get_current_risk(),
                            risk_level=session.get_risk_level(),
                            acoustic_score=6.0,
                            speaker_score=0.0,
                            context_score=0.0,
                            is_spoofed=False,
                            details={
                                "speaker_channel": "local_user",
                                "is_owner_speaking": True,
                                "owner_similarity": round(float(owner_sim), 3),
                                "note": "Local user (device owner) voice verified. Deepfake scan bypassed."
                            },
                            timestamp=datetime.datetime.now().isoformat()
                        )
                except Exception as verify_err:
                    logger.warning(f"Owner verification check error: {verify_err}")
        
        # Multi-scale neural evaluation
        lfcc_prob, wavlm_prob, rawnet2_prob = evaluate_neural_models(audio)
            
        has_target_speaker = bool(request.speaker_id and request.speaker_id in speaker_verifier.voiceprints)
        similarity = 0.85
        if has_target_speaker:
            is_match, similarity = speaker_verifier.verify(request.speaker_id, log_mel)
        
        acoustic_probs = {
            'lfcc_lcnn': lfcc_prob,
            'wavlm': wavlm_prob,
            'rawnet2': rawnet2_prob
        }
        
        call_metadata = {}
        bio_metrics = risk_engine.analyze_biomechanical_authenticity(audio)
        risk_assessment = risk_engine.assess_risk(
            acoustic_probs,
            similarity,
            call_metadata,
            bio_metrics=bio_metrics,
            has_target_speaker=has_target_speaker,
        )
        
        session_manager.update_session(session_id, risk_assessment.fused_score * 100, speaker_id=request.speaker_id)
        is_spoofed = (risk_assessment.fused_score >= 0.70) or (risk_assessment.acoustic_score >= 0.70)
        
        logger.info(
            f"Analyze: peak={peak:.4f}, lfcc={lfcc_prob:.4f}, rawnet2={rawnet2_prob:.4f}, "
            f"wavlm={wavlm_prob:.4f}, bio={bio_metrics.get('bio_spoof_prob', 0):.4f}, "
            f"acoustic={risk_assessment.acoustic_score:.4f}, fused={risk_assessment.fused_score:.4f}, spoofed={is_spoofed}"
        )
        
        return AnalyzeResponse(
            session_id=session_id,
            risk_score=session.get_current_risk(),
            risk_level=session.get_risk_level(),
            acoustic_score=risk_assessment.acoustic_score * 100,
            speaker_score=risk_assessment.speaker_score * 100,
            context_score=risk_assessment.context_score * 100,
            is_spoofed=is_spoofed,
            details=risk_assessment.details,
            timestamp=risk_assessment.timestamp.isoformat()
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Analysis failed due to internal error.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal analysis error. Please try again."
        )

@app.get("/api/risk-score/{session_id}", response_model=RiskScoreResponse, dependencies=[Depends(verify_api_key)])
def get_risk_score(session_id: str):
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
        
    return RiskScoreResponse(
        session_id=session_id,
        current_risk=session.get_current_risk(),
        risk_level=session.get_risk_level(),
        risk_history=session.risk_history
    )

@app.get("/api/sessions", response_model=SessionListResponse, dependencies=[Depends(verify_api_key)])
def list_sessions():
    return SessionListResponse(sessions=[SessionInfo(**s) for s in session_manager.list_sessions()])

@app.delete("/api/sessions/{session_id}", dependencies=[Depends(verify_api_key)])
def close_session(session_id: str):
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    session_manager.close_session(session_id)
    return {"status": "closed", "session_id": session_id}

@app.get("/api/enrolled-speakers", dependencies=[Depends(verify_api_key)])
def list_enrolled_speakers():
    return {"speakers": speaker_verifier.enrolled_speakers}

@app.websocket("/ws/stream")
async def websocket_endpoint(websocket: WebSocket):
    # Enforce API key authentication on WebSocket handshake if configured
    if VOCXGUARD_API_KEY:
        query_key = websocket.query_params.get("api_key") or websocket.query_params.get("token")
        header_key = websocket.headers.get("x-api-key")
        provided_key = header_key or query_key
        if not provided_key or provided_key != VOCXGUARD_API_KEY:
            await websocket.close(code=1008, reason="Unauthorized: invalid or missing API key")
            return

    await websocket.accept()
    session_id = session_manager.create_session()
    try:
        await websocket.send_json({"event": "connected", "session_id": session_id})
        while True:
            data = await websocket.receive_text()
            
            try:
                msg = json.loads(data)
                audio_base64 = msg.get("audio_base64") or msg.get("data")
                speaker_id = msg.get("speaker_id")
                owner_speaker_id = msg.get("owner_speaker_id")
                filter_owner = bool(msg.get("filter_owner", False))
                
                if not audio_base64:
                    continue

                if len(audio_base64) > MAX_AUDIO_BASE64_BYTES:
                    await websocket.send_json({"error": "Payload exceeds maximum allowed 10MB limit."})
                    continue
                    
                audio = decode_audio(audio_base64)
                peak = float(np.max(np.abs(audio))) if len(audio) > 0 else 0.0

                # Ambient silence check
                if peak < 0.012:
                    session_manager.update_session(session_id, 8.0)
                    session = session_manager.get_session(session_id)
                    await websocket.send_json({
                        "session_id": session_id,
                        "risk_score": 8.0,
                        "risk_level": "LOW",
                        "acoustic_score": 8.0,
                        "speaker_score": 7.0,
                        "context_score": 0.0,
                        "is_spoofed": False,
                        "details": {"status": "ambient_silence", "peak_amplitude": peak}
                    })
                    continue

                audio = normalize_audio(audio)
                log_mel = extract_log_mel(audio)

                # Strict owner voice bypass check
                if filter_owner and owner_speaker_id and owner_speaker_id.strip() in speaker_verifier.voiceprints:
                    try:
                        owner_id = owner_speaker_id.strip()
                        is_owner_match, owner_sim = speaker_verifier.verify(owner_id, log_mel)
                        if is_owner_match and owner_sim >= OWNER_BYPASS_SIMILARITY_THRESHOLD:
                            session = session_manager.get_session(session_id)
                            current_r = session.get_current_risk() if session else 8.0
                            current_lvl = session.get_risk_level() if session else "LOW"
                            await websocket.send_json({
                                "session_id": session_id,
                                "risk_score": current_r,
                                "risk_level": current_lvl,
                                "acoustic_score": 6.0,
                                "speaker_score": 0.0,
                                "context_score": 0.0,
                                "is_spoofed": False,
                                "details": {
                                    "speaker_channel": "local_user",
                                    "is_owner_speaking": True,
                                    "owner_similarity": round(float(owner_sim), 3),
                                    "note": "Local user (device owner) voice verified. Deepfake scan bypassed."
                                }
                            })
                            continue
                    except Exception as verify_err:
                        logger.warning(f"WS owner verification check error: {verify_err}")

                lfcc_prob, wavlm_prob, rawnet2_prob = evaluate_neural_models(audio)
                    
                has_target_speaker = bool(speaker_id and speaker_id in speaker_verifier.voiceprints)
                similarity = 0.85
                if has_target_speaker:
                    is_match, similarity = speaker_verifier.verify(speaker_id, log_mel)
                
                acoustic_probs = {
                    'lfcc_lcnn': lfcc_prob,
                    'wavlm': wavlm_prob,
                    'rawnet2': rawnet2_prob
                }
                
                bio_metrics = risk_engine.analyze_biomechanical_authenticity(audio)
                risk_assessment = risk_engine.assess_risk(
                    acoustic_probs,
                    similarity,
                    {},
                    bio_metrics=bio_metrics,
                    has_target_speaker=has_target_speaker,
                )
                session_manager.update_session(session_id, risk_assessment.fused_score * 100)
                session = session_manager.get_session(session_id)
                
                is_spoofed = (risk_assessment.fused_score >= 0.70) or (risk_assessment.acoustic_score >= 0.70)
                await websocket.send_json({
                    "session_id": session_id,
                    "risk_score": session.get_current_risk(),
                    "risk_level": session.get_risk_level(),
                    "acoustic_score": risk_assessment.acoustic_score * 100,
                    "speaker_score": risk_assessment.speaker_score * 100,
                    "context_score": risk_assessment.context_score * 100,
                    "is_spoofed": is_spoofed,
                    "details": risk_assessment.details,
                })
            except Exception as e:
                logger.exception("WS frame analysis failed.")
                await websocket.send_json({"error": "Audio frame processing error."})
                
    except WebSocketDisconnect:
        session_manager.close_session(session_id)
        logger.info(f"Session {session_id} disconnected.")
    finally:
        session_manager.close_session(session_id)
