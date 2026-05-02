// PROTOTYPE — Friday cockpit prototype page.
//
// This page is for showing real service-bureau processors and reacting to
// their feedback. It is NOT production-wired:
//   - Mocked fixtures, no API calls.
//   - No auth.
//   - No persistence of saved views.
//   - REFERENCE_NOW is a fixed instant so deadlines render deterministically.
//
// Source of truth: docs/ux/screens/friday-cockpit.md

'use client';

import * as React from 'react';
import { Keyboard } from 'lucide-react';
import { FridayList, type FridayListHandle, type RowAction } from '../../ui/components/FridayList.js';
import { FilterBar } from '../../ui/components/FilterBar.js';
import { KeyboardShortcutOverlay } from '../../ui/components/KeyboardShortcutOverlay.js';
import { SidePanel } from '../../ui/components/SidePanel.js';
import { StatusChip } from '../../ui/components/StatusChip.js';
import { ExceptionBadge } from '../../ui/components/ExceptionBadge.js';
import { DeadlineCountdown } from '../../ui/components/DeadlineCountdown.js';
import {
  FRIDAY_FIXTURES,
  MOCK_SAVED_VIEWS,
  REFERENCE_NOW,
} from '../../ui/fixtures/friday-cockpit.js';
import type {
  FridayListFilters,
  FridayListSort,
  PayrollInFlight,
} from '../../ui/types.js';
import type { Density } from '../../ui/tokens/index.js';
import { SEQUENCE_TIMEOUT_MS } from '../../ui/keyboard-map.js';

interface SidePanelState {
  readonly kind: 'approval' | 'block' | 'snooze';
  readonly row: PayrollInFlight;
}

