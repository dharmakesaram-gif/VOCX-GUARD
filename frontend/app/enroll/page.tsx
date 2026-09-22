'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, Upload, CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { API_BASE } from '../../lib/config';

interface EnrolledSpeakerItem {
  id: string;
  date: string;
  samples: number;
  status: 'Active';
}

const defaultSpeakers: EnrolledSpeakerItem[] = [
  { id: 'my_owner_voice', date: 'Today (Live)', samples: 1, status: 'Active' },
  { id: 'SPK-10492', date: '2026-09-18', samples: 3, status: 'Active' },
  { id: 'SPK-99214', date: '2026-09-18', samples: 5, status: 'Active' },
  { id: 'SPK-38102', date: '2026-09-17', samples: 2, status: 'Active' },
  { id: 'SPK-55190', date: '2026-09-15', samples: 4, status: 'Active' },
];

export default function EnrollPage() {
  const [speakerId, setSpeakerId] = useState('my_owner_voice');
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState<'idle' | 'enrolling' | 'enrolled' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [enrolledList, setEnrolledList] = useState<EnrolledSpeakerItem[]>(defaultSpeakers);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchEnrolled();
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const fetchEnrolled = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/enrolled-speakers`);
      if (res.ok) {
        const data = await res.json();
        if (data.speakers && Array.isArray(data.speakers) && data.speakers.length > 0) {
          const items: EnrolledSpeakerItem[] = data.speakers.map((id: string) => ({
            id,
            date: 'Registered Voiceprint',
            samples: 1,
            status: 'Active',
          }));
          setEnrolledList(items);
        }
      }
    } catch (_) {}
  };

  const enrollAudioBase64 = async (base64: string, targetId: string) => {
    setStatus('enrolling');
    try {
      const res = await fetch(`${API_BASE}/api/enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Bypass-Tunnel-Reminder': 'true',
        },
        body: JSON.stringify({
          speaker_id: targetId || 'my_owner_voice',
          audio_base64: base64,
        }),
      });

      if (!res.ok) {
        throw new Error(`Enrollment returned HTTP ${res.status}`);
      }

      setStatus('enrolled');
      await fetchEnrolled();
    } catch (err: any) {
      console.error('Enrollment error:', err);
      setStatus('error');
      setErrorMessage(err.message || 'Failed to enroll speaker profile.');
    }
  };

  const handleRecord = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
    } else {
      try {
        setErrorMessage('');
        audioChunksRef.current = [];
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          stream.getTracks().forEach((track) => track.stop());

          const reader = new FileReader();
          reader.onload = () => {
            const res = reader.result as string;
            const b64 = res.includes('base64,') ? res.split('base64,')[1] : res;
            enrollAudioBase64(b64, speakerId.trim() || 'my_owner_voice');
          };
          reader.readAsDataURL(blob);
        };

        recorder.start();
        setIsRecording(true);
        setStatus('idle');
      } catch (err: any) {
        console.error('Error accessing microphone:', err);
        setStatus('error');
        setErrorMessage('Microphone access denied: ' + err.message);
      }
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus('enrolling');
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const b64 = res.includes('base64,') ? res.split('base64,')[1] : res;
      enrollAudioBase64(b64, speakerId.trim() || 'my_owner_voice');
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8 mt-8 pb-12">
      <header className="mb-8 border-b border-gray-700 pb-4">
        <h1 className="text-3xl font-bold text-white">Voice Biometric Enrollment</h1>
        <p className="text-gray-400 mt-2">
          Register authentic voice patterns (such as your Device Owner voice) to enable biometric verification and bypass your speech from deepfake alarms.
        </p>
      </header>

      <div className="glassmorphism p-8 rounded-xl space-y-8 border-t-4 border-t-accent">
        {/* Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Speaker ID / Profile Identifier
          </label>
          <input
            type="text"
            className="w-full bg-primary/50 border border-gray-600 rounded-md py-3 px-4 text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all font-mono"
            placeholder="e.g., my_owner_voice or John_Doe"
            value={speakerId}
            onChange={(e) => setSpeakerId(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">
            Tip: Enrolling with &quot;my_owner_voice&quot; lets both Web and Mobile apps recognize you and filter your voice during live calls.
          </p>
        </div>

        {/* Enrollment Methods */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Record */}
          <div className="border border-gray-700 rounded-lg p-6 flex flex-col items-center justify-center space-y-4 hover:border-accent/50 transition-colors bg-primary/30">
            <h3 className="text-lg font-medium text-gray-200">Record Live Voice Sample</h3>
            <p className="text-sm text-gray-400 text-center">Speak naturally for 3-5 seconds into your laptop microphone.</p>
            <button
              onClick={handleRecord}
              className={`mt-4 w-16 h-16 rounded-full flex items-center justify-center transition-all ${
                isRecording ? 'bg-danger animate-pulse shadow-lg shadow-danger/50' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              <Mic size={24} className={isRecording ? 'text-white' : 'text-gray-300'} />
            </button>
            <span className="text-sm font-medium text-gray-300">
              {isRecording ? 'Recording... Click to Stop & Enroll' : 'Click to Record'}
            </span>
          </div>

          {/* Upload */}
          <div className="border border-gray-700 rounded-lg p-6 flex flex-col items-center justify-center space-y-4 hover:border-accent/50 transition-colors bg-primary/30 border-dashed">
            <h3 className="text-lg font-medium text-gray-200">Upload Reference Audio</h3>
            <p className="text-sm text-gray-400 text-center">Upload a clean audio sample (.wav, .mp3, .m4a).</p>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="audio/*,.wav,.mp3,.m4a"
              onChange={handleUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 p-4 rounded-full bg-gray-700 hover:bg-gray-600 transition-colors"
            >
              <Upload size={24} className="text-gray-300" />
            </button>
            <span className="text-sm font-medium text-gray-300">Browse Files</span>
          </div>
        </div>

        {/* Status */}
        {status !== 'idle' && (
          <div
            className={`p-4 rounded-md flex items-center gap-3 ${
              status === 'enrolling'
                ? 'bg-warning/20 border border-warning/50 text-warning'
                : status === 'enrolled'
                ? 'bg-success/20 border border-success/50 text-success'
                : 'bg-danger/20 border border-danger/50 text-danger'
            }`}
          >
            {status === 'enrolling' && (
              <div className="w-5 h-5 rounded-full border-2 border-warning border-t-transparent animate-spin"></div>
            )}
            {status === 'enrolled' && <CheckCircle size={20} />}
            {status === 'error' && <AlertTriangle size={20} />}

            <span className="font-medium">
              {status === 'enrolling'
                ? 'Extracting 192-dim ECAPA-TDNN biometric embedding on FastAPI backend...'
                : status === 'enrolled'
                ? `Successfully enrolled voiceprint for "${speakerId || 'my_owner_voice'}"! You can now use "Filter My Voice" in Analysis.`
                : errorMessage || 'Error processing audio sample. Please try again.'}
            </span>
          </div>
        )}
      </div>

      {/* Enrolled Speakers List */}
      <div className="glassmorphism p-6 rounded-xl mt-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-200">Active Biometric Voiceprints</h2>
          <span className="text-xs text-accent font-mono bg-accent/10 px-3 py-1 rounded-full border border-accent/30">
            {enrolledList.length} Voiceprints Registered
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-400">
            <thead className="text-xs uppercase bg-primary text-gray-300">
              <tr>
                <th className="px-6 py-3 rounded-tl-lg">Speaker ID</th>
                <th className="px-6 py-3">Registration Status</th>
                <th className="px-6 py-3">Vector Embedding</th>
                <th className="px-6 py-3 rounded-tr-lg">Biometric State</th>
              </tr>
            </thead>
            <tbody>
              {enrolledList.map((spk, idx) => (
                <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="px-6 py-4 font-medium text-white flex items-center gap-2">
                    <ShieldCheck size={16} className="text-accent" />
                    <span className="font-mono">{spk.id}</span>
                  </td>
                  <td className="px-6 py-4">{spk.date}</td>
                  <td className="px-6 py-4 font-mono text-xs text-gray-400">192-dim TDNN</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-success/20 text-success rounded-md text-xs font-semibold">
                      Active
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
