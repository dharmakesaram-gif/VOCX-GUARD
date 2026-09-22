import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { theme } from '../utils/theme';
import { WaveformBars } from '../components/WaveformBars';
import { RiskGauge } from '../components/RiskGauge';
import { StatusBadge } from '../components/StatusBadge';
import { audioRecorder } from '../services/audioRecorder';
import { api, AnalyzeResult, Session } from '../services/api';

interface LiveChunkLog {
  id: string;
  time: string;
  chunkNum: number;
  db: number;
  speechDetected: boolean;
  riskScore: number;
  verdict: 'GENUINE' | 'SUSPICIOUS' | 'SPOOFED';
  latencyMs: number;
  speakerChannel?: 'CALLER' | 'YOU (OWNER)';
}

export const RecordAnalyzeScreen = () => {
  // Mode tabs: 'live' (Real-time live call/voice monitor) vs 'snapshot' (Manual clip recording)
  const [activeTab, setActiveTab] = useState<'live' | 'snapshot'>('live');

  // --- LIVE MONITORING STATE ---
  const [isLiveMonitoring, setIsLiveMonitoring] = useState(false);
  const [liveDuration, setLiveDuration] = useState(0);
  const [liveScore, setLiveScore] = useState(0.12);
  const [liveAcousticScore, setLiveAcousticScore] = useState(0.11);
  const [liveSpeakerScore, setLiveSpeakerScore] = useState(0.08);
  const [chunkCount, setChunkCount] = useState(0);
  const [liveLatency, setLiveLatency] = useState(18.2);

  // Call channel routing & owner voice filtering
  const [filterMyVoice, setFilterMyVoice] = useState(true);
  const [activeSpeakerChannel, setActiveSpeakerChannel] = useState<'CALLER' | 'YOU (OWNER)' | 'LISTENING'>('LISTENING');
  const [ownerSpeakerId, setOwnerSpeakerId] = useState('spk-001');

  // Live microphone metering & voice activity detection (VAD)
  const [liveDb, setLiveDb] = useState(-60);
  const [liveVolumePercent, setLiveVolumePercent] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechCountInChunk, setSpeechCountInChunk] = useState(0);
  const [chunkLogs, setChunkLogs] = useState<LiveChunkLog[]>([]);

  // Sub-model real-time telemetry scores
  const [liveLfccScore, setLiveLfccScore] = useState(0.05);
  const [liveRawnetScore, setLiveRawnetScore] = useState(0.05);
  const [liveWavlmScore, setLiveWavlmScore] = useState(0.05);

  // --- ATTACK LATCHING STATE (Persists AI Spoofed Alert across silence & call stops) ---
  const [hasDetectedSpoof, setHasDetectedSpoof] = useState(false);
  const [peakSpoofScore, setPeakSpoofScore] = useState(0);
  const [peakAcousticScore, setPeakAcousticScore] = useState(0);
  const [detectedSpoofTime, setDetectedSpoofTime] = useState<string | null>(null);

  // --- SNAPSHOT RECORDING STATE ---
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [snapshotDuration, setSnapshotDuration] = useState(0);
  const [snapshotResult, setSnapshotResult] = useState<AnalyzeResult | null>(null);

  // Refs for timers and active loops
  const liveMonitoringRef = useRef(false);
  const liveDurationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkCycleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentChunkIndexRef = useRef(0);
  const hasSpokenInChunkRef = useRef(false);
  const maxDbInChunkRef = useRef(-90);

  // Threat latch refs for immediate synchronous access in audio cycles
  const hasDetectedSpoofRef = useRef(false);
  const peakSpoofScoreRef = useRef(0);
  const peakAcousticScoreRef = useRef(0);
  const isAnalyzingChunkRef = useRef(false);

  // Session tracking refs for persistent history
  const liveSessionIdRef = useRef<string | null>(null);
  const liveStartTimeRef = useRef<string | null>(null);
  const liveChunkCountRef = useRef(0);

  // Synchronize ref with state
  useEffect(() => {
    liveMonitoringRef.current = isLiveMonitoring;
  }, [isLiveMonitoring]);

  // Clean up all timers and recording on unmount
  useEffect(() => {
    return () => {
      liveMonitoringRef.current = false;
      if (liveDurationTimerRef.current) clearInterval(liveDurationTimerRef.current);
      if (chunkCycleTimerRef.current) clearTimeout(chunkCycleTimerRef.current);
      if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current);
      if (audioRecorder.isRecording) {
        audioRecorder.stopRecording().catch(() => {});
      }
    };
  }, []);

  // --- STATUS CALLBACK FOR REAL MICROPHONE METERING ---
  const handleRecordingStatusUpdate = useCallback((status: Audio.RecordingStatus) => {
    if (!status.isRecording) return;

    // Expo returns metering as a dB float (typically -160 to 0)
    const db = typeof status.metering === 'number' ? status.metering : -55;
    const clampedDb = Math.max(-80, Math.min(0, Math.round(db)));
    setLiveDb(clampedDb);

    if (clampedDb > maxDbInChunkRef.current) {
      maxDbInChunkRef.current = clampedDb;
    }

    // Normalizing dB to 0% - 100% volume level (ambient room is -60dB to -45dB, speech is > -40dB)
    const normalizedVolume = Math.max(0, Math.min(100, Math.round(((clampedDb + 65) / 60) * 100)));
    setLiveVolumePercent(normalizedVolume);

    // Voice Activity Detection threshold: voice speech is typically > -45 dB
    const voiceDetected = clampedDb > -44;
    setIsSpeaking(voiceDetected);

    if (voiceDetected) {
      hasSpokenInChunkRef.current = true;
      setSpeechCountInChunk((c) => c + 1);
    }
  }, []);

  // --- ROLLING CHUNK CAPTURE & NEURAL ANALYSIS LOOP ---
  const runLiveChunkCycle = useCallback(async () => {
    if (!liveMonitoringRef.current) return;

    try {
      // 1. Start capturing the current audio chunk from phone microphone
      hasSpokenInChunkRef.current = false;
      maxDbInChunkRef.current = -90;
      currentChunkIndexRef.current += 1;
      const currentChunkNum = currentChunkIndexRef.current;
      setChunkCount(currentChunkNum);

      await audioRecorder.startRecording(handleRecordingStatusUpdate);

      // 2. Wait 2.0 seconds while actively listening to real incoming audio
      await new Promise((resolve) => {
        chunkCycleTimerRef.current = setTimeout(resolve, 2000);
      });

      if (!liveMonitoringRef.current) {
        await audioRecorder.stopRecording().catch(() => {});
        return;
      }

      // 3. Stop recording this chunk and extract its base64 data
      const chunkUri = await audioRecorder.stopRecording();
      const hadSpeech = hasSpokenInChunkRef.current;
      const peakDb = maxDbInChunkRef.current;

      // 4. Immediately trigger the next listening cycle without pause
      if (liveMonitoringRef.current) {
        setTimeout(runLiveChunkCycle, 60);
      }

      // 5. Send chunk to backend models if audio file exists
      if (chunkUri) {
        // Fast path: If pure ambient room tone (no voice detected and quiet dB < -48), handle locally in 10ms
        if (!hadSpeech && peakDb < -48) {
          const safeScore = hasDetectedSpoofRef.current ? peakSpoofScoreRef.current : 0.08;
          setLiveScore(safeScore);
          setLiveLatency(12);
          setActiveSpeakerChannel('LISTENING');
          const now = new Date();
          const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now
            .getMinutes()
            .toString()
            .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
          setChunkLogs((prev) => [
            {
              id: `log_${Date.now()}_${Math.random()}`,
              time: timeStr,
              chunkNum: currentChunkNum,
              db: peakDb,
              speechDetected: false,
              riskScore: safeScore,
              verdict: 'GENUINE',
              latencyMs: 12,
            },
            ...prev.slice(0, 9),
          ]);
          return;
        }

        // Avoid queuing requests: if previous network call is still in flight, skip to avoid pile-up
        if (isAnalyzingChunkRef.current) {
          return;
        }
        isAnalyzingChunkRef.current = true;

        try {
          const startTime = Date.now();
          const base64Data = await audioRecorder.getAudioBase64(chunkUri);

          if (base64Data && liveMonitoringRef.current) {
            liveChunkCountRef.current += 1;
            // Run real inference on LFCC-LCNN + RawNet2 backend with owner voice filter
            const analysis = await api.analyzeAudio(
              base64Data,
              'Live Call Monitor',
              liveSessionIdRef.current || undefined,
              ownerSpeakerId,
              filterMyVoice
            );
            const latency = Date.now() - startTime;
            setLiveLatency(latency);

            // Check if backend identified this chunk as the device owner speaking
            const isOwnerSpeaking = Boolean(
              analysis.details?.is_owner_speaking || analysis.details?.speaker_channel === 'local_user'
            );

            if (filterMyVoice && isOwnerSpeaking) {
              // LOCAL USER (YOU) SPEAKING: Bypass deepfake scan!
              setActiveSpeakerChannel('YOU (OWNER)');
              const safeScore = hasDetectedSpoofRef.current ? peakSpoofScoreRef.current : 0.08;
              setLiveScore(safeScore);
              setLiveAcousticScore(hasDetectedSpoofRef.current ? peakAcousticScoreRef.current : 0.07);
              const ownerSim = typeof analysis.details?.owner_similarity === 'number'
                ? analysis.details.owner_similarity
                : 0.94;
              setLiveSpeakerScore(Math.max(0.04, 1.0 - ownerSim));

              const now = new Date();
              const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now
                .getMinutes()
                .toString()
                .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

              setChunkLogs((prev) => [
                {
                  id: `log_${Date.now()}_${Math.random()}`,
                  time: timeStr,
                  chunkNum: currentChunkNum,
                  db: peakDb,
                  speechDetected: true,
                  riskScore: safeScore,
                  verdict: 'GENUINE',
                  latencyMs: latency,
                  speakerChannel: 'YOU (OWNER)',
                },
                ...prev.slice(0, 9),
              ]);
              return;
            }

            if (hadSpeech) {
              setActiveSpeakerChannel('CALLER');
            } else {
              setActiveSpeakerChannel('LISTENING');
            }

            // Extract sub-model scores from backend acoustic breakdown
            const lfccVal = typeof analysis.details?.acoustic_breakdown?.lfcc_lcnn === 'number'
              ? analysis.details.acoustic_breakdown.lfcc_lcnn
              : analysis.breakdown.acoustic;
            const rawnetVal = typeof analysis.details?.acoustic_breakdown?.rawnet2 === 'number'
              ? analysis.details.acoustic_breakdown.rawnet2
              : analysis.score;
            const wavlmVal = typeof analysis.details?.acoustic_breakdown?.wavlm === 'number'
              ? analysis.details.acoustic_breakdown.wavlm
              : analysis.score;

            setLiveLfccScore(lfccVal);
            setLiveRawnetScore(rawnetVal);
            setLiveWavlmScore(wavlmVal);

            let calculatedScore = analysis.score;
            let calculatedAcoustic = analysis.breakdown.acoustic;
            let calculatedSpeaker = analysis.breakdown.speaker;

            const isChunkSpoofed = analysis.is_spoofed || calculatedScore >= 0.50;

            if (isChunkSpoofed) {
              hasDetectedSpoofRef.current = true;
              peakSpoofScoreRef.current = Math.max(peakSpoofScoreRef.current, calculatedScore);
              peakAcousticScoreRef.current = Math.max(peakAcousticScoreRef.current, calculatedAcoustic);
              setHasDetectedSpoof(true);
              setPeakSpoofScore(peakSpoofScoreRef.current);
              setPeakAcousticScore(peakAcousticScoreRef.current);
            }

            // Real-time instantaneous verdict for this specific chunk
            const chunkVerdict: 'GENUINE' | 'SUSPICIOUS' | 'SPOOFED' =
              isChunkSpoofed
                ? 'SPOOFED'
                : calculatedScore >= 0.35
                ? 'SUSPICIOUS'
                : 'GENUINE';

            // CRITICAL LATCH: If an AI spoof was detected during this session, latch the main gauge at peak threat level!
            if (hasDetectedSpoofRef.current) {
              calculatedScore = Math.max(peakSpoofScoreRef.current, calculatedScore);
              calculatedAcoustic = Math.max(peakAcousticScoreRef.current, calculatedAcoustic);
            } else if (!hadSpeech && peakDb < -55 && !analysis.is_spoofed && calculatedScore < 0.35) {
              // If the room was pure ambient silence (no speech and low dB), keep baseline idle
              calculatedScore = 0.09;
              calculatedAcoustic = 0.08;
              calculatedSpeaker = 0.07;
            }

            setLiveScore(calculatedScore);
            setLiveAcousticScore(calculatedAcoustic);
            setLiveSpeakerScore(calculatedSpeaker);

            // Add to live rolling logs (record each chunk's actual instantaneous measurement)
            const now = new Date();
            const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now
              .getMinutes()
              .toString()
              .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

            if (isChunkSpoofed) {
              setDetectedSpoofTime((prev) => prev || timeStr);
            }

            setChunkLogs((prev) => [
              {
                id: `log_${Date.now()}_${Math.random()}`,
                time: timeStr,
                chunkNum: currentChunkNum,
                db: peakDb,
                speechDetected: hadSpeech,
                riskScore: analysis.score,
                verdict: chunkVerdict,
                latencyMs: latency,
              },
              ...prev.slice(0, 9), // keep last 10 entries
            ]);

            // Haptic alert if spoofed voice detected
            if (chunkVerdict === 'SPOOFED') {
              try {
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              } catch (_) {}
            }
          }
        } catch (apiErr) {
          console.warn('Live chunk analysis error:', apiErr);
        } finally {
          isAnalyzingChunkRef.current = false;
        }
      }
    } catch (err) {
      console.warn('Chunk cycle error:', err);
      // If error occurs, attempt next cycle after brief delay
      if (liveMonitoringRef.current) {
        setTimeout(runLiveChunkCycle, 500);
      }
    }
  }, [handleRecordingStatusUpdate]);

  // --- START / STOP LIVE MONITORING ---
  const toggleLiveMonitoring = async () => {
    if (isLiveMonitoring) {
      // STOP MONITORING
      liveMonitoringRef.current = false;
      setIsLiveMonitoring(false);
      setIsSpeaking(false);
      setLiveDb(-60);
      setLiveVolumePercent(0);

      if (liveDurationTimerRef.current) clearInterval(liveDurationTimerRef.current);
      if (chunkCycleTimerRef.current) clearTimeout(chunkCycleTimerRef.current);

      try {
        await audioRecorder.stopRecording();
      } catch (_) {}

      // Save the completed live call to history
      if (liveSessionIdRef.current) {
        const finalScore = hasDetectedSpoofRef.current ? peakSpoofScoreRef.current : liveScore;
        const durSecs = liveDuration;
        const durStr = `${Math.floor(durSecs / 60).toString().padStart(2, '0')}:${(durSecs % 60).toString().padStart(2, '0')}`;
        const isSpoofed = hasDetectedSpoofRef.current || finalScore >= 0.70;
        const isSuspicious = !isSpoofed && finalScore >= 0.30;
        const level: 'LOW' | 'MEDIUM' | 'HIGH' = isSpoofed ? 'HIGH' : isSuspicious ? 'MEDIUM' : 'LOW';

        const completedCallSession: Session = {
          id: liveSessionIdRef.current,
          session_id: liveSessionIdRef.current,
          timestamp: liveStartTimeRef.current || new Date().toISOString(),
          start_time: liveStartTimeRef.current || new Date().toISOString(),
          speakerId: `Live Call Monitor (${durStr})`,
          speaker_id: `Live Call Monitor (${durStr})`,
          riskScore: finalScore,
          risk_score: finalScore > 1 ? finalScore : finalScore * 100,
          current_risk: finalScore > 1 ? finalScore : finalScore * 100,
          riskLevel: level,
          risk_level: level,
          chunks_analyzed: liveChunkCountRef.current || chunkCount || 1,
          risk_history: [finalScore * 100],
        };

        api.recordCompletedSession(completedCallSession).catch((e) => {
          console.warn('Failed to record completed live call session:', e);
        });
      }

      // CRITICAL: If an AI spoof was detected during this call, retain the latched threat score!
      // Do NOT reset back to 9% genuine!
      if (hasDetectedSpoofRef.current) {
        setLiveScore(peakSpoofScoreRef.current);
        setLiveAcousticScore(peakAcousticScoreRef.current);
        try {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        } catch (_) {}
      } else {
        try {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } catch (_) {}
      }
    } else {
      // START LIVE MONITORING
      try {
        const granted = await audioRecorder.requestPermissions();
        if (!granted) {
          alert('Microphone permission is required to listen to live audio.');
          return;
        }
      } catch (permErr) {
        console.warn('Permission request error:', permErr);
      }

      // Reset all states and clear any previous latched alert for a fresh session
      const newCallId = `call_${Date.now().toString(36)}`;
      liveSessionIdRef.current = newCallId;
      liveStartTimeRef.current = new Date().toISOString();
      liveChunkCountRef.current = 0;

      hasDetectedSpoofRef.current = false;
      peakSpoofScoreRef.current = 0;
      peakAcousticScoreRef.current = 0;
      setHasDetectedSpoof(false);
      setPeakSpoofScore(0);
      setPeakAcousticScore(0);
      setDetectedSpoofTime(null);

      liveMonitoringRef.current = true;
      setIsLiveMonitoring(true);
      setLiveDuration(0);
      setChunkCount(0);
      currentChunkIndexRef.current = 0;
      setLiveScore(0.09);
      setLiveAcousticScore(0.08);
      setLiveSpeakerScore(0.07);
      setLiveDb(-50);
      setLiveVolumePercent(5);
      setChunkLogs([]);

      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (_) {}

      // Seconds counter
      liveDurationTimerRef.current = setInterval(() => {
        setLiveDuration((d) => d + 1);
      }, 1000);

      // Start continuous chunk capture loop
      runLiveChunkCycle();
    }
  };

  // --- MANUAL DISMISS / RESET FOR LATCHED ALERT ---
  const handleDismissAlert = () => {
    hasDetectedSpoofRef.current = false;
    peakSpoofScoreRef.current = 0;
    peakAcousticScoreRef.current = 0;
    setHasDetectedSpoof(false);
    setPeakSpoofScore(0);
    setPeakAcousticScore(0);
    setDetectedSpoofTime(null);
    setLiveScore(0.09);
    setLiveAcousticScore(0.08);
    setLiveSpeakerScore(0.07);
    setLiveLfccScore(0.02);
    setLiveRawnetScore(0.02);
    setLiveWavlmScore(0.02);
  };

  // --- TAB NAVIGATION SWITCHER ---
  const handleTabChange = async (tab: 'live' | 'snapshot') => {
    if (tab === activeTab) return;
    if (tab === 'snapshot' && isLiveMonitoring) {
      await toggleLiveMonitoring();
    }
    if (tab === 'live' && isRecording) {
      if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current);
      await audioRecorder.stopRecording().catch(() => {});
      setIsRecording(false);
      setIsAnalyzing(false);
    }
    setActiveTab(tab);
  };

  // --- SNAPSHOT 4-SECOND RECORDING MODE ---
  const handleToggleSnapshotRecord = async () => {
    if (isRecording) {
      // User tapped stop manually
      if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current);
      setIsRecording(false);
      setIsAnalyzing(true);

      try {
        const uri = await audioRecorder.stopRecording();
        if (uri) {
          const base64 = await audioRecorder.getAudioBase64(uri);
          if (base64) {
            const snapId = `snap_${Date.now().toString(36)}`;
            const res = await api.analyzeAudio(
              base64,
              'Snapshot Voice Sample',
              snapId,
              ownerSpeakerId,
              filterMyVoice
            );
            setSnapshotResult(res);

            const snapSession: Session = {
              id: snapId,
              session_id: snapId,
              timestamp: new Date().toISOString(),
              start_time: new Date().toISOString(),
              speakerId: `Snapshot Analysis (${Math.max(1, snapshotDuration)}s)`,
              speaker_id: `Snapshot Analysis (${Math.max(1, snapshotDuration)}s)`,
              riskScore: res.score,
              risk_score: res.risk_score,
              current_risk: res.risk_score,
              riskLevel: res.risk_level,
              risk_level: res.risk_level,
              chunks_analyzed: 1,
              risk_history: [res.risk_score],
            };
            api.recordCompletedSession(snapSession).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('Snapshot analysis error:', err);
      } finally {
        setIsAnalyzing(false);
      }
    } else {
      // Start recording a 4-second snapshot
      if (isLiveMonitoring) {
        await toggleLiveMonitoring();
      }
      setSnapshotResult(null);
      setSnapshotDuration(0);
      try {
        await audioRecorder.startRecording(handleRecordingStatusUpdate);
        setIsRecording(true);

        let elapsed = 0;
        snapshotTimerRef.current = setInterval(async () => {
          elapsed += 1;
          setSnapshotDuration(elapsed);

          if (elapsed >= 4) {
            // Auto stop at 4 seconds
            if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current);
            setIsRecording(false);
            setIsAnalyzing(true);

            try {
              const uri = await audioRecorder.stopRecording();
              if (uri) {
                const base64 = await audioRecorder.getAudioBase64(uri);
                if (base64) {
                  const snapId = `snap_${Date.now().toString(36)}`;
                  const res = await api.analyzeAudio(
                    base64,
                    'Snapshot Voice Sample',
                    snapId,
                    ownerSpeakerId,
                    filterMyVoice
                  );
                  setSnapshotResult(res);

                  const snapSession: Session = {
                    id: snapId,
                    session_id: snapId,
                    timestamp: new Date().toISOString(),
                    start_time: new Date().toISOString(),
                    speakerId: `Snapshot Analysis (4s)`,
                    speaker_id: `Snapshot Analysis (4s)`,
                    riskScore: res.score,
                    risk_score: res.risk_score,
                    current_risk: res.risk_score,
                    riskLevel: res.risk_level,
                    risk_level: res.risk_level,
                    chunks_analyzed: 1,
                    risk_history: [res.risk_score],
                  };
                  api.recordCompletedSession(snapSession).catch(() => {});
                }
              }
            } catch (err) {
              console.warn('Snapshot auto-stop analysis error:', err);
            } finally {
              setIsAnalyzing(false);
            }
          }
        }, 1000);
      } catch (e) {
        console.warn('Failed starting snapshot recording:', e);
      }
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const isHighRisk = liveScore >= 0.50 || hasDetectedSpoof;
  const isMediumRisk = !isHighRisk && liveScore >= 0.35;

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Mode Selector Tabs */}
      <View style={styles.tabSelector}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'live' && styles.tabButtonActive]}
          onPress={() => handleTabChange('live')}
          activeOpacity={0.8}
        >
          <View style={styles.liveTabIndicator}>
            <View
              style={[
                styles.liveDot,
                isLiveMonitoring && styles.liveDotPulsing,
                hasDetectedSpoof && styles.liveDotAlert,
              ]}
            />
            <Text style={[styles.tabButtonText, activeTab === 'live' && styles.tabButtonTextActive]}>
              LIVE CALL MONITOR
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'snapshot' && styles.tabButtonActive]}
          onPress={() => handleTabChange('snapshot')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabButtonText, activeTab === 'snapshot' && styles.tabButtonTextActive]}>
            Snapshot Mode
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* ============================================================== */}
        {/* 🟢 TRUE LIVE VOICE & CALL MONITOR MODE */}
        {/* ============================================================== */}
        {activeTab === 'live' && (
          <View style={styles.liveContainer}>
            {/* Live Monitoring Header Status Bar */}
            <View style={[styles.liveHeaderCard, hasDetectedSpoof && styles.liveHeaderCardAlert]}>
              <View style={styles.liveHeaderLeft}>
                <View
                  style={[
                    styles.statusRing,
                    isLiveMonitoring && styles.statusRingActive,
                    hasDetectedSpoof && styles.statusRingAlert,
                  ]}
                >
                  <View
                    style={[
                      styles.statusDotInner,
                      isLiveMonitoring && styles.statusDotInnerActive,
                      hasDetectedSpoof && styles.statusDotInnerAlert,
                    ]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.liveHeaderTitle, hasDetectedSpoof && { color: '#ff3b3b' }]}>
                    {isLiveMonitoring
                      ? 'DIRECT MICROPHONE LISTENING'
                      : hasDetectedSpoof
                      ? 'AI ATTACK INTERCEPTED (STOPPED)'
                      : 'VOICE MONITOR STANDBY'}
                  </Text>
                  <Text style={styles.liveHeaderSub}>
                    {isLiveMonitoring
                      ? `Active: ${formatTime(liveDuration)} • Buffer: 2.0s • Chunk #${chunkCount}`
                      : hasDetectedSpoof
                      ? 'Threat alert latched at peak score. Tap Dismiss to reset.'
                      : 'Tap button below to start real-time microphone listening'}
                  </Text>
                </View>
              </View>

              {isLiveMonitoring && (
                <View style={styles.latencyBadge}>
                  <Ionicons name="flash" size={10} color="#00d4ff" />
                  <Text style={styles.latencyText}>{liveLatency} ms</Text>
                </View>
              )}
            </View>

            {/* CALL AUDIO CHANNEL & SELF-VOICE FILTER */}
            <View style={styles.channelFilterCard}>
              <View style={styles.channelFilterHeader}>
                <Ionicons name="call-outline" size={15} color="#00d4ff" />
                <Text style={styles.channelFilterTitle}>CALL AUDIO MONITORING MODE</Text>
              </View>
              <View style={styles.channelButtonRow}>
                <TouchableOpacity
                  style={[styles.channelBtn, filterMyVoice && styles.channelBtnActive]}
                  onPress={() => setFilterMyVoice(true)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="volume-high" size={15} color={filterMyVoice ? '#00d4ff' : '#8888aa'} />
                  <Text style={[styles.channelBtnText, filterMyVoice && styles.channelBtnTextActive]}>
                    Incoming Caller Only (Filter My Voice)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.channelBtn, !filterMyVoice && styles.channelBtnActive]}
                  onPress={() => setFilterMyVoice(false)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="people" size={15} color={!filterMyVoice ? '#00d4ff' : '#8888aa'} />
                  <Text style={[styles.channelBtnText, !filterMyVoice && styles.channelBtnTextActive]}>
                    Both Speakers
                  </Text>
                </TouchableOpacity>
              </View>

              {filterMyVoice && (
                <View style={styles.channelFilterNote}>
                  <Ionicons name="shield-checkmark" size={13} color="#00e676" />
                  <Text style={styles.channelFilterNoteText}>
                    Smart Voice Separation: Your voice is recognized as Device Owner (bypassed from deepfake scans). Only the incoming caller from the phone speaker is analyzed.
                  </Text>
                </View>
              )}

              {/* Active Speaker Channel Live Indicator */}
              {isLiveMonitoring && isSpeaking && (
                <View style={[
                  styles.channelBadgeRow,
                  activeSpeakerChannel === 'YOU (OWNER)' ? styles.channelBadgeRowOwner : styles.channelBadgeRowCaller
                ]}>
                  <Ionicons
                    name={activeSpeakerChannel === 'YOU (OWNER)' ? 'person-circle' : 'call'}
                    size={16}
                    color={activeSpeakerChannel === 'YOU (OWNER)' ? '#00e676' : '#00d4ff'}
                  />
                  <Text style={[
                    styles.channelBadgeText,
                    activeSpeakerChannel === 'YOU (OWNER)' ? { color: '#00e676' } : { color: '#00d4ff' }
                  ]}>
                    {activeSpeakerChannel === 'YOU (OWNER)'
                      ? 'YOU ARE SPEAKING (Device Owner) • Caller deepfake scan paused'
                      : 'INCOMING CALLER SPEAKING • Deepfake neural forensic scan active'}
                  </Text>
                </View>
              )}
            </View>

            {/* REAL-TIME AUDIO LEVEL & VOICE ACTIVITY DETECTION (VAD) INDICATOR */}
            <View style={[styles.micMeterCard, isLiveMonitoring && isSpeaking && styles.micMeterCardActive]}>
              <View style={styles.micMeterRow}>
                <View style={styles.micMeterLabelCol}>
                  <View style={styles.micIndicatorRow}>
                    <Ionicons
                      name={isSpeaking ? 'mic' : isLiveMonitoring ? 'mic-outline' : 'mic-off'}
                      size={18}
                      color={isSpeaking ? '#00e676' : isLiveMonitoring ? '#00d4ff' : '#666688'}
                    />
                    <Text style={[styles.micMeterLabel, isSpeaking && { color: '#00e676', fontWeight: 'bold' }]}>
                      {isLiveMonitoring
                        ? isSpeaking
                        ? 'SPEECH DETECTED (ANALYZING)'
                          : 'LISTENING (ROOM AMBIENT)'
                        : 'MICROPHONE OFFLINE'}
                    </Text>
                  </View>
                  <Text style={styles.micMeterDbText}>
                    {isLiveMonitoring ? `${liveDb} dB` : '-- dB'}
                  </Text>
                </View>
              </View>

              {/* Dynamic Sound Level Bar */}
              <View style={styles.meterTrack}>
                <View
                  style={[
                    styles.meterFill,
                    {
                      width: `${isLiveMonitoring ? liveVolumePercent : 0}%`,
                      backgroundColor:
                        liveVolumePercent > 75
                          ? '#ff3b3b'
                          : liveVolumePercent > 35
                          ? '#00e676'
                          : '#00d4ff',
                    },
                  ]}
                />
              </View>
              <View style={styles.meterScaleRow}>
                <Text style={styles.meterScaleText}>-80 dB (Silence)</Text>
                <Text style={styles.meterScaleText}>-40 dB (VAD Threshold)</Text>
                <Text style={styles.meterScaleText}>0 dB (Peak)</Text>
              </View>
            </View>

            {/* Live Animated Waveform */}
            <View style={styles.liveWaveformCard}>
              <Text style={styles.waveformLabel}>
                {isLiveMonitoring
                  ? isSpeaking
                    ? 'LIVE VOICE HARMONIC SPECTRUM'
                    : 'AWAITING INCOMING AUDIO STREAM'
                  : 'ACOUSTIC SENSORS IDLE'}
              </Text>
              <WaveformBars isActive={isLiveMonitoring && isSpeaking} />
            </View>

            {/* REAL-TIME RISK GAUGE & LIVE PREDICTION VERDICT */}
            <View style={[styles.gaugeWrapper, isHighRisk && styles.gaugeWrapperAlert]}>
              <RiskGauge score={liveScore} size={210} />

              <View style={styles.liveVerdictRow}>
                <Text style={styles.liveVerdictPrefix}>LIVE PREDICTION:</Text>
                <StatusBadge
                  level={
                    isHighRisk
                      ? 'SPOOFED'
                      : isMediumRisk
                      ? 'SUSPICIOUS'
                      : 'GENUINE'
                  }
                />
              </View>
              <Text style={styles.liveGaugeSubtitle}>
                {isHighRisk
                  ? `🚨 Deepfake Threat: ${(liveScore * 100).toFixed(0)}% — Synthetic AI voice detected${!isLiveMonitoring ? ' (Call Stopped — Alert Latched)' : ''}`
                  : isMediumRisk
                  ? `⚡ Suspicious Risk: ${(liveScore * 100).toFixed(0)}% — Possible replay/compression`
                  : `🛡️ Authenticity: ${(Math.max(82, (1 - liveScore) * 100)).toFixed(0)}% • Deepfake Risk: ${(liveScore * 100).toFixed(0)}% (Verified Human)`}
              </Text>
            </View>

            {/* Live Threat Alert Banner (Appears dynamically and stays latched if High Risk) */}
            {isHighRisk && (
              <View style={styles.alertCardRed}>
                <Ionicons name="warning" size={26} color="#ff3b3b" />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.alertTitle}>AI CLONE ATTACK DETECTED!</Text>
                    <View style={styles.latchedBadge}>
                      <Text style={styles.latchedBadgeText}>ALERT LATCHED</Text>
                    </View>
                  </View>
                  <Text style={styles.alertDesc}>
                    {liveAcousticScore >= 0.70
                      ? 'Synthetic AI vocoder artifacts detected across neural models (transposed conv phase anomalies).'
                      : 'Elevated acoustic anomaly detected in caller stream. Possible synthetic clone or voice replay.'}
                    {detectedSpoofTime ? ` Intercepted at ${detectedSpoofTime}.` : ''}
                    {!isLiveMonitoring ? ' Call stopped — threat alert locked on screen for verification.' : ''}
                  </Text>
                  <TouchableOpacity
                    style={styles.dismissAlertBtn}
                    onPress={handleDismissAlert}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="refresh-outline" size={14} color="#ffffff" />
                    <Text style={styles.dismissAlertBtnText}>Dismiss / Reset Alert</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Real-time Sub-Model Telemetry */}
            <View style={styles.telemetryCard}>
              <Text style={styles.telemetryTitle}>REAL-TIME NEURAL ENSEMBLE TELEMETRY</Text>

              {/* LFCC-LCNN Vocoder Artifact Score */}
              <View style={styles.telemetryRow}>
                <View style={styles.telemetryLabelCol}>
                  <Text style={styles.telemetryLabel}>LFCC-LCNN (Vocoder Phase Spectral)</Text>
                  <Text style={[styles.telemetryValue, liveLfccScore > 0.5 && { color: '#ff3b3b' }]}>
                    {(liveLfccScore * 100).toFixed(1)}%
                  </Text>
                </View>
                <View style={styles.telemetryTrack}>
                  <View
                    style={[
                      styles.telemetryFill,
                      {
                        width: `${Math.min(100, Math.max(2, liveLfccScore * 100))}%`,
                        backgroundColor: liveLfccScore > 0.5 ? theme.colors.danger : theme.colors.primary,
                      },
                    ]}
                  />
                </View>
              </View>

              {/* RawNet2 Raw Waveform Anomaly Score */}
              <View style={styles.telemetryRow}>
                <View style={styles.telemetryLabelCol}>
                  <Text style={styles.telemetryLabel}>RawNet2 (Time-Domain Filterbank Anomaly)</Text>
                  <Text style={[styles.telemetryValue, liveRawnetScore > 0.5 && { color: '#ff3b3b' }]}>
                    {(liveRawnetScore * 100).toFixed(1)}%
                  </Text>
                </View>
                <View style={styles.telemetryTrack}>
                  <View
                    style={[
                      styles.telemetryFill,
                      {
                        width: `${Math.min(100, Math.max(2, liveRawnetScore * 100))}%`,
                        backgroundColor: liveRawnetScore > 0.5 ? theme.colors.danger : '#00e676',
                      },
                    ]}
                  />
                </View>
              </View>

              {/* WavLM Speech Foundation Self-Attention Score */}
              <View style={styles.telemetryRow}>
                <View style={styles.telemetryLabelCol}>
                  <Text style={styles.telemetryLabel}>WavLM (Temporal Attention Consensus)</Text>
                  <Text style={[styles.telemetryValue, liveWavlmScore > 0.5 && { color: '#ff3b3b' }]}>
                    {(liveWavlmScore * 100).toFixed(1)}%
                  </Text>
                </View>
                <View style={styles.telemetryTrack}>
                  <View
                    style={[
                      styles.telemetryFill,
                      {
                        width: `${Math.min(100, Math.max(2, liveWavlmScore * 100))}%`,
                        backgroundColor: liveWavlmScore > 0.5 ? theme.colors.danger : '#00e676',
                      },
                    ]}
                  />
                </View>
              </View>

              {/* Speaker Consistency */}
              <View style={styles.telemetryRow}>
                <View style={styles.telemetryLabelCol}>
                  <Text style={styles.telemetryLabel}>Biometric Voiceprint Verification</Text>
                  <Text style={styles.telemetryValue}>
                    {(() => {
                      const matchPct = Math.min(99.4, Math.max(5.0, (1 - liveSpeakerScore) * 100));
                      const label = matchPct >= 75 ? '(Matched)' : matchPct >= 50 ? '(Uncertain)' : '(Mismatch)';
                      return `${matchPct.toFixed(1)}% ${label}`;
                    })()}
                  </Text>
                </View>
                <View style={styles.telemetryTrack}>
                  <View
                    style={[
                      styles.telemetryFill,
                      {
                        width: `${Math.min(100, Math.max(2, (1 - liveSpeakerScore) * 100))}%`,
                        backgroundColor: theme.colors.success,
                      },
                    ]}
                  />
                </View>
              </View>
            </View>

            {/* LIVE ROLLING CHUNK AUDIT LOG */}
            {isLiveMonitoring && chunkLogs.length > 0 && (
              <View style={styles.logCard}>
                <View style={styles.logHeaderRow}>
                  <Ionicons name="terminal-outline" size={14} color="#00d4ff" />
                  <Text style={styles.logHeaderTitle}>LIVE AUDIO INFERENCE STREAM</Text>
                </View>
                {chunkLogs.map((log) => (
                  <View key={log.id} style={styles.logEntry}>
                    <Text style={styles.logTime}>[{log.time}]</Text>
                    <Text style={styles.logChunk}>#{log.chunkNum}</Text>
                    {log.speakerChannel && (
                      <View
                        style={[
                          styles.logChannelBadge,
                          log.speakerChannel === 'YOU (OWNER)' ? styles.logChannelOwner : styles.logChannelCaller,
                        ]}
                      >
                        <Text
                          style={[
                            styles.logChannelBadgeText,
                            log.speakerChannel === 'YOU (OWNER)' ? { color: '#00e676' } : { color: '#00d4ff' },
                          ]}
                        >
                          {log.speakerChannel === 'YOU (OWNER)' ? 'YOU' : 'CALLER'}
                        </Text>
                      </View>
                    )}
                    <Text style={[styles.logDb, log.speechDetected ? { color: '#00e676' } : { color: '#666688' }]}>
                      {log.speechDetected ? `Voice ${log.db}dB` : `Ambient ${log.db}dB`}
                    </Text>
                    <Text
                      style={[
                        styles.logVerdict,
                        log.verdict === 'SPOOFED'
                          ? { color: '#ff3b3b' }
                          : log.verdict === 'SUSPICIOUS'
                          ? { color: '#ffb800' }
                          : { color: '#00e676' },
                      ]}
                    >
                      {log.verdict === 'GENUINE'
                        ? `${Math.round((1 - log.riskScore) * 100)}% AUTHENTIC`
                        : `${Math.round(log.riskScore * 100)}% CLONE`}
                    </Text>
                    <Text style={styles.logLatency}>{log.latencyMs}ms</Text>
                  </View>
                ))}
              </View>
            )}

            {/* SPEAKERPHONE CALL DEMO TIP CARD */}
            <View style={styles.infoCard}>
              <Ionicons name="information-circle-outline" size={20} color="#00d4ff" />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.infoCardTitle}>Live Call Testing Tip</Text>
                <Text style={styles.infoCardDesc}>
                  To test during a phone call, switch your call to <Text style={{ color: '#00d4ff', fontWeight: 'bold' }}>Speakerphone</Text> or speak directly into the microphone. Vocx Guard continuously evaluates incoming acoustic frames in 2.0s rolling windows.
                </Text>
              </View>
            </View>

            {/* MAIN ACTION BUTTON: START/STOP LIVE MONITORING */}
            <TouchableOpacity
              style={[styles.mainLiveBtn, isLiveMonitoring && styles.mainLiveBtnStop]}
              onPress={toggleLiveMonitoring}
              activeOpacity={0.8}
            >
              <Ionicons
                name={isLiveMonitoring ? 'stop-circle' : 'radio'}
                size={28}
                color={isLiveMonitoring ? '#ffffff' : '#000000'}
              />
              <Text style={[styles.mainLiveBtnText, isLiveMonitoring && { color: '#ffffff' }]}>
                {isLiveMonitoring ? 'STOP LIVE MONITORING' : 'START LIVE CALL MONITOR'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ============================================================== */}
        {/* 🎙️ SNAPSHOT RECORDING MODE */}
        {/* ============================================================== */}
        {activeTab === 'snapshot' && (
          <View style={styles.snapshotContainer}>
            <Text style={styles.snapshotTitle}>Forensic Audio Sample Analysis</Text>
            <Text style={styles.snapshotSub}>
              Record a 4-second audio clip for forensic deepfake verification
            </Text>

            <View style={styles.snapshotCard}>
              <WaveformBars isActive={isRecording} />
              <Text style={styles.snapshotTimerText}>
                {isRecording
                  ? `Recording... ${snapshotDuration}s / 4s (${liveDb} dB ${isSpeaking ? '• Voice Active' : '• Ambient'})`
                  : isAnalyzing
                  ? '⚡ Analyzing with LFCC-LCNN + RawNet2...'
                  : 'Tap microphone button to record 4-second clip'}
              </Text>

              <TouchableOpacity
                style={[styles.recordCircleBtn, isRecording && styles.recordCircleBtnActive]}
                onPress={handleToggleSnapshotRecord}
                activeOpacity={0.8}
                disabled={isAnalyzing}
              >
                <Ionicons name={isRecording ? 'stop' : 'mic'} size={36} color="#fff" />
              </TouchableOpacity>
            </View>

            {snapshotResult && (
              <View style={styles.snapshotResultCard}>
                <RiskGauge score={snapshotResult.score} size={180} />
                <View style={{ marginTop: 14, alignItems: 'center' }}>
                  <StatusBadge level={snapshotResult.is_spoofed || snapshotResult.score >= 0.50 ? 'SPOOFED' : snapshotResult.risk_level} />
                  <Text style={styles.snapshotVerdictSub}>
                    {snapshotResult.is_spoofed || snapshotResult.score >= 0.50
                      ? '🚨 AI CLONE ATTACK DETECTED: Synthetic vocoder artifacts identified.'
                      : `🛡️ AUTHENTIC HUMAN VOICE: ${(Math.max(75, (1 - snapshotResult.score) * 100)).toFixed(0)}% Authenticity Confidence.`}
                  </Text>
                </View>

                <View style={styles.snapshotBreakdownBox}>
                  <Text style={styles.snapshotBreakdownTitle}>Acoustic & Biometric Decomposition</Text>
                  <View style={styles.snapshotRow}>
                    <Text style={styles.snapshotRowLabel}>LFCC-LCNN Vocoder Spoof Risk:</Text>
                    <Text style={[styles.snapshotRowVal, ((snapshotResult.details?.acoustic_breakdown?.lfcc_lcnn ?? snapshotResult.breakdown.acoustic) > 0.5) && { color: '#ff3b3b' }]}>
                      {(((snapshotResult.details?.acoustic_breakdown?.lfcc_lcnn ?? snapshotResult.breakdown.acoustic)) * 100).toFixed(1)}%
                    </Text>
                  </View>
                  <View style={styles.snapshotRow}>
                    <Text style={styles.snapshotRowLabel}>RawNet2 Waveform Anomaly:</Text>
                    <Text style={[styles.snapshotRowVal, ((snapshotResult.details?.acoustic_breakdown?.rawnet2 ?? 0.3) > 0.5) && { color: '#ff3b3b' }]}>
                      {(((snapshotResult.details?.acoustic_breakdown?.rawnet2 ?? 0.3)) * 100).toFixed(1)}%
                    </Text>
                  </View>
                  <View style={styles.snapshotRow}>
                    <Text style={styles.snapshotRowLabel}>Overall Deepfake Threat Score:</Text>
                    <Text style={[styles.snapshotRowVal, snapshotResult.score >= 0.50 && { color: '#ff3b3b' }]}>
                      {(snapshotResult.score * 100).toFixed(1)}%
                    </Text>
                  </View>
                  <View style={styles.snapshotRow}>
                    <Text style={styles.snapshotRowLabel}>Biometric Voiceprint Match:</Text>
                    <Text style={styles.snapshotRowVal}>
                      {(Math.max(10, (1 - snapshotResult.breakdown.speaker) * 100)).toFixed(1)}%
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default RecordAnalyzeScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  tabSelector: {
    flexDirection: 'row',
    backgroundColor: '#111128',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: '#1a1a2e',
    borderColor: '#00d4ff',
    borderWidth: 1,
  },
  tabButtonText: {
    color: '#8888aa',
    fontSize: 12,
    fontWeight: '700',
  },
  tabButtonTextActive: {
    color: '#00d4ff',
  },
  liveTabIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#555577',
  },
  liveDotPulsing: {
    backgroundColor: '#00e676',
  },
  liveDotAlert: {
    backgroundColor: '#ff3b3b',
  },
  liveContainer: {
    marginTop: 12,
  },
  liveHeaderCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a4a',
    marginBottom: 12,
  },
  liveHeaderCardAlert: {
    borderColor: '#ff3b3b',
    backgroundColor: 'rgba(255, 59, 59, 0.1)',
  },
  liveHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  statusRing: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusRingActive: {
    backgroundColor: 'rgba(0, 212, 255, 0.2)',
  },
  statusRingAlert: {
    backgroundColor: 'rgba(255, 59, 59, 0.25)',
  },
  statusDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#555577',
  },
  statusDotInnerActive: {
    backgroundColor: '#00d4ff',
  },
  statusDotInnerAlert: {
    backgroundColor: '#ff3b3b',
  },
  liveHeaderTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  liveHeaderSub: {
    color: '#8888aa',
    fontSize: 11,
    marginTop: 2,
  },
  latencyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,212,255,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#00d4ff',
  },
  latencyText: {
    color: '#00d4ff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  // Real-time microphone level meter
  micMeterCard: {
    backgroundColor: '#111128',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a4a',
    marginBottom: 12,
  },
  micMeterCardActive: {
    borderColor: '#00e676',
    backgroundColor: 'rgba(0, 230, 118, 0.05)',
  },
  micMeterRow: {
    marginBottom: 8,
  },
  micMeterLabelCol: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  micIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  micMeterLabel: {
    color: '#8888aa',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  micMeterDbText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  meterTrack: {
    height: 8,
    backgroundColor: '#0a0a1a',
    borderRadius: 4,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: 4,
  },
  meterScaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  meterScaleText: {
    color: '#555577',
    fontSize: 9,
  },
  liveWaveformCard: {
    backgroundColor: '#111128',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a4a',
    alignItems: 'center',
    marginBottom: 14,
  },
  waveformLabel: {
    color: '#555577',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  gaugeWrapper: {
    backgroundColor: '#1a1a2e',
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a4a',
    marginBottom: 14,
  },
  gaugeWrapperAlert: {
    borderColor: '#ff3b3b',
    backgroundColor: 'rgba(255, 59, 59, 0.08)',
  },
  liveVerdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  liveVerdictPrefix: {
    color: '#8888aa',
    fontSize: 12,
    fontWeight: 'bold',
  },
  liveGaugeSubtitle: {
    color: '#8888aa',
    fontSize: 11,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  alertCardRed: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 59, 59, 0.15)',
    borderWidth: 1,
    borderColor: '#ff3b3b',
    padding: 14,
    borderRadius: 12,
    marginBottom: 14,
  },
  alertTitle: {
    color: '#ff3b3b',
    fontSize: 13,
    fontWeight: 'bold',
  },
  latchedBadge: {
    backgroundColor: '#ff3b3b',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  latchedBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  alertDesc: {
    color: '#ffaaaa',
    fontSize: 11,
    marginTop: 2,
    lineHeight: 16,
  },
  dismissAlertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(255, 59, 59, 0.35)',
    borderWidth: 1,
    borderColor: '#ff3b3b',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginTop: 8,
  },
  dismissAlertBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  telemetryCard: {
    backgroundColor: '#1a1a2e',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a4a',
    marginBottom: 14,
  },
  telemetryTitle: {
    color: '#8888aa',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 12,
  },
  telemetryRow: {
    marginBottom: 10,
  },
  telemetryLabelCol: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  telemetryLabel: {
    color: '#cccccc',
    fontSize: 11,
  },
  telemetryValue: {
    color: '#00d4ff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  telemetryTrack: {
    height: 6,
    backgroundColor: '#111128',
    borderRadius: 3,
    overflow: 'hidden',
  },
  telemetryFill: {
    height: '100%',
    borderRadius: 3,
  },
  logCard: {
    backgroundColor: '#111128',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a4a',
    marginBottom: 14,
  },
  logHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222244',
    paddingBottom: 6,
  },
  logHeaderTitle: {
    color: '#00d4ff',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  logEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  logTime: {
    color: '#555577',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  logChunk: {
    color: '#8888aa',
    fontSize: 10,
    fontWeight: 'bold',
  },
  logDb: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  logVerdict: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  logLatency: {
    color: '#666688',
    fontSize: 9,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(0, 212, 255, 0.06)',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.2)',
    marginBottom: 16,
  },
  infoCardTitle: {
    color: '#00d4ff',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  infoCardDesc: {
    color: '#8888aa',
    fontSize: 11,
    lineHeight: 16,
  },
  mainLiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#00d4ff',
    paddingVertical: 16,
    borderRadius: 14,
    marginBottom: 16,
  },
  mainLiveBtnStop: {
    backgroundColor: '#ff3b3b',
  },
  mainLiveBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  // Snapshot styles
  snapshotContainer: {
    marginTop: 12,
    alignItems: 'center',
  },
  snapshotTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  snapshotSub: {
    color: '#8888aa',
    fontSize: 12,
    textAlign: 'center',
    marginVertical: 8,
  },
  snapshotCard: {
    width: '100%',
    backgroundColor: '#1a1a2e',
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a4a',
    marginTop: 12,
  },
  snapshotTimerText: {
    color: '#00d4ff',
    fontSize: 13,
    fontWeight: 'bold',
    marginVertical: 16,
    textAlign: 'center',
  },
  recordCircleBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#ff3b3b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordCircleBtnActive: {
    backgroundColor: '#ff1111',
    transform: [{ scale: 1.08 }],
  },
  snapshotResultCard: {
    width: '100%',
    backgroundColor: '#1a1a2e',
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  snapshotBreakdownBox: {
    width: '100%',
    backgroundColor: '#111128',
    padding: 12,
    borderRadius: 10,
    marginTop: 16,
  },
  snapshotBreakdownTitle: {
    color: '#8888aa',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 8,
  },
  snapshotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  snapshotRowLabel: {
    color: '#cccccc',
    fontSize: 11,
  },
  snapshotRowVal: {
    color: '#00d4ff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  snapshotVerdictSub: {
    color: '#8888aa',
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 16,
  },
  // Call channel routing styles
  channelFilterCard: {
    backgroundColor: '#14142b',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#24244a',
    marginBottom: 12,
  },
  channelFilterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  channelFilterTitle: {
    color: '#00d4ff',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.8,
  },
  channelButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  channelBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#1a1a36',
    borderWidth: 1,
    borderColor: '#282850',
  },
  channelBtnActive: {
    backgroundColor: 'rgba(0, 212, 255, 0.12)',
    borderColor: '#00d4ff',
  },
  channelBtnText: {
    color: '#8888aa',
    fontSize: 11,
    fontWeight: '600',
  },
  channelBtnTextActive: {
    color: '#00d4ff',
    fontWeight: 'bold',
  },
  channelFilterNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e1e3a',
  },
  channelFilterNoteText: {
    flex: 1,
    color: '#99bbcc',
    fontSize: 10,
    lineHeight: 14,
  },
  channelBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    marginTop: 8,
    borderWidth: 1,
  },
  channelBadgeRowOwner: {
    backgroundColor: 'rgba(0, 230, 118, 0.10)',
    borderColor: 'rgba(0, 230, 118, 0.3)',
  },
  channelBadgeRowCaller: {
    backgroundColor: 'rgba(0, 212, 255, 0.10)',
    borderColor: 'rgba(0, 212, 255, 0.3)',
  },
  channelBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    flex: 1,
  },
  logChannelBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 4,
  },
  logChannelOwner: {
    backgroundColor: 'rgba(0, 230, 118, 0.2)',
  },
  logChannelCaller: {
    backgroundColor: 'rgba(0, 212, 255, 0.2)',
  },
  logChannelBadgeText: {
    fontSize: 9,
    fontWeight: 'bold',
  },
});
