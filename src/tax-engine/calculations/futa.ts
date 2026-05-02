// FUTA — federal unemployment tax.
//
// Source: docs/payroll-semantics/futa.md
//
// Employer side only. Per-period accrual against a $7,000-per-employee
// per-calendar-year cap. Effective rate is:
//   - 6.0% if state UI was not paid timely (full credit lost)
//   - 0.6% + creditReductionPercent otherwise
//
// `creditReductionPercent` and `stateUiPaidTimely` are employer-config /
// per-state inputs, not rule data. Default 0 / true. The DOL credit-reduction
// list is published in November for the prior year; until then the engine
// runs with 0 and the year-end true-up adjusts on Form 940.

import Decimal from 'decimal.js';

import { ZERO, clampNonNegative, decMin, roundMoney, toDecimal, traceMoney } from '../core/decimal.js';
import type { TraceBuilder } from '../core/trace.js';
import type { FederalRuleSet } from '../core/rule-types.js';

interface FutaArgs {
  readonly futaWagesThisPeriod: Decimal;
  readonly futaYtdPrior: Decimal;
  readonly creditReductionPercent: Decimal;
  readonly stateUiPaidTimely: boolean;
  readonly rules: FederalRuleSet;
  readonly trace: TraceBuilder;
}

export function computeFuta({
  futaWagesThisPeriod,
  futaYtdPrior,
  creditReductionPercent,
  stateUiPaidTimely,
  rules,
  trace,
}: FutaArgs): Decimal {
  const grossRate = toDecimal(rules.futa.grossRate);
  const stateCredit = toDecimal(rules.futa.stateCredit);
  const wageBase = toDecimal(rules.futa.wageBase);

  // Effective rate.
  const effectiveRate = stateUiPaidTimely
    ? grossRate.minus(stateCredit).plus(creditReductionPercent)
    : grossRate;

  // Wage-base crossing.
  const remainingBase = clampNonNegative(wageBase.minus(futaYtdPrior));
  const taxable = decMin(futaWagesThisPeriod, remainingBase);

  const futaTax = roundMoney(taxable.times(effectiveRate));

  trace.add(
    'futa.compute',
    {
      futaWagesThisPeriod: traceMoney(futaWagesThisPeriod),
      futaYtdPrior: traceMoney(futaYtdPrior),
      wageBase: wageBase.toString(),
      remainingBase: traceMoney(remainingBase),
      taxableThisPeriod: traceMoney(taxable),
      grossRate: grossRate.toString(),
      stateCredit: stateCredit.toString(),
      creditReductionPercent: creditReductionPercent.toString(),
      stateUiPaidTimely: String(stateUiPaidTimely),
      effectiveRate: effectiveRate.toString(),
    },
    traceMoney(futaTax),
  );

  // Negative-wage corrections: spec allows negative accrual (refund); spec also
  // says clamp behavior on the downstream report. The arithmetic here passes
  // through naturally — `taxable` would be negative if `futaWagesThisPeriod` is
  // negative and `futaYtdPrior` is below the base. We do NOT clamp at zero
  // here because that would silently swallow legitimate corrections.
  if (futaTax.isNegative()) {
    trace.add(
      'futa.negative-correction-flag',
      { futaTax: traceMoney(futaTax) },
      'flagged',
    );
  }

  // Defensive: if futaTax came out negative and futaWagesThisPeriod is positive,
  // something is wrong with effectiveRate (would imply negative effective rate).
  // The check below guards rule-data malformation, not legitimate corrections.
  if (futaTax.isNegative() && futaWagesThisPeriod.greaterThan(ZERO)) {
    throw new Error(
      `Negative FUTA on positive wages — effectiveRate=${effectiveRate.toString()} is malformed.`,
    );
  }

  return futaTax;
}