export default function CockpitPage(): React.JSX.Element {
  const [filters, setFilters] = React.useState<FridayListFilters>({});
  const [sort, setSort] = React.useState<FridayListSort>({
    column: 'deadline',
    direction: 'asc',
  });
  const [activeViewId, setActiveViewId] = React.useState<string>(MOCK_SAVED_VIEWS[0]?.id ?? '');
  const [density, setDensity] = React.useState<Density>('comfortable');
  const [overlayOpen, setOverlayOpen] = React.useState(false);
  const [sidePanel, setSidePanel] = React.useState<SidePanelState | null>(null);
  const [actionLog, setActionLog] = React.useState<ReadonlyArray<string>>([]);

  const listRef = React.useRef<FridayListHandle | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  // ---- Saved view handling ----
  const handleChangeView = (viewId: string): void => {
    setActiveViewId(viewId);
    const v = MOCK_SAVED_VIEWS.find((x) => x.id === viewId);
    if (v) {
      setFilters(v.filters);
      setSort(v.sort);
    }
  };

  // ---- Row actions ----
  const handleRowAction = React.useCallback((row: PayrollInFlight, action: RowAction): void => {
    setActionLog((prev) => [
      `${new Date().toLocaleTimeString()} — ${action.kind} on ${row.clientName}`,
      ...prev.slice(0, 4),
    ]);
    switch (action.kind) {
      case 'open':
        // Single-page-app navigation would happen here. For prototype, just log.
        window.history.pushState({}, '', `/cockpit/clients/${row.clientHandle}`);
        break;
      case 'open-new-tab':
        window.open(`/cockpit/clients/${row.clientHandle}`, '_blank', 'noreferrer');
        break;
      case 'enter-exceptions':
        window.history.pushState({}, '', `/cockpit/clients/${row.clientHandle}/exceptions`);
        break;
      case 'snooze':
        setSidePanel({ kind: 'snooze', row });
        break;
      case 'mark-blocked':
        setSidePanel({ kind: 'block', row });
        break;
      case 'request-approval':
        setSidePanel({ kind: 'approval', row });
        break;
    }
  }, []);

  // ---- Global keyboard handler ----
  // Implements the multi-key sequences defined in keyboard-map.ts.
  React.useEffect(() => {
    let pendingPrefix: string | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const clearPending = (): void => {
      pendingPrefix = null;
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    };

    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      // The `?` overlay binding is global, even while typing — but most
      // shortcuts are suppressed inside inputs.
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        // Allow opening the overlay even from inputs with shift+/ since that
        // is unambiguous.
        if (!isTyping || e.shiftKey) {
          e.preventDefault();
          setOverlayOpen((v) => !v);
          clearPending();
          return;
        }
      }

      if (e.key === 'Escape') {
        if (sidePanel) setSidePanel(null);
        if (overlayOpen) setOverlayOpen(false);
        if (target instanceof HTMLElement) target.blur();
        clearPending();
        return;
      }

      // Slash focuses the search box.
      if (e.key === '/' && !isTyping) {
        e.preventDefault();
        searchInputRef.current?.focus();
        clearPending();
        return;
      }

      if (isTyping) return;

      // Two-key sequences.
      if (pendingPrefix === 'g') {
        if (e.key === 'f') {
          // Already on Friday view.
          clearPending();
          return;
        }
        if (e.key === 'g') {
          listRef.current?.jumpTop();
          clearPending();
          return;
        }
        clearPending();
      }
      if (pendingPrefix === 'f') {
        if (e.key === 's') {
          setActionLog((p) => [`${new Date().toLocaleTimeString()} — saved view (mock)`, ...p.slice(0, 4)]);
        } else if (e.key === 'd') {
          setActionLog((p) => [`${new Date().toLocaleTimeString()} — discarded view changes (mock)`, ...p.slice(0, 4)]);
        }
        clearPending();
        return;
      }

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          listRef.current?.moveDown();
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          listRef.current?.moveUp();
          break;
        case 'G':
          e.preventDefault();
          listRef.current?.jumpBottom();
          break;
        case 'g':
        case 'f':
          // Begin a 2-key sequence.
          pendingPrefix = e.key;
          pendingTimer = setTimeout(() => {
            pendingPrefix = null;
            pendingTimer = null;
          }, SEQUENCE_TIMEOUT_MS);
          break;
        case 'o':
        case 'Enter':
          e.preventDefault();
          listRef.current?.triggerAction({ kind: 'open' });
          break;
        case 'O':
          e.preventDefault();
          listRef.current?.triggerAction({ kind: 'open-new-tab' });
          break;
        case 'e':
          e.preventDefault();
          listRef.current?.triggerAction({ kind: 'enter-exceptions' });
          break;
        case 's':
          e.preventDefault();
          listRef.current?.triggerAction({ kind: 'snooze' });
          break;
        case 'b':
          e.preventDefault();
          listRef.current?.triggerAction({ kind: 'mark-blocked' });
          break;
        case 'a':
          e.preventDefault();
          listRef.current?.triggerAction({ kind: 'request-approval' });
          break;
        case 'x':
          e.preventDefault();
          listRef.current?.toggleSelection();
          break;
        case 'd':
          e.preventDefault();
          setDensity((v) => (v === 'comfortable' ? 'compact' : 'comfortable'));
          break;
        case '[':
          e.preventDefault();
          {
            const i = MOCK_SAVED_VIEWS.findIndex((v) => v.id === activeViewId);
            const prev = MOCK_SAVED_VIEWS[(i - 1 + MOCK_SAVED_VIEWS.length) % MOCK_SAVED_VIEWS.length];
            if (prev) handleChangeView(prev.id);
          }
          break;
        case ']':
          e.preventDefault();
          {
            const i = MOCK_SAVED_VIEWS.findIndex((v) => v.id === activeViewId);
            const next = MOCK_SAVED_VIEWS[(i + 1) % MOCK_SAVED_VIEWS.length];
            if (next) handleChangeView(next.id);
          }
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (pendingTimer) clearTimeout(pendingTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeViewId, sidePanel, overlayOpen]);

  // Counts for the filter bar.
  const totalCount = FRIDAY_FIXTURES.length;
  const visibleCount = React.useMemo(() => {
    const f = filters;
    return FRIDAY_FIXTURES.filter((row) => {
      if (f.statuses && f.statuses.length > 0 && !f.statuses.includes(row.status)) return false;
      if (f.clientNameQuery && !row.clientName.toLowerCase().includes(f.clientNameQuery.toLowerCase())) return false;
      if (f.hasExceptionsOnly) {
        const t = row.exceptions.critical + row.exceptions.major + row.exceptions.minor;
        if (t === 0) return false;
      }
      return true;
    }).length;
  }, [filters]);

  return (
    <div className="flex h-screen flex-col bg-surface-subtle dark:bg-surface-dark">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-surface px-4 py-2 dark:border-gray-800 dark:bg-surface-dark-subtle">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-ink dark:text-ink-inverse">
            Paygon Cockpit
          </span>
          <span className="text-xs text-ink-subtle">
            Friday · {REFERENCE_NOW.toLocaleString(undefined, {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}
          </span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-2xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            PROTOTYPE
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-muted dark:text-gray-400">
          <RunSummary rows={FRIDAY_FIXTURES} />
          <button
            type="button"
            onClick={() => setOverlayOpen(true)}
            title="Show keyboard shortcuts (?)"
            className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50 dark:border-gray-700 dark:bg-surface-dark-muted dark:hover:bg-gray-800"
          >
            <Keyboard className="h-3.5 w-3.5" />
            Shortcuts
          </button>
        </div>
      </header>

      <FilterBar
        savedViews={MOCK_SAVED_VIEWS}
        activeViewId={activeViewId}
        onChangeView={handleChangeView}
        filters={filters}
        onChangeFilters={setFilters}
        density={density}
        onToggleDensity={() => setDensity((v) => (v === 'comfortable' ? 'compact' : 'comfortable'))}
        counts={{ visible: visibleCount, total: totalCount }}
        searchInputRef={searchInputRef}
      />

      <FridayList
        rows={FRIDAY_FIXTURES}
        filters={filters}
        sort={sort}
        onChangeSort={setSort}
        density={density}
        referenceNow={REFERENCE_NOW}
        onRowAction={handleRowAction}
        listRef={listRef}
      />

      {/* Action log strip — handy during prototype demos */}
      {actionLog.length > 0 && (
        <div className="border-t border-gray-200 bg-surface-muted px-4 py-1 text-2xs text-ink-muted dark:border-gray-800 dark:bg-surface-dark-muted dark:text-gray-400">
          <span className="mr-2 font-semibold uppercase tracking-wide">Recent (mock):</span>
          {actionLog.slice(0, 3).join('  ·  ')}
        </div>
      )}

      <KeyboardShortcutOverlay
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
      />

      <SidePanel
        open={sidePanel !== null}
        title={sidePanel ? sidePanelTitle(sidePanel) : ''}
        onClose={() => setSidePanel(null)}
      >
        {sidePanel && <SidePanelBody state={sidePanel} />}
      </SidePanel>
    </div>
  );
}

// ---- Small components used by the page ----

function RunSummary({ rows }: { rows: ReadonlyArray<PayrollInFlight> }): React.JSX.Element {
  const counts = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  return (
    <div className="flex items-center gap-1.5">
      {(['blocked', 'has-exception', 'clean', 'submitted', 'draft'] as const).map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <StatusChip variant={s} density="compact" label={`${counts[s] ?? 0} ${s}`} />
        </span>
      ))}
    </div>
  );
}

