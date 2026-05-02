/**
 * ExceptionBadge — small inline badge showing the count and severity weight
 * of exceptions on a row.
 *
 * Severity color hierarchy: critical (red) > major (amber) > minor (grey).
 * The badge color is the highest severity present; the count is the sum.
 * If the count exceeds 99 we render "99+" — Friday cockpits with thousands
 * of exceptions have happened (large clients with bad time-clock imports).
 */

'use client';

import * as React from 'react';
import { cn } from '../utils/cn.js';
import type { ExceptionSummary } from '../types.js';

export interface ExceptionBadgeProps {
  readonly exceptions: ExceptionSummary;
  readonly density?: 'comfortable' | 'compact';
  readonly className?: string;
}

function topSeverity(e: ExceptionSummary): 'critical' | 'major' | 'minor' | 'none' {
  if (e.critical > 0) return 'critical';
  if (e.major > 0) return 'major';
  if (e.minor > 0) return 'minor';
  return 'none';
}

const SEVERITY_CLASSES: Record<'critical' | 'major' | 'minor' | 'none', string> = {
  critical:
    'bg-red-100 text-red-800 border-red-300 ' +
    'dark:bg-red-950/50 dark:text-red-200 dark:border-red-800',
  major:
    'bg-amber-100 text-amber-800 border-amber-300 ' +
    'dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800',
  minor:
    'bg-gray-100 text-gray-700 border-gray-300 ' +
    'dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600',
  none: 'bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-900 dark:text-gray-600',
};

export function ExceptionBadge({
  exceptions,
  density = 'comfortable',
  className,
}: ExceptionBadgeProps): React.JSX.Element {
  const total = exceptions.critical + exceptions.major + exceptions.minor;
  const severity = topSeverity(exceptions);
  const display = total > 99 ? '99+' : String(total);
  const tooltip =
    total === 0
      ? 'No exceptions'
      : `${exceptions.critical} critical · ${exceptions.major} major · ${exceptions.minor} minor`;

  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      className={cn(
        'inline-flex items-center justify-center rounded border font-mono font-medium tabular-nums',
        density === 'compact' ? 'h-5 min-w-[1.5rem] px-1 text-2xs' : 'h-6 min-w-[1.75rem] px-1.5 text-xs',
        SEVERITY_CLASSES[severity],
        total === 0 && 'opacity-60',
        className
      )}
    >
      {display}
    </span>
  );
}
