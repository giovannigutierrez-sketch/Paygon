/**
 * SidePanel — the cockpit's primary contextual surface.
 *
 * Critical-path actions (approve, request approval, mark blocked, snooze
 * exception) open a side panel on the right rather than a modal. The list
 * remains visible and keyboard-navigable; the processor never loses context.
 *
 * Modals are reserved for irreversible destructive confirmations only
 * (e.g. "void submitted run"). This panel is NOT that.
 */

'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../utils/cn.js';

export interface SidePanelProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly width?: 'narrow' | 'medium' | 'wide';
  readonly children: React.ReactNode;
}

const WIDTH_CLASSES = {
  narrow: 'w-[360px]',
  medium: 'w-[480px]',
  wide: 'w-[640px]',
} as const;

export function SidePanel({
  open,
  title,
  onClose,
  width = 'medium',
  children,
}: SidePanelProps): React.JSX.Element | null {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside
      role="complementary"
      aria-label={title}
      className={cn(
        'fixed right-0 top-0 z-40 flex h-full flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-surface-dark-subtle',
        WIDTH_CLASSES[width]
      )}
    >
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-ink dark:text-ink-inverse">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="rounded p-1 text-ink-muted hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
  );
}
