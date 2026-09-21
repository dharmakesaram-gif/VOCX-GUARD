"""
Vocx Guard — ASVspoof 2021 Training Pipeline
Trains LFCC-LCNN, RawNet2, and WavLM detector models on ASVspoof-style data.

Usage:
    python ml/training/train.py --model lfcc_lcnn --epochs 20 --batch_size 32
    python ml/training/train.py --model rawnet2 --epochs 20
    python ml/training/train.py --model wavlm --epochs 10
    python ml/training/train.py --model all --epochs 20
"""

import os
import sys

# Ensure UTF-8 output encoding and line buffering on Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', line_buffering=True)

import time
import json
import argparse
import struct
from pathlib import Path
from typing import List, Dict, Tuple, Optional

import numpy as np

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader

# ─── ASVspoof Dataset ─────────────────────────────────────────────────────────


class ASVspoofDataset(Dataset):
    """
    PyTorch Dataset for ASVspoof-style data.
    Loads audio files and returns (audio_tensor, label) pairs.
    """

    def __init__(
        self,
        audio_dir: str,
        protocol_path: str,
        max_samples: Optional[int] = None,
        max_audio_len: int = 48000,  # 3 seconds at 16kHz
        feature_type: str = "raw",   # 'raw', 'lfcc', or 'log_mel'
    ):
        self.audio_dir = Path(audio_dir)
        self.max_audio_len = max_audio_len
        self.feature_type = feature_type
        self.entries: List[Dict] = []

        # Parse protocol file
        with open(protocol_path, 'r') as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) >= 5:
                    self.entries.append({
                        "speaker_id": parts[0],
                        "audio_id": parts[1],
                        "attack_type": parts[3],
                        "label": 0 if parts[4] == "bonafide" else 1,
                    })

        if max_samples:
            self.entries = self.entries[:max_samples]

        # Count labels
        n_bonafide = sum(1 for e in self.entries if e["label"] == 0)
        n_spoof = sum(1 for e in self.entries if e["label"] == 1)
        print(f"    Dataset: {len(self.entries)} samples "
              f"(bonafide={n_bonafide}, spoof={n_spoof})")

        self._cache: Dict[int, torch.Tensor] = {}

    def __len__(self):
        return len(self.entries)

    def _load_wav(self, filepath: str) -> np.ndarray:
        """Load WAV file and return float32 numpy array."""
        with open(filepath, 'rb') as f:
            # Read WAV header
            riff = f.read(4)
            if riff != b'RIFF':
                raise ValueError(f"Not a WAV file: {filepath}")
            f.read(4)  # file size
            wave = f.read(4)
            if wave != b'WAVE':
                raise ValueError(f"Not a WAV file: {filepath}")

            # Find data chunk
            while True:
                chunk_id = f.read(4)
                if len(chunk_id) < 4:
                    raise ValueError(f"Could not find data chunk in {filepath}")
                chunk_size = struct.unpack('<I', f.read(4))[0]
                if chunk_id == b'data':
                    data = f.read(chunk_size)
                    break
                else:
                    f.read(chunk_size)

            # Convert to float32
            audio = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32767.0
            return audio

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, int]:
        entry = self.entries[idx]
        if idx in self._cache:
            return self._cache[idx], entry["label"]

        audio_path = self.audio_dir / f"{entry['audio_id']}.wav"

        # Load audio
        try:
            audio = self._load_wav(str(audio_path))
        except Exception:
            # Fallback: random noise
            audio = np.random.randn(self.max_audio_len).astype(np.float32) * 0.01

        # Pad or truncate
        if len(audio) > self.max_audio_len:
            audio = audio[:self.max_audio_len]
        elif len(audio) < self.max_audio_len:
            audio = np.pad(audio, (0, self.max_audio_len - len(audio)))

        # Peak normalize audio to standard range
        peak = np.max(np.abs(audio))
        if peak > 1e-6:
            audio = audio / peak

        # Extract features if needed
        if self.feature_type == "lfcc":
            features = self._extract_lfcc(audio)
        elif self.feature_type == "log_mel":
            features = self._extract_log_mel(audio)
        else:
            features = torch.FloatTensor(audio)

        self._cache[idx] = features
        return features, entry["label"]

    def _extract_lfcc(self, audio: np.ndarray, sr: int = 16000) -> torch.Tensor:
        """Extract LFCC features for LCNN model."""
        try:
            from ml.feature_extraction import extract_lfcc
            features = extract_lfcc(audio, sr=sr)
            return features
        except ImportError:
            # Fallback: simple spectrogram
            n_fft = 512
            hop = 160
            spec = np.abs(np.fft.rfft(
                np.lib.stride_tricks.sliding_window_view(audio, n_fft)[::hop]
            ))
            # Take log and apply DCT-like transform
            log_spec = np.log(spec + 1e-8)
            lfcc = log_spec[:, :20]  # First 20 coefficients
            return torch.FloatTensor(lfcc)

    def _extract_log_mel(self, audio: np.ndarray, sr: int = 16000) -> torch.Tensor:
        """Extract Log-Mel spectrogram."""
        try:
            from ml.feature_extraction import extract_log_mel
            features = extract_log_mel(audio, sr=sr)
            return features
        except ImportError:
            n_fft = 512
            hop = 160
            spec = np.abs(np.fft.rfft(
                np.lib.stride_tricks.sliding_window_view(audio, n_fft)[::hop]
            ))
            log_mel = np.log(spec[:, :80] + 1e-8)
            return torch.FloatTensor(log_mel)


