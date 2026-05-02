// Decimal helpers for the tax engine.
//
// Rules of the road for money math in this engine:
//   1. ALL money is `Decimal`. IEEE-754 floats are forbidden by CLAUDE.md hard rule #8.
//   2. Precision is at least 12 digits (Pub 15 / state DOR guidance).
//   3. We round to the nearest cent (2 decimal places) at "natural" boundaries —
//      per-period FIT, each FICA line, FUTA — never at intermediate sub-calculations.
//   4. Rounding mode is HALF_EVEN ("banker's rounding") per IRS Pub 15 §13 and
//      the federal-income-tax-withholding.md spec preamble. This is what IRS
//      worked examples implicitly use. (Note: HALF_EVEN and HALF_UP produce
//      identical results except at exact .X5 boundaries; the spec's worked
//      examples don't discriminate, so all current vectors pass under either.
//      We follow the spec.)

import Decimal from 'decimal.js';

// Configure decimal.js once for the whole module graph. decimal.js stores config
// globally on the constructor; this assignment is intentionally idempotent.
Decimal.set({
  precision: 28, // generously above the required 12
  rounding: Decimal.ROUND_HALF_EVEN,
});

export const ZERO: Decimal = new Decimal(0);

/**
 * The canonical money rounding boundary used throughout the engine.
 * All per-line outputs (per-period FIT, each FICA line, FUTA) flow through this.
 * Mode: HALF_EVEN (banker's rounding) per IRS Pub 15 §13.
 */
export function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
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
