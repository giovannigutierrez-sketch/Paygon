// Decimal helpers for the tax engine.
//
// Rules of the road for money math in this engine:
//   1. ALL money is `Decimal`. IEEE-754 floats are forbidden by CLAUDE.md hard rule #8.
//   2. Precision is at least 12 digits (Pub 15 / state DOR guidance).
//   3. We round to the nearest cent (2 decimal places) at "natural" boundaries —
//      per-period FIT, each FICA line, FUTA — never at intermediate sub-calculations.
//   4. Rounding mode is HALF_UP per the engineer's operational instruction.
//      Note: the FIT spec (federal-income-tax-withholding.md, Algorithm preamble)
//      identifies HALF_EVEN as the canonical mode. The user-supplied implementation
//      brief overrides that to HALF_UP. This mismatch is flagged for
//      payroll-domain-expert reconciliation; the engine code is centralized here so
//      switching is a one-line change if the spec wins.

import Decimal from 'decimal.js';

// Configure decimal.js once for the whole module graph. decimal.js stores config
// globally on the constructor; this assignment is intentionally idempotent.
Decimal.set({
  precision: 28, // generously above the required 12
  rounding: Decimal.ROUND_HALF_UP,
});

export const ZERO: Decimal = new Decimal(0);

/**
 * The canonical money rounding boundary used throughout the engine.
 * All per-line outputs (per-period FIT, each FICA line, FUTA) flow through this.
 */
export function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Decimal max(a, 0). Used heavily in worksheet clamps.
 */
export function clampNonNegative(value: Decimal): Decimal {
  return value.isNegative() ? ZERO : value;
}

/**
 * Decimal min.
 */
export function decMin(a: Decimal, b: Decimal): Decimal {
  return a.lessThan(b) ? a : b;
}

/**
 * Decimal max.
 */
export function decMax(a: Decimal, b: Decimal): Decimal {
  return a.greaterThan(b) ? a : b;
}

/**
 * Coerce unknown numeric-ish values from JSON rule data into Decimal.
 * Strings are preferred (they're exact); numbers go through Decimal's constructor.
 */
export function toDecimal(value: string | number | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value);
}

/**
 * Render a Decimal as a stable decimal-string for the trace ledger.
 * Trace strings must be reproducible byte-for-byte.
 */
export function traceMoney(value: Decimal): string {
  return value.toFixed(2);
}

/**
 * Render a Decimal at full precision for trace inputs that aren't money
 * (e.g., a rate like 0.062, or a wage-base intermediate like 184500.0000000001).
 */
export function traceExact(value: Decimal): string {
  return value.toString();
}
