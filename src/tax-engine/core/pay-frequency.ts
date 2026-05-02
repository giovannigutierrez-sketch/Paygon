// Pay-frequency utilities.
//
// The annualization factor `N` is fixed by IRS Pub 15-T Worksheet 1A,
// line 1b. These values are the same regardless of jurisdiction; states
// that use the federal annualized method inherit them.

import Decimal from 'decimal.js';

import type { PayFrequency } from '../calculate.js';

const PERIODS_PER_YEAR: Readonly<Record<PayFrequency, number>> = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMIMONTHLY: 24,
  MONTHLY: 12,
  QUARTERLY: 4,
  SEMIANNUAL: 2,
  ANNUAL: 1,
  DAILY: 260,
};

export function periodsPerYear(payFrequency: PayFrequency): Decimal {
  // Property access on a Record<>; not an index signature, so direct access is fine.
  return new Decimal(PERIODS_PER_YEAR[payFrequency]);
}
