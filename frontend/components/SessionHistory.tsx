'use client';

import React, { useState, useEffect } from 'react';
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { API_BASE, getAuthHeaders } from '../lib/config';

interface SessionItem {
  id: string;
  speaker: string;
  time: string;
  score: number;
  status: 'Verified' | 'Flagged' | 'Blocked';
}

const defaultSessions: SessionItem[] = [
  { id: 'SES-9921', speaker: 'SPK-10492', time: '10:42 AM', score: 0.12, status: 'Verified' },
  { id: 'SES-9920', speaker: 'ElevenLabs AI', time: '10:15 AM', score: 0.98, status: 'Blocked' },
  { id: 'SES-9919', speaker: 'SPK-38102', time: '09:30 AM', score: 0.05, status: 'Verified' },
  { id: 'SES-9918', speaker: 'SPK-55190', time: '09:12 AM', score: 0.45, status: 'Flagged' },
  { id: 'SES-9917', speaker: 'SPK-99214', time: '08:45 AM', score: 0.18, status: 'Verified' },
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
            const mapped = data.sessions.map((s: any) => {
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
                status,
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
            <th className="px-6 py-3 rounded-tl-lg">Session ID</th>
            <th className="px-6 py-3">Speaker Info</th>
            <th className="px-6 py-3">Time</th>
            <th className="px-6 py-3">Risk Score</th>
            <th className="px-6 py-3 rounded-tr-lg">Action Taken</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session, idx) => {
            const isHigh = session.score >= 0.70;
            const isMed = session.score >= 0.30 && session.score < 0.70;

            return (
              <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                <td className="px-6 py-4 font-mono">{session.id}</td>
                <td className="px-6 py-4 font-medium text-gray-300">{session.speaker}</td>
                <td className="px-6 py-4">{session.time}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className={`font-mono font-bold ${
                      isHigh ? 'text-danger' : isMed ? 'text-warning' : 'text-success'
                    }`}>
                      {(session.score * 100).toFixed(0)}%
                    </span>
                    <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${isHigh ? 'bg-danger' : isMed ? 'bg-warning' : 'bg-success'}`}
                        style={{ width: `${session.score * 100}%` }}
                      ></div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
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
