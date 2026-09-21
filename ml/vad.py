import numpy as np
import scipy.signal

class EnergyVAD:
    """Energy-based Voice Activity Detection with a simple threshold."""
    
    def __init__(self, energy_threshold: float = 0.01):
        """
        Initialize the VAD.
        
        Args:
            energy_threshold (float): Energy threshold for speech detection.
        """
        self.energy_threshold = energy_threshold

    def detect(self, audio: np.ndarray, sr: int, frame_length: float = 0.025, hop_length: float = 0.01) -> list[tuple[float, float]]:
        """
        Detect voiced segments in the audio.
        
        Args:
            audio (np.ndarray): Audio time series.
            sr (int): Sampling rate.
            frame_length (float): Length of the frame in seconds. Defaults to 0.025.
            hop_length (float): Hop length in seconds. Defaults to 0.01.
            
        Returns:
            list[tuple[float, float]]: List of (start_time, end_time) of voiced segments.
        """
        frame_samples = int(frame_length * sr)
        hop_samples = int(hop_length * sr)
        
        voiced_segments = []
        is_voiced = False
        start_time = 0.0
        
        for i in range(0, len(audio) - frame_samples + 1, hop_samples):
            frame = audio[i:i + frame_samples]
            energy = np.mean(frame**2)
            
            time = i / sr
            
            if energy > self.energy_threshold:
                if not is_voiced:
                    is_voiced = True
                    start_time = time
            else:
                if is_voiced:
                    is_voiced = False
                    end_time = time
                    voiced_segments.append((start_time, end_time))
                    
        # Handle case where audio ends while voiced
        if is_voiced:
            end_time = len(audio) / sr
            voiced_segments.append((start_time, end_time))
            
        # Merge very close segments (simple smoothing)
        merged_segments = []
        if voiced_segments:
            current_start, current_end = voiced_segments[0]
            for start, end in voiced_segments[1:]:
                if start - current_end < 0.2: # 200ms smoothing window
                    current_end = end
                else:
                    merged_segments.append((current_start, current_end))
                    current_start, current_end = start, end
            merged_segments.append((current_start, current_end))
            
        return merged_segments

def filter_silence(audio: np.ndarray, sr: int) -> np.ndarray:
    """
    Remove silence from audio and return concatenated voiced segments.
    
    Args:
        audio (np.ndarray): Audio time series.
        sr (int): Sampling rate.
        
    Returns:
        np.ndarray: Audio containing only voiced segments.
    """
    vad = EnergyVAD()
    segments = vad.detect(audio, sr)
    
    if not segments:
        return audio # Return original if no speech detected (fallback)
        
    voiced_audio = []
    for start, end in segments:
        start_sample = int(start * sr)
        end_sample = int(end * sr)
        voiced_audio.append(audio[start_sample:end_sample])
        
    return np.concatenate(voiced_audio)
