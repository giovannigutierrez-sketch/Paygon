/**
 * KeyboardShortcutOverlay — the `?` cheat-sheet overlay.
 *
 * Reads from `SHORTCUTS` so docs and behavior cannot drift.
 *
 * NOTE: this is a *visual overlay*, not a modal in the
 * "interrupts the critical path" sense. Pressing `Escape` or `?` again
 * dismisses it without committing any state. It does not block keyboard
 * input on the underlying list — it just darkens it.
 */

'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../utils/cn.js';
import { shortcutsByGroup, type ShortcutDef } from '../keyboard-map.js';

export interface KeyboardShortcutOverlayProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

function renderKeys(keys: ReadonlyArray<string>): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((k, i) => (
        <React.Fragment key={i}>
          <kbd className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-gray-300 bg-gray-50 px-1 font-mono text-2xs text-ink-muted shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {k}
          </kbd>
          {i < keys.length - 1 && (
            <span className="text-ink-subtle text-2xs">then</span>
          )}
        </React.Fragment>
      ))}
    </span>
  );
}

export function KeyboardShortcutOverlay({
  open,
  onClose,
}: KeyboardShortcutOverlayProps): React.JSX.Element | null {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const groups = shortcutsByGroup();
  const groupOrder = ['Navigation', 'List', 'Actions', 'View', 'Help'] as const;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Keyboard shortcuts"
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4',
        'animate-in fade-in'
      )}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-2xl dark:bg-surface-dark-subtle"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between border-b border-gray-200 pb-3 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-ink dark:text-ink-inverse">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-muted hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          {groupOrder.map((g) => {
            const items: ReadonlyArray<ShortcutDef> = groups[g] ?? [];
            if (items.length === 0) return null;
            return (
              <section key={g}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted dark:text-gray-400">
                  {g}
                </h3>
                <ul className="space-y-1.5">
                  {items.map((s, i) => (
                    <li
                      key={`${g}-${i}`}
                      className="flex items-center justify-between gap-4 text-sm"
                    >
                      <span className="text-ink dark:text-gray-200">
                        {s.description}
                      </span>
                      {renderKeys(s.keys)}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <footer className="mt-5 border-t border-gray-200 pt-3 text-xs text-ink-muted dark:border-gray-800 dark:text-gray-400">
          Press <kbd className="rounded border border-gray-300 bg-gray-50 px-1 font-mono text-2xs dark:border-gray-700 dark:bg-gray-900">Esc</kbd> or{' '}
          <kbd className="rounded border border-gray-300 bg-gray-50 px-1 font-mono text-2xs dark:border-gray-700 dark:bg-gray-900">?</kbd> to close.
        </footer>
      </div>
    </div>
  );
}
