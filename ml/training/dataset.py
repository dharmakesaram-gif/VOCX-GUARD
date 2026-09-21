"""
Vocx Guard — ASVspoof 2021 Dataset Manager
Downloads, prepares, and manages the ASVspoof 2021 dataset for training.

ASVspoof 2021 Dataset:
- LA (Logical Access): Text-to-speech and voice conversion attacks
- Used for training spoof detection models (LFCC-LCNN, RawNet2)

Reference: https://www.asvspoof.org/
"""

import os
import sys

# Ensure UTF-8 output encoding on Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

import json
import hashlib
import urllib.request
import zipfile
import tarfile
from pathlib import Path
from typing import Optional, Dict, List, Tuple

# Project paths
PROJECT_ROOT = Path(__file__).parent.parent
DATASET_DIR = PROJECT_ROOT / "data"
ASVSPOOF_DIR = DATASET_DIR / "asvspoof2021"
LA_DIR = ASVSPOOF_DIR / "LA"

# ASVspoof 2021 LA partition info
PARTITIONS = {
    "train": {
        "protocol": "ASVspoof2019.LA.cm.train.trn.txt",
        "dir": "ASVspoof2019_LA_train",
    },
    "dev": {
        "protocol": "ASVspoof2019.LA.cm.dev.trl.txt",
        "dir": "ASVspoof2019_LA_dev",
    },
    "eval": {
        "protocol": "ASVspoof2021.LA.cm.eval.trl.txt",
        "dir": "ASVspoof2021_LA_eval",
    },
}


def setup_directories():
    """Create necessary directories."""
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    ASVSPOOF_DIR.mkdir(parents=True, exist_ok=True)
    LA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"  [OK] Dataset directory: {DATASET_DIR}")


def parse_protocol_file(protocol_path: str) -> List[Dict]:
    """
    Parse ASVspoof protocol file.
    Format: SPEAKER_ID AUDIO_FILE_ID - ATTACK_TYPE LABEL
    Example: LA_0079 LA_T_1234567 - A01 spoof
    """
    entries = []
    if not os.path.exists(protocol_path):
        return entries

    with open(protocol_path, 'r') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 5:
                entry = {
                    "speaker_id": parts[0],
                    "audio_id": parts[1],
                    "attack_type": parts[3],
                    "label": parts[4],  # 'bonafide' or 'spoof'
                }
                entries.append(entry)
            elif len(parts) >= 4:
                entry = {
                    "speaker_id": parts[0],
                    "audio_id": parts[1],
                    "attack_type": parts[2] if parts[2] != "-" else "unknown",
                    "label": parts[3],
                }
                entries.append(entry)

    return entries


