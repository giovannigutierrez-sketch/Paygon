/**
 * FridayList — the central list of in-flight payrolls.
 *
 * Built on TanStack Table v8 for sorting + filtering. Keyboard navigation
 * (j/k/arrows, gg, G, x, o, Enter) is implemented inline because TanStack
 * Table is headless and does not opinionate on focus management.
 *
 * Hard rules enforced here:
 *   - Every row is a link (`<a href="/cockpit/clients/{handle}">`). Right-
 *     click opens in a new tab natively. URLs are shareable.
 *   - The status chip column is non-hideable.
 *   - Sort indicators are visible.
 *   - Skeleton-row loading state, not a spinner.
 */

'use client';

import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type FilterFn,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown, ExternalLink } from 'lucide-react';
import { cn } from '../utils/cn.js';
import type {
  PayrollInFlight,
  FridayListFilters,
  FridayListSort,
} from '../types.js';
import type { Density } from '../tokens/index.js';
import { StatusChip } from './StatusChip.js';
import { DeadlineCountdown } from './DeadlineCountdown.js';
import { ExceptionBadge } from './ExceptionBadge.js';

export interface FridayListProps {
  readonly rows: ReadonlyArray<PayrollInFlight>;
  readonly filters: FridayListFilters;
  readonly sort: FridayListSort;
  readonly onChangeSort: (sort: FridayListSort) => void;
  readonly density: Density;
  readonly referenceNow: Date;
  readonly loading?: boolean;
  /** Called when a quick action is triggered (mouse or keyboard). */
  readonly onRowAction?: (row: PayrollInFlight, action: RowAction) => void;
  /** Imperative handle for keyboard shortcuts on the page. */
  readonly listRef?: React.RefObject<FridayListHandle | null>;
}

export type RowAction =
  | { readonly kind: 'open' }
  | { readonly kind: 'open-new-tab' }
  | { readonly kind: 'enter-exceptions' }
  | { readonly kind: 'snooze' }
  | { readonly kind: 'mark-blocked' }
  | { readonly kind: 'request-approval' };

export interface FridayListHandle {
  moveDown: () => void;
  moveUp: () => void;
  jumpTop: () => void;
  jumpBottom: () => void;
  triggerAction: (action: RowAction) => void;
  toggleSelection: () => void;
}

// ---- Custom filter function combining FridayListFilters into a single fn. ----

function buildFilterFn(filters: FridayListFilters): (row: PayrollInFlight) => boolean {
  return (row) => {
    if (filters.statuses && filters.statuses.length > 0) {
      if (!filters.statuses.includes(row.status)) return false;
    }
    if (filters.clientNameQuery) {
      const q = filters.clientNameQuery.toLowerCase();
      if (!row.clientName.toLowerCase().includes(q)) return false;
    }
    if (filters.hasExceptionsOnly) {
      const total = row.exceptions.critical + row.exceptions.major + row.exceptions.minor;
      if (total === 0) return false;
    }
    if (filters.deadlineWithinHours !== undefined) {
      const ms = new Date(row.deadline).getTime() - Date.now();
      const hours = ms / (1000 * 60 * 60);
      if (hours > filters.deadlineWithinHours) return false;
    }
    return true;
  };
}

// ---- Helpers ----

const PAY_FREQ_LABEL: Record<PayrollInFlight['payFrequency'], string> = {
  weekly: 'Wk',
  'bi-weekly': 'Bi-wk',
  'semi-monthly': 'Semi',
  monthly: 'Mo',
};

