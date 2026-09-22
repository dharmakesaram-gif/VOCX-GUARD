import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1a1a2e',
        accent: '#00d4ff',
        danger: 'var(--cyber-crimson, #ff0055)',
        warning: 'var(--cyber-amber, #ffaa00)',
        success: 'var(--cyber-emerald, #00ff88)',
        background: 'var(--background, #060814)',
        foreground: 'var(--foreground, #f0f4fc)',
        'cyber-blue': 'var(--cyber-blue, #00f0ff)',
        'cyber-emerald': 'var(--cyber-emerald, #00ff88)',
        'cyber-crimson': 'var(--cyber-crimson, #ff0055)',
        'cyber-amber': 'var(--cyber-amber, #ffaa00)',
        'card-bg': 'var(--card-bg, rgba(13, 17, 38, 0.7))',
        'border-glow': 'var(--border-glow, rgba(0, 240, 255, 0.18))',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      keyframes: {
        'slide-down': {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        }
      },
      animation: {
        'slide-down': 'slide-down 0.5s ease-out',
      },
    },
  },
  plugins: [],
}
export default config
