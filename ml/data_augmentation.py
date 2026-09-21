"""
Acoustic Channel Augmentation Module for VocxGuard Swarm Optimization.

Simulates physical acoustic channels, micro-transducers, lossy telephony codecs,
and room acoustics to stress-test anti-spoofing and deepfake detection models
(RawNet2, WavLM, LCNN, Biomechanical Engine).
"""

from typing import Any, Dict, Optional, Tuple, Union
import numpy as np
import scipy.signal


def _ensure_float32_1d(audio: Any) -> Tuple[np.ndarray, Tuple[int, ...], Optional[Any]]:
    """
    Standardizes input audio into a 1D float32 numpy array while tracking original shape
    and torch tensor type if applicable.
    """
    torch_type = None
    orig_device = None

    # Handle PyTorch tensor
    try:
        import torch
        if isinstance(audio, torch.Tensor):
            torch_type = audio.dtype
            orig_device = audio.device
            audio = audio.detach().cpu().numpy()
    except ImportError:
        pass

    audio_np = np.asarray(audio, dtype=np.float32)
    orig_shape = audio_np.shape

    if audio_np.size == 0:
        return audio_np.reshape(orig_shape), orig_shape, (torch_type, orig_device)

    # Flatten to 1D
    audio_1d = audio_np.ravel()
    # Sanitize NaNs and Infs
    audio_1d = np.nan_to_num(audio_1d, nan=0.0, posinf=1.0, neginf=-1.0)

    return audio_1d, orig_shape, (torch_type, orig_device)


def _restore_output(
    audio_1d: np.ndarray,
    orig_shape: Tuple[int, ...],
    torch_info: Optional[Tuple[Any, Any]],
    target_len: int,
) -> Any:
    """
    Restores processed 1D audio to original shape, strictly ensures target length,
    and converts back to torch.Tensor if original was a tensor.
    """
    # Strictly enforce target length
    if len(audio_1d) > target_len:
        audio_1d = audio_1d[:target_len]
    elif len(audio_1d) < target_len:
        audio_1d = np.pad(audio_1d, (0, target_len - len(audio_1d)))

    audio_1d = np.nan_to_num(audio_1d, nan=0.0, posinf=1.0, neginf=-1.0).astype(np.float32)

    # Reshape back to original shape
    out_np = audio_1d.reshape(orig_shape)

    torch_type, orig_device = torch_info if torch_info else (None, None)
    if torch_type is not None:
        import torch
        return torch.from_numpy(out_np).to(device=orig_device, dtype=torch_type)

    return out_np


