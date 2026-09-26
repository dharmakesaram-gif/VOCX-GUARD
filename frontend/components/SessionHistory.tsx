'use client';

import React, { useState, useEffect } from 'react';
import { Shield, ShieldAlert, ShieldCheck, Phone, Camera, Monitor, Radio, Cpu } from 'lucide-react';
import { API_BASE, getAuthHeaders } from '../lib/config';

interface SessionItem {
  id: string;
  speaker: string;
  time: string;
  score: number;
  peakRisk: number;
  status: 'Verified' | 'Flagged' | 'Blocked';
  analysisType: string;
  chunksAnalyzed: number;
  modelBreakdown: { lfcc_lcnn?: number; wavlm?: number; rawnet2?: number; bio?: number } | null;
}

const ANALYSIS_TYPE_LABELS: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  live_call: { label: 'LIVE CALL', icon: <Phone size={11} />, className: 'bg-cyan-950/80 text-cyan-300 border-cyan-500/40' },
  snapshot: { label: 'SNAPSHOT', icon: <Camera size={11} />, className: 'bg-purple-950/80 text-purple-300 border-purple-500/40' },
  desktop_monitor: { label: 'DESKTOP', icon: <Monitor size={11} />, className: 'bg-blue-950/80 text-blue-300 border-blue-500/40' },
  websocket: { label: 'STREAM', icon: <Radio size={11} />, className: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40' },
};

const defaultSessions: SessionItem[] = [
  { id: 'SES-9921', speaker: 'SPK-10492', time: '10:42 AM', score: 0.12, peakRisk: 14, status: 'Verified', analysisType: 'live_call', chunksAnalyzed: 24, modelBreakdown: { lfcc_lcnn: 0.08, wavlm: 0.02, rawnet2: 0.01, bio: 0.05 } },
  { id: 'SES-9920', speaker: 'ElevenLabs AI', time: '10:15 AM', score: 0.98, peakRisk: 98, status: 'Blocked', analysisType: 'snapshot', chunksAnalyzed: 1, modelBreakdown: { lfcc_lcnn: 0.95, wavlm: 0.88, rawnet2: 0.92, bio: 0.72 } },
  { id: 'SES-9919', speaker: 'SPK-38102', time: '09:30 AM', score: 0.05, peakRisk: 8, status: 'Verified', analysisType: 'live_call', chunksAnalyzed: 18, modelBreakdown: { lfcc_lcnn: 0.04, wavlm: 0.01, rawnet2: 0.02, bio: 0.03 } },
  { id: 'SES-9918', speaker: 'SPK-55190', time: '09:12 AM', score: 0.45, peakRisk: 52, status: 'Flagged', analysisType: 'desktop_monitor', chunksAnalyzed: 12, modelBreakdown: { lfcc_lcnn: 0.55, wavlm: 0.22, rawnet2: 0.18, bio: 0.15 } },
  { id: 'SES-9917', speaker: 'SPK-99214', time: '08:45 AM', score: 0.18, peakRisk: 22, status: 'Verified', analysisType: 'snapshot', chunksAnalyzed: 1, modelBreakdown: { lfcc_lcnn: 0.12, wavlm: 0.03, rawnet2: 0.04, bio: 0.06 } },
];

