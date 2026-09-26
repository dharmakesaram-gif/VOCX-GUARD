# VocxGuard Desktop Call Monitor

Real-time audio monitoring tool for VocxGuard. Captures system audio or microphone input and streams 2-second chunks to the VocxGuard backend for deepfake detection.

## Setup

1. Create a virtual environment (optional but recommended):
   ```bash
   python -m venv venv
   venv\Scripts\activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

List available audio devices:
```bash
python call_monitor.py --list-devices
```

Start monitoring (default device):
```bash
python call_monitor.py
```

Start monitoring on a specific device (e.g., WASAPI loopback device for system audio):
```bash
python call_monitor.py --device <DEVICE_ID>
```

Stop monitoring by pressing `Ctrl+C`.
