/**
 * DeadlineCountdown — colored countdown showing time-until-deadline.
 *
 * Color bands (per `DEADLINE_THRESHOLDS`):
 *   - >24h           green  — comfortable
 *   - 6h–24h         amber  — getting tight
 *   - <6h            red    — urgent
 *   - past deadline  red    — "MISSED" label
 *
 * The component re-renders only when `referenceNow` changes. The cockpit page
 * passes a fixed `REFERENCE_NOW` for the prototype; production wiring will
 * pass a live ticker prop.
 */

'use client';

import * as React from 'react';
import { cn } from '../utils/cn.js';
import { DEADLINE_THRESHOLDS } from '../tokens/index.js';

export interface DeadlineCountdownProps {
  /** ISO timestamp of the deadline. */
  readonly deadline: string;
  /** ISO timestamp representing "now" (use a ticker in production). */
  readonly referenceNow: Date;
  readonly density?: 'comfortable' | 'compact';
  readonly className?: string;
}

type Band = 'comfortable' | 'tight' | 'urgent' | 'missed';

function bandFor(hoursRemaining: number): Band {
  if (hoursRemaining < 0) return 'missed';
  if (hoursRemaining < DEADLINE_THRESHOLDS.tight) return 'urgent';
  if (hoursRemaining < DEADLINE_THRESHOLDS.comfortable) return 'tight';
  return 'comfortable';
}

const BAND_CLASSES: Record<Band, string> = {
  comfortable:
    'text-emerald-700 dark:text-emerald-300',
  tight:
    'text-amber-700 dark:text-amber-300',
  urgent:
    'text-red-700 dark:text-red-300 font-semibold',
  missed:
    'text-red-800 dark:text-red-200 font-bold',
};

function formatRemaining(hoursRemaining: number): string {
  if (hoursRemaining < 0) {
    const overdue = Math.abs(hoursRemaining);
    if (overdue < 1) return `MISSED ${Math.round(overdue * 60)}m`;
    if (overdue < 24) return `MISSED ${Math.round(overdue)}h`;
    return `MISSED ${Math.round(overdue / 24)}d`;
  }
  if (hoursRemaining < 1) {
    const minutes = Math.max(1, Math.round(hoursRemaining * 60));
    return `${minutes}m`;
  }
  if (hoursRemaining < 24) {
    const h = Math.floor(hoursRemaining);
    const m = Math.round((hoursRemaining - h) * 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  const days = Math.floor(hoursRemaining / 24);
  const h = Math.round(hoursRemaining - days * 24);
  return h === 0 ? `${days}d` : `${days}d ${h}h`;
}

export function DeadlineCountdown({
  deadline,
  referenceNow,
  density = 'comfortable',
  className,
}: DeadlineCountdownProps): React.JSX.Element {
  const deadlineMs = new Date(deadline).getTime();
  const hoursRemaining = (deadlineMs - referenceNow.getTime()) / (1000 * 60 * 60);
  const band = bandFor(hoursRemaining);
  const label = formatRemaining(hoursRemaining);
  const absLabel = new Date(deadline).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <span
      title={`Deadline: ${new Date(deadline).toLocaleString()}`}
      className={cn(
        'inline-flex items-baseline gap-1.5 tabular-nums',
        density === 'compact' ? 'text-xs' : 'text-sm',
        BAND_CLASSES[band],
        className
      )}
    >
      <span>{label}</span>
      <span className="text-ink-subtle text-2xs font-normal">{absLabel}</span>
    </span>
  );
}
