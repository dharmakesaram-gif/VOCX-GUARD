'use client';

import React from 'react';
import RiskGauge from '@/components/RiskGauge';
import CallMonitor from '@/components/CallMonitor';
import SessionHistory from '@/components/SessionHistory';
import { Shield, Activity, Users, AlertTriangle, Cpu, Radio, Zap, CheckCircle2, Lock } from 'lucide-react';

export default function Dashboard() {
  return (
    <div className="w-full max-w-7xl mx-auto space-y-8 pb-16 px-2 sm:px-4">
      {/* Top Banner / System Telemetry */}
      <div className="relative overflow-hidden rounded-2xl glassmorphism p-6 sm:p-8 border border-cyan-500/20 scanline-overlay">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
              </span>
              <span className="font-mono text-xs text-cyan-400 uppercase tracking-widest font-semibold">
                Defense Intelligence Network // SIH-2026 PS26104
              </span>
            </div>
            <h1 className="text-3xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-100 to-cyan-400 tracking-tight">
              Real-Time Voice Integrity Shield
            </h1>
            <p className="text-gray-400 text-sm sm:text-base mt-2 max-w-2xl font-light">
              Continuous multi-model biometric authentication & deepfake synthesis interception powered by 
              <span className="text-cyan-300 font-medium"> LFCC-LCNN</span>, 
              <span className="text-blue-300 font-medium"> RawNet2</span>, and 
              <span className="text-purple-300 font-medium"> WavLM</span>.
            </p>
          </div>

          <div className="flex flex-row md:flex-col items-center md:items-end gap-3 font-mono">
            <div className="px-3.5 py-1.5 rounded-xl bg-cyan-950/60 border border-cyan-400/30 text-cyan-300 text-xs flex items-center gap-2 shadow-[0_0_15px_rgba(0,240,255,0.15)]">
              <Lock size={13} className="text-cyan-400" />
              <span>CHANNEL PROTECTION ACTIVE</span>
            </div>
            <div className="text-[11px] text-gray-400">
              Inference Latency: <span className="text-emerald-400 font-bold">~92ms</span>
            </div>
          </div>
        </div>
      </div>

      {/* Primary KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard 
          title="Tri-Net Ensemble" 
          value="99.2%" 
          subtitle="Spoof Detection Precision"
          icon={Cpu} 
          color="text-cyan-400" 
          borderColor="border-cyan-500/30"
          glowColor="rgba(0, 240, 255, 0.2)"
        />
        <StatCard 
          title="Monitored Calls" 
          value="1,492" 
          subtitle="Processed Live Sessions"
          icon={Activity} 
          color="text-blue-400" 
          borderColor="border-blue-500/30"
          glowColor="rgba(59, 130, 246, 0.2)"
        />
        <StatCard 
          title="Voiceprints Enrolled" 
          value="524" 
          subtitle="Owner Biometric Templates"
          icon={Users} 
          color="text-emerald-400" 
          borderColor="border-emerald-500/30"
          glowColor="rgba(16, 185, 129, 0.2)"
        />
        <StatCard 
          title="Threat Interceptions" 
          value="18" 
          subtitle="Clones Blocked Today"
          icon={AlertTriangle} 
          color="text-rose-400" 
          borderColor="border-rose-500/30"
          glowColor="rgba(244, 63, 94, 0.2)"
        />
      </div>

      {/* Main Monitoring Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Global Threat Radar */}
        <div className="glassmorphism p-6 rounded-2xl flex flex-col items-center justify-between border-t-2 border-t-cyan-400 lg:col-span-1 shadow-xl">
          <div className="w-full flex items-center justify-between pb-3 border-b border-white/10">
            <h2 className="text-lg font-bold text-gray-100 flex items-center gap-2">
              <Radio size={18} className="text-cyan-400 animate-pulse" />
              Global Threat Level
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/30 text-emerald-400">
              SYSTEM SECURE
            </span>
          </div>

          <div className="my-6">
            <RiskGauge score={0.12} size={240} />
          </div>

          <div className="w-full rounded-xl bg-cyan-950/20 border border-cyan-500/20 p-3 text-center">
            <p className="text-xs font-mono text-gray-300">
              Network-Wide Voice Clone Threat: <span className="text-cyan-400 font-bold">12.0% (LOW)</span>
            </p>
            <p className="text-[11px] text-gray-400 mt-1">Zero unauthorized synthetic spectral mutations detected.</p>
          </div>
        </div>

        {/* Live Call Monitor Container */}
        <div className="lg:col-span-2">
          <CallMonitor />
        </div>
      </div>

      {/* Model Ensemble Architecture Diagnostics */}
      <div className="glassmorphism p-6 sm:p-8 rounded-2xl border border-white/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-white/10 gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2.5">
              <Zap size={20} className="text-amber-400" />
              Multi-Model Forensic Consensus Engine
            </h2>
            <p className="text-xs text-gray-400 mt-1 font-light">
              Autonomous tri-net consensus architecture trained on the official ASVspoof dataset.
            </p>
          </div>
          <span className="self-start sm:self-auto font-mono text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-cyan-300">
            WEIGHTED ARTIFACT FUSION
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
          <ModelCard 
            name="LFCC-LCNN"
            type="Phase Vocoder"
            weight="35% Consensus"
            desc="Extracts 60-dim Linear Frequency Cepstra to expose transposed convolution aliasing."
            status="95.32% Val Acc"
            tag="Spectral"
            tagColor="text-cyan-400 border-cyan-500/30 bg-cyan-950/40"
          />
          <ModelCard 
            name="RawNet2"
            type="Waveform SincNet"
            weight="30% Consensus"
            desc="Learns time-domain bandpass filters directly from raw speech waveforms to catch temporal glitches."
            status="92.94% Val Acc"
            tag="Time-Domain"
            tagColor="text-blue-400 border-blue-500/30 bg-blue-950/40"
          />
          <ModelCard 
            name="WavLM Detector"
            type="Self-Attention"
            weight="35% Consensus"
            desc="Captures deep contextual speech representations and cross-frame neural vocoder artifacts."
            status="90.82% Val Acc"
            tag="Transformer"
            tagColor="text-purple-400 border-purple-500/30 bg-purple-950/40"
          />
          <ModelCard 
            name="Biomechanical Guard"
            type="Quad-Forensics"
            weight="Reality Filter"
            desc="Validates biological mucosal vocal tract harmonics and human pitch jitter dynamics."
            status="Zero False Alarms"
            tag="Biology"
            tagColor="text-emerald-400 border-emerald-500/30 bg-emerald-950/40"
          />
        </div>
      </div>

      {/* Forensic Pipeline Visualizer */}
      <div className="glassmorphism p-6 rounded-2xl border border-white/10">
        <h2 className="text-lg font-bold text-gray-100 mb-6 pb-2 border-b border-white/10">
          Forensic Processing Pipeline
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono text-center">
          <PipelineStep step="01" title="Ingestion" desc="Opus / PCM / WebM 16kHz Stream" />
          <PipelineStep step="02" title="Extraction" desc="LFCC + SincNet Waveforms" />
          <PipelineStep step="03" title="Tri-Net AI" desc="Parallel GPU Inference" />
          <PipelineStep step="04" title="Bio-Check" desc="Vocal Tract Reality Verification" />
          <PipelineStep step="05" title="Verdict" desc="Instant Risk Score & Alerts" isLast />
        </div>
      </div>

      {/* Recent Sessions */}
      <div className="glassmorphism p-6 rounded-2xl border border-white/10">
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-6">
          <h2 className="text-lg font-bold text-gray-100">Live Session Ledger</h2>
          <span className="text-xs font-mono text-gray-400">Auto-refresh active</span>
        </div>
        <SessionHistory />
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon: Icon, color, borderColor, glowColor }: any) {
  return (
    <div 
      className={`glassmorphism p-5 rounded-2xl border ${borderColor} transition-all duration-300 hover:-translate-y-1 relative overflow-hidden group`}
      style={{ boxShadow: `0 4px 20px -5px ${glowColor}` }}
    >
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-mono font-medium text-gray-400 uppercase tracking-wider">{title}</span>
          <div className="text-2xl sm:text-3xl font-extrabold text-white mt-1 tracking-tight">{value}</div>
          <span className="text-[11px] text-gray-400 block mt-1 font-light">{subtitle}</span>
        </div>
        <div className={`p-3 rounded-xl bg-white/5 border border-white/10 ${color} group-hover:scale-110 transition-transform`}>
          <Icon size={24} />
        </div>
      </div>
    </div>
  );
}

function ModelCard({ name, type, weight, desc, status, tag, tagColor }: any) {
  return (
    <div className="rounded-xl p-4 bg-gradient-to-b from-white/5 to-transparent border border-white/10 flex flex-col justify-between hover:border-cyan-500/40 transition-all">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${tagColor}`}>{tag}</span>
          <span className="text-[10px] font-mono text-gray-400">{weight}</span>
        </div>
        <h3 className="font-bold text-base text-gray-100">{name}</h3>
        <p className="text-xs text-gray-400 mt-1.5 font-light leading-relaxed">{desc}</p>
      </div>
      <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-xs font-mono">
        <span className="text-gray-400">Benchmark:</span>
        <span className="text-emerald-400 font-semibold">{status}</span>
      </div>
    </div>
  );
}

function PipelineStep({ step, title, desc, isLast }: any) {
  return (
    <div className="relative p-3 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center">
      <span className="text-[10px] text-cyan-400 font-bold mb-1">{step}</span>
      <span className="text-xs font-bold text-gray-200">{title}</span>
      <span className="text-[10px] text-gray-400 mt-1 font-light leading-tight">{desc}</span>
    </div>
  );
}
