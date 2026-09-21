// Centralized API configuration for production deployment (Vercel, Render, Railway)

export const API_BASE = 
  process.env.NEXT_PUBLIC_API_URL || 
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? `https://${window.location.hostname.replace('vocxguard-web', 'vocxguard-backend')}`
    : 'http://localhost:8000');

export const WS_BASE = 
  process.env.NEXT_PUBLIC_WS_URL || 
  API_BASE.replace(/^http/, 'ws');
