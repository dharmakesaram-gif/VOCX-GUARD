'use client';

import React from 'react';
import RiskGauge from '@/components/RiskGauge';
import CallMonitor from '@/components/CallMonitor';
import SessionHistory from '@/components/SessionHistory';
import { Shield, Activity, Users, AlertTriangle } from 'lucide-react';

export default function Dashboard() {
  return (
    <div className="w-full max-w-7xl mx-auto space-y-8 pb-12">
      {/* Header section */}
      <header className="mb-8">
        <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-accent to-blue-400 tracking-tight">
          Real-Time Voice Integrity Monitoring
        </h1>
        <p className="text-gray-400 mt-2">Continuous AI-driven deepfake detection and speaker verification.</p>
      </header>

      {/* Stats cards row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard title="Total Sessions" value="1,248" icon={Activity} color="text-accent" />
        <StatCard title="Active Alerts" value="3" icon={AlertTriangle} color="text-danger" />
        <StatCard title="Speakers Enrolled" value="412" icon={Users} color="text-success" />
        <StatCard title="Avg Risk Score" value="0.12" icon={Shield} color="text-warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Risk Monitor section */}
        <div className="glassmorphism p-6 rounded-xl flex flex-col items-center justify-center space-y-6 lg:col-span-1 border-t-4 border-t-accent">
          <h2 className="text-xl font-semibold text-gray-200 self-start w-full border-b border-gray-700 pb-2">Global Threat Level</h2>
          <RiskGauge score={0.24} size={250} />
          <p className="text-sm text-gray-400 text-center">Current network-wide synthetic voice risk probability.</p>
        </div>

        {/* Live Call Monitor */}
        <div className="lg:col-span-2">
          <CallMonitor />
        </div>
      </div>

      {/* Call Flow Diagram */}
      <div className="glassmorphism p-6 rounded-xl">
        <h2 className="text-xl font-semibold text-gray-200 mb-6 border-b border-gray-700 pb-2">Analysis Pipeline</h2>
        <div className="flex flex-wrap items-center justify-between text-sm md:text-base font-medium text-gray-300 gap-4">
          <div className="flex flex-col items-center gap-2"><div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center border border-gray-600">📞</div><span>Call Ingestion</span></div>
          <div className="h-[2px] flex-grow bg-gradient-to-r from-gray-600 to-accent hidden md:block"></div>
          <div className="flex flex-col items-center gap-2"><div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center border border-accent text-accent glow-effect">🔊</div><span>Feature Extraction</span></div>
          <div className="h-[2px] flex-grow bg-gradient-to-r from-accent to-accent hidden md:block"></div>
          <div className="flex flex-col items-center gap-2"><div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center border border-accent text-accent glow-effect">🧠</div><span>AI Analysis</span></div>
          <div className="h-[2px] flex-grow bg-gradient-to-r from-accent to-warning hidden md:block"></div>
          <div className="flex flex-col items-center gap-2"><div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center border border-warning text-warning">📊</div><span>Risk Scoring</span></div>
          <div className="h-[2px] flex-grow bg-gradient-to-r from-warning to-success hidden md:block"></div>
          <div className="flex flex-col items-center gap-2"><div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center border border-success text-success">✓</div><span>Decision</span></div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="glassmorphism p-6 rounded-xl">
        <h2 className="text-xl font-semibold text-gray-200 mb-6 border-b border-gray-700 pb-2">Recent Analysis Sessions</h2>
        <SessionHistory />
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }: { title: string, value: string, icon: any, color: string }) {
  return (
    <div className="glassmorphism p-6 rounded-xl flex items-center justify-between hover:bg-primary/80 transition-colors">
      <div>
        <h3 className="text-gray-400 text-sm font-medium mb-1">{title}</h3>
        <p className="text-3xl font-bold text-white">{value}</p>
      </div>
      <div className={`p-3 rounded-lg bg-gray-800/50 ${color}`}>
        <Icon size={24} />
      </div>
    </div>
  );
}
