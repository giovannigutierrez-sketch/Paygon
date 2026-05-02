/**
 * Paygon design tokens — single source of truth.
 *
 * These mirror the values declared in `tailwind.config.ts`. JS-side code
 * (e.g. dynamic class composition, inline style fallbacks) imports from here.
 * Whenever you add a token, update both files.
 */

export const STATUS_COLORS = {
  clean: {
    label: 'Clean',
    bg: '#ECFDF5',
    fg: '#065F46',
    border: '#A7F3D0',
  },
  'has-exception': {
    label: 'Exception',
    bg: '#FFFBEB',
    fg: '#92400E',
    border: '#FCD34D',
  },
  blocked: {
    label: 'Blocked',
    bg: '#FEF2F2',
    fg: '#991B1B',
    border: '#FCA5A5',
  },
  submitted: {
    label: 'Submitted',
    bg: '#EFF6FF',
    fg: '#1E40AF',
    border: '#93C5FD',
  },
  draft: {
    label: 'Draft',
    bg: '#F3F4F6',
    fg: '#374151',
    border: '#D1D5DB',
  },
} as const;

export type StatusVariant = keyof typeof STATUS_COLORS;

/** Hours-to-deadline thresholds for `DeadlineCountdown` color bands. */
export const DEADLINE_THRESHOLDS = {
  /** Green — comfortable. */
  comfortable: 24,
  /** Amber — getting tight. */
  tight: 6,
} as const;

export const DENSITY = {
  comfortable: { rowHeight: 48, fontSize: 14 },
  compact: { rowHeight: 36, fontSize: 13 },
} as const;

export type Density = keyof typeof DENSITY;
