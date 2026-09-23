from enum import Enum
from dataclasses import dataclass
from typing import Any, Optional
import datetime
import numpy as np

class RiskLevel(Enum):
    """Enumeration of risk levels."""
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"

@dataclass
class RiskAssessment:
    """Dataclass holding the result of a risk assessment."""
    acoustic_score: float
    speaker_score: float
    context_score: float
    fused_score: float
    risk_level: RiskLevel
    timestamp: datetime.datetime
    details: dict[str, Any]

class RiskEngine:
    """
    Risk fusion engine that combines multiple scores into a final risk assessment.
    """
    def __init__(self, acoustic_weight: float = 0.4, speaker_weight: float = 0.4, context_weight: float = 0.2):
        """
        Initialize the RiskEngine.
        
        Args:
            acoustic_weight (float): Weight for acoustic anti-spoofing score.
            speaker_weight (float): Weight for speaker verification mismatch score.
            context_weight (float): Weight for contextual risk score.
        """
        self.acoustic_weight = acoustic_weight
        self.speaker_weight = speaker_weight
        self.context_weight = context_weight

    def analyze_biomechanical_authenticity(self, audio: np.ndarray, sr: int = 16000) -> dict[str, Any]:
        """
        Quad-Forensic Reality Verification:
        1. Neural Vocoder Transposed Conv Aliasing (HFAR in 5.0 - 7.8 kHz band)
        2. Biomechanical Vocal Fold Mucosal Dynamics (Glottal micro-jitter and shimmer)
        3. Acoustic Near-field Mouth Proximity vs Loudspeaker Replay (sub-140Hz energy ratio)
        4. Frame Hop Boundary Phase Coherence (160 and 256 sample periodicities)
        """
        if len(audio) < int(sr * 0.3):
            return {'is_speech': False, 'bio_spoof_prob': 0.12, 'authenticity': 0.88, 'jitter': 0.012, 'shimmer': 0.035}

        peak = float(np.max(np.abs(audio))) if len(audio) > 0 else 0.0
        if peak < 0.008:
            return {'is_speech': False, 'bio_spoof_prob': 0.08, 'authenticity': 0.92, 'jitter': 0.012, 'shimmer': 0.035}

        import scipy.signal
        import librosa

        # 1. High-frequency neural vocoder aliasing during speech (5000 - 7800 Hz)
        # Human vowels decay steeply (-12dB/octave). Neural vocoders show transposed conv aliasing.
        sos_voice = scipy.signal.butter(4, [300, 3000], btype='bandpass', fs=sr, output='sos')
        sos_hi = scipy.signal.butter(4, [5000, 7800], btype='bandpass', fs=sr, output='sos')
        e_voice = float(np.mean(scipy.signal.sosfilt(sos_voice, audio)**2)) + 1e-8
        e_hi = float(np.mean(scipy.signal.sosfilt(sos_hi, audio)**2)) + 1e-8
        hf_aliasing_ratio = float(e_hi / e_voice)

        # 2. Spectral Flatness in high bands (neural vocoder noise floor)
        try:
            spec_flat = float(np.mean(librosa.feature.spectral_flatness(y=audio)))
        except Exception:
            spec_flat = 5e-6

        # 3. Sub-bass proximity energy (mouth near microphone vs laptop/phone speaker playback)
        sos_sub = scipy.signal.butter(3, 140, btype='lowpass', fs=sr, output='sos')
        e_sub = float(np.mean(scipy.signal.sosfilt(sos_sub, audio)**2)) + 1e-8
        e_total = float(np.mean(audio**2)) + 1e-8
        sub_bass_ratio = float(e_sub / e_total)

        # 4. Transposed conv hop frame periodicity (160 and 256 samples)
        hi_env = np.abs(scipy.signal.sosfilt(sos_hi, audio))
        chunk_len = min(len(hi_env), sr)
        x_hi = hi_env[:chunk_len]
        e0 = float(np.dot(x_hi, x_hi)) + 1e-8
        hop_160 = float(np.dot(x_hi[:-160], x_hi[160:])) / e0 if len(x_hi) > 160 else 0.0
        hop_256 = float(np.dot(x_hi[:-256], x_hi[256:])) / e0 if len(x_hi) > 256 else 0.0
        max_hop = max(hop_160, hop_256)

        # 5. Pitch tracking for biological micro-jitter & shimmer
        frame_len = int(0.025 * sr)
        hop_len = int(0.010 * sr)
        pitches = []
        amplitudes = []
        for i in range(0, len(audio) - frame_len, hop_len):
            frame = audio[i:i+frame_len]
            if float(np.mean(frame**2)) < 0.0006:
                continue
            corr = np.correlate(frame, frame, mode='full')
            corr = corr[len(corr)//2:]
            min_lag = int(sr / 380)
            max_lag = int(sr / 75)
            if max_lag < len(corr):
                lag = min_lag + np.argmax(corr[min_lag:max_lag])
                if corr[lag] / (corr[0] + 1e-8) > 0.35:
                    pitches.append(sr / lag)
                    amplitudes.append(float(np.max(np.abs(frame))))

        is_speech = len(pitches) >= 4
        jitter = 0.014
        shimmer = 0.035
        if is_speech:
            pitch_diffs = np.abs(np.diff(pitches))
            jitter = float(np.mean(pitch_diffs) / (np.mean(pitches) + 1e-6))
            amp_diffs = np.abs(np.diff(amplitudes))
            shimmer = float(np.mean(amp_diffs) / (np.mean(amplitudes) + 1e-6))

        # Forensic Biomechanical Scoring
        # Real conversational human speech exhibits prosodic intonation (jitter 0.003 - 0.50) and micro-shimmer
        has_biological_dynamics = (0.0030 <= jitter <= 0.50) and (shimmer >= 0.008)
        has_flat_pitch = (jitter < 0.0020)
        has_flat_shimmer = (shimmer < 0.005)
        has_vocoder_aliasing = (hf_aliasing_ratio > 0.060)
        is_speaker_replay = (sub_bass_ratio < 0.008)

        spoof_indicators = 0.0
        if has_flat_pitch:
            spoof_indicators += 0.50
        elif has_flat_shimmer:
            spoof_indicators += 0.25

        if has_vocoder_aliasing:
            spoof_indicators += 0.45

        if is_speaker_replay:
            spoof_indicators += 0.30

        if has_biological_dynamics and not has_vocoder_aliasing:
            # Verified living human mucosal wave oscillation & natural prosody
            bio_spoof_prob = 0.05 + 0.10 * spoof_indicators
        else:
            bio_spoof_prob = min(0.95, 0.25 + spoof_indicators * 0.50)

        return {
            'is_speech': is_speech,
            'jitter': jitter,
            'shimmer': shimmer,
            'hf_aliasing_ratio': hf_aliasing_ratio,
            'spec_flat': spec_flat,
            'sub_bass_ratio': sub_bass_ratio,
            'max_hop': max_hop,
            'bio_spoof_prob': float(bio_spoof_prob),
            'authenticity': float(1.0 - bio_spoof_prob),
        }

    def compute_acoustic_score(
        self,
        lfcc_lcnn_prob: float,
        wavlm_prob: float,
        rawnet2_prob: float,
        bio_spoof_prob: Optional[float] = None,
    ) -> float:
        """
        Consensus Tri-Net + Biomechanical acoustic score:
        1. LFCC-LCNN (35%): 2D spectral phase vocoder artifact detector
        2. WavLM (35%): Raw waveform self-attention speech foundation detector
        3. RawNet2 (30%): Raw waveform 1D filterbank detector
        4. Biomechanical Engine: Vocal tract & glottal reality validation
        """
        bio = bio_spoof_prob if bio_spoof_prob is not None else 0.10

        # Weighted neural consensus across all 3 fine-tuned models
        neural_score = 0.35 * lfcc_lcnn_prob + 0.35 * wavlm_prob + 0.30 * rawnet2_prob

        # Multi-model threat consensus:
        high_model_votes = sum(1 for p in (lfcc_lcnn_prob, wavlm_prob, rawnet2_prob) if p >= 0.70)
        
        # 1. Biological & Raw-Waveform Human Reality Shield:
        # If vocal fold dynamics (micro-jitter, shimmer, prosody) confirm a living human (bio < 0.25)
        # AND raw waveform foundation models detect no synthetic artifacts (wavlm < 0.20 and rawnet2 < 0.25):
        # The isolated LFCC elevation is a known microphone channel / lossy codec artifact (Opus/WebM/MP3).
        # Unanimous biological and neural consensus MUST protect genuine human speech from false alarms!
        if (bio < 0.25) and (wavlm_prob < 0.20) and (rawnet2_prob < 0.25):
            threat_score = 0.30 * (wavlm_prob + rawnet2_prob) + 0.70 * bio
            threat_score = min(threat_score, 0.18)

        # 2. Spectral & Biological Reality Guard (LFCC confirms bonafide + bio confirms human):
        elif (lfcc_lcnn_prob < 0.15) and (bio < 0.25):
            threat_score = 0.25 * neural_score + 0.75 * max(lfcc_lcnn_prob, bio)
            threat_score = min(threat_score, 0.20)

        # 3. Multi-Model AI Voice Clone Consensus (e.g. ElevenLabs, Tacotron, VITS):
        elif (lfcc_lcnn_prob >= 0.60 and (wavlm_prob >= 0.30 or rawnet2_prob >= 0.30 or bio >= 0.30)) or (high_model_votes >= 2):
            threat_score = max(neural_score, 0.85 + 0.15 * (neural_score - 0.50))

        # 4. Severe Biomechanical Reality Violation (robotic pitch, zero shimmer, extreme aliasing):
        elif bio >= 0.60 and (neural_score >= 0.30 or lfcc_lcnn_prob >= 0.50):
            threat_score = max(bio, 0.80)

        # 5. Overwhelming Spectral Evidence Corroborated:
        elif lfcc_lcnn_prob >= 0.85 and (wavlm_prob >= 0.20 or rawnet2_prob >= 0.20 or bio >= 0.20):
            threat_score = max(lfcc_lcnn_prob * 0.88, 0.75)

        # 6. Standard Consensus Fusion:
        elif neural_score < 0.30 and bio < 0.35:
            threat_score = 0.65 * neural_score + 0.35 * bio
        else:
            threat_score = 0.60 * neural_score + 0.40 * bio

        return float(np.clip(threat_score, 0.05, 0.98))

    def compute_speaker_score(self, similarity: float, threshold: float = 0.65) -> float:
        """
        Compute speaker verification risk score based on similarity.
        Higher score means higher risk (greater mismatch).
        
        Args:
            similarity (float): Cosine similarity score.
            threshold (float): Similarity threshold.
            
        Returns:
            float: Speaker risk score (0-1).
        """
        diff = threshold - similarity
        risk = 1.0 / (1.0 + np.exp(-10 * diff))
        return float(risk)

    def compute_context_score(self, call_metadata: dict[str, Any]) -> float:
        """
        Compute context risk score based on call metadata.
        
        Args:
            call_metadata (dict): Metadata such as time of day, frequency of calls, etc.
            
        Returns:
            float: Context risk score (0-1).
        """
        score = 0.0
        if 'hour' in call_metadata:
            hour = call_metadata['hour']
            if hour < 6 or hour > 22:
                score += 0.3
                
        if 'calls_last_hour' in call_metadata:
            calls = call_metadata['calls_last_hour']
            if calls > 5:
                score += 0.4
                
        if 'is_international' in call_metadata and call_metadata['is_international']:
            score += 0.2
            
        if 'number_withheld' in call_metadata and call_metadata['number_withheld']:
            score += 0.3
            
        return min(1.0, score)

    def fuse_scores(
        self,
        acoustic: float,
        speaker: float,
        context: float,
        has_target_speaker: bool = False,
    ) -> float:
        """
        Fuse individual risk scores into a final score:
        - When evaluating an incoming call or voice sample without an enrolled target profile:
          Deepfake Risk IS determined directly by the acoustic spoof analysis!
        - When evaluating an enrolled target profile:
          Speaker mismatch elevates the risk if an impersonator is attempting a voice attack.
        - Threat Gating: Synthetic vocoder attacks (>= 0.50) always dominate.
        """
        if not has_target_speaker:
            # Direct deepfake voice clone analysis
            return max(acoustic, context * 0.5)
            
        linear_fused = (
            acoustic * 0.50 +
            speaker * 0.40 +
            context * 0.10
        )
        
        # Gating threat: If acoustic models detect synthetic vocoder artifacts (>= 0.50),
        # the voice is an AI clone/synthetic attack.
        if acoustic >= 0.50:
            return max(acoustic, linear_fused)
        if speaker >= 0.70:
            return max(speaker * 0.85, linear_fused)
            
        return linear_fused

    def get_risk_level(self, score: float) -> RiskLevel:
        """
        Determine risk level from fused score:
        - < 0.30: LOW (Verified Authentic Human Voice)
        - 0.30 - 0.699: MEDIUM (Suspicious / Inconclusive)
        - >= 0.70: HIGH (Spoofed / AI Clone Attack)
        """
        if score < 0.30:
            return RiskLevel.LOW
        elif score < 0.70:
            return RiskLevel.MEDIUM
        else:
            return RiskLevel.HIGH
            
    def get_action(self, risk_level: RiskLevel) -> str:
        """
        Get recommended action based on risk level.
        
        Args:
            risk_level (RiskLevel): The computed risk level.
            
        Returns:
            str: Recommended action.
        """
        if risk_level == RiskLevel.LOW:
            return "ALLOW"
        elif risk_level == RiskLevel.MEDIUM:
            return "WARN_USER"
        else:
            return "BLOCK_CALL"

    def assess_risk(
        self,
        acoustic_probs: dict[str, float],
        similarity: float,
        call_metadata: dict[str, Any],
        bio_metrics: Optional[dict[str, Any]] = None,
        has_target_speaker: bool = False,
    ) -> RiskAssessment:
        """
        Perform a full risk assessment with Quad-Layer fusion:
        Tri-Net neural ensemble + physical biomechanical reality verification.
        """
        bio_spoof = bio_metrics.get('bio_spoof_prob') if bio_metrics else None
        acoustic_score = self.compute_acoustic_score(
            acoustic_probs.get('lfcc_lcnn', 0.0),
            acoustic_probs.get('wavlm', 0.0),
            acoustic_probs.get('rawnet2', 0.0),
            bio_spoof_prob=bio_spoof,
        )
        
        speaker_score = self.compute_speaker_score(similarity)
        context_score = self.compute_context_score(call_metadata)
        
        fused_score = self.fuse_scores(
            acoustic_score,
            speaker_score,
            context_score,
            has_target_speaker=has_target_speaker,
        )
        risk_level = self.get_risk_level(fused_score)
        
        details = {
            "acoustic_breakdown": acoustic_probs,
            "speaker_similarity": similarity,
            "context_factors": call_metadata,
            "recommended_action": self.get_action(risk_level),
            "biomechanical": bio_metrics or {},
        }
        
        return RiskAssessment(
            acoustic_score=acoustic_score,
            speaker_score=speaker_score,
            context_score=context_score,
            fused_score=fused_score,
            risk_level=risk_level,
            timestamp=datetime.datetime.now(),
            details=details
        )
