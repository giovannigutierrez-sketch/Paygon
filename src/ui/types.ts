/**
 * Cockpit-side types. These describe what the UI *displays* — they are NOT a
 * backend schema and they intentionally hold no PII (see ADR 0001).
 *
 * The Friday view's central row type is `PayrollInFlight`. Backend wiring
 * later will produce values of this shape from session-scoped working state.
 */

import type { StatusVariant } from './tokens/index.js';

/** Severity of an exception. Drives both color and ordering. */
export type ExceptionSeverity = 'critical' | 'major' | 'minor';

export interface ExceptionSummary {
  readonly critical: number;
  readonly major: number;
  readonly minor: number;
}

/** Pay frequency used in the row's pay-period display. */
export type PayFrequency =
  | 'weekly'
  | 'bi-weekly'
  | 'semi-monthly'
  | 'monthly';

/**
 * One row in the Friday cockpit list. Identified by an opaque session-scoped
 * handle — never the client's EIN or legal name on the wire (legal name is
 * displayed text only, mirrored from session state, not persisted by Paygon).
 *
 * @see docs/adr/0001-no-pii-at-rest.md
 */
export interface PayrollInFlight {
  /** Opaque session handle. Used in URLs: `/cockpit/clients/{handle}`. */
  readonly clientHandle: string;
  /** Display-only client name (synthetic in fixtures; mirrored from source in real use). */
  readonly clientName: string;
  /** Pay frequency (drives the period-label format). */
  readonly payFrequency: PayFrequency;
  /** ISO 8601 date — first day of the pay period. */
  readonly periodStart: string;
  /** ISO 8601 date — last day of the pay period. */
  readonly periodEnd: string;
  /** ISO 8601 timestamp — submit-by deadline. */
  readonly deadline: string;
  /** Number of employees in this run. Used for the secondary metric. */
  readonly employeeCount: number;
  /** Run status. Drives the chip. */
  readonly status: StatusVariant;
  /** Exception breakdown by severity. Sum drives the badge. */
  readonly exceptions: ExceptionSummary;
  /** ISO 8601 timestamp of the most recent processor action on this run. */
  readonly lastActionAt: string;
  /** Display name of the actor (a Paygon processor; not a client employee). */
  readonly lastActor: string;
  /** Short verb ('imported hours', 'snoozed exception', etc) — last action label. */
  readonly lastActionVerb: string;
  /** Optional: client-side approver display name if approval has been requested. */
  readonly approvalRequestedFrom?: string;
}

/** A processor-saved view of the Friday list. */
export interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly filters: FridayListFilters;
  readonly sort: FridayListSort;
}

export interface FridayListFilters {
  // `| undefined` is intentional — matches `exactOptionalPropertyTypes: true`
  // and lets controlled inputs zero out a filter by setting it to undefined.
  readonly statuses?: ReadonlyArray<StatusVariant> | undefined;
  readonly clientNameQuery?: string | undefined;
  readonly hasExceptionsOnly?: boolean | undefined;
  readonly deadlineWithinHours?: number | undefined;
}

export interface FridayListSort {
  readonly column: 'deadline' | 'clientName' | 'status' | 'exceptions' | 'lastActionAt';
  readonly direction: 'asc' | 'desc';
}
