import argparse
import base64
import json
import logging
import queue
import sys
import threading
import uuid
import time
from typing import Optional

import colorama
import numpy as np
import requests
import sounddevice as sd
from colorama import Fore, Style

# Initialize colorama
colorama.init(autoreset=True)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

API_ENDPOINT = "http://localhost:8000/api/analyze"
SAMPLE_RATE = 48000
CHUNK_DURATION = 2  # seconds
CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_DURATION
SILENCE_THRESHOLD = 0.012

def print_banner():
    banner = f"""
{Fore.CYAN}{Style.BRIGHT}========================================
       VocxGuard Call Monitor           
========================================{Style.RESET_ALL}
    """
    print(banner)

def list_devices():
    print(f"{Fore.CYAN}Available Audio Devices:{Style.RESET_ALL}")
    print(sd.query_devices())
    print("\nNote: For Windows WASAPI loopback, look for devices with 'Loopback' in the name or use the WASAPI host API.")

class CallMonitor:
    def __init__(self, device: Optional[int] = None):
        self.device = device
        self.session_id = str(uuid.uuid4())
        self.audio_queue = queue.Queue()
        self.running = False
        self.stream = None
        self.buffer = np.array([], dtype=np.float32)

    def audio_callback(self, indata, frames, time_info, status):
        if status:
            logger.warning(f"Audio status: {status}")
        self.audio_queue.put(indata.copy())

    def start(self):
        self.running = True
        
        try:
            self.stream = sd.InputStream(
                device=self.device,
                channels=4,
                samplerate=SAMPLE_RATE,
                callback=self.audio_callback,
                dtype=np.float32
            )
            self.stream.start()
            print(f"{Fore.GREEN}Started listening (Session ID: {self.session_id})...{Style.RESET_ALL}")
            
            self.process_audio()
        except Exception as e:
            logger.error(f"Failed to start audio stream: {e}")
            self.running = False

    def process_audio(self):
        while self.running:
            try:
                chunk = self.audio_queue.get(timeout=1.0)
                # flatten the chunk as it is 2D
                chunk = chunk.flatten()
                self.buffer = np.append(self.buffer, chunk)

                while len(self.buffer) >= CHUNK_SAMPLES:
                    process_chunk = self.buffer[:CHUNK_SAMPLES]
                    self.buffer = self.buffer[CHUNK_SAMPLES:]

                    peak = np.max(np.abs(process_chunk))
                    if peak < SILENCE_THRESHOLD:
                        # logger.debug(f"Silence detected (peak: {peak:.4f}), skipping...")
                        continue

                    # Send to backend
                    self.send_to_backend(process_chunk)
            except queue.Empty:
                pass
            except Exception as e:
                logger.error(f"Error processing audio: {e}")

    def send_to_backend(self, audio_data: np.ndarray):
        # Convert to 16-bit PCM for API
        pcm_data = (audio_data * 32767).astype(np.int16)
        audio_base64 = base64.b64encode(pcm_data.tobytes()).decode('utf-8')

        payload = {
            "audio_base64": audio_base64,
            "session_id": self.session_id,
            "speaker_id": "Desktop Call Monitor"
        }

        try:
            response = requests.post(API_ENDPOINT, json=payload, timeout=5.0)
            if response.status_code == 200:
                self.display_result(response.json())
            else:
                logger.error(f"API Error ({response.status_code}): {response.text}")
        except Exception as e:
            logger.error(f"Request failed: {e}")

    def display_result(self, result: dict):
        risk_score = result.get('risk_score', 0)
        risk_level = result.get('risk_level', 'unknown')
        spoofed = result.get('spoofed', False)
        models = result.get('model_breakdown', {})

        color = Fore.GREEN if risk_level == 'low' else Fore.YELLOW if risk_level == 'medium' else Fore.RED
        spoof_str = "SPOOF DETECTED" if spoofed else "GENUINE"
        
        print(f"\n{color}{Style.BRIGHT}[{time.strftime('%H:%M:%S')}] Analysis Result: {spoof_str} (Risk: {risk_score:.2f} - {risk_level.upper()}){Style.RESET_ALL}")
        print(f"Models: LFCC: {models.get('lfcc', 0):.2f} | RawNet2: {models.get('rawnet2', 0):.2f} | WavLM: {models.get('wavlm', 0):.2f} | Bio: {models.get('bio', 0):.2f}")

    def stop(self):
        self.running = False
        if self.stream:
            self.stream.stop()
            self.stream.close()
        print(f"\n{Fore.YELLOW}Monitoring stopped.{Style.RESET_ALL}")


def main():
    parser = argparse.ArgumentParser(description="VocxGuard Real-time Call Monitor")
    parser.add_argument("--device", type=int, help="Audio device ID to monitor")
    parser.add_argument("--list-devices", action="store_true", help="List available audio devices")
    
    args = parser.parse_args()

    print_banner()

    if args.list_devices:
        list_devices()
        return

    monitor = CallMonitor(device=args.device)
    
    try:
        monitor.start()
    except KeyboardInterrupt:
        monitor.stop()

if __name__ == "__main__":
    main()