def generate_synthetic_dataset(
    n_bonafide: int = 500,
    n_spoof: int = 500,
    duration: float = 3.0,
    sr: int = 16000,
) -> Tuple[str, str]:
    """
    Generate a synthetic dataset mimicking ASVspoof structure for training
    when the real dataset is not available.

    Creates audio files with characteristics of genuine and spoofed speech.
    """
    import numpy as np

    synth_dir = ASVSPOOF_DIR / "synthetic_LA"
    audio_dir = synth_dir / "flac"
    audio_dir.mkdir(parents=True, exist_ok=True)

    protocol_path = synth_dir / "protocol.txt"

    print(f"\n  Generating synthetic training dataset...")
    print(f"  Bonafide samples: {n_bonafide}")
    print(f"  Spoof samples: {n_spoof}")
    print(f"  Duration: {duration}s each")
    print(f"  Sample rate: {sr} Hz")

    entries = []
    total = n_bonafide + n_spoof

    import scipy.signal

    # Common vowel formants [F1, F2, F3] in Hz
    VOWEL_FORMANTS = [
        [730, 1090, 2440],  # /a/ father
        [270, 2290, 3010],  # /i/ see
        [530, 1840, 2480],  # /e/ bed
        [300, 870, 2240],   # /u/ boot
        [500, 700, 2400],   # /o/ door
    ]

    for i in range(n_bonafide):
        audio_id = f"BONAFIDE_{i:05d}"
        speaker_id = f"SP_{i % 20:03d}"

        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        n_samples = len(t)

        # 1. Fundamental frequency with natural biological pitch contour + micro-jitter
        f0_base = np.random.uniform(90, 250)  # male to female range
        # Syllabic intonation contour (1.5 - 3.0 Hz sentence cadence)
        f0_contour = f0_base * (1.0 + 0.12 * np.sin(2 * np.pi * np.random.uniform(1.2, 2.8) * t))
        # Biological cycle-to-cycle micro-jitter (~0.8% - 1.8%)
        f0_contour = f0_contour * (1.0 + np.random.randn(n_samples) * np.random.uniform(0.008, 0.018))
        phase = 2 * np.pi * np.cumsum(f0_contour) / sr

        # 2. Glottal source excitation (voiced pulse train with -12dB/octave decay)
        glottal = np.sin(phase)
        for h in range(2, 16):
            glottal += ((1.0 / h) ** 1.3) * np.sin(h * phase + np.random.uniform(-0.1, 0.1))
        # Biological shimmer (amplitude perturbation ~3%)
        glottal *= (1.0 + 0.035 * np.random.randn(n_samples))

        # 3. Vocal tract formant filtering (second-order IIR peak resonators)
        f1, f2, f3 = VOWEL_FORMANTS[np.random.randint(len(VOWEL_FORMANTS))]
        speech = np.zeros_like(glottal)
        for freq, gain, bw in [(f1, 1.0, 90), (f2, 0.65, 130), (f3, 0.35, 170)]:
            b, a = scipy.signal.iirpeak(freq, Q=freq / max(bw, 10), fs=sr)
            speech += gain * scipy.signal.lfilter(b, a, glottal)

        # 4. Syllable cadence envelope (3.0 - 5.0 syllables per second)
        syllable_rate = np.random.uniform(2.8, 4.8)
        syllables = 0.5 * (1.0 + np.sin(2 * np.pi * syllable_rate * t)) ** 2
        speech *= syllables

        # 5. Natural unvoiced fricatives and consonants (/s/, /sh/, /t/, /f/)
        noise = np.random.randn(n_samples)
        sos_fric = scipy.signal.butter(4, [3000, 7500], btype='bandpass', fs=sr, output='sos')
        fricatives = scipy.signal.sosfilt(sos_fric, noise)
        consonant_mask = (1.0 - syllables) * (np.sin(2 * np.pi * syllable_rate * t) > 0.3)
        speech += 0.12 * fricatives * consonant_mask

        # 6. Natural mouth near-field proximity effect (sub-120 Hz chest resonance & breath)
        proximity_bass = 0.05 * np.sin(2 * np.pi * np.random.uniform(55, 95) * t) * syllables
        speech += proximity_bass

        # Normalize to standard speech amplitude
        peak = np.max(np.abs(speech))
        if peak > 0:
            speech = speech / peak * np.random.uniform(0.75, 0.90)

        filepath = audio_dir / f"{audio_id}.wav"
        _save_wav_raw(speech.astype(np.float32), str(filepath), sr)
        entries.append(f"{speaker_id} {audio_id} - bonafide bonafide\n")

        if (i + 1) % 100 == 0:
            print(f"    Bonafide: {i + 1}/{n_bonafide}")

    for i in range(n_spoof):
        audio_id = f"SPOOF_{i:05d}"
        speaker_id = f"SP_{i % 20:03d}"
        attack_type = f"A{np.random.randint(1, 20):02d}"

        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        n_samples = len(t)
        attack_style = np.random.choice(["elevenlabs_vocoder", "voice_conversion", "speaker_replay"])

        # Base pitch with natural intonation contour (speech cadence)
        f0_base = np.random.uniform(90, 250)
        f0_contour = f0_base * (1.0 + 0.12 * np.sin(2 * np.pi * np.random.uniform(1.2, 2.8) * t))

        # Neural speech has ZERO mucosal cycle-to-cycle micro-jitter
        phase = 2 * np.pi * np.cumsum(f0_contour) / sr

        # Glottal pulse train with mathematical phase (lacking biological micro-shimmer)
        glottal = np.sin(phase)
        for h in range(2, 16):
            glottal += ((1.0 / h) ** 1.3) * np.sin(h * phase)

        # Same vocal tract formant filtering as human speech (vowels)
        f1, f2, f3 = VOWEL_FORMANTS[np.random.randint(len(VOWEL_FORMANTS))]
        speech = np.zeros_like(glottal)
        for freq, gain, bw in [(f1, 1.0, 90), (f2, 0.65, 130), (f3, 0.35, 170)]:
            b, a = scipy.signal.iirpeak(freq, Q=freq / max(bw, 10), fs=sr)
            speech += gain * scipy.signal.lfilter(b, a, glottal)

        # Syllable cadence
        syllable_rate = np.random.uniform(2.8, 4.8)
        syllables = 0.5 * (1.0 + np.sin(2 * np.pi * syllable_rate * t)) ** 2
        speech *= syllables

        # Unvoiced fricatives
        noise = np.random.randn(n_samples)
        sos_fric = scipy.signal.butter(4, [3000, 7500], btype='bandpass', fs=sr, output='sos')
        fricatives = scipy.signal.sosfilt(sos_fric, noise)
        consonant_mask = (1.0 - syllables) * (np.sin(2 * np.pi * syllable_rate * t) > 0.3)
        speech += 0.12 * fricatives * consonant_mask

        # INJECT REALISTIC AI / NEURAL VOCODER / PLAYBACK ARTIFACTS
        if attack_style == "elevenlabs_vocoder":
            # 1. Neural vocoder transposed conv high-frequency aliasing (5.5kHz - 7.8kHz)
            alias_freq = np.random.uniform(5500, 7600)
            speech += np.random.uniform(0.025, 0.055) * np.sin(2 * np.pi * alias_freq * t) * syllables

            # 2. Transposed conv hop frame phase boundary glitches (160 or 256 samples)
            hop = int(np.random.choice([160, 256]))
            glitch_indices = np.arange(0, n_samples, hop)
            speech[glitch_indices] += np.random.uniform(0.02, 0.05) * np.random.choice([-1.0, 1.0], size=len(glitch_indices))

            # 3. High-frequency spectral flatness elevation
            speech += np.random.randn(n_samples) * np.random.uniform(0.008, 0.02)

        elif attack_style == "voice_conversion":
            # Phase incoherence across harmonics and formant ripple
            speech += 0.04 * np.sin(2 * np.pi * 3800 * t) * syllables
            # Pitch shifting / time stretching spectral ripples
            speech *= (1.0 + 0.06 * np.sin(2 * np.pi * 95 * t))

        else:
            # Replay attack: AI voice played through phone/laptop speaker into test mic
            # Speaker bass roll-off (< 160 Hz - no proximity bass)
            sos_bass = scipy.signal.butter(3, np.random.uniform(150, 200), btype='highpass', fs=sr, output='sos')
            speech = scipy.signal.sosfilt(sos_bass, speech)

            # Room desk/wall reflection echo (12ms - 28ms)
            delay = int(np.random.uniform(0.012, 0.028) * sr)
            speech += np.random.uniform(0.25, 0.40) * np.roll(speech, delay)

            # Loudspeaker non-linear 2nd harmonic distortion
            speech += 0.04 * (speech ** 2)

        peak = np.max(np.abs(speech))
        if peak > 0:
            speech = speech / peak * np.random.uniform(0.75, 0.90)

        filepath = audio_dir / f"{audio_id}.wav"
        _save_wav_raw(speech.astype(np.float32), str(filepath), sr)
        entries.append(f"{speaker_id} {audio_id} - {attack_type} spoof\n")

        if (i + 1) % 100 == 0:
            print(f"    Spoof: {i + 1}/{n_spoof}")

    # Write protocol file
    with open(protocol_path, 'w') as f:
        f.writelines(entries)

    print(f"  [OK] Generated {total} audio files")
    print(f"  [OK] Protocol file: {protocol_path}")

    return str(audio_dir), str(protocol_path)


