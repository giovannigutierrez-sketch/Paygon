/**
 * Single source of truth for keyboard shortcuts in the cockpit.
 *
 * The `?` overlay reads from `SHORTCUTS` to render the cheat sheet. Components
 * that bind keys reference `SHORTCUTS` so docs and behavior cannot drift.
 *
 * Conventions:
 * - Single-key shortcuts are unmodified (no Ctrl/Cmd) and live in the row scope.
 * - Two-key sequences (`g` then `f`) follow Vim's leader pattern; the second
 *   key must be pressed within `SEQUENCE_TIMEOUT_MS`.
 * - `?` is reserved for the overlay itself.
 * - Modifier shortcuts (Cmd/Ctrl + K) are reserved for the global command bar
 *   (future round, not in this prototype).
 */

export interface ShortcutDef {
  readonly keys: ReadonlyArray<string>;
  readonly description: string;
  readonly scope: 'global' | 'list' | 'detail';
  /** Optional grouping for the overlay (e.g. "Navigation", "List", "Actions"). */
  readonly group: 'Navigation' | 'List' | 'Actions' | 'View' | 'Help';
}

export const SEQUENCE_TIMEOUT_MS = 1200;

export const SHORTCUTS: ReadonlyArray<ShortcutDef> = [
  // ---- Navigation ----
  {
    keys: ['g', 'f'],
    description: 'Go to Friday cockpit',
    scope: 'global',
    group: 'Navigation',
  },
  {
    keys: ['g', 'c'],
    description: 'Go to clients index',
    scope: 'global',
    group: 'Navigation',
  },
  {
    keys: ['g', 'e'],
    description: 'Go to exceptions queue',
    scope: 'global',
    group: 'Navigation',
  },

  // ---- List navigation ----
  {
    keys: ['j'],
    description: 'Move down one row',
    scope: 'list',
    group: 'List',
  },
  {
    keys: ['k'],
    description: 'Move up one row',
    scope: 'list',
    group: 'List',
  },
  {
    keys: ['ArrowDown'],
    description: 'Move down one row',
    scope: 'list',
    group: 'List',
  },
  {
    keys: ['ArrowUp'],
    description: 'Move up one row',
    scope: 'list',
    group: 'List',
  },
  {
    keys: ['gg'],
    description: 'Jump to top of list',
    scope: 'list',
    group: 'List',
  },
  {
    keys: ['G'],
    description: 'Jump to bottom of list',
    scope: 'list',
    group: 'List',
  },
  {
    keys: ['x'],
    description: 'Toggle row selection (for bulk actions)',
    scope: 'list',
    group: 'List',
  },

  // ---- Per-row actions ----
  {
    keys: ['o', 'Enter'],
    description: 'Open client payroll detail',
    scope: 'list',
    group: 'Actions',
  },
  {
    keys: ['O'],
    description: 'Open client detail in new tab',
    scope: 'list',
    group: 'Actions',
  },
  {
    keys: ['e'],
    description: 'Enter exception triage for this row',
    scope: 'list',
    group: 'Actions',
  },
  {
    keys: ['s'],
    description: 'Snooze top exception on this row',
    scope: 'list',
    group: 'Actions',
  },
  {
    keys: ['b'],
    description: 'Mark row blocked (opens side panel)',
    scope: 'list',
    group: 'Actions',
  },
  {
    keys: ['a'],
    description: 'Request client approval (opens side panel)',
    scope: 'list',
    group: 'Actions',
  },

  // ---- View / filtering ----
  {
    keys: ['/'],
    description: 'Focus filter input',
    scope: 'list',
    group: 'View',
  },
  {
    keys: ['f', 's'],
    description: 'Save current view',
    scope: 'list',
    group: 'View',
  },
  {
    keys: ['f', 'd'],
    description: 'Discard view changes',
    scope: 'list',
    group: 'View',
  },
  {
    keys: ['['],
    description: 'Previous saved view',
    scope: 'list',
    group: 'View',
  },
  {
    keys: [']'],
    description: 'Next saved view',
    scope: 'list',
    group: 'View',
  },
  {
    keys: ['d'],
    description: 'Toggle compact density',
    scope: 'global',
    group: 'View',
  },

  // ---- Help / panels ----
  {
    keys: ['?'],
    description: 'Show keyboard shortcut overlay',
    scope: 'global',
    group: 'Help',
  },
  {
    keys: ['Escape'],
    description: 'Close side panel / overlay',
    scope: 'global',
    group: 'Help',
  },
];

/** Helper: keys grouped for the overlay. */
export function shortcutsByGroup(): Record<string, ReadonlyArray<ShortcutDef>> {
  const out: Record<string, ShortcutDef[]> = {};
  for (const s of SHORTCUTS) {
    const arr = out[s.group] ?? (out[s.group] = []);
    arr.push(s);
  }
  return out;
}
