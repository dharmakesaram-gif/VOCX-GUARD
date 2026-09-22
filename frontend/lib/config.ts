// Centralized API configuration for production deployment (Vercel, Render, Railway)

export const API_BASE = 
  process.env.NEXT_PUBLIC_API_URL || 
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? '' // Use same-origin relative path to leverage Next.js /api rewrites
    : 'http://localhost:8000');

export const WS_BASE = 
  process.env.NEXT_PUBLIC_WS_URL || 
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? `wss://${window.location.host}`
    : 'ws://localhost:8000');

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
