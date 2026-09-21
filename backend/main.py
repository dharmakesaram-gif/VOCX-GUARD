import sys
import os
from pathlib import Path
import uuid
import base64
import logging
import datetime
import numpy as np
import torch
import json

# Add parent directory to sys.path to allow importing from ml
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

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

app = FastAPI(title="Vocx Guard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

session_manager = SessionManager()

# Initialize ML models
lfcc_lcnn_model = None
wavlm_model = None
rawnet2_model = None
speaker_verifier = None
risk_engine = None
ENROLLED_SPEAKERS = {}

@app.on_event("startup")
async def startup_event():
    global lfcc_lcnn_model, wavlm_model, rawnet2_model, speaker_verifier, risk_engine
    logger.info("Initializing Vocx Guard models...")
    lfcc_lcnn_model = LCNN()
    lfcc_lcnn_model.eval()
    wavlm_model = WavLMDetector()
    wavlm_model.eval()
    rawnet2_model = RawNet2()
    rawnet2_model.eval()

    # Load trained checkpoints if available
    checkpoint_dir = Path(__file__).parent.parent / "checkpoints"
    lcnn_path = checkpoint_dir / "lfcc_lcnn_best.pt"
    if lcnn_path.exists():
        try:
            ckpt = torch.load(lcnn_path, map_location="cpu")
            lfcc_lcnn_model.load_state_dict(ckpt.get("model_state_dict", ckpt))
            logger.info("Loaded trained weights for LFCC-LCNN.")
        except Exception as e:
            logger.warning(f"Could not load LFCC-LCNN weights: {e}")

    rawnet_path = checkpoint_dir / "rawnet2_best.pt"
    if rawnet_path.exists():
        try:
            ckpt = torch.load(rawnet_path, map_location="cpu")
            rawnet2_model.load_state_dict(ckpt.get("model_state_dict", ckpt))
            logger.info("Loaded trained weights for RawNet2.")
        except Exception as e:
            logger.warning(f"Could not load RawNet2 weights: {e}")

    wavlm_path = checkpoint_dir / "wavlm_best.pt"
    if wavlm_path.exists():
        try:
            ckpt = torch.load(wavlm_path, map_location="cpu")
            wavlm_model.load_state_dict(ckpt.get("model_state_dict", ckpt))
            logger.info("Loaded trained weights for WavLM.")
        except Exception as e:
            logger.warning(f"Could not load WavLM weights: {e}")

    speaker_verifier = SpeakerVerifier()
    risk_engine = RiskEngine()
    logger.info("Models initialized. Application ready.")

@app.get("/")
def health_check():
    return {"status": "ok", "name": "Vocx Guard API"}

@app.post("/api/enroll", response_model=EnrollResponse)
def enroll_speaker(request: EnrollRequest):
    if not request.audio_base64:
        raise HTTPException(status_code=400, detail="Audio data is required.")
    
    audio = decode_audio(request.audio_base64)
    mel_spec = extract_log_mel(audio)
    speaker_verifier.enroll(request.speaker_id, [mel_spec])
    ENROLLED_SPEAKERS[request.speaker_id] = True
    
    return EnrollResponse(
        speaker_id=request.speaker_id,
        status="success",
        message=f"Speaker {request.speaker_id} successfully enrolled.",
        embedding_dim=192
    )

def evaluate_neural_models(audio: np.ndarray, sr: int = 16000) -> tuple[float, float, float]:
    """
    Multi-Scale Neural Anti-Spoofing Inference.
    - If audio <= 2.5s: Evaluate directly (optimized for real-time live call chunks).
    - If audio > 2.5s (e.g. 4s snapshots or full 15s+ file uploads):
      Slide 2.0s - 2.5s windows with 1.0s hop across the audio to preserve local
      transposed-convolution vocoder phase and aliasing signatures that would otherwise
      be diluted by AdaptiveAvgPool2d((4, 4)).
      Aggregates using peak threat dominance (if ANY window contains deepfake signatures,
      the audio is an AI voice clone).
    """
    if len(audio) < sr:
        audio = np.pad(audio, (0, sr - len(audio)))

    total_len = len(audio)

    if total_len <= int(2.5 * sr):
        lfcc = extract_lfcc(audio, sr=sr).unsqueeze(0)
        audio_tensor = torch.tensor(audio, dtype=torch.float32).unsqueeze(0).unsqueeze(0)
        with torch.no_grad():
            lfcc_prob = lfcc_lcnn_model.predict(lfcc).item()
            wavlm_prob = wavlm_model.predict(audio_tensor).item()
            rawnet2_prob = rawnet2_model.predict(audio_tensor).item()
        return lfcc_prob, wavlm_prob, rawnet2_prob

    win_samples = int(2.5 * sr)
    hop_samples = int(1.0 * sr)
    chunk_lfccs = []
    chunk_wls = []
    chunk_rns = []
    chunk_weights = []

    for start in range(0, total_len - sr + 1, hop_samples):
        chunk = audio[start:start + win_samples]
        if len(chunk) < sr:
            break

        # Energy / VAD gating: check if this window contains active speech or ambient noise/silence
        chunk_peak = float(np.max(np.abs(chunk)))
        chunk_rms = float(np.sqrt(np.mean(chunk ** 2)))

        # Skip silent gaps, background mic hiss, or breathing pauses to prevent false vocoder detection
        if chunk_peak < 0.035 or chunk_rms < 0.005:
            continue

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
        chunk_weights.append(chunk_rms)

    if not chunk_lfccs:
        # Fallback to direct evaluation if no windows met voice energy threshold
        c_norm = normalize_audio(audio)
        lfcc = extract_lfcc(c_norm, sr=sr).unsqueeze(0)
        audio_tensor = torch.tensor(c_norm, dtype=torch.float32).unsqueeze(0)
        with torch.no_grad():
            return (
                lfcc_lcnn_model.predict(lfcc).item(),
                wavlm_model.predict(audio_tensor).item(),
                rawnet2_model.predict(audio_tensor).item()
            )

    # Energy-weighted aggregation across active voiced windows
    weights = np.array(chunk_weights) / (np.sum(chunk_weights) + 1e-6)
    weighted_lfcc = float(np.sum(np.array(chunk_lfccs) * weights))
    weighted_wl = float(np.sum(np.array(chunk_wls) * weights))
    weighted_rn = float(np.sum(np.array(chunk_rns) * weights))

    # If any high-energy speech chunk (RMS > 0.02) demonstrates clear multi-model synthetic signatures:
    high_energy_indices = [i for i, w in enumerate(chunk_weights) if w >= 0.020]
    if high_energy_indices:
        he_lfccs = [chunk_lfccs[i] for i in high_energy_indices]
        he_wls = [chunk_wls[i] for i in high_energy_indices]
        he_rns = [chunk_rns[i] for i in high_energy_indices]
        # Check if high-energy voiced speech has strong synthetic detection
        if any((l >= 0.75 and (w >= 0.70 or r >= 0.70)) or (w >= 0.80 and r >= 0.80) for l, w, r in zip(he_lfccs, he_wls, he_rns)):
            weighted_lfcc = max(weighted_lfcc, max(he_lfccs))
            weighted_wl = max(weighted_wl, max(he_wls))
            weighted_rn = max(weighted_rn, max(he_rns))

    return weighted_lfcc, weighted_wl, weighted_rn

@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze_audio(request: AnalyzeRequest):
    session_id = request.session_id
    if not session_id:
        session_id = session_manager.create_session(request.speaker_id)
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    try:
        audio = decode_audio(request.audio_base64)
        peak = float(np.max(np.abs(audio))) if len(audio) > 0 else 0.0
        
        # Room ambient silence gate: if pure room tone and no voice activity, report low baseline
        if peak < 0.012:
            session_manager.update_session(session_id, 8.0)
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
            
        # Peak-normalize audio to standard range (matching ASVspoof training)
        audio = normalize_audio(audio)
        
        # Log Mel for Speaker Verifier (batch, n_mels, time_frames)
        log_mel = extract_log_mel(audio)

        # Owner Voice Filtering: If device owner filtering is enabled and the speech matches the owner,
        # bypass deepfake inspection so the user's own voice is never flagged or analyzed as the incoming caller.
        if request.filter_owner and request.owner_speaker_id:
            owner_id = request.owner_speaker_id
            if owner_id in speaker_verifier.voiceprints:
                try:
                    is_owner_match, owner_sim = speaker_verifier.verify(owner_id, log_mel)
                    if is_owner_match or owner_sim >= 0.52:
                        logger.info(f"Local device owner speech detected (similarity={owner_sim:.3f}). Bypassing caller deepfake scan.")
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
                                "note": "Local user (device owner) voice detected. Deepfake scan bypassed."
                            },
                            timestamp=datetime.datetime.now().isoformat()
                        )
                except Exception as verify_err:
                    logger.warning(f"Owner verification check error: {verify_err}")
        
        # Multi-scale neural evaluation for LFCC-LCNN, WavLM, RawNet2
        lfcc_prob, wavlm_prob, rawnet2_prob = evaluate_neural_models(audio)
            
        has_target_speaker = bool(request.speaker_id and request.speaker_id in speaker_verifier.voiceprints)
        similarity = 0.85 # baseline neutral if no enrolled voiceprint target
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
        
        session_manager.update_session(session_id, risk_assessment.fused_score * 100)
        is_spoofed = (risk_assessment.fused_score >= 0.50) or (risk_assessment.acoustic_score >= 0.50)
        
        logger.info(
            f"Analyze: peak={peak:.4f}, lfcc={lfcc_prob:.4f}, rawnet2={rawnet2_prob:.4f}, "
            f"wavlm={wavlm_prob:.4f}, bio={bio_metrics.get('bio_spoof_prob', 0):.4f}, "
            f"jitter={bio_metrics.get('jitter', 0):.4f}, acoustic={risk_assessment.acoustic_score:.4f}, "
            f"fused={risk_assessment.fused_score:.4f}, spoofed={is_spoofed}"
        )
        
        # Convert timestamp to str for JSON serialization
        timestamp_str = risk_assessment.timestamp.isoformat()
        
        return AnalyzeResponse(
            session_id=session_id,
            risk_score=session.get_current_risk(),
            risk_level=session.get_risk_level(),
            acoustic_score=risk_assessment.acoustic_score * 100,
            speaker_score=risk_assessment.speaker_score * 100,
            context_score=risk_assessment.context_score * 100,
            is_spoofed=is_spoofed,
            details=risk_assessment.details,
            timestamp=timestamp_str
        )
    except Exception as e:
        logger.error(f"Analysis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/risk-score/{session_id}", response_model=RiskScoreResponse)
