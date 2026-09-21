import numpy as np
import scipy.signal
import soundfile as sf
import librosa
import base64
import io

def decode_audio(audio_base64: str, sr: int = 16000) -> np.ndarray:
    """Decodes base64 audio string to a numpy array, supporting AAC, MPEG-4, M4A, WAV, WebM, etc."""
    if not audio_base64 or not isinstance(audio_base64, str) or not audio_base64.strip():
        return np.zeros(sr, dtype=np.float32)

    # Strip data URL prefix if present (e.g. data:audio/webm;base64,...)
    if "," in audio_base64:
        audio_base64 = audio_base64.split(",", 1)[1]

    audio_base64 = audio_base64.strip()

    # Fix base64 padding if needed
    missing_padding = len(audio_base64) % 4
    if missing_padding:
        audio_base64 += "=" * (4 - missing_padding)

    try:
        audio_bytes = base64.b64decode(audio_base64)
    except Exception:
        return np.zeros(sr, dtype=np.float32)

    if not audio_bytes:
        return np.zeros(sr, dtype=np.float32)

    # 1. Try PyAV which supports all Android & iOS codecs (AAC, MP4, M4A, WAV, WebM/Opus)
    try:
        import av
        container = av.open(io.BytesIO(audio_bytes))
        stream = next((s for s in container.streams if s.type == 'audio'), None)
        if stream is not None:
            resampler = av.AudioResampler(format='fltp', layout='mono', rate=sr)
            samples = []
            for frame in container.decode(stream):
                for resampled_frame in resampler.resample(frame):
                    samples.append(resampled_frame.to_ndarray())
            if samples:
                audio = np.concatenate(samples, axis=1).squeeze()
                if audio.ndim == 0:
                    audio = np.array([audio], dtype=np.float32)
                if len(audio) < sr:
                    audio = np.pad(audio, (0, sr - len(audio)))
                return np.nan_to_num(audio.astype(np.float32), nan=0.0)
    except Exception:
        pass

    # 2. Fallback to librosa / soundfile
    try:
        with io.BytesIO(audio_bytes) as buf:
            audio, _ = librosa.load(buf, sr=sr, mono=True)
            if len(audio) < sr:
                audio = np.pad(audio, (0, sr - len(audio)))
            return np.nan_to_num(audio.astype(np.float32), nan=0.0)
    except Exception:
        return np.zeros(sr, dtype=np.float32)

def load_audio(path: str, sr: int = 16000) -> np.ndarray:
    """
    Load and resample audio from a file path.
    
    Args:
        path (str): Path to the audio file.
        sr (int): Target sampling rate. Defaults to 16000.
        
    Returns:
        np.ndarray: Audio time series.
    """
    try:
        audio, _ = librosa.load(path, sr=sr, mono=True)
        if len(audio) < sr:
            audio = np.pad(audio, (0, sr - len(audio)))
        return np.nan_to_num(audio.astype(np.float32), nan=0.0)
    except Exception:
        return np.zeros(sr, dtype=np.float32)

def chunk_audio(audio: np.ndarray, sr: int = 16000, chunk_duration: float = 2.0, overlap: float = 0.5) -> list[np.ndarray]:
    """
    Split audio into rolling windows with overlap.
    
    Args:
        audio (np.ndarray): Audio time series.
        sr (int): Sampling rate. Defaults to 16000.
        chunk_duration (float): Duration of each chunk in seconds. Defaults to 2.0.
        overlap (float): Overlap between chunks (0.0 to 1.0). Defaults to 0.5.
        
    Returns:
        list[np.ndarray]: List of audio chunks.
    """
    chunk_samples = int(chunk_duration * sr)
    step_samples = int(chunk_samples * (1 - overlap))
    
    chunks = []
    for start in range(0, len(audio) - chunk_samples + 1, step_samples):
        chunks.append(audio[start:start + chunk_samples])
        
    # Handle the last chunk if needed
    if len(audio) > 0 and (len(audio) - chunk_samples) % step_samples != 0:
        last_start = len(audio) - chunk_samples
        if last_start >= 0:
            chunks.append(audio[last_start:])
        else:
            # Pad if audio is shorter than chunk_samples
            chunks.append(np.pad(audio, (0, chunk_samples - len(audio))))
            
    if not chunks and len(audio) > 0:
        chunks.append(np.pad(audio, (0, max(0, chunk_samples - len(audio)))))
        
    return chunks

def normalize_audio(audio: np.ndarray) -> np.ndarray:
    """
    Apply peak normalization to audio safely.
    
    Args:
        audio (np.ndarray): Audio time series.
        
    Returns:
        np.ndarray: Normalized audio.
    """
    audio = np.nan_to_num(audio, nan=0.0, posinf=1.0, neginf=-1.0)
    if len(audio) == 0:
        return audio
    max_val = float(np.max(np.abs(audio)))
    if max_val > 1e-6:
        return np.clip(audio / max_val, -1.0, 1.0).astype(np.float32)
    return audio.astype(np.float32)

def apply_codec_augmentation(audio: np.ndarray, sr: int) -> np.ndarray:
    """
    Simulate telephony codec distortion (G.711, GSM).
    This is a simplified simulation using quantization and bandpass filtering.
    
    Args:
        audio (np.ndarray): Audio time series.
        sr (int): Sampling rate.
        
    Returns:
        np.ndarray: Distorted audio.
    """
    # Bandpass filter to simulate telephone bandwidth (300Hz - 3400Hz)
    nyquist = sr / 2.0
    low = 300.0 / nyquist
    high = 3400.0 / nyquist
    if high >= 1.0:
        high = 0.99
        
    b, a = scipy.signal.butter(4, [low, high], btype='band')
    filtered = scipy.signal.lfilter(b, a, audio)
    
    # Quantization (simulate 8-bit mu-law/A-law)
    quantized = np.round(filtered * 127.0) / 127.0
    
    return quantized

def apply_noise_augmentation(audio: np.ndarray, sr: int, snr_db: float = 10.0) -> np.ndarray:
    """
    Add white/babble noise to audio at a specific SNR.
    
    Args:
        audio (np.ndarray): Audio time series.
        sr (int): Sampling rate.
        snr_db (float): Signal-to-noise ratio in dB. Defaults to 10.0.
        
    Returns:
        np.ndarray: Noisy audio.
    """
    # Calculate signal power
    sig_power = np.mean(audio**2)
    
    # Calculate noise power based on target SNR
    snr_linear = 10**(snr_db / 10.0)
    noise_power = sig_power / snr_linear
    
    # Generate white noise
    noise = np.random.normal(0, np.sqrt(noise_power), len(audio))
    
    return audio + noise
