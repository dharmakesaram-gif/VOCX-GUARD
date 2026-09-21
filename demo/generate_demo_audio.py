"""
Vocx Guard — Demo Audio Generator
Generates sample audio files for testing the detection pipeline.
Creates genuine speech samples and simulated synthetic/cloned audio.
"""

import numpy as np
import os

# Output directory
DEMO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audio_samples")
os.makedirs(DEMO_DIR, exist_ok=True)

SAMPLE_RATE = 16000


def generate_sine_wave(freq: float, duration: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Generate a pure sine wave."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    return 0.5 * np.sin(2 * np.pi * freq * t)


def generate_genuine_speech(duration: float = 4.0, sr: int = SAMPLE_RATE) -> np.ndarray:
    """
    Simulate genuine speech-like audio with natural characteristics:
    - Multiple harmonics (fundamental + overtones)
    - Amplitude modulation (natural speech envelope)
    - Slight pitch variation
    - Background noise
    """
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)

    # Fundamental frequency with slight vibrato (natural pitch variation)
    f0 = 150 + 5 * np.sin(2 * np.pi * 4 * t)  # ~150 Hz with 4 Hz vibrato
    phase = 2 * np.pi * np.cumsum(f0) / sr

    # Harmonics (natural speech has rich harmonics)
    signal = 0.5 * np.sin(phase)
    signal += 0.3 * np.sin(2 * phase)   # 2nd harmonic
    signal += 0.15 * np.sin(3 * phase)  # 3rd harmonic
    signal += 0.08 * np.sin(4 * phase)  # 4th harmonic
    signal += 0.04 * np.sin(5 * phase)  # 5th harmonic

    # Natural amplitude envelope (speech has pauses and emphasis)
    envelope = np.ones_like(t)
    # Simulate word boundaries with amplitude dips
    for i in range(int(duration * 2)):
        pause_center = (i + 0.5) / (duration * 2) * len(t)
        pause_width = int(0.05 * sr)
        start = max(0, int(pause_center - pause_width))
        end = min(len(t), int(pause_center + pause_width))
        envelope[start:end] *= np.random.uniform(0.1, 0.4)

    signal *= envelope

    # Add slight breathiness (noise component)
    noise = np.random.randn(len(t)) * 0.02
    signal += noise

    # Normalize
    signal = signal / np.max(np.abs(signal)) * 0.8

    return signal.astype(np.float32)


def generate_synthetic_speech(duration: float = 4.0, sr: int = SAMPLE_RATE) -> np.ndarray:
    """
    Simulate AI-cloned/synthetic speech with telltale artifacts:
    - Overly smooth pitch (no natural micro-variations)
    - Uniform amplitude (lacks natural dynamics)
    - Subtle spectral artifacts (periodic patterns)
    - Missing breathiness
    """
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)

    # Very stable fundamental (synthetic voices have unnaturally stable pitch)
    f0 = 150.0  # No vibrato — unnaturally stable
    phase = 2 * np.pi * f0 * t

    # Harmonics (slightly different distribution than natural)
    signal = 0.5 * np.sin(phase)
    signal += 0.25 * np.sin(2 * phase)
    signal += 0.12 * np.sin(3 * phase)

    # Overly uniform envelope (synthetic speech lacks natural dynamics)
    envelope = 0.7 + 0.1 * np.sin(2 * np.pi * 2 * t)  # Very smooth, periodic
    signal *= envelope

    # Add synthetic artifact: slight periodic clicking (vocoder artifact)
    artifact_freq = 80  # Hz
    artifact = 0.01 * np.sign(np.sin(2 * np.pi * artifact_freq * t))
    signal += artifact

    # Normalize
    signal = signal / np.max(np.abs(signal)) * 0.8

    return signal.astype(np.float32)


def save_wav(audio: np.ndarray, filename: str, sr: int = SAMPLE_RATE):
    """Save audio as WAV file using only numpy (no soundfile dependency needed)."""
    import struct

    filepath = os.path.join(DEMO_DIR, filename)
    # Convert float32 to int16
    audio_int16 = (audio * 32767).astype(np.int16)

    # Write WAV file manually
    with open(filepath, 'wb') as f:
        # WAV header
        num_samples = len(audio_int16)
        data_size = num_samples * 2  # 2 bytes per sample (16-bit)
        file_size = 36 + data_size

        f.write(b'RIFF')
        f.write(struct.pack('<I', file_size))
        f.write(b'WAVE')
        f.write(b'fmt ')
        f.write(struct.pack('<I', 16))       # Chunk size
        f.write(struct.pack('<H', 1))        # PCM format
        f.write(struct.pack('<H', 1))        # Mono
        f.write(struct.pack('<I', sr))       # Sample rate
        f.write(struct.pack('<I', sr * 2))   # Byte rate
        f.write(struct.pack('<H', 2))        # Block align
        f.write(struct.pack('<H', 16))       # Bits per sample
        f.write(b'data')
        f.write(struct.pack('<I', data_size))
        f.write(audio_int16.tobytes())

    print(f"  ✓ Saved: {filepath} ({num_samples / sr:.1f}s, {os.path.getsize(filepath)} bytes)")


def main():
    print("=" * 60)
    print("  VOCX GUARD — Demo Audio Generator")
    print("=" * 60)
    print()

    # Generate genuine speech samples
    print("[1/4] Generating genuine speech sample (Speaker A)...")
    genuine_a = generate_genuine_speech(duration=4.0)
    save_wav(genuine_a, "genuine_speaker_a.wav")

    print("[2/4] Generating genuine speech sample (Speaker B)...")
    np.random.seed(42)  # Different random characteristics
    genuine_b = generate_genuine_speech(duration=4.0)
    save_wav(genuine_b, "genuine_speaker_b.wav")

    # Generate synthetic/cloned speech samples
    print("[3/4] Generating synthetic/cloned speech sample...")
    synthetic = generate_synthetic_speech(duration=4.0)
    save_wav(synthetic, "synthetic_cloned.wav")

    print("[4/4] Generating enrollment sample (Speaker A - reference)...")
    np.random.seed(0)
    enrollment = generate_genuine_speech(duration=6.0)
    save_wav(enrollment, "enrollment_speaker_a.wav")

    print()
    print(f"All demo audio files saved to: {DEMO_DIR}")
    print()
    print("Usage:")
    print("  1. Use 'enrollment_speaker_a.wav' to enroll Speaker A")
    print("  2. Test with 'genuine_speaker_a.wav' → should show LOW risk")
    print("  3. Test with 'synthetic_cloned.wav' → should show HIGH risk")
    print("  4. Test with 'genuine_speaker_b.wav' → should show speaker mismatch")


if __name__ == "__main__":
    main()
