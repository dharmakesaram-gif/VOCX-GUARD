'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Phone, ShieldAlert, Check, X, Clock, Mic, MicOff, Volume2, ShieldCheck, RefreshCw, Radio } from 'lucide-react';
import { API_BASE } from '../lib/config';
import WaveformVisualizer from './WaveformVisualizer';
import AlertBanner from './AlertBanner';

interface ChunkLogItem {
  id: string;
  time: string;
  chunkNum: number;
  db: number;
  score: number;
  channel: 'YOU (OWNER)' | 'CALLER';
  verdict: 'GENUINE' | 'SUSPICIOUS' | 'SPOOFED';
  latencyMs: number;
}

export default function CallMonitor() {
  const [isLive, setIsLive] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [riskScore, setRiskScore] = useState(0.09);
  const [timeline, setTimeline] = useState<number[]>(Array(30).fill(0.08));
  const [showAlert, setShowAlert] = useState(false);
  const [hasDetectedSpoof, setHasDetectedSpoof] = useState(false);
  const [latchedPeakScore, setLatchedPeakScore] = useState(0);
  const [activeChannel, setActiveChannel] = useState<'YOU (OWNER)' | 'CALLER' | 'IDLE'>('IDLE');
  const [filterMyVoice, setFilterMyVoice] = useState(true);
  const [ownerSpeakerId, setOwnerSpeakerId] = useState('my_owner_voice');
  const [enrolledList, setEnrolledList] = useState<string[]>(['my_owner_voice']);
  const [liveDb, setLiveDb] = useState(-60);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [latencyMs, setLatencyMs] = useState(18);
  const [chunkCount, setChunkCount] = useState(0);
  const [chunkLogs, setChunkLogs] = useState<ChunkLogItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isLiveRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cycleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSpoofedRef = useRef(false);
  const peakScoreRef = useRef(0);
  const chunkIndexRef = useRef(0);
  const maxDbInChunkRef = useRef(-90);

  useEffect(() => {
    fetch(`${API_BASE}/api/enrolled-speakers`)
      .then((res) => res.json())
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
      stopLiveMonitoring();
    };
  }, []);

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const startLiveMonitoring = async () => {
    try {
      setErrorMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Web Audio API for continuous dB metering & VAD
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateMeter = () => {
        if (!isLiveRef.current) return;
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length) / 255;
        const db = Math.round(20 * Math.log10(Math.max(rms, 1e-4)));
        const clampedDb = Math.max(-80, Math.min(0, db));
        setLiveDb(clampedDb);

        if (clampedDb > maxDbInChunkRef.current) {
          maxDbInChunkRef.current = clampedDb;
        }

        const voiceDetected = clampedDb > -44;
        setIsSpeaking(voiceDetected);

        rafRef.current = requestAnimationFrame(updateMeter);
      };

      isLiveRef.current = true;
      setIsLive(true);
      setCallDuration(0);
      setChunkCount(0);
      chunkIndexRef.current = 0;
      hasSpoofedRef.current = false;
      peakScoreRef.current = 0;
      setHasDetectedSpoof(false);
      setLatchedPeakScore(0);
      setShowAlert(false);

      timerRef.current = setInterval(() => {
        setCallDuration((d) => d + 1);
      }, 1000);

      rafRef.current = requestAnimationFrame(updateMeter);

      // Start the 2-second rolling chunk loop
      runChunkLoop(stream);
    } catch (err: any) {
      console.error('Failed to start live monitor:', err);
      setErrorMessage('Microphone access denied: ' + (err.message || 'Check browser permissions.'));
      stopLiveMonitoring();
    }
  };

  const stopLiveMonitoring = () => {
    isLiveRef.current = false;
    setIsLive(false);
    setIsSpeaking(false);
    setLiveDb(-60);
    setActiveChannel('IDLE');

    if (timerRef.current) clearInterval(timerRef.current);
    if (cycleTimeoutRef.current) clearTimeout(cycleTimeoutRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  };

  const runChunkLoop = (stream: MediaStream) => {
    if (!isLiveRef.current) return;

    maxDbInChunkRef.current = -90;
    chunkIndexRef.current += 1;
    const currentChunkNum = chunkIndexRef.current;
    setChunkCount(currentChunkNum);

    const chunkBlobs: Blob[] = [];
    const recorder = new MediaRecorder(stream);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunkBlobs.push(e.data);
    };

    recorder.onstop = async () => {
      if (!isLiveRef.current) return;

      const blob = new Blob(chunkBlobs, { type: 'audio/webm' });
      const peakDb = maxDbInChunkRef.current;
      const hadSpeech = peakDb > -44;

      const reader = new FileReader();
      reader.onload = async () => {
        if (!isLiveRef.current) return;
        const res = reader.result as string;
        const base64 = res.includes('base64,') ? res.split('base64,')[1] : res;

        const startTime = Date.now();
        try {
          const apiRes = await fetch(`${API_BASE}/api/analyze`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Bypass-Tunnel-Reminder': 'true',
            },
            body: JSON.stringify({
              audio_base64: base64,
              filter_owner: filterMyVoice,
              owner_speaker_id: ownerSpeakerId,
            }),
          });

          if (apiRes.ok) {
            const data = await apiRes.json();
            const latency = Date.now() - startTime;
            setLatencyMs(latency);

            const isOwner = Boolean(
              data.details?.is_owner_speaking || data.details?.speaker_channel === 'local_user'
            );

            let score = typeof data.risk_score === 'number' ? data.risk_score : 10;
            score = score > 1 ? score / 100 : score;

            if (filterMyVoice && isOwner) {
              setActiveChannel('YOU (OWNER)');
              const safeScore = hasSpoofedRef.current ? peakScoreRef.current : 0.06;
              setRiskScore(safeScore);
              setTimeline((t) => [...t.slice(1), safeScore]);

              const timeStr = new Date().toLocaleTimeString();
              setChunkLogs((prev) => [
                {
                  id: `chk_${Date.now()}`,
                  time: timeStr,
                  chunkNum: currentChunkNum,
                  db: peakDb,
                  score: safeScore,
                  channel: 'YOU (OWNER)',
                  verdict: 'GENUINE',
                  latencyMs: latency,
                },
                ...prev.slice(0, 7),
              ]);
            } else {
              if (hadSpeech) {
                setActiveChannel('CALLER');
              } else {
                setActiveChannel('IDLE');
              }

              const isSpoofed = data.is_spoofed || score >= 0.5;
              if (isSpoofed) {
                hasSpoofedRef.current = true;
                peakScoreRef.current = Math.max(peakScoreRef.current, score);
                setHasDetectedSpoof(true);
                setLatchedPeakScore(peakScoreRef.current);
                setShowAlert(true);
              }

              const reportedScore = hasSpoofedRef.current ? Math.max(peakScoreRef.current, score) : score;
              setRiskScore(reportedScore);
              setTimeline((t) => [...t.slice(1), reportedScore]);

              const timeStr = new Date().toLocaleTimeString();
              setChunkLogs((prev) => [
                {
                  id: `chk_${Date.now()}`,
                  time: timeStr,
                  chunkNum: currentChunkNum,
                  db: peakDb,
                  score: reportedScore,
                  channel: 'CALLER',
                  verdict: isSpoofed || hasSpoofedRef.current ? 'SPOOFED' : score >= 0.35 ? 'SUSPICIOUS' : 'GENUINE',
                  latencyMs: latency,
                },
                ...prev.slice(0, 7),
              ]);
            }
          }
        } catch (e) {
          console.warn('Chunk eval error:', e);
        }
      };
      reader.readAsDataURL(blob);

      // Trigger next cycle
      if (isLiveRef.current) {
        cycleTimeoutRef.current = setTimeout(() => {
          runChunkLoop(stream);
        }, 50);
      }
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    }, 2000);
  };

  const handleDismissAlert = () => {
    hasSpoofedRef.current = false;
    peakScoreRef.current = 0;
    setHasDetectedSpoof(false);
    setLatchedPeakScore(0);
    setShowAlert(false);
    setRiskScore(0.08);
  };

  const riskLevel = riskScore >= 0.5 ? 'high' : riskScore >= 0.35 ? 'medium' : 'low';
  const borderColor = riskLevel === 'high' ? 'border-danger' : riskLevel === 'medium' ? 'border-warning' : 'border-accent';
  const glowClass = riskLevel === 'high' ? 'glow-effect-danger' : '';

  return (
    <div className={`glassmorphism rounded-xl border-t-4 flex flex-col overflow-hidden transition-colors duration-500 ${borderColor} ${glowClass}`}>
      <AlertBanner
        message={
          hasDetectedSpoof
            ? 'CRITICAL ALERT: Synthetic AI voice clone intercepted on active audio stream!'
            : 'CRITICAL: High probability of synthetic voice detected on active call.'
        }
        isVisible={showAlert || (isLive && hasDetectedSpoof)}
        onDismiss={handleDismissAlert}
      />

      <div className="p-6 space-y-6">
        {/* Header Bar */}
        <div className="flex flex-wrap justify-between items-start gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${isLive ? 'bg-danger animate-ping' : 'bg-gray-600'}`}></span>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Radio size={20} className={isLive ? 'text-accent animate-pulse' : 'text-gray-400'} />
                {isLive ? 'Live Microphone & Call Stream' : 'Live Call Monitor Standby'}
              </h2>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-400 font-mono">
              <span className="flex items-center gap-1 text-gray-300">
                <Clock size={14} className="text-accent" /> {formatDuration(callDuration)}
              </span>
              <span>Buffer: 2.0s</span>
              <span>Chunk: #{chunkCount}</span>
              {isLive && (
                <span className="text-accent bg-accent/10 px-2 py-0.5 rounded text-xs border border-accent/30">
                  {latencyMs}ms inference
                </span>
              )}
            </div>
          </div>

          <div className="text-right">
            <div
              className={`text-3xl font-mono font-extrabold ${
                riskLevel === 'high' ? 'text-danger' : riskLevel === 'medium' ? 'text-warning' : 'text-success'
              }`}
            >
              {(riskScore * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
              {riskLevel === 'high'
                ? 'AI Spoof Detected'
                : riskLevel === 'medium'
                ? 'Suspicious Risk'
                : 'Verified Authentic'}
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 bg-danger/20 border border-danger rounded-lg text-danger text-xs flex items-center gap-2">
            <ShieldAlert size={16} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Audio Channel Mode & Voice Filter Selector */}
        <div className="bg-primary/40 border border-gray-700/80 rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-accent tracking-wider">
              <Phone size={14} /> Call Audio Routing & Filter
            </div>
            {isLive && (
              <div
                className={`text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 ${
                  activeChannel === 'YOU (OWNER)'
                    ? 'bg-success/20 text-success border border-success/40'
                    : activeChannel === 'CALLER'
                    ? 'bg-accent/20 text-accent border border-accent/40'
                    : 'bg-gray-800 text-gray-400'
                }`}
              >
                {activeChannel === 'YOU (OWNER)' && <ShieldCheck size={14} />}
                {activeChannel === 'CALLER' && <Phone size={14} />}
                {activeChannel === 'YOU (OWNER)'
                  ? 'YOU ARE SPEAKING (Scan Bypassed)'
                  : activeChannel === 'CALLER'
                  ? 'INCOMING CALLER (Scanning Clones)'
                  : 'LISTENING...'}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg overflow-hidden border border-gray-700">
              <button
                type="button"
                onClick={() => setFilterMyVoice(true)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  filterMyVoice ? 'bg-accent text-black font-bold' : 'bg-primary/70 text-gray-400 hover:text-white'
                }`}
              >
                📞 Incoming Caller (Filter My Voice)
              </button>
              <button
                type="button"
                onClick={() => setFilterMyVoice(false)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  !filterMyVoice ? 'bg-accent text-black font-bold' : 'bg-primary/70 text-gray-400 hover:text-gray-200'
                }`}
              >
                🎙️ All Audio
              </button>
            </div>

            {filterMyVoice && (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>Owner Profile:</span>
                <select
                  value={ownerSpeakerId}
                  onChange={(e) => setOwnerSpeakerId(e.target.value)}
                  className="bg-primary border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
                >
                  {enrolledList.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                  {!enrolledList.includes('my_owner_voice') && (
                    <option value="my_owner_voice">my_owner_voice</option>
                  )}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Live dB Volume & VAD Meter */}
        <div className="bg-primary/30 border border-gray-700/60 rounded-lg p-3 space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="flex items-center gap-1.5 text-gray-300 font-semibold">
              <Volume2 size={14} className={isSpeaking ? 'text-success animate-pulse' : 'text-gray-500'} />
              {isSpeaking ? 'VOICE SPEECH DETECTED' : isLive ? 'ROOM AMBIENT' : 'MICROPHONE OFFLINE'}
            </span>
            <span className="font-mono text-gray-400">{isLive ? `${liveDb} dB` : '-- dB'}</span>
          </div>
          <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-75 ${
                liveDb > -25 ? 'bg-danger' : liveDb > -44 ? 'bg-success' : 'bg-accent'
              }`}
              style={{ width: `${isLive ? Math.max(3, Math.min(100, ((liveDb + 80) / 80) * 100)) : 0}%` }}
            ></div>
          </div>
        </div>

        {/* Animated Waveform Visualizer */}
        <div className="h-24 bg-primary/50 rounded-lg border border-gray-700 p-4 relative overflow-hidden">
          <WaveformVisualizer isActive={isLive && isSpeaking} />
          {!isLive && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm text-gray-400 text-xs font-mono">
              Click &quot;Start Live Call Monitor&quot; below to stream real audio
            </div>
          )}
        </div>

        {/* Risk Timeline */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <h3 className="text-xs font-bold uppercase text-gray-400 tracking-wider">Live Risk Timeline</h3>
            <span className="text-[11px] text-gray-500 font-mono">Rolling 30 intervals</span>
          </div>
          <div className="flex items-end gap-1 h-10 bg-primary/20 p-1 rounded border border-gray-800">
            {timeline.map((val, idx) => {
              const bg = val >= 0.5 ? 'bg-danger' : val >= 0.35 ? 'bg-warning' : 'bg-success';
              return (
                <div
                  key={idx}
                  className={`flex-1 rounded-t-sm transition-all duration-300 ${bg}`}
                  style={{ height: `${Math.max(8, val * 100)}%`, opacity: 0.3 + (idx / timeline.length) * 0.7 }}
                ></div>
              );
            })}
          </div>
        </div>

        {/* Live Rolling Chunk Logs */}
        {isLive && chunkLogs.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-gray-800">
            <h4 className="text-xs font-bold text-gray-400 tracking-wider uppercase">Live Chunk Audit Feed</h4>
            <div className="space-y-1.5 max-h-36 overflow-y-auto font-mono text-xs">
              {chunkLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between p-2 rounded bg-primary/40 border border-gray-800 hover:bg-primary/60 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">[{log.time}]</span>
                    <span className="text-gray-400">#{log.chunkNum}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        log.channel === 'YOU (OWNER)'
                          ? 'bg-success/20 text-success border border-success/30'
                          : 'bg-accent/20 text-accent border border-accent/30'
                      }`}
                    >
                      {log.channel === 'YOU (OWNER)' ? 'YOU' : 'CALLER'}
                    </span>
                    <span className="text-gray-400">{log.db}dB</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`font-bold ${
                        log.verdict === 'SPOOFED'
                          ? 'text-danger'
                          : log.verdict === 'SUSPICIOUS'
                          ? 'text-warning'
                          : 'text-success'
                      }`}
                    >
                      {log.verdict === 'SPOOFED'
                        ? `${(log.score * 100).toFixed(0)}% AI CLONE`
                        : `${((1 - log.score) * 100).toFixed(0)}% AUTHENTIC`}
                    </span>
                    <span className="text-gray-500 text-[10px]">{log.latencyMs}ms</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Controls */}
        <div className="pt-2 flex flex-wrap gap-3">
          <button
            onClick={isLive ? stopLiveMonitoring : startLiveMonitoring}
            className={`flex-1 py-3 px-4 rounded-lg font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${
              isLive
                ? 'bg-danger hover:bg-danger/80 text-white animate-pulse'
                : 'bg-accent hover:bg-accent/80 text-black glow-effect'
            }`}
          >
            {isLive ? (
              <>
                <MicOff size={18} /> STOP LIVE MONITOR
              </>
            ) : (
              <>
                <Mic size={18} /> START LIVE CALL MONITOR
              </>
            )}
          </button>

          {hasDetectedSpoof && (
            <button
              onClick={handleDismissAlert}
              className="py-3 px-4 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw size={14} /> Dismiss Alert
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
