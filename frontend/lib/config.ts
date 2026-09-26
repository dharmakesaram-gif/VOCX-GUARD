// Centralized API configuration for production deployment (Vercel, Render, Railway)

const isLocalHost = typeof window !== 'undefined' && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname.startsWith('192.168.') ||
  window.location.hostname.startsWith('10.')
);

export const API_BASE = 
  process.env.NEXT_PUBLIC_API_URL || 
  (typeof window !== 'undefined'
    ? (isLocalHost ? `http://${window.location.hostname}:8000` : '')
    : 'http://localhost:8000');

export const WS_BASE = 
  process.env.NEXT_PUBLIC_WS_URL || 
  (typeof window !== 'undefined'
    ? (isLocalHost ? `ws://${window.location.hostname}:8000/ws/stream` : `wss://${window.location.host}`)
    : 'ws://localhost:8000/ws/stream');

export const API_KEY = process.env.NEXT_PUBLIC_API_KEY || '';

export function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Bypass-Tunnel-Reminder': 'true',
    ...extraHeaders,
  };
  if (API_KEY) {
    headers['X-API-Key'] = API_KEY;
  }
  return headers;
}
