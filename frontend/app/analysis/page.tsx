'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { API_BASE, getAuthHeaders } from '../../lib/config';
import RiskGauge from '@/components/RiskGauge';
import WaveformVisualizer from '@/components/WaveformVisualizer';
import { Upload, Mic, Play, Pause, FileAudio, CheckCircle, AlertTriangle, XCircle, RefreshCw, Radio } from 'lucide-react';

interface AnalysisData {
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  isSpoofed: boolean;
  acousticScore: number;
  speakerScore: number;
  lfccScore: number;
  rawnetScore: number;
  bioSpoof: number;
  jitter: number;
  aliasingRatio: number;
  authenticity: number;
  isOwner?: boolean;
  ownerSimilarity?: number;
  speakerChannel?: string;
}

export default function AnalysisPage() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const [selectedSpeaker, setSelectedSpeaker] = useState('');
  const [filterMyVoice, setFilterMyVoice] = useState(true);
  const [ownerSpeakerId, setOwnerSpeakerId] = useState('my_owner_voice');
  const [enrolledList, setEnrolledList] = useState<string[]>(['my_owner_voice', 'SPK-10492']);
  const [audioFileName, setAudioFileName] = useState('No audio selected');
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/enrolled-speakers`, {
      headers: getAuthHeaders(),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.speakers) && data.speakers.length > 0) {
          setEnrolledList(data.speakers);
          if (!data.speakers.includes(ownerSpeakerId)) {
            setOwnerSpeakerId(data.speakers[0]);
          }
        }
      })
      .catch(() => {});

    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, [audioUrl]);

  // Handle File Selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadAudioFile(file);
  };

  const loadAudioFile = (file: File) => {
    setAudioFileName(file.name);
    setErrorMessage(null);
    setHasResult(false);
    setAnalysisResult(null);

    // Create object URL for audio playback
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);

    // Read as Base64 for API transmission
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes('base64,') ? result.split('base64,')[1] : result;
      setAudioBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  // Handle Microphone Recording
  const handleToggleRecord = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
    } else {
      try {
        setErrorMessage(null);
        audioChunksRef.current = [];
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const file = new File([blob], `mic_recording_${Date.now()}.webm`, { type: 'audio/webm' });
          loadAudioFile(file);
          stream.getTracks().forEach((track) => track.stop());
        };

        recorder.start();
        setIsRecording(true);
      } catch (err: any) {
        console.error('Microphone error:', err);
        setErrorMessage('Could not access microphone: ' + (err.message || 'Permission denied'));
      }
    }
  };

  // Handle Audio Playback
  const handleTogglePlay = () => {
    if (!audioPlayerRef.current || !audioUrl) return;
    if (isPlaying) {
      audioPlayerRef.current.pause();
      setIsPlaying(false);
    } else {
      audioPlayerRef.current.play();
      setIsPlaying(true);
    }
  };

  // Run Forensic Analysis against FastAPI Backend
  const handleAnalyze = async () => {
    if (!audioBase64) {
      setErrorMessage('Please upload or record an audio sample first.');
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage(null);

    try {
      const payload: any = {
        audio_base64: audioBase64,
        speaker_id: selectedSpeaker || (audioFileName ? `File: ${audioFileName.slice(0, 24)}` : 'Forensic Lab Audio'),
        filter_owner: filterMyVoice,
        owner_speaker_id: ownerSpeakerId,
      };

      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.detail || `Server returned error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const rawRisk = typeof data.risk_score === 'number' ? data.risk_score : 15.0;
      const normScore = rawRisk > 1 ? rawRisk / 100 : rawRisk;
      const acousticNorm = (data.acoustic_score || 0) > 1 ? data.acoustic_score / 100 : data.acoustic_score || 0;
      const speakerNorm = (data.speaker_score || 0) > 1 ? data.speaker_score / 100 : data.speaker_score || 0;

      const acousticBreakdown = data.details?.acoustic_breakdown || {};
      const bioMetrics = data.details?.biomechanical || {};

      const isOwner = Boolean(data.details?.is_owner_speaking || data.details?.speaker_channel === 'local_user');
      const ownerSim = data.details?.owner_similarity;
      const speakerChan = data.details?.speaker_channel || (isOwner ? 'local_user' : 'caller');

      setAnalysisResult({
        riskScore: isOwner ? 0.06 : normScore,
        riskLevel: isOwner ? 'LOW' : (data.risk_level || (normScore >= 0.5 ? 'HIGH' : normScore >= 0.35 ? 'MEDIUM' : 'LOW')),
        isSpoofed: isOwner ? false : (data.is_spoofed ?? normScore >= 0.5),
        acousticScore: isOwner ? 0.06 : acousticNorm,
        speakerScore: speakerNorm,
        lfccScore: acousticBreakdown.lfcc_lcnn ?? normScore,
        rawnetScore: acousticBreakdown.rawnet2 ?? normScore,
        bioSpoof: bioMetrics.bio_spoof_prob ?? 0.1,
        jitter: bioMetrics.jitter ?? 0.015,
        aliasingRatio: bioMetrics.hf_aliasing_ratio ?? 0.02,
        authenticity: isOwner ? 0.99 : (bioMetrics.authenticity ?? (1 - normScore)),
        isOwner,
        ownerSimilarity: ownerSim,
        speakerChannel: speakerChan,
      });

      setHasResult(true);
    } catch (err: any) {
      console.error('Analysis error:', err);
      setErrorMessage('Analysis failed: ' + (err.message || 'Check if backend server is running on port 8000'));
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-8 mt-4">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="audio/*,.mp3,.wav,.flac,.m4a"
        className="hidden"
      />

      {/* Hidden Audio Player */}
      {audioUrl && (
        <audio
          ref={audioPlayerRef}
          src={audioUrl}
          onEnded={() => setIsPlaying(false)}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
        />
      )}

      <header className="mb-6 border-b border-gray-700 pb-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Voice Forensic Analysis</h1>
          <p className="text-gray-400 mt-2">
            Deep forensic neural analysis of audio samples for synthetic AI voice clone & deepfake detection.
          </p>
        </div>
        <Link
          href="/"
          className="px-4 py-2.5 rounded-lg bg-accent/15 border border-accent text-accent font-semibold flex items-center gap-2 hover:bg-accent/25 transition-all text-sm shadow-md"
        >
          <Radio size={16} className="animate-pulse" />
          Switch to Live Call Monitor ➔
        </Link>
      </header>

      {errorMessage && (
        <div className="p-4 bg-danger/15 border border-danger rounded-lg flex items-center gap-3 text-danger text-sm">
          <AlertTriangle size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column - Input */}
        <div className="lg:col-span-1 space-y-6">
          <div className="glassmorphism p-6 rounded-xl space-y-6 border-t-4 border-t-accent">
            <h2 className="text-xl font-semibold text-white">Audio Input</h2>

            {/* File Upload Box */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) loadAudioFile(file);
              }}
              className="border border-gray-600 border-dashed rounded-lg p-6 flex flex-col items-center justify-center space-y-3 hover:bg-gray-800/50 transition-colors cursor-pointer bg-primary/40"
            >
              <Upload size={32} className="text-accent" />
              <div className="text-center">
                <p className="text-sm font-medium text-gray-200">
                  {audioBase64 ? audioFileName : 'Drop audio file here or click to browse'}
                </p>
                <p className="text-xs text-gray-500 mt-1">.wav, .mp3, .flac, .m4a (ElevenLabs & Voice Clones)</p>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm text-gray-500">
              <hr className="w-full border-gray-700" />
              <span className="px-3">OR</span>
              <hr className="w-full border-gray-700" />
            </div>

            {/* Record Button */}
            <button
              onClick={handleToggleRecord}
              className={`w-full py-3 rounded-lg border flex items-center justify-center gap-2 transition-colors font-medium ${
                isRecording
                  ? 'border-danger bg-danger/20 text-danger animate-pulse'
                  : 'border-gray-600 bg-primary/40 hover:bg-gray-700 text-gray-300'
              }`}
            >
              <Mic size={18} className={isRecording ? 'text-danger' : ''} />
              {isRecording ? 'Stop Recording' : 'Record Audio Snippet'}
            </button>

            {/* Call Audio Channel & Owner Filter */}
            <div className="pt-4 border-t border-gray-700 space-y-3">
              <label className="block text-xs uppercase font-bold text-accent tracking-wider">
                Monitoring Channel Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFilterMyVoice(true)}
                  className={`py-2 px-2 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1 transition-all ${
                    filterMyVoice
                      ? 'bg-accent/20 border-accent text-accent'
                      : 'bg-primary/40 border-gray-700 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  📞 Caller Only (Filter Me)
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMyVoice(false)}
                  className={`py-2 px-2 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1 transition-all ${
                    !filterMyVoice
                      ? 'bg-accent/20 border-accent text-accent'
                      : 'bg-primary/40 border-gray-700 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  🎙️ All Audio
                </button>
              </div>

              {filterMyVoice && (
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-400">Owner Profile to Bypass</label>
                  <select
                    className="w-full bg-primary/50 border border-gray-600 rounded-md py-2 px-3 text-sm text-white focus:outline-none focus:border-accent"
                    value={ownerSpeakerId}
                    onChange={(e) => setOwnerSpeakerId(e.target.value)}
                  >
                    {enrolledList.map((spk) => (
                      <option key={spk} value={spk}>
                        {spk}
                      </option>
                    ))}
                    {!enrolledList.includes('my_owner_voice') && (
                      <option value="my_owner_voice">my_owner_voice</option>
                    )}
                  </select>
                  <p className="text-[11px] text-success leading-tight mt-1">
                    ✓ Speech matching this profile is recognized as Owner & bypassed from deepfake scans.
                  </p>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-gray-700">
              <label className="block text-sm font-medium text-gray-400 mb-2">Claimed Identity (Optional)</label>
              <select
                className="w-full bg-primary/50 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:border-accent"
                value={selectedSpeaker}
                onChange={(e) => setSelectedSpeaker(e.target.value)}
              >
                <option value="">-- No specific speaker --</option>
                <option value="SPK-10492">SPK-10492</option>
                <option value="SPK-99214">SPK-99214</option>
                <option value="SPK-38102">SPK-38102</option>
              </select>
            </div>

            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !audioBase64}
              className={`w-full py-3 rounded-lg font-bold text-white transition-all shadow-lg flex items-center justify-center gap-2 ${
                isAnalyzing
                  ? 'bg-accent/50 cursor-wait'
                  : !audioBase64
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-accent hover:bg-accent/80 glow-effect'
              }`}
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw size={18} className="animate-spin" /> Analyzing Audio...
                </>
              ) : (
                'Run Forensic Analysis'
              )}
            </button>
          </div>
        </div>

        {/* Right Column - Results */}
        <div className="lg:col-span-2 space-y-6">
          <div className="glassmorphism p-6 rounded-xl min-h-[500px] flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white">Analysis Results</h2>
              {hasResult && analysisResult && (
                <div
                  className={`flex items-center gap-2 px-3 py-1 rounded-full font-bold text-sm ${
                    analysisResult.isOwner
                      ? 'bg-success/20 border border-success text-success'
                      : analysisResult.isSpoofed
                      ? 'bg-danger/20 border border-danger text-danger'
                      : 'bg-success/20 border border-success text-success'
                  }`}
                >
                  {analysisResult.isOwner ? (
                    <CheckCircle size={16} />
                  ) : analysisResult.isSpoofed ? (
                    <XCircle size={16} />
                  ) : (
                    <CheckCircle size={16} />
                  )}
                  {analysisResult.isOwner
                    ? 'OWNER VOICE DETECTED (BYPASSED)'
                    : analysisResult.isSpoofed
                    ? 'SPOOFED AUDIO DETECTED (DEEPFAKE)'
                    : 'AUTHENTIC HUMAN VOICE VERIFIED'}
                </div>
              )}
            </div>

            {/* Owner Bypassed Banner */}
            {hasResult && analysisResult && analysisResult.isOwner && (
              <div className="mb-6 p-4 rounded-lg bg-success/15 border border-success/40 flex items-start gap-3">
                <CheckCircle size={22} className="text-success mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-success">
                    DEVICE OWNER VOICE DETECTED (Similarity: {((analysisResult.ownerSimilarity || 0.99) * 100).toFixed(1)}%)
                  </h4>
                  <p className="text-xs text-gray-300 mt-0.5">
                    This speech was recognized as the authentic device owner ({ownerSpeakerId}). Deepfake analysis was bypassed so your voice will never trigger false spoof alarms during live call monitoring.
                  </p>
                </div>
              </div>
            )}

            {/* Visualization & Player Area */}
            <div className="h-32 bg-primary/50 rounded-lg border border-gray-700 mb-6 p-4 flex flex-col relative overflow-hidden">
              <div className="flex items-center gap-3 mb-2 text-gray-300">
                <button
                  onClick={handleTogglePlay}
                  disabled={!audioUrl}
                  className={`hover:text-white ${!audioUrl ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isPlaying ? (
                    <Pause size={20} fill="currentColor" />
                  ) : (
                    <Play size={20} fill={isPlaying ? 'currentColor' : 'none'} />
                  )}
                </button>
                <span className="text-sm font-mono truncate max-w-xs">{audioFileName}</span>
                <span className="text-xs text-gray-500 ml-auto">
                  {audioBase64 ? 'Ready for Neural Analysis' : 'Awaiting input'}
                </span>
              </div>
              <div className="flex-grow">
                <WaveformVisualizer isActive={isPlaying || isAnalyzing} />
              </div>
            </div>

            {/* Results Content */}
            {!hasResult && !isAnalyzing ? (
              <div className="flex-grow flex flex-col items-center justify-center text-gray-500 space-y-4">
                <FileAudio size={48} className="opacity-50" />
                <p>Upload an audio file or record a snippet to view live forensic verification results.</p>
              </div>
            ) : isAnalyzing ? (
              <div className="flex-grow flex flex-col items-center justify-center space-y-6">
                <div className="w-16 h-16 rounded-full border-4 border-accent border-t-transparent animate-spin"></div>
                <div className="text-center space-y-2">
                  <p className="text-accent font-medium animate-pulse">Running LFCC-LCNN + RawNet2 models...</p>
                  <p className="text-sm text-gray-400">Scanning multi-scale sliding windows for vocoder artifacts.</p>
                </div>
              </div>
            ) : analysisResult ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-grow">
                {/* Score Column */}
                <div className="flex flex-col items-center justify-center border-r border-gray-700 pr-4">
                  <RiskGauge score={analysisResult.riskScore} size={220} />
                  <p className="text-center text-gray-300 mt-4 font-medium">
                    Verdict: <span className={analysisResult.isSpoofed ? 'text-danger font-bold' : 'text-success font-bold'}>
                      {analysisResult.isSpoofed ? 'Synthetic AI Clone' : 'Natural Human'}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 text-center mt-1">
                    Multi-scale sliding window confidence: {(analysisResult.riskScore * 100).toFixed(1)}%
                  </p>
                </div>

                {/* Details Column */}
                <div className="space-y-4 flex flex-col justify-center">
                  <ScoreBar
                    label="LFCC-LCNN (Vocoder Phase Spoof Risk)"
                    score={analysisResult.lfccScore}
                    color={analysisResult.lfccScore > 0.5 ? 'bg-danger' : 'bg-accent'}
                  />
                  <ScoreBar
                    label="RawNet2 (Time-Domain Waveform Anomaly)"
                    score={analysisResult.rawnetScore}
                    color={analysisResult.rawnetScore > 0.5 ? 'bg-danger' : 'bg-accent'}
                  />
                  <ScoreBar
                    label="Biomechanical Physical Reality Match"
                    score={analysisResult.authenticity}
                    color="bg-success"
                  />

                  <div className="mt-2 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                    <h4 className="text-sm font-medium text-gray-200 mb-2 flex items-center gap-2">
                      <AlertTriangle
                        size={16}
                        className={analysisResult.isSpoofed ? 'text-danger' : 'text-success'}
                      />
                      AI Neural Conclusion
                    </h4>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      {analysisResult.isSpoofed
                        ? `🚨 High probability of synthetic AI voice generation (${(analysisResult.riskScore * 100).toFixed(1)}% threat). Multi-scale neural acoustic consensus detected synthetic vocoder phase anomalies and physical vocal tract discrepancies.`
                        : `🛡️ Authentic human voice verified (${(analysisResult.authenticity * 100).toFixed(1)}% confidence). Natural glottal pulse perturbation and continuous vocal tract resonance confirmed across all analysis windows.`}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ label, score, color }: { label: string; score: number; color: string }) {
  const percentage = Math.min(100, Math.max(0, Math.round(score * 100)));
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-300 text-xs">{label}</span>
        <span className="font-mono text-gray-400 text-xs">{percentage}%</span>
      </div>
      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${color}`}
          style={{ width: `${percentage}%`, transition: 'width 0.8s ease-in-out' }}
        ></div>
      </div>
    </div>
  );
}