export default function SessionHistory() {
  const [sessions, setSessions] = useState<SessionItem[]>(defaultSessions);

  useEffect(() => {
    let cancelled = false;

    const fetchSessions = () => {
      fetch(`${API_BASE}/api/sessions`, {
        headers: getAuthHeaders(),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (cancelled || !data) return;
          if (Array.isArray(data.sessions) && data.sessions.length > 0) {
            const mapped: SessionItem[] = data.sessions.map((s: any) => {
              const risk = (s.current_risk || 0) / 100;
              const status = risk >= 0.7 ? 'Blocked' : risk >= 0.3 ? 'Flagged' : 'Verified';
              let timeStr = 'Just now';
              if (s.start_time) {
                const d = new Date(s.start_time);
                timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
              }
              return {
                id: s.session_id ? `SES-${s.session_id.slice(0, 6).toUpperCase()}` : 'SES-LIVE',
                speaker: s.speaker_id || (risk >= 0.7 ? 'Synthetic Voice Clone' : 'Verified Human'),
                time: timeStr,
                score: risk,
                peakRisk: s.peak_risk || 0,
                status,
                analysisType: s.analysis_type || 'live_call',
                chunksAnalyzed: s.chunks_analyzed || 0,
                modelBreakdown: s.model_breakdown || null,
              };
            });
            setSessions(mapped);
          }
        })
        .catch(() => {});
    };

    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm text-gray-400">
        <thead className="text-xs uppercase bg-primary text-gray-300">
          <tr>
            <th className="px-4 py-3 rounded-tl-lg">Session</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Speaker</th>
            <th className="px-4 py-3">Time</th>
            <th className="px-4 py-3">Risk</th>
            <th className="px-4 py-3">Model Breakdown</th>
            <th className="px-4 py-3 rounded-tr-lg">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session, idx) => {
            const isHigh = session.score >= 0.70;
            const isMed = session.score >= 0.30 && session.score < 0.70;
            const typeConfig = ANALYSIS_TYPE_LABELS[session.analysisType] || ANALYSIS_TYPE_LABELS.live_call;
            const bd = session.modelBreakdown;

            return (
              <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-mono text-xs text-gray-300">{session.id}</div>
                  {session.chunksAnalyzed > 0 && (
                    <div className="text-[10px] text-gray-500 mt-0.5">{session.chunksAnalyzed} chunks</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${typeConfig.className}`}>
                    {typeConfig.icon}
                    {typeConfig.label}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium text-gray-300 text-xs">{session.speaker}</td>
                <td className="px-4 py-3 text-xs">{session.time}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`font-mono font-bold text-xs ${
                      isHigh ? 'text-danger' : isMed ? 'text-warning' : 'text-success'
                    }`}>
                      {(session.score * 100).toFixed(0)}%
                    </span>
                    <div className="w-14 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${isHigh ? 'bg-danger' : isMed ? 'bg-warning' : 'bg-success'}`}
                        style={{ width: `${session.score * 100}%` }}
                      ></div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {bd ? (
                    <div className="flex items-center gap-1.5 font-mono text-[10px]">
                      <div className="flex flex-col gap-0.5" title={`LFCC: ${((bd.lfcc_lcnn || 0) * 100).toFixed(0)}%`}>
                        <div className="w-10 h-1 bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-cyan-400" style={{ width: `${Math.max(3, (bd.lfcc_lcnn || 0) * 100)}%` }}></div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5" title={`RN2: ${((bd.rawnet2 || 0) * 100).toFixed(0)}%`}>
                        <div className="w-10 h-1 bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400" style={{ width: `${Math.max(3, (bd.rawnet2 || 0) * 100)}%` }}></div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5" title={`WLM: ${((bd.wavlm || 0) * 100).toFixed(0)}%`}>
                        <div className="w-10 h-1 bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-400" style={{ width: `${Math.max(3, (bd.wavlm || 0) * 100)}%` }}></div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5" title={`BIO: ${((bd.bio || 0) * 100).toFixed(0)}%`}>
                        <div className="w-10 h-1 bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-400" style={{ width: `${Math.max(3, (bd.bio || 0) * 100)}%` }}></div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <span className="text-[10px] text-gray-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-md text-xs font-semibold flex items-center w-max gap-1 ${
                    session.status === 'Verified' ? 'bg-success/20 text-success' :
                    session.status === 'Blocked' ? 'bg-danger/20 text-danger' :
                    'bg-warning/20 text-warning'
                  }`}>
                    {session.status === 'Verified' && <ShieldCheck size={14} />}
                    {session.status === 'Blocked' && <ShieldAlert size={14} />}
                    {session.status === 'Flagged' && <Shield size={14} />}
                    {session.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