def get_risk_score(session_id: str):
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    return RiskScoreResponse(
        session_id=session_id,
        current_risk=session.get_current_risk(),
        risk_level=session.get_risk_level(),
        risk_history=session.risk_history
    )

@app.get("/api/sessions", response_model=SessionListResponse)
def list_sessions():
    return SessionListResponse(sessions=[SessionInfo(**s) for s in session_manager.list_sessions()])

@app.delete("/api/sessions/{session_id}")
def close_session(session_id: str):
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    session_manager.close_session(session_id)
    return {"status": "closed", "session_id": session_id}

@app.get("/api/enrolled-speakers")
def list_enrolled_speakers():
    return {"speakers": speaker_verifier.enrolled_speakers}

@app.websocket("/ws/stream")
async def websocket_endpoint(websocket: WebSocket):
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
                        "is_spoofed": False,
                        "details": {"status": "ambient_silence", "peak_amplitude": peak}
                    })
                    continue

                audio = normalize_audio(audio)
                log_mel = extract_log_mel(audio)

                # Owner voice bypass check
                if filter_owner and owner_speaker_id and owner_speaker_id in speaker_verifier.voiceprints:
                    try:
                        is_owner_match, owner_sim = speaker_verifier.verify(owner_speaker_id, log_mel)
                        if is_owner_match or owner_sim >= 0.52:
                            session = session_manager.get_session(session_id)
                            current_r = session.get_current_risk() if session else 8.0
                            current_lvl = session.get_risk_level() if session else "LOW"
                            await websocket.send_json({
                                "session_id": session_id,
                                "risk_score": current_r,
                                "risk_level": current_lvl,
                                "acoustic_score": 6.0,
                                "speaker_score": 0.0,
                                "is_spoofed": False,
                                "details": {
                                    "speaker_channel": "local_user",
                                    "is_owner_speaking": True,
                                    "owner_similarity": round(float(owner_sim), 3),
                                    "note": "Local user (device owner) voice detected. Deepfake scan bypassed."
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
                
                is_spoofed = (risk_assessment.fused_score >= 0.50) or (risk_assessment.acoustic_score >= 0.50)
                await websocket.send_json({
                    "session_id": session_id,
                    "risk_score": session.get_current_risk(),
                    "risk_level": session.get_risk_level(),
                    "acoustic_score": risk_assessment.acoustic_score * 100,
                    "speaker_score": risk_assessment.speaker_score * 100,
                    "is_spoofed": is_spoofed,
                    "details": risk_assessment.details,
                })
            except Exception as e:
                logger.error(f"WS error: {str(e)}")
                await websocket.send_json({"error": str(e)})
                
    except WebSocketDisconnect:
        session_manager.close_session(session_id)
        logger.info(f"Session {session_id} disconnected and closed.")
    finally:
        session_manager.close_session(session_id)
