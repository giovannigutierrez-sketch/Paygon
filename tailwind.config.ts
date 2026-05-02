import type { Config } from 'tailwindcss';

// Paygon design tokens. Mirror values in src/ui/tokens/index.ts so JS-side code can
// reference them too (e.g. inline styles, conditional class composition).
const config: Config = {
  darkMode: 'class',
  content: ['./src/app/**/*.{ts,tsx}', './src/ui/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Status palette — used by StatusChip, DeadlineCountdown, ExceptionBadge.
        status: {
          clean: {
            bg: '#ECFDF5',
            fg: '#065F46',
            border: '#A7F3D0',
            'bg-dark': '#022C22',
            'fg-dark': '#6EE7B7',
            'border-dark': '#065F46',
          },
          exception: {
            bg: '#FFFBEB',
            fg: '#92400E',
            border: '#FCD34D',
            'bg-dark': '#451A03',
            'fg-dark': '#FCD34D',
            'border-dark': '#92400E',
          },
          blocked: {
            bg: '#FEF2F2',
            fg: '#991B1B',
            border: '#FCA5A5',
            'bg-dark': '#450A0A',
            'fg-dark': '#FCA5A5',
            'border-dark': '#991B1B',
          },
          submitted: {
            bg: '#EFF6FF',
            fg: '#1E40AF',
            border: '#93C5FD',
            'bg-dark': '#172554',
            'fg-dark': '#93C5FD',
            'border-dark': '#1E40AF',
          },
          draft: {
            bg: '#F3F4F6',
            fg: '#374151',
            border: '#D1D5DB',
            'bg-dark': '#1F2937',
            'fg-dark': '#9CA3AF',
            'border-dark': '#4B5563',
          },
        },
        surface: {
          DEFAULT: '#FFFFFF',
          subtle: '#F9FAFB',
          muted: '#F3F4F6',
          dark: '#0B0F14',
          'dark-subtle': '#111827',
          'dark-muted': '#1F2937',
        },
        ink: {
          DEFAULT: '#0F172A',
          muted: '#475569',
          subtle: '#94A3B8',
          inverse: '#F8FAFC',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          'Inter',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Compact-density-tuned scale.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }], // 11px
        xs: ['0.75rem', { lineHeight: '1.125rem' }], // 12px
        sm: ['0.8125rem', { lineHeight: '1.25rem' }], // 13px
      },
      spacing: {
        'row-comfortable': '3rem', // 48px
        'row-compact': '2.25rem', // 36px (~25% reduction)
      },
    },
  },
  plugins: [],
};

export default config;