class AcousticChannelAugmenter:
    """
    Acoustic channel distortion and transducer simulation engine.
    
    Provides realistic simulation of:
    1. Smartphone MEMS/electret microphone response (bandpass filtering, roll-off, saturation, thermal noise)
    2. Telephony lossy codecs (AAC/Opus MDCT quantization noise and high-frequency spectral thinning)
    3. Laptop loudspeaker acoustic replay (chassis bass cutoff, 2-3kHz enclosure resonance, room reflections)
    """

    def __init__(self, seed: Optional[int] = None, default_sr: int = 16000):
        """
        Initialize the AcousticChannelAugmenter.
        
        Args:
            seed (Optional[int]): Random seed for repeatable stochastic augmentations.
            default_sr (int): Default audio sampling rate in Hz (default: 16000).
        """
        self.default_sr = default_sr
        self.rng = np.random.default_rng(seed)

    @staticmethod
    def simulate_phone_microphone(
        audio: Any,
        sr: int = 16000,
        low_cutoff: float = 200.0,
        high_cutoff: float = 7000.0,
        roll_off_order: int = 2,
        preamp_gain: float = 1.35,
        thermal_noise_snr_db: float = 48.0,
        seed: Optional[int] = None,
    ) -> Any:
        """
        Simulate a smartphone microphone capsule and analog front-end.
        
        Physical components:
        - Bandpass filtering (200Hz - 7000Hz) with characteristic high-pass roll-off curve
          simulating acoustic inlet diaphragm damping.
        - Microphone pre-amp saturation (smooth non-linear soft-clipping via hyperbolic tangent).
        - Additive Johnson-Nyquist thermal noise from the transducer and front-end ASIC.

        Args:
            audio: Input audio array (np.ndarray or torch.Tensor).
            sr: Sampling rate in Hz (default: 16000).
            low_cutoff: High-pass roll-off corner frequency in Hz (default: 200.0).
            high_cutoff: Low-pass cutoff frequency in Hz (default: 7000.0).
            roll_off_order: Order of the high-pass roll-off curve (default: 2).
            preamp_gain: Non-linear pre-amp saturation drive factor (default: 1.35).
            thermal_noise_snr_db: Target Signal-to-Noise Ratio in dB for thermal noise (default: 48.0 dB).
            seed: Optional RNG seed for repeatable thermal noise.

        Returns:
            Augmented audio with identical shape, length, and dtype.
        """
        audio_1d, orig_shape, torch_info = _ensure_float32_1d(audio)
        n_samples = len(audio_1d)
        if n_samples == 0:
            return _restore_output(audio_1d, orig_shape, torch_info, n_samples)

        nyquist = sr / 2.0
        # Guard against cutoffs exceeding Nyquist or invalid ranges
        clamped_low = max(20.0, min(low_cutoff, nyquist * 0.85))
        clamped_high = min(max(clamped_low + 50.0, high_cutoff), nyquist * 0.95)

        # 1. Bandpass filtering with high-pass roll-off curve
        # Electret/MEMS smartphone mics exhibit gentle 12dB/octave low-end acoustic roll-off
        # and steeper anti-aliasing / acoustic damping at the high end.
        sos_hp = scipy.signal.butter(roll_off_order, clamped_low, btype='highpass', fs=sr, output='sos')
        sos_lp = scipy.signal.butter(4, clamped_high, btype='lowpass', fs=sr, output='sos')
        filtered = scipy.signal.sosfilt(sos_lp, scipy.signal.sosfilt(sos_hp, audio_1d))

        # 2. Microphone pre-amp saturation
        # Models JFET/CMOS amplifier soft-clipping under near-rail input dynamics
        drive = max(1.0, float(preamp_gain))
        norm_factor = float(np.tanh(drive))
        if norm_factor > 1e-6:
            saturated = np.tanh(drive * filtered) / norm_factor
        else:
            saturated = filtered

        # 3. Additive thermal noise (Johnson-Nyquist noise floor)
        rng = np.random.default_rng(seed)
        sig_power = float(np.mean(saturated ** 2))
        if sig_power > 1e-11 and thermal_noise_snr_db > 0:
            snr_linear = 10.0 ** (thermal_noise_snr_db / 10.0)
            noise_power = sig_power / snr_linear
            noise_std = np.sqrt(noise_power)
        else:
            # Baseline thermal floor for silence
            noise_std = 1e-5

        thermal_noise = rng.normal(0.0, noise_std, size=n_samples).astype(np.float32)
        augmented = saturated + thermal_noise

        # Peak normalization / clipping protection
        peak = float(np.max(np.abs(augmented)))
        if peak > 1.0:
            augmented = augmented / peak

        return _restore_output(augmented, orig_shape, torch_info, n_samples)

    @staticmethod
    def simulate_lossy_codec(
        audio: Any,
        sr: int = 16000,
        quantization_bits: int = 6,
        thinning_threshold_freq: float = 3500.0,
        thinning_dropout_ratio: float = 0.35,
        cutoff_freq: float = 7200.0,
        seed: Optional[int] = None,
    ) -> Any:
        """
        Simulate AAC / Opus lossy speech compression artifacts.
        
        Acoustic components:
        - Sub-band MDCT / STFT quantization noise: Psychoacoustic bit reduction
          allocating fewer bits (e.g. 5-6 bits) to higher frequency bands.
        - High-frequency spectral thinning: Zeroing / pruning transform coefficients
          below psychoacoustic masking thresholds, producing characteristic spectral holes.
        - Band-edge roll-off: Upper cutoff near codec band-edge (e.g. 7.2kHz for 16kHz audio).

        Args:
            audio: Input audio array (np.ndarray or torch.Tensor).
            sr: Sampling rate in Hz (default: 16000).
            quantization_bits: Effective quantization resolution in high bands (default: 6 bits).
            thinning_threshold_freq: Frequency boundary above which thinning occurs (default: 3500.0 Hz).
            thinning_dropout_ratio: Fraction of high-frequency bins pruned (default: 0.35).
            cutoff_freq: Upper bandwidth cutoff frequency (default: 7200.0 Hz).
            seed: Optional RNG seed for repeatable spectral thinning.

        Returns:
            Augmented audio with identical shape, length, and dtype.
        """
        audio_1d, orig_shape, torch_info = _ensure_float32_1d(audio)
        n_samples = len(audio_1d)
        if n_samples == 0:
            return _restore_output(audio_1d, orig_shape, torch_info, n_samples)

        # For very short audio (< 64 samples), fall back to time-domain companding
        if n_samples < 64:
            steps = 2.0 ** max(2, quantization_bits)
            quantized = np.round(audio_1d * (steps / 2.0)) / (steps / 2.0)
            return _restore_output(quantized, orig_shape, torch_info, n_samples)

        rng = np.random.default_rng(seed)

        # STFT configuration tailored to Opus/AAC frame sizes
        nperseg = min(512, n_samples)
        if nperseg % 2 != 0:
            nperseg -= 1
        noverlap = (nperseg * 3) // 4

        freqs, times, zxx = scipy.signal.stft(
            audio_1d,
            fs=sr,
            window='hann',
            nperseg=nperseg,
            noverlap=noverlap,
            boundary='zeros',
            padded=True,
        )

        nyquist = sr / 2.0
        zxx_mod = zxx.copy()

        # 1. High-frequency spectral thinning (psychoacoustic hole-filling / coefficient pruning)
        thinning_mask = freqs >= thinning_threshold_freq
        if np.any(thinning_mask):
            high_mag = np.abs(zxx_mod[thinning_mask, :])
            if high_mag.size > 0:
                # Discard bins below 35th percentile in high-frequency bands (spectral holes)
                perc_thresh = float(np.percentile(high_mag, 35.0))
                mask_holes = high_mag < perc_thresh
                zxx_mod[thinning_mask, :][mask_holes] = 0.0

                # Stochastic transform coefficient thinning (simulating bit starvation)
                dropout_mask = rng.random(size=zxx_mod[thinning_mask, :].shape) < thinning_dropout_ratio
                zxx_mod[thinning_mask, :][dropout_mask] = 0.0

        # Upper codec bandwidth cutoff
        cutoff_mask = freqs >= min(cutoff_freq, nyquist * 0.98)
        if np.any(cutoff_mask):
            zxx_mod[cutoff_mask, :] *= 0.05

        # 2. AAC / Opus Quantization Noise Simulation
        # Frequency-dependent bit allocation: 10 bits at low frequencies smoothly transitioning
        # to quantization_bits at the upper Nyquist boundary.
        freq_norm = np.clip(freqs / (nyquist + 1e-6), 0.0, 1.0)
        bit_depths = 10.0 - (10.0 - max(3.0, float(quantization_bits))) * freq_norm

        for f_idx in range(len(freqs)):
            row = zxx_mod[f_idx, :]
            row_peak = float(np.max(np.abs(row)))
            if row_peak < 1e-12:
                continue

            b = bit_depths[f_idx]
            levels = 2.0 ** (b - 1.0)
            step = row_peak / levels

            # Quantize real and imaginary components
            real_q = np.round(np.real(row) / step) * step
            imag_q = np.round(np.imag(row) / step) * step

            # Add shaped dither / quantization hiss characteristic of MDCT truncation
            dither_real = rng.uniform(-0.25, 0.25, size=row.shape) * step
            dither_imag = rng.uniform(-0.25, 0.25, size=row.shape) * step

            zxx_mod[f_idx, :] = (real_q + dither_real) + 1j * (imag_q + dither_imag)

        # Invert STFT
        _, reconstructed = scipy.signal.istft(
            zxx_mod,
            fs=sr,
            window='hann',
            nperseg=nperseg,
            noverlap=noverlap,
            boundary=True,
        )

        # Normalize peaks and prevent clipping
        peak = float(np.max(np.abs(reconstructed)))
        if peak > 1.0:
            reconstructed = reconstructed / peak

        return _restore_output(reconstructed, orig_shape, torch_info, n_samples)

    @staticmethod
    def simulate_laptop_speaker_playback(
        audio: Any,
        sr: int = 16000,
        highpass_cutoff: float = 350.0,
        resonance_freq: float = 2500.0,
        resonance_q: float = 3.0,
        resonance_gain_db: float = 6.0,
        reflection_delay_ms: float = 25.0,
        reflection_decay: float = 0.35,
        secondary_reflection: bool = True,
        seed: Optional[int] = None,
    ) -> Any:
        """
        Simulate acoustic playback through miniature laptop speakers in a physical room.
        
        Acoustic components:
        - High-pass filter (> 350Hz cutoff): Miniature micro-speakers have negligible acoustic
          output below 350Hz due to tiny diaphragm displacement and lack of sealed back-volume.
        - Enclosure resonance at 2-3kHz: Peaking filter simulating the sharp plastic/aluminum chassis
          cavity resonant peak that gives laptop speakers their thin, boxy character.
        - Room reflection (15-35ms delay with decay): Early boundary reflections bouncing off the
          desk surface and room boundaries into the recording receiver.

        Args:
            audio: Input audio array (np.ndarray or torch.Tensor).
            sr: Sampling rate in Hz (default: 16000).
            highpass_cutoff: High-pass cutoff frequency in Hz (> 350Hz, default: 350.0).
            resonance_freq: Chassis resonance center frequency (2000-3000Hz, default: 2500.0).
            resonance_q: Quality factor Q of speaker enclosure resonance (default: 3.0).
            resonance_gain_db: Resonant boost in dB (default: 6.0 dB).
            reflection_delay_ms: Delay of primary reflection in ms (15-35ms, default: 25.0).
            reflection_decay: Attenuation factor of reflection (default: 0.35).
            secondary_reflection: Whether to simulate a secondary desk/wall bounce (default: True).
            seed: Optional RNG seed.

        Returns:
            Augmented audio with identical shape, length, and dtype.
        """
        audio_1d, orig_shape, torch_info = _ensure_float32_1d(audio)
        n_samples = len(audio_1d)
        if n_samples == 0:
            return _restore_output(audio_1d, orig_shape, torch_info, n_samples)

        nyquist = sr / 2.0

        # 1. High-pass filter (> 350Hz cutoff)
        # Guarantees cutoff >= 350Hz as specified
        actual_cutoff = max(350.0, min(float(highpass_cutoff), nyquist * 0.85))
        sos_hp = scipy.signal.butter(4, actual_cutoff, btype='highpass', fs=sr, output='sos')
        hp_audio = scipy.signal.sosfilt(sos_hp, audio_1d)

        # 2. Speaker enclosure resonance at 2-3kHz
        # Parametric peaking equalizer biquad filter (Audio EQ Cookbook standard)
        res_freq = float(np.clip(resonance_freq, 2000.0, min(3000.0, nyquist * 0.90)))
        q_val = max(0.5, float(resonance_q))
        gain_db = float(resonance_gain_db)

        w0 = 2.0 * np.pi * (res_freq / sr)
        alpha = np.sin(w0) / (2.0 * q_val)
        a_amp = 10.0 ** (gain_db / 40.0)

        b0 = 1.0 + alpha * a_amp
        b1 = -2.0 * np.cos(w0)
        b2 = 1.0 - alpha * a_amp
        a0 = 1.0 + alpha / a_amp
        a1 = -2.0 * np.cos(w0)
        a2 = 1.0 - alpha / a_amp

        b_coeffs = np.array([b0 / a0, b1 / a0, b2 / a0], dtype=np.float64)
        a_coeffs = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)

        resonant_audio = scipy.signal.lfilter(b_coeffs, a_coeffs, hp_audio).astype(np.float32)

        # 3. Room reflection (15-35ms delay with decay)
        clamped_delay_ms = float(np.clip(reflection_delay_ms, 15.0, 35.0))
        delay_samples_1 = int(round((clamped_delay_ms / 1000.0) * sr))
        decay_1 = float(np.clip(reflection_decay, 0.05, 0.95))

        reflected = np.zeros_like(resonant_audio)
        if 0 < delay_samples_1 < n_samples:
            reflected[delay_samples_1:] += decay_1 * resonant_audio[:-delay_samples_1]

        # Secondary boundary reflection (e.g. laptop display to desk)
        if secondary_reflection:
            delay_samples_2 = int(round(min(35.0, clamped_delay_ms * 1.35) / 1000.0 * sr))
            decay_2 = decay_1 * 0.45
            if 0 < delay_samples_2 < n_samples:
                reflected[delay_samples_2:] += decay_2 * resonant_audio[:-delay_samples_2]

        # Mix direct speaker sound and room reflections
        output_audio = resonant_audio + reflected

        # Peak normalization to prevent clipping and maintain stable energy
        peak = float(np.max(np.abs(output_audio)))
        if peak > 1.0:
            output_audio = output_audio / peak

        return _restore_output(output_audio, orig_shape, torch_info, n_samples)

    @classmethod
    def simulate_full_replay_channel(
        cls,
        audio: Any,
        sr: int = 16000,
        seed: Optional[int] = None,
    ) -> Any:
        """
        Simulate an end-to-end replay attack transmission channel:
        Synthetic audio -> Laptop speaker playback with room reflection
                        -> Smartphone microphone capture (bandpass + saturation + thermal noise)
                        -> Lossy telephony transmission (AAC/Opus quantization + thinning).
        
        Args:
            audio: Input audio array or tensor.
            sr: Sampling rate (default: 16000).
            seed: Optional random seed.

        Returns:
            Augmented audio incorporating the entire acoustic replay chain.
        """
        rng = np.random.default_rng(seed)
        seed_speaker = int(rng.integers(0, 1000000))
        seed_mic = int(rng.integers(0, 1000000))
        seed_codec = int(rng.integers(0, 1000000))

        # 1. Speaker playback & room reflection
        audio_speaker = cls.simulate_laptop_speaker_playback(audio, sr=sr, seed=seed_speaker)
        # 2. Phone microphone capture
        audio_mic = cls.simulate_phone_microphone(audio_speaker, sr=sr, seed=seed_mic)
        # 3. Lossy VoIP/telephony codec transmission
        audio_final = cls.simulate_lossy_codec(audio_mic, sr=sr, seed=seed_codec)

        return audio_final

    def augment(
        self,
        audio: Any,
        mode: str = "random",
        sr: Optional[int] = None,
    ) -> Any:
        """
        Apply data augmentation using configured instance settings.

        Args:
            audio: Audio array or tensor.
            mode: One of 'phone', 'codec', 'speaker', 'replay', or 'random'.
            sr: Optional sampling rate override.

        Returns:
            Augmented audio.
        """
        target_sr = sr if sr is not None else self.default_sr
        seed = int(self.rng.integers(0, 1000000))

        if mode == "phone":
            return self.simulate_phone_microphone(audio, sr=target_sr, seed=seed)
        elif mode == "codec":
            return self.simulate_lossy_codec(audio, sr=target_sr, seed=seed)
        elif mode == "speaker":
            return self.simulate_laptop_speaker_playback(audio, sr=target_sr, seed=seed)
        elif mode == "replay":
            return self.simulate_full_replay_channel(audio, sr=target_sr, seed=seed)
        elif mode == "random":
            choice = self.rng.choice(["phone", "codec", "speaker", "replay"])
            return self.augment(audio, mode=choice, sr=target_sr)
        else:
            raise ValueError(f"Unknown augmentation mode: '{mode}'. Expected phone, codec, speaker, replay, random.")


