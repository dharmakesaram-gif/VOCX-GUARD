import numpy as np
import scipy.signal
import scipy.fftpack
import librosa
import torch

def _build_linear_filterbank(sr: int = 16000, n_fft: int = 512, n_filters: int = 20) -> np.ndarray:
    fft_freqs = np.linspace(0, sr / 2, n_fft // 2 + 1)
    filter_points = np.linspace(0, sr / 2, n_filters + 2)
    filterbank = np.zeros((n_filters, len(fft_freqs)), dtype=np.float32)
    for i in range(1, n_filters + 1):
        left = filter_points[i - 1]
        center = filter_points[i]
        right = filter_points[i + 1]
        for j, freq in enumerate(fft_freqs):
            if left < freq <= center:
                filterbank[i - 1, j] = (freq - left) / (center - left)
            elif center < freq < right:
                filterbank[i - 1, j] = (right - freq) / (right - center)
    return filterbank

_PRECOMPUTED_FILTERBANK = _build_linear_filterbank(sr=16000, n_fft=512, n_filters=20)

def extract_lfcc(audio: np.ndarray, sr: int = 16000, n_filters: int = 20, n_lfcc: int = 20) -> torch.Tensor:
    """
    Extract Linear Frequency Cepstral Coefficients (LFCC) efficiently.
    
    Args:
        audio (np.ndarray): Audio time series.
        sr (int): Sampling rate. Defaults to 16000.
        n_filters (int): Number of linear filters. Defaults to 20.
        n_lfcc (int): Number of LFCCs to return. Defaults to 20.
        
    Returns:
        torch.Tensor: LFCC features of shape (1, n_lfcc, time_frames).
    """
    # Compute power spectrogram
    stft = librosa.stft(y=audio, n_fft=512, hop_length=160, win_length=400)
    power_spec = np.abs(stft)**2
    
    # Use precomputed filterbank if standard configuration
    if sr == 16000 and n_filters == 20:
        filterbank = _PRECOMPUTED_FILTERBANK
    else:
        filterbank = _build_linear_filterbank(sr, 512, n_filters)
                
    # Apply filterbank
    linear_spec = np.dot(filterbank, power_spec)
    
    # Log and DCT
    log_linear_spec = librosa.power_to_db(linear_spec)
    lfcc = scipy.fftpack.dct(log_linear_spec, type=2, axis=0, norm='ortho')[:n_lfcc]
    
    return torch.tensor(lfcc, dtype=torch.float32).unsqueeze(0)

def extract_log_mel(audio: np.ndarray, sr: int = 16000, n_mels: int = 80, n_fft: int = 512, hop_length: int = 160) -> torch.Tensor:
    """
    Extract Log-Mel spectrograms.
    
    Args:
        audio (np.ndarray): Audio time series.
        sr (int): Sampling rate. Defaults to 16000.
        n_mels (int): Number of Mel bands. Defaults to 80.
        n_fft (int): FFT size. Defaults to 512.
        hop_length (int): Hop length. Defaults to 160.
        
    Returns:
        torch.Tensor: Log-Mel spectrogram of shape (1, n_mels, time_frames).
    """
    mel_spec = librosa.feature.melspectrogram(y=audio, sr=sr, n_mels=n_mels, n_fft=n_fft, hop_length=hop_length)
    log_mel = librosa.power_to_db(mel_spec)
    return torch.tensor(log_mel, dtype=torch.float32).unsqueeze(0)

def extract_mfcc(audio: np.ndarray, sr: int = 16000, n_mfcc: int = 20) -> torch.Tensor:
    """
    Extract Mel-Frequency Cepstral Coefficients (MFCC).
    
    Args:
        audio (np.ndarray): Audio time series.
        sr (int): Sampling rate. Defaults to 16000.
        n_mfcc (int): Number of MFCCs to return. Defaults to 20.
        
    Returns:
        torch.Tensor: MFCC features of shape (1, n_mfcc, time_frames).
    """
    mfcc = librosa.feature.mfcc(y=audio, sr=sr, n_mfcc=n_mfcc)
    return torch.tensor(mfcc, dtype=torch.float32).unsqueeze(0)
