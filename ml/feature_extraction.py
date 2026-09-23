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

def _build_dct_matrix(n_filters: int = 20, n_lfcc: int = 20) -> np.ndarray:
    dct_mat = np.zeros((n_lfcc, n_filters), dtype=np.float32)
    for k in range(n_lfcc):
        for n in range(n_filters):
            dct_mat[k, n] = np.cos(np.pi * k * (2 * n + 1) / (2 * n_filters))
    dct_mat[0, :] = 1.0 / np.sqrt(n_filters)
    dct_mat[1:, :] *= np.sqrt(2.0 / n_filters)
    return dct_mat

_PRECOMPUTED_FILTERBANK = _build_linear_filterbank(sr=16000, n_fft=512, n_filters=20)
_PRECOMPUTED_FILTERBANK_TORCH = torch.from_numpy(_PRECOMPUTED_FILTERBANK)
_PRECOMPUTED_DCT_TORCH = torch.from_numpy(_build_dct_matrix(20, 20))
_PRECOMPUTED_WINDOW_TORCH = torch.from_numpy(
    librosa.util.pad_center(librosa.filters.get_window('hann', 400), size=512)
).float()

def extract_lfcc(audio: np.ndarray, sr: int = 16000, n_filters: int = 20, n_lfcc: int = 20) -> torch.Tensor:
    """
    Extract Linear Frequency Cepstral Coefficients (LFCC) ultra-efficiently using PyTorch STFT.
    
    Args:
        audio (np.ndarray): Audio time series.
        sr (int): Sampling rate. Defaults to 16000.
        n_filters (int): Number of linear filters. Defaults to 20.
        n_lfcc (int): Number of LFCCs to return. Defaults to 20.
        
    Returns:
        torch.Tensor: LFCC features of shape (1, n_lfcc, time_frames).
    """
    if isinstance(audio, np.ndarray):
        audio_tensor = torch.from_numpy(audio.astype(np.float32, copy=False))
    elif isinstance(audio, torch.Tensor):
        audio_tensor = audio.float()
    else:
        audio_tensor = torch.tensor(audio, dtype=torch.float32)

    if audio_tensor.dim() == 2 and audio_tensor.size(0) == 1:
        audio_tensor = audio_tensor.squeeze(0)

    # Use precomputed tensors for standard 16kHz configuration
    if sr == 16000 and n_filters == 20 and n_lfcc == 20:
        fb = _PRECOMPUTED_FILTERBANK_TORCH
        dct_mat = _PRECOMPUTED_DCT_TORCH
        window = _PRECOMPUTED_WINDOW_TORCH
    else:
        fb = torch.from_numpy(_build_linear_filterbank(sr, 512, n_filters))
        dct_mat = torch.from_numpy(_build_dct_matrix(n_filters, n_lfcc))
        window = torch.from_numpy(
            librosa.util.pad_center(librosa.filters.get_window('hann', 400), size=512)
        ).float()

    with torch.no_grad():
        stft = torch.stft(
            audio_tensor,
            n_fft=512,
            hop_length=160,
            win_length=512,
            window=window,
            return_complex=True,
            center=True,
            pad_mode='constant'
        )
        power_spec = stft.abs().square()
        lin_spec = torch.matmul(fb, power_spec)
        log_spec = 10.0 * torch.log10(torch.clamp(lin_spec, min=1e-10))
        log_spec = torch.clamp(log_spec, min=log_spec.max() - 80.0)
        lfcc = torch.matmul(dct_mat, log_spec)

    return lfcc.unsqueeze(0)

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
