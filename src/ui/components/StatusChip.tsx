/**
 * StatusChip — the canonical run-status indicator.
 *
 * The chip is the most-scanned element on the cockpit. Its color is the
 * single fact a processor needs to know "what state is this client in" from
 * across the room.
 *
 * Variants are intentionally limited to the 5 documented in the screen spec.
 * Adding a sixth requires updating tokens, the spec, and this file together.
 */

'use client';

import * as React from 'react';
import { cn } from '../utils/cn.js';
import { STATUS_COLORS, type StatusVariant } from '../tokens/index.js';

export interface StatusChipProps {
  readonly variant: StatusVariant;
  /**
   * Override the rendered label (e.g. "Submitted 09:14"). Defaults to the
   * canonical variant label from tokens.
   */
  readonly label?: string;
  /** Compact density renders a smaller chip. */
  readonly density?: 'comfortable' | 'compact';
  readonly className?: string;
}

const VARIANT_CLASSES: Record<StatusVariant, string> = {
  clean:
    'bg-status-clean-bg text-status-clean-fg border-status-clean-border ' +
    'dark:bg-status-clean-bg-dark dark:text-status-clean-fg-dark dark:border-status-clean-border-dark',
  'has-exception':
    'bg-status-exception-bg text-status-exception-fg border-status-exception-border ' +
    'dark:bg-status-exception-bg-dark dark:text-status-exception-fg-dark dark:border-status-exception-border-dark',
  blocked:
    'bg-status-blocked-bg text-status-blocked-fg border-status-blocked-border ' +
    'dark:bg-status-blocked-bg-dark dark:text-status-blocked-fg-dark dark:border-status-blocked-border-dark',
  submitted:
    'bg-status-submitted-bg text-status-submitted-fg border-status-submitted-border ' +
    'dark:bg-status-submitted-bg-dark dark:text-status-submitted-fg-dark dark:border-status-submitted-border-dark',
  draft:
    'bg-status-draft-bg text-status-draft-fg border-status-draft-border ' +
    'dark:bg-status-draft-bg-dark dark:text-status-draft-fg-dark dark:border-status-draft-border-dark',
};

const DOT_CLASSES: Record<StatusVariant, string> = {
  clean: 'bg-emerald-500',
  'has-exception': 'bg-amber-500',
  blocked: 'bg-red-500',
  submitted: 'bg-blue-500',
  draft: 'bg-gray-400',
};

export function StatusChip({
  variant,
  label,
  density = 'comfortable',
  className,
}: StatusChipProps): React.JSX.Element {
  const text = label ?? STATUS_COLORS[variant].label;
  return (
    <span
      role="status"
      aria-label={`Status: ${STATUS_COLORS[variant].label}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium uppercase tracking-wide',
        density === 'compact'
          ? 'px-2 py-0.5 text-2xs'
          : 'px-2.5 py-0.5 text-xs',
        VARIANT_CLASSES[variant],
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-1.5 w-1.5 rounded-full', DOT_CLASSES[variant])}
      />
      {text}
    </span>
  );
}
