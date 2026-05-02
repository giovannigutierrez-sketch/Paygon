/**
 * FilterBar — top of the Friday list. Holds:
 *   - Saved-view selector (with prev/next via `[` and `]`)
 *   - Free-text client filter (focusable via `/`)
 *   - Status multi-select (chips)
 *   - "Has exceptions only" toggle
 *   - Density toggle
 *
 * This is a controlled component. The page owns filter state.
 */

'use client';

import * as React from 'react';
import { Search, ListFilter, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '../utils/cn.js';
import { STATUS_COLORS, type StatusVariant, type Density } from '../tokens/index.js';
import { StatusChip } from './StatusChip.js';
import type { FridayListFilters, SavedView } from '../types.js';

export interface FilterBarProps {
  readonly savedViews: ReadonlyArray<SavedView>;
  readonly activeViewId: string;
  readonly onChangeView: (viewId: string) => void;
  readonly filters: FridayListFilters;
  readonly onChangeFilters: (filters: FridayListFilters) => void;
  readonly density: Density;
  readonly onToggleDensity: () => void;
  /** Total visible / total un-filtered, displayed at the right edge. */
  readonly counts: { readonly visible: number; readonly total: number };
  readonly searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

const ALL_STATUSES: ReadonlyArray<StatusVariant> = [
  'clean',
  'has-exception',
  'blocked',
  'submitted',
  'draft',
];

export function FilterBar({
  savedViews,
  activeViewId,
  onChangeView,
  filters,
  onChangeFilters,
  density,
  onToggleDensity,
  counts,
  searchInputRef,
}: FilterBarProps): React.JSX.Element {
  const toggleStatus = (s: StatusVariant): void => {
    const current = new Set(filters.statuses ?? []);
    if (current.has(s)) {
      current.delete(s);
    } else {
      current.add(s);
    }
    const next = Array.from(current);
    onChangeFilters({
      ...filters,
      statuses: next.length > 0 ? next : undefined,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-surface px-4 py-2 dark:border-gray-800 dark:bg-surface-dark">
      {/* Saved views */}
      <div className="flex items-center gap-1">
        <ListFilter className="h-4 w-4 text-ink-muted" aria-hidden="true" />
        <label className="sr-only" htmlFor="saved-view-select">
          Saved view
        </label>
        <select
          id="saved-view-select"
          value={activeViewId}
          onChange={(e) => onChangeView(e.target.value)}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-surface-dark-subtle dark:text-ink-inverse"
        >
          {savedViews.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      {/* Search */}
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2 h-4 w-4 text-ink-subtle" aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="search"
          placeholder="Filter by client name…   ( / )"
          value={filters.clientNameQuery ?? ''}
          onChange={(e) =>
            onChangeFilters({
              ...filters,
              clientNameQuery: e.target.value || undefined,
            })
          }
          className="w-72 rounded border border-gray-300 bg-white py-1 pl-8 pr-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-surface-dark-subtle dark:text-ink-inverse"
          aria-label="Filter clients by name"
        />
      </div>

      {/* Status chip filters */}
      <div className="flex flex-wrap items-center gap-1">
        {ALL_STATUSES.map((s) => {
          const active = filters.statuses?.includes(s) ?? false;
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              aria-pressed={active}
              className={cn(
                'rounded-full transition-opacity',
                active ? 'opacity-100' : 'opacity-50 hover:opacity-80'
              )}
              title={`Filter to ${STATUS_COLORS[s].label}`}
            >
              <StatusChip variant={s} density="compact" />
            </button>
          );
        })}
      </div>

      {/* Has-exceptions only */}
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted dark:text-gray-400">
        <input
          type="checkbox"
          checked={filters.hasExceptionsOnly ?? false}
          onChange={(e) =>
            onChangeFilters({
              ...filters,
              hasExceptionsOnly: e.target.checked || undefined,
            })
          }
          className="rounded"
        />
        Exceptions only
      </label>

      {/* Spacer + count + density toggle */}
      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs text-ink-muted tabular-nums dark:text-gray-400">
          {counts.visible} / {counts.total} runs
        </span>
        <button
          type="button"
          onClick={onToggleDensity}
          title={density === 'comfortable' ? 'Switch to compact (d)' : 'Switch to comfortable (d)'}
          className="rounded border border-gray-300 bg-white p-1 text-ink-muted hover:bg-gray-50 dark:border-gray-700 dark:bg-surface-dark-subtle dark:text-gray-300 dark:hover:bg-gray-800"
          aria-label="Toggle row density"
        >
          {density === 'comfortable' ? (
            <Minimize2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
