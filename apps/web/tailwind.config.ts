import type { Config } from 'tailwindcss';

// Design tokens for the FinTrack admin shell. All fonts/assets are local (system font stack, inline SVG icons).
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      colors: {
        primary: { DEFAULT: '#5750F1', soft: 'rgba(87,80,241,0.08)' },
        dark: { DEFAULT: '#111928', 2: '#1F2A37', 3: '#374151', 4: '#4B5563', 5: '#6B7280', 6: '#9CA3AF' },
        gray: { 1: '#F9FAFB', 2: '#F3F4F6', 3: '#E5E7EB', 4: '#D1D5DB' },
        stroke: { DEFAULT: '#E6EBF1', dark: '#27303E' },
        canvas: { DEFAULT: '#F7F9FC', dark: '#020D1A' },
        surface: { dark: '#122031' },
        green: { DEFAULT: '#22AD5C', soft: 'rgba(34,173,92,0.08)' },
        red: { DEFAULT: '#F23030', soft: 'rgba(242,48,48,0.08)' },
        amber: { DEFAULT: '#F59E0B', soft: 'rgba(245,158,11,0.1)' },
        blue: { DEFAULT: '#3C50E0', soft: 'rgba(60,80,224,0.08)' },
      },
      boxShadow: {
        card: '0px 1px 2px 0px rgba(84, 87, 118, 0.12)',
        float: '0px 8px 13px -3px rgba(0, 0, 0, 0.07)',
      },
      borderRadius: { card: '10px' },
    },
  },
  plugins: [],
};
export default config;