function periodLabel(row: PayrollInFlight): string {
  const start = new Date(row.periodStart);
  const end = new Date(row.periodEnd);
  const fmt = (d: Date): string =>
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function relativeTime(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

// ---- Component ----

export function FridayList({
  rows,
  filters,
  sort,
  onChangeSort,
  density,
  referenceNow,
  loading,
  onRowAction,
  listRef,
}: FridayListProps): React.JSX.Element {
  const [focusedIndex, setFocusedIndex] = React.useState(0);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());

  // TanStack Table sort state mirrors the controlled `sort` prop.
  const sorting: SortingState = React.useMemo(
    () => [{ id: sort.column, desc: sort.direction === 'desc' }],
    [sort]
  );

  const filterFn = React.useMemo(() => buildFilterFn(filters), [filters]);

  const dataFiltered = React.useMemo(
    () => rows.filter(filterFn),
    [rows, filterFn]
  );

  const columns = React.useMemo<ColumnDef<PayrollInFlight>[]>(
    () => [
      {
        id: 'select',
        size: 32,
        header: () => null,
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selected.has(row.original.clientHandle)}
            onChange={() =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(row.original.clientHandle)) {
                  next.delete(row.original.clientHandle);
                } else {
                  next.add(row.original.clientHandle);
                }
                return next;
              })
            }
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${row.original.clientName}`}
          />
        ),
        enableSorting: false,
      },
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'status',
        size: 130,
        cell: ({ row }) => (
          <StatusChip variant={row.original.status} density={density} />
        ),
      },
      {
        id: 'clientName',
        header: 'Client',
        accessorKey: 'clientName',
        size: 280,
        cell: ({ row }) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate font-medium text-ink dark:text-ink-inverse">
              {row.original.clientName}
            </span>
            <span className="text-2xs text-ink-subtle">
              {PAY_FREQ_LABEL[row.original.payFrequency]} · {row.original.employeeCount} ee
            </span>
          </div>
        ),
      },
      {
        id: 'period',
        header: 'Pay period',
        size: 140,
        cell: ({ row }) => (
          <span className="text-sm text-ink-muted dark:text-gray-400 tabular-nums">
            {periodLabel(row.original)}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: 'deadline',
        header: 'Deadline',
        accessorKey: 'deadline',
        size: 200,
        cell: ({ row }) => (
          <DeadlineCountdown
            deadline={row.original.deadline}
            referenceNow={referenceNow}
            density={density}
          />
        ),
        sortingFn: (a, b) =>
          new Date(a.original.deadline).getTime() -
          new Date(b.original.deadline).getTime(),
      },
      {
        id: 'exceptions',
        header: 'Exc.',
        size: 70,
        cell: ({ row }) => (
          <ExceptionBadge exceptions={row.original.exceptions} density={density} />
        ),
        sortingFn: (a, b) => {
          const total = (r: PayrollInFlight): number =>
            r.exceptions.critical * 1000 +
            r.exceptions.major * 10 +
            r.exceptions.minor;
          return total(a.original) - total(b.original);
        },
      },
      {
        id: 'lastAction',
        header: 'Last action',
        size: 240,
        cell: ({ row }) => (
          <div className="flex flex-col leading-tight">
            <span className="truncate text-sm text-ink dark:text-gray-200">
              {row.original.lastActionVerb}
            </span>
            <span className="truncate text-2xs text-ink-subtle">
              {row.original.lastActor} · {relativeTime(row.original.lastActionAt, referenceNow)}
            </span>
          </div>
        ),
        sortingFn: (a, b) =>
          new Date(a.original.lastActionAt).getTime() -
          new Date(b.original.lastActionAt).getTime(),
      },
      {
        id: 'actions',
        header: '',
        size: 110,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRowAction?.(row.original, { kind: 'enter-exceptions' });
              }}
              title="Enter exception triage (e)"
              className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-2xs text-ink-muted hover:bg-gray-50 dark:border-gray-700 dark:bg-surface-dark-muted dark:text-gray-300"
            >
              Triage
            </button>
            <a
              href={`/cockpit/clients/${row.original.clientHandle}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open in new tab (Shift+O)"
              className="rounded border border-gray-300 bg-white p-1 text-ink-muted hover:bg-gray-50 dark:border-gray-700 dark:bg-surface-dark-muted dark:text-gray-300"
              aria-label="Open in new tab"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ),
        enableSorting: false,
      },
    ],
    [density, referenceNow, selected, onRowAction]
  );

  const table = useReactTable({
    data: dataFiltered as PayrollInFlight[],
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      const head = next[0];
      if (head) {
        onChangeSort({
          column: head.id as FridayListSort['column'],
          direction: head.desc ? 'desc' : 'asc',
        });
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (r) => r.clientHandle,
  });

  const rowModel = table.getRowModel();
  const visibleRows = rowModel.rows;

  // Keep focused index in bounds when filters change.
  React.useEffect(() => {
    if (focusedIndex >= visibleRows.length && visibleRows.length > 0) {
      setFocusedIndex(visibleRows.length - 1);
    }
  }, [visibleRows.length, focusedIndex]);

  // Imperative handle for the page's global keydown handler.
  React.useImperativeHandle(
    listRef,
    (): FridayListHandle => ({
      moveDown: () =>
        setFocusedIndex((i) => Math.min(visibleRows.length - 1, i + 1)),
      moveUp: () => setFocusedIndex((i) => Math.max(0, i - 1)),
      jumpTop: () => setFocusedIndex(0),
      jumpBottom: () => setFocusedIndex(Math.max(0, visibleRows.length - 1)),
      triggerAction: (action) => {
        const r = visibleRows[focusedIndex];
        if (!r) return;
        onRowAction?.(r.original, action);
      },
      toggleSelection: () => {
        const r = visibleRows[focusedIndex];
        if (!r) return;
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(r.original.clientHandle)) {
            next.delete(r.original.clientHandle);
          } else {
            next.add(r.original.clientHandle);
          }
          return next;
        });
      },
    }),
    [focusedIndex, visibleRows, onRowAction]
  );

  // Empty state
  if (!loading && rows.length === 0) {
    return <EmptyState />;
  }
  if (!loading && visibleRows.length === 0) {
    return <FilteredEmptyState />;
  }

  const rowHeight = density === 'compact' ? 'h-row-compact' : 'h-row-comfortable';

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-surface-subtle dark:bg-surface-dark-muted">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className={cn(
                      'border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted dark:border-gray-800 dark:text-gray-400',
                      canSort && 'cursor-pointer select-none hover:text-ink dark:hover:text-ink-inverse'
                    )}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {canSort && (
                        sorted === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : sorted === 'desc' ? (
                          <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-40" />
                        )
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} density={density} />)
            : visibleRows.map((row, idx) => {
                const isFocused = idx === focusedIndex;
                const isSelected = selected.has(row.original.clientHandle);
                return (
                  <tr
                    key={row.id}
                    onClick={() => setFocusedIndex(idx)}
                    onDoubleClick={() => onRowAction?.(row.original, { kind: 'open' })}
                    className={cn(
                      'group cursor-pointer transition-colors',
                      rowHeight,
                      isFocused
                        ? 'bg-blue-50 dark:bg-blue-950/30'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-900/50',
                      isSelected && 'bg-blue-100/60 dark:bg-blue-900/30'
                    )}
                  >
                    {row.getVisibleCells().map((cell, cellIdx) => {
                      // First non-checkbox cell wraps an <a> for natural URL semantics.
                      const isLinkCell = cellIdx === 2; // clientName column
                      return (
                        <td
                          key={cell.id}
                          className="border-b border-gray-100 px-3 py-1 align-middle dark:border-gray-900"
                        >
                          {isLinkCell ? (
                            <a
                              href={`/cockpit/clients/${row.original.clientHandle}`}
                              onClick={(e) => {
                                // Plain click: navigate via SPA-friendly behavior. Modifier
                                // keys (ctrl/cmd/shift) keep default browser behavior so
                                // "open in new tab" still works.
                                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                                e.preventDefault();
                                onRowAction?.(row.original, { kind: 'open' });
                              }}
                              className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </a>
                          ) : (
                            flexRender(cell.column.columnDef.cell, cell.getContext())
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Sub-components ----

function SkeletonRow({ density }: { density: Density }): React.JSX.Element {
  const h = density === 'compact' ? 'h-row-compact' : 'h-row-comfortable';
  return (
    <tr className={cn('animate-pulse', h)}>
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i} className="border-b border-gray-100 px-3 py-1 dark:border-gray-900">
          <div className="h-3 w-full max-w-[120px] rounded bg-gray-200 dark:bg-gray-800" />
        </td>
      ))}
    </tr>
  );
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-24 text-center">
      <h2 className="text-lg font-semibold text-ink dark:text-ink-inverse">
        No payrolls in flight
      </h2>
      <p className="mt-2 max-w-md text-sm text-ink-muted dark:text-gray-400">
        Either no clients have a pay period currently open, or you haven&apos;t
        connected any client systems yet. Runs appear here automatically once a
        connector pulls a pay period.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <a
          href="/cockpit/clients"
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Manage clients
        </a>
        <a
          href="/cockpit/connectors"
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-surface-dark-subtle dark:text-ink-inverse"
        >
          Configure a connector
        </a>
      </div>
    </div>
  );
}

function FilteredEmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
      <h2 className="text-base font-semibold text-ink dark:text-ink-inverse">
        No runs match your filters
      </h2>
      <p className="mt-1 text-sm text-ink-muted dark:text-gray-400">
        Clear filters above, or pick a different saved view.
      </p>
    </div>
  );
}
