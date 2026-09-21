# VOCX GUARD — Complete Deployment Guide (Web & Mobile App)

This guide provides step-by-step instructions to deploy **VOCX GUARD** as a live, publicly accessible **Web Application** and a standalone **Mobile App (Android APK & iOS)**.

---

## Architecture

```
                                +-------------------------------------+
                                |      FastAPI Backend (PyTorch)      |
                                |       Render / Railway / AWS        |
                                |  https://vocxguard-api.onrender.com |
                                +-------------------------------------+
                                             ▲            ▲
                       HTTPS REST / WSS     │            │   HTTPS REST / WSS
                       Live 2s Chunks       │            │   Live 2s Chunks
                                             │            │
            +--------------------------------+            +-------------------------------+
            │                                                                             │
+-----------------------+                                                     +-----------------------+
|  Next.js 14 Web App   |                                                     | React Native (Expo)   |
|     Vercel Host       |                                                     | Android APK / iOS App |
| https://vocxguard.app |                                                     | EAS Cloud Build       |
+-----------------------+                                                     +-----------------------+
```

---

## Step 1: Deploy the Backend (FastAPI + ML Models)

The backend handles the tri-model neural consensus (LFCC-LCNN, RawNet2, WavLM) and biomechanical analysis. It must be deployed first so Web and Mobile can connect to it.

### Option A: Deploy on Render (Recommended — Free & Easy)
1. Go to [Render.com](https://render.com) and create an account.
2. Click **New +** $\to$ **Web Service**.
3. Select **Build and deploy from a Git repository** and connect:
   `https://github.com/dharmakesaram-gif/VOCX-GUARD`
4. Configure the service:
   - **Name**: `vocxguard-api`
   - **Region**: Closest to you (e.g., Singapore, Frankfurt, Oregon)
   - **Branch**: `main`
   - **Runtime**: **Docker** *(Render will automatically detect the root `Dockerfile`)*
   - **Instance Type**: Free or Starter ($7/mo for persistent RAM without cold starts)
5. Click **Create Web Service**.
6. Once deployed, Render will provide a public HTTPS URL (e.g. `https://vocxguard-api.onrender.com`).
   - Test it by opening `https://vocxguard-api.onrender.com/` in your browser $\to$ returns `{"status":"ok","service":"Vocx Guard"}`.

### Option B: Deploy on Railway
1. Go to [Railway.app](https://railway.app) $\to$ **New Project**.
2. Select **Deploy from GitHub repo** $\to$ choose `VOCX-GUARD`.
3. Railway automatically builds the `Dockerfile`.
4. Go to **Settings** $\to$ **Generate Domain** $\to$ copy your public URL.

---

## Step 2: Deploy the Web Application (Next.js 14)

The web dashboard provides the command center, live call monitor, and voiceprint enrollment.

### Deploy on Vercel (Recommended — Free & 1-Click)
1. Go to [Vercel.com](https://vercel.com) and sign in with GitHub.
2. Click **Add New...** $\to$ **Project**.
3. Import `dharmakesaram-gif/VOCX-GUARD`.
4. In the configuration screen:
   - **Framework Preset**: Next.js
   - **Root Directory**: Click **Edit** and select `frontend`
5. Expand **Environment Variables** and add:
   - **Key**: `NEXT_PUBLIC_API_URL`
   - **Value**: `https://your-backend-name.onrender.com` *(your backend URL from Step 1)*
   - **Key**: `NEXT_PUBLIC_WS_URL`
   - **Value**: `wss://your-backend-name.onrender.com/ws/stream`
6. Click **Deploy**.
7. In ~60 seconds, your web dashboard is live at `https://vocx-guard.vercel.app`!

---

## Step 3: Deploy the Mobile App (React Native / Expo)

The mobile application runs on Android and iOS devices, monitoring phone audio with real-time telemetry.

### Option A: Build Standalone Android APK (Install on any Android device)
You don't need Android Studio or a high-end machine — Expo's cloud builds the `.apk` for you:

1. In your local terminal, navigate to the mobile folder:
   ```bash
   cd mobile
   ```
2. Install EAS CLI globally (if not already installed):
   ```bash
   npm install -g eas-cli
   ```
3. Log in to your Expo account:
   ```bash
   eas login
   ```
4. Create a `.env` file in `mobile/`:
   ```env
   EXPO_PUBLIC_API_URL=https://your-backend-name.onrender.com
   EXPO_PUBLIC_WS_URL=wss://your-backend-name.onrender.com/ws/stream
   ```
5. Trigger the cloud APK build:
   ```bash
   eas build -p android --profile preview
   ```
6. EAS will build the `.apk` in the cloud (~5-8 minutes).
7. When finished, EAS prints a **download link and QR code**.
8. Open the link on your Android phone, download `vocxguard.apk`, and install it!

### Option B: Build iOS App (TestFlight / Internal)
```bash
cd mobile
eas build -p ios --profile preview
```
*(Requires an Apple Developer account to install on iOS devices).*

### Option C: Quick Live Demo via Expo Go (No APK Build Required)
1. In `mobile/.env`:
   ```env
   EXPO_PUBLIC_API_URL=https://your-backend-name.onrender.com
   ```
2. Run:
   ```bash
   npx expo start
   ```
3. Scan the terminal QR code with the **Expo Go** app on your phone. The app will communicate directly with your production cloud backend!

---

## Verification Checklist

| Service | Component | Verification Check |
|---|---|---|
| **Backend** | REST API | `curl https://your-backend.onrender.com/api/sessions` returns HTTP 200 |
| **Backend** | WebSockets | Connect to `wss://your-backend.onrender.com/ws/stream` |
| **Web** | Dashboard | Open web URL $\to$ telemetry graphs and enrollment load |
| **Web** | Call Monitor | Click "Start Live Monitoring" $\to$ latency $< 100\text{ ms}$ |
| **Mobile** | Live Detection | Open APK on phone $\to$ toggle "Start Live Monitoring" $\to$ latency sits $< 100\text{ ms}$ |