function sidePanelTitle(state: SidePanelState): string {
  switch (state.kind) {
    case 'approval':
      return `Request approval — ${state.row.clientName}`;
    case 'block':
      return `Mark blocked — ${state.row.clientName}`;
    case 'snooze':
      return `Snooze exception — ${state.row.clientName}`;
  }
}

function SidePanelBody({ state }: { state: SidePanelState }): React.JSX.Element {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-2">
        <StatusChip variant={state.row.status} />
        <ExceptionBadge exceptions={state.row.exceptions} />
        <DeadlineCountdown deadline={state.row.deadline} referenceNow={REFERENCE_NOW} />
      </div>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-ink-muted">Client</dt>
        <dd className="text-ink dark:text-gray-200">{state.row.clientName}</dd>
        <dt className="text-ink-muted">Pay frequency</dt>
        <dd className="text-ink dark:text-gray-200">{state.row.payFrequency}</dd>
        <dt className="text-ink-muted">Employees</dt>
        <dd className="text-ink dark:text-gray-200">{state.row.employeeCount}</dd>
        <dt className="text-ink-muted">Last action</dt>
        <dd className="text-ink dark:text-gray-200">
          {state.row.lastActionVerb} — {state.row.lastActor}
        </dd>
      </dl>

      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
        Side-panel body for <strong>{state.kind}</strong> is a stub. The real
        form (note field, approver picker, due time, etc.) is the subject of
        the next round of design.
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-surface-dark-muted dark:text-ink-inverse dark:hover:bg-gray-800"
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