def _save_wav_raw(audio: "np.ndarray", filepath: str, sr: int):
    """Save audio as WAV using struct (no external deps)."""
    import struct
    import numpy as np

    audio_int16 = (audio * 32767).astype(np.int16)
    with open(filepath, 'wb') as f:
        num_samples = len(audio_int16)
        data_size = num_samples * 2
        file_size = 36 + data_size
        f.write(b'RIFF')
        f.write(struct.pack('<I', file_size))
        f.write(b'WAVE')
        f.write(b'fmt ')
        f.write(struct.pack('<I', 16))
        f.write(struct.pack('<H', 1))
        f.write(struct.pack('<H', 1))
        f.write(struct.pack('<I', sr))
        f.write(struct.pack('<I', sr * 2))
        f.write(struct.pack('<H', 2))
        f.write(struct.pack('<H', 16))
        f.write(b'data')
        f.write(struct.pack('<I', data_size))
        f.write(audio_int16.tobytes())


if __name__ == "__main__":
    print("=" * 60)
    print("  VOCX GUARD -- ASVspoof Dataset Manager")
    print("=" * 60)

    setup_directories()

    print("\n  Note: The full ASVspoof 2021 dataset requires registration at")
    print("  https://www.asvspoof.org/ and manual download.")
    print("\n  Generating synthetic training dataset instead...")

    audio_dir, protocol_path = generate_synthetic_dataset(
        n_bonafide=500,
        n_spoof=500,
        duration=3.0,
    )

    print(f"\n  Dataset ready for training!")
    print(f"  Audio directory: {audio_dir}")
    print(f"  Protocol file: {protocol_path}")