if __name__ == "__main__":
    import os
    import sys
    import wave

    print("=" * 70)
    print("AcousticChannelAugmenter Self-Test Verification")
    print("=" * 70)

    # Resolve sample audio file
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    sample_rel_path = os.path.join(
        repo_root, "ml", "data", "asvspoof2021", "synthetic_LA", "flac", "BONAFIDE_00000.wav"
    )

    if not os.path.exists(sample_rel_path):
        print(f"Sample file not found at {sample_rel_path}, creating synthetic test chirp.")
        sr = 16000
        t = np.linspace(0, 3.0, sr * 3, endpoint=False, dtype=np.float32)
        sample_audio = 0.5 * np.sin(2 * np.pi * 440 * t) + 0.25 * np.sin(2 * np.pi * 1200 * t)
    else:
        print(f"Loading reference sample: {sample_rel_path}")
        with wave.open(sample_rel_path, "rb") as wf:
            sr = wf.getframerate()
            n_frames = wf.getnframes()
            raw_bytes = wf.readframes(n_frames)
            sample_audio = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0

    print(f"Loaded audio: shape={sample_audio.shape}, sr={sr}, duration={len(sample_audio)/sr:.2f}s")
    orig_len = len(sample_audio)
    orig_shape = sample_audio.shape

    augmenter = AcousticChannelAugmenter(seed=42, default_sr=sr)

    # 1. Phone Microphone
    phone_audio = augmenter.simulate_phone_microphone(sample_audio, sr=sr)
    assert phone_audio.shape == orig_shape, f"Phone shape mismatch: {phone_audio.shape} vs {orig_shape}"
    assert len(phone_audio) == orig_len, f"Phone length mismatch: {len(phone_audio)} vs {orig_len}"
    assert not np.isnan(phone_audio).any(), "Phone audio contains NaNs"
    assert not np.isinf(phone_audio).any(), "Phone audio contains Infs"
    assert np.max(np.abs(phone_audio)) <= 1.0, "Phone audio exceeded amplitude bounds"
    print(f"[PASS] simulate_phone_microphone: len={len(phone_audio)}, max={np.max(np.abs(phone_audio)):.4f}, rms={np.sqrt(np.mean(phone_audio**2)):.4f}")

    # 2. Lossy Codec
    codec_audio = augmenter.simulate_lossy_codec(sample_audio, sr=sr)
    assert codec_audio.shape == orig_shape, f"Codec shape mismatch: {codec_audio.shape} vs {orig_shape}"
    assert len(codec_audio) == orig_len, f"Codec length mismatch: {len(codec_audio)} vs {orig_len}"
    assert not np.isnan(codec_audio).any(), "Codec audio contains NaNs"
    assert not np.isinf(codec_audio).any(), "Codec audio contains Infs"
    assert np.max(np.abs(codec_audio)) <= 1.0, "Codec audio exceeded amplitude bounds"
    print(f"[PASS] simulate_lossy_codec: len={len(codec_audio)}, max={np.max(np.abs(codec_audio)):.4f}, rms={np.sqrt(np.mean(codec_audio**2)):.4f}")

    # 3. Laptop Speaker Playback
    speaker_audio = augmenter.simulate_laptop_speaker_playback(sample_audio, sr=sr)
    assert speaker_audio.shape == orig_shape, f"Speaker shape mismatch: {speaker_audio.shape} vs {orig_shape}"
    assert len(speaker_audio) == orig_len, f"Speaker length mismatch: {len(speaker_audio)} vs {orig_len}"
    assert not np.isnan(speaker_audio).any(), "Speaker audio contains NaNs"
    assert not np.isinf(speaker_audio).any(), "Speaker audio contains Infs"
    assert np.max(np.abs(speaker_audio)) <= 1.0, "Speaker audio exceeded amplitude bounds"
    print(f"[PASS] simulate_laptop_speaker_playback: len={len(speaker_audio)}, max={np.max(np.abs(speaker_audio)):.4f}, rms={np.sqrt(np.mean(speaker_audio**2)):.4f}")

    # 4. Full Replay Pipeline
    replay_audio = augmenter.simulate_full_replay_channel(sample_audio, sr=sr)
    assert replay_audio.shape == orig_shape, f"Replay shape mismatch: {replay_audio.shape} vs {orig_shape}"
    assert len(replay_audio) == orig_len, f"Replay length mismatch: {len(replay_audio)} vs {orig_len}"
    assert not np.isnan(replay_audio).any(), "Replay audio contains NaNs"
    assert not np.isinf(replay_audio).any(), "Replay audio contains Infs"
    print(f"[PASS] simulate_full_replay_channel: len={len(replay_audio)}, max={np.max(np.abs(replay_audio)):.4f}, rms={np.sqrt(np.mean(replay_audio**2)):.4f}")

    print("=" * 70)
    print("ALL ACOUSTIC CHANNEL AUGMENTATION TESTS PASSED SUCCESSFULLY!")
    print("=" * 70)