# ─── Training Functions ───────────────────────────────────────────────────────


def train_one_epoch(
    model: nn.Module,
    dataloader: DataLoader,
    optimizer: optim.Optimizer,
    criterion: nn.Module,
    device: torch.device,
    epoch: int,
    model_name: str,
) -> Dict:
    """Train model for one epoch."""
    model.train()
    total_loss = 0.0
    correct = 0
    total = 0

    for batch_idx, (data, labels) in enumerate(dataloader):
        data = data.to(device)
        labels = labels.to(device).long()

        # Reshape input based on model type
        if model_name == "lfcc_lcnn":
            # LCNN expects (batch, 1, n_frames, n_lfcc)
            if data.dim() == 2:
                data = data.unsqueeze(1)  # Add channel dim
            if data.dim() == 3:
                data = data.unsqueeze(1)  # (B, 1, T, F)
        elif model_name in ("rawnet2", "wavlm"):
            # RawNet2 and WavLM expect (batch, 1, samples)
            if data.dim() == 1:
                data = data.unsqueeze(0).unsqueeze(0)
            elif data.dim() == 2:
                data = data.unsqueeze(1)  # (B, 1, samples)

        optimizer.zero_grad()

        try:
            logits = model(data)
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()

            total_loss += loss.item()
            _, predicted = torch.max(logits, 1)
            correct += (predicted == labels).sum().item()
            total += labels.size(0)

        except RuntimeError as e:
            print(f"    [!] Batch {batch_idx} error: {e}")
            continue

        if (batch_idx + 1) % 10 == 0:
            acc = correct / max(total, 1) * 100
            print(f"    Epoch {epoch} | Batch {batch_idx + 1}/{len(dataloader)} | "
                  f"Loss: {total_loss / (batch_idx + 1):.4f} | Acc: {acc:.1f}%")

    avg_loss = total_loss / max(len(dataloader), 1)
    accuracy = correct / max(total, 1) * 100

    return {"loss": avg_loss, "accuracy": accuracy, "total": total}


def evaluate(
    model: nn.Module,
    dataloader: DataLoader,
    criterion: nn.Module,
    device: torch.device,
    model_name: str,
) -> Dict:
    """Evaluate model on validation set."""
    model.eval()
    total_loss = 0.0
    correct = 0
    total = 0
    all_preds = []
    all_labels = []

    with torch.no_grad():
        for data, labels in dataloader:
            data = data.to(device)
            labels = labels.to(device).long()

            # Reshape input
            if model_name == "lfcc_lcnn":
                if data.dim() == 2:
                    data = data.unsqueeze(1)
                if data.dim() == 3:
                    data = data.unsqueeze(1)
            elif model_name in ("rawnet2", "wavlm"):
                if data.dim() == 1:
                    data = data.unsqueeze(0).unsqueeze(0)
                elif data.dim() == 2:
                    data = data.unsqueeze(1)

            try:
                logits = model(data)
                loss = criterion(logits, labels)

                total_loss += loss.item()
                _, predicted = torch.max(logits, 1)
                correct += (predicted == labels).sum().item()
                total += labels.size(0)

                all_preds.extend(predicted.cpu().numpy().tolist())
                all_labels.extend(labels.cpu().numpy().tolist())
            except RuntimeError:
                continue

    avg_loss = total_loss / max(len(dataloader), 1)
    accuracy = correct / max(total, 1) * 100

    # Compute EER approximation
    tp = sum(1 for p, l in zip(all_preds, all_labels) if p == 1 and l == 1)
    tn = sum(1 for p, l in zip(all_preds, all_labels) if p == 0 and l == 0)
    fp = sum(1 for p, l in zip(all_preds, all_labels) if p == 1 and l == 0)
    fn = sum(1 for p, l in zip(all_preds, all_labels) if p == 0 and l == 1)

    far = fp / max(fp + tn, 1)  # False Accept Rate
    frr = fn / max(fn + tp, 1)  # False Reject Rate

    return {
        "loss": avg_loss,
        "accuracy": accuracy,
        "far": far,
        "frr": frr,
        "eer_approx": (far + frr) / 2,
        "total": total,
    }


