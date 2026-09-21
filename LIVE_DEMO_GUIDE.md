# Vocx Guard — Live Voice & Call Monitoring Demonstration Guide

## 1. Overview of the Live Listening Engine

Vocx Guard is now configured to **directly listen to real incoming voice from your phone's microphone** in real time and continuously compute deepfake & clone predictions while listening.

All manual demo simulation buttons ("*Normal Human Voice*", "*Inject AI Clone Attack*") have been completely removed as requested.

```
+-----------------------------------------------------------------------------------+
|                            PHYSICAL ANDROID PHONE                                 |
|                                                                                   |
|  [ Microphone Hardware ]                                                          |
|           |                                                                       |
|           v                                                                       |
|  [ Hardware Metering (80-100ms) ] ----> [ Live Audio Level Meter (-80 to 0 dB) ]   |
|           |                       ----> [ Voice Activity Detection (VAD) ]        |
|           |                       ----> [ Animated Harmonic Waveform ]            |
|           v                                                                       |
|  [ Rolling 2.5s Audio Buffer ]                                                    |
|           |                                                                       |
|           v (WAV Base64)                                                          |
|  [ FastAPI Backend (0.0.0.0:8000) ]                                               |
|           |                                                                       |
|           +---> [ LFCC-LCNN: Vocoder Spectral Phase Spoof Detection ]             |
|           +---> [ RawNet2: Time-Domain Filterbank Anomaly Analysis ]              |
|           +---> [ Risk Engine: Multi-Model Bayesian Risk Fusion ]                 |
|           |                                                                       |
|           v (Real-time Prediction JSON)                                           |
|  [ Live UI Updates ]                                                              |
|       • Real-Time Risk Gauge Needle                                               |
|       • Verdict: GENUINE vs SUSPICIOUS vs SPOOFED                                 |
|       • LFCC-LCNN Vocoder Telemetry Bar                                           |
|       • RawNet2 Waveform Anomaly Bar                                              |
|       • Live Audio Inference Log Ticker                                           |
+-----------------------------------------------------------------------------------+
```

---

## 2. Key Features Implemented

### 🎤 Real-Time Microphone Decibel (dB) Level Meter
- Displays instantaneous sound input loudness in decibels (dB) from `-80 dB` (silence) to `0 dB` (peak).
- Dynamic color-coded level bar:
  - **Cyan (< 35%)**: Low background sound
  - **Green (35% - 75%)**: Active human voice range (-40 dB to -15 dB)
  - **Red (> 75%)**: High acoustic intensity / loud audio

### 🟢 Dynamic Voice Activity Detection (VAD)
- **`⚪ LISTENING (ROOM AMBIENT)`**: When the room is quiet or waiting for the caller.
- **`🟢 SPEECH DETECTED (ANALYZING)`**: The instant someone speaks into the phone or when incoming caller voice arrives.

### ⚡ Rolling 2.5-Second Neural Chunk Processing
- Captures audio in continuous 2.5-second windows from the microphone.
- Slices the audio and sends it directly to the running backend (`/api/analyze`).
- The LFCC-LCNN and RawNet2 neural networks analyze the real audio waveform and vocoder phase.
- Updates the **Risk Gauge**, **Acoustic Score**, and **Biometric Consistency** live while listening.
- Displays actual roundtrip processing latency (e.g. `⚡ 85 ms`).

### 📜 Live Audio Inference Stream (Terminal Feed)
- A rolling on-screen audit log displaying every chunk processed in real time:
  - `[18:42:15] #4 Voice -22dB • 11% GENUINE • 82ms`
  - `[18:42:18] #5 Voice -24dB • 12% GENUINE • 79ms`
  - `[18:42:21] #6 Ambient -56dB • 9% GENUINE • 75ms`

---

## 3. How to Demonstrate Live to Hackathon Judges

### Understanding Android Call Audio Sandboxing:
Android OS security sandboxing restricts non-system third-party apps from tapping into the internal baseband cell call stream. In production enterprise deployment, Vocx Guard sits at the carrier SIP/telecom trunk or VoIP gateway level.

For a live demonstration on a physical smartphone, **Speakerphone mode** allows the microphone to directly capture and analyze the caller's incoming voice in real time!

### Step-by-Step Live Demo Instructions:

1. **Open the App on Your Phone**:
   - Open Expo Go on your mobile device (or launch the standalone APK), go to the **Analyze** tab.
   - Tap **"LIVE CALL MONITOR"** at the top.

2. **Start Live Listening**:
   - Tap the large button: **"START LIVE CALL MONITOR"**.
   - If prompted for microphone permission, tap **Allow**.
   - Notice the status updates immediately to **`DIRECT MICROPHONE LISTENING`**.
   - Look at the **Audio Level Meter**: when silent, it reads around `-55 dB (Room Ambient)`.

3. **Demonstrate Authentic Human Voice**:
   - Speak naturally into the phone: *"Hello, this is a live test of Vocx Guard voice security."*
   - Watch the screen in real time:
     - The decibel meter jumps up to `-25 dB` to `-15 dB`.
     - The indicator turns bright green: **`🟢 SPEECH DETECTED (ANALYZING)`**.
     - The waveform bars actively animate to your voice.
     - Within 2.5 seconds, the chunk is processed by LFCC-LCNN: Risk Gauge shows **`LOW RISK (8% - 15%)`** with status **`GENUINE`**.
     - An entry appears in the **Live Audio Inference Stream**.

4. **Demonstrate a Live Phone Call**:
   - Make a phone call to the device.
   - Answer the call and put it on **Speakerphone**.
   - As the caller speaks, the phone's microphone captures the incoming audio.
   - The screen shows the speech detected and evaluates the caller's voice in 2.5s rolling windows.

5. **Demonstrate AI Voice / Clone Detection**:
   - Play an AI generated voice (e.g. ElevenLabs, OpenAI voice, or Siri/Google TTS) from a laptop or second phone near the microphone.
   - Vocx Guard captures the synthetic audio frames.
   - LFCC-LCNN detects synthetic vocoder spectral phase irregularities and RawNet2 flags time-domain filterbank anomalies.
   - The Risk Gauge climbs into **`HIGH RISK (> 70%)`** and the red **`AI CLONE ATTACK DETECTED!`** alert card illuminates on screen!