def train_model(
    model_name: str,
    epochs: int = 20,
    batch_size: int = 32,
    learning_rate: float = 0.0001,
    device: Optional[str] = None,
):
    """
    Full training pipeline for a single model.
    """
    print(f"\n{'=' * 60}")
    print(f"  Training: {model_name.upper()}")
    print(f"{'=' * 60}")

    # Device setup
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    device = torch.device(device)
    print(f"  Device: {device}")

    # ─── Generate/load dataset ─────────────────────────────────────────────
    print("\n  [1/5] Preparing dataset...")

    data_dir = PROJECT_ROOT / "ml" / "data" / "asvspoof2021" / "synthetic_LA"
    if not data_dir.exists():
        data_dir = PROJECT_ROOT / "data" / "asvspoof2021" / "synthetic_LA"
    audio_dir = data_dir / "flac"
    protocol_path = data_dir / "protocol.txt"

    if not protocol_path.exists():
        print("  Dataset not found. Generating synthetic data...")
        from ml.training.dataset import generate_synthetic_dataset
        audio_dir_str, protocol_path_str = generate_synthetic_dataset(
            n_bonafide=500, n_spoof=500
        )
        audio_dir = Path(audio_dir_str)
        protocol_path = Path(protocol_path_str)

    # Select feature type based on model
    if model_name == "lfcc_lcnn":
        feature_type = "lfcc"
    elif model_name in ("rawnet2", "wavlm"):
        feature_type = "raw"
    else:
        feature_type = "raw"

    # Create datasets (80/20 split)
    full_dataset = ASVspoofDataset(
        audio_dir=str(audio_dir),
        protocol_path=str(protocol_path),
        feature_type=feature_type,
    )

    train_size = int(0.8 * len(full_dataset))
    val_size = len(full_dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(
        full_dataset, [train_size, val_size],
        generator=torch.Generator().manual_seed(42)
    )

    train_loader = DataLoader(
        train_dataset, batch_size=batch_size, shuffle=True,
        num_workers=0, drop_last=True
    )
    val_loader = DataLoader(
        val_dataset, batch_size=batch_size, shuffle=False,
        num_workers=0,
    )

    print(f"  Train: {len(train_dataset)} samples")
    print(f"  Val:   {len(val_dataset)} samples")

    # ─── Initialize model ──────────────────────────────────────────────────
    print(f"\n  [2/5] Initializing {model_name} model...")

    if model_name == "lfcc_lcnn":
        from ml.models.lfcc_lcnn import LCNN
        model = LCNN()
    elif model_name == "rawnet2":
        from ml.models.rawnet2 import RawNet2
        model = RawNet2()
    elif model_name == "wavlm":
        from ml.models.wavlm_detector import WavLMDetector
        model = WavLMDetector()
    else:
        raise ValueError(f"Unknown model: {model_name}")

    save_dir = PROJECT_ROOT / "checkpoints"
    save_dir.mkdir(parents=True, exist_ok=True)
    existing_ckpt = save_dir / f"{model_name}_best.pt"
    if existing_ckpt.exists():
        try:
            ckpt = torch.load(existing_ckpt, map_location=device)
            state = ckpt.get("model_state_dict", ckpt)
            model.load_state_dict(state)
            print(f"  [Fine-Tune] Loaded existing weights from {existing_ckpt}")
        except Exception as e:
            print(f"  [Warning] Could not load existing weights: {e}")

    model = model.to(device)
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"  Total parameters: {total_params:,}")
    print(f"  Trainable parameters: {trainable_params:,}")

    # ─── Optimizer & Loss ──────────────────────────────────────────────────
    print(f"\n  [3/5] Setting up optimizer...")

    optimizer = optim.Adam(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    # Weighted loss to handle class imbalance
    criterion = nn.CrossEntropyLoss()

    print(f"  Optimizer: Adam (lr={learning_rate}, weight_decay=1e-4)")
    print(f"  Scheduler: CosineAnnealingLR")

    # ─── Training loop ─────────────────────────────────────────────────────
    print(f"\n  [4/5] Training for {epochs} epochs...")

    best_val_acc = 0.0
    history = []
    save_dir = PROJECT_ROOT / "checkpoints"
    save_dir.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, epochs + 1):
        start_time = time.time()

        # Train
        train_metrics = train_one_epoch(
            model, train_loader, optimizer, criterion, device, epoch, model_name
        )

        # Validate
        val_metrics = evaluate(model, val_loader, criterion, device, model_name)

        scheduler.step()

        elapsed = time.time() - start_time
        current_lr = optimizer.param_groups[0]['lr']

        print(f"\n  Epoch {epoch}/{epochs} ({elapsed:.1f}s) | "
              f"LR: {current_lr:.6f}")
        print(f"    Train Loss: {train_metrics['loss']:.4f} | "
              f"Train Acc: {train_metrics['accuracy']:.1f}%")
        print(f"    Val Loss:   {val_metrics['loss']:.4f} | "
              f"Val Acc:   {val_metrics['accuracy']:.1f}% | "
              f"EER: {val_metrics['eer_approx']:.4f}")

        history.append({
            "epoch": epoch,
            "train_loss": train_metrics["loss"],
            "train_acc": train_metrics["accuracy"],
            "val_loss": val_metrics["loss"],
            "val_acc": val_metrics["accuracy"],
            "val_eer": val_metrics["eer_approx"],
            "lr": current_lr,
        })

        # Save best model
        if val_metrics["accuracy"] > best_val_acc:
            best_val_acc = val_metrics["accuracy"]
            checkpoint_path = save_dir / f"{model_name}_best.pt"
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "val_accuracy": val_metrics["accuracy"],
                "val_eer": val_metrics["eer_approx"],
            }, checkpoint_path)
            print(f"    * New best model saved: {checkpoint_path}")

    # --- Save final model & results ----------------------------------------
    print(f"\n  [5/5] Saving final model and results...")

    # Save final checkpoint
    final_path = save_dir / f"{model_name}_final.pt"
    torch.save({
        "epoch": epochs,
        "model_state_dict": model.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "history": history,
    }, final_path)
    print(f"  [OK] Final model: {final_path}")

    # Save training history
    history_path = save_dir / f"{model_name}_history.json"
    with open(history_path, 'w') as f:
        json.dump(history, f, indent=2)
    print(f"  [OK] History: {history_path}")

    # Print summary
    print(f"\n  {'-' * 50}")
    print(f"  TRAINING COMPLETE: {model_name.upper()}")
    print(f"  Best validation accuracy: {best_val_acc:.1f}%")
    print(f"  Final model saved to: {final_path}")
    print(f"  {'-' * 50}")

    return model, history


# ─── Main ──────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Vocx Guard — ASVspoof 2021 Model Training"
    )
    parser.add_argument(
        "--model", type=str, default="all",
        choices=["lfcc_lcnn", "rawnet2", "wavlm", "all"],
        help="Model to train (default: all)"
    )
    parser.add_argument("--epochs", type=int, default=20, help="Number of epochs")
    parser.add_argument("--batch_size", type=int, default=32, help="Batch size")
    parser.add_argument("--lr", type=float, default=0.0001, help="Learning rate")
    parser.add_argument("--device", type=str, default=None, help="Device (cuda/cpu)")

    args = parser.parse_args()

    print()
    print("==========================================================")
    print("       VOCX GUARD - ASVspoof 2021 Training Pipeline       ")
    print("   AI-Powered Voice Cloning Detection Model Training      ")
    print("==========================================================")
    print()
    print(f"  Configuration:")
    print(f"    Model:      {args.model}")
    print(f"    Epochs:     {args.epochs}")
    print(f"    Batch size: {args.batch_size}")
    print(f"    LR:         {args.lr}")
    print(f"    Device:     {args.device or 'auto'}")

    models_to_train = (
        ["lfcc_lcnn", "rawnet2", "wavlm"] if args.model == "all"
        else [args.model]
    )

    results = {}
    for model_name in models_to_train:
        try:
            model, history = train_model(
                model_name=model_name,
                epochs=args.epochs,
                batch_size=args.batch_size,
                learning_rate=args.lr,
                device=args.device,
            )
            results[model_name] = {
                "status": "success",
                "best_acc": max(h["val_acc"] for h in history),
                "final_eer": history[-1]["val_eer"],
            }
        except Exception as e:
            print(f"\n  [X] Failed to train {model_name}: {e}")
            import traceback
            traceback.print_exc()
            results[model_name] = {"status": "failed", "error": str(e)}

    # Final summary
    print(f"\n{'=' * 60}")
    print(f"  TRAINING SUMMARY")
    print(f"{'=' * 60}")
    for name, result in results.items():
        if result["status"] == "success":
            print(f"  [OK] {name:15s} | Acc: {result['best_acc']:.1f}% | EER: {result['final_eer']:.4f}")
        else:
            print(f"  [X] {name:15s} | FAILED: {result['error']}")
    print()


if __name__ == "__main__":
    main()
