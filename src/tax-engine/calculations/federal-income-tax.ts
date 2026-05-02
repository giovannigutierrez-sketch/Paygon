// Federal income tax — percentage method, automated payroll system.
//
// Source: IRS Pub 15-T (2026) Worksheet 1A. Spec:
// docs/payroll-semantics/federal-income-tax-withholding.md
//
// This calculation is employee-side only — there is no employer match for FIT.
//
// The bracket data comes from rule data (rules/federal/2026.json). This file
// contains no jurisdiction-specific constants — it is the algorithm only. To
// add a state with the same algorithm shape (annualized + bracket schedule),
// supply that state's brackets in rule data; do not branch this code.

import Decimal from 'decimal.js';

import type { CalcInput, FilingStatus } from '../calculate.js';
import { ZERO, clampNonNegative, decMax, roundMoney, toDecimal, traceMoney } from '../core/decimal.js';
import { periodsPerYear } from '../core/pay-frequency.js';
import type { TraceBuilder } from '../core/trace.js';
import type { FederalFitBracket, FederalRuleSet } from '../core/rule-types.js';

interface FitArgs {
  readonly federalTaxableWages: Decimal;
  readonly input: CalcInput;
  readonly rules: FederalRuleSet;
  readonly trace: TraceBuilder;
}

export function computeFederalIncomeTax({
  federalTaxableWages,
  input,
  rules,
  trace,
}: FitArgs): Decimal {
  // Edge case: negative federal taxable wages (correction/void) — Pub 15-T
  // worksheet does not contemplate negative wages. Spec rule:
  // engine returns $0 and emits trace.
  if (federalTaxableWages.isNegative()) {
    trace.add(
      'fit.skip-negative-wages',
      { federalTaxableWages: traceMoney(federalTaxableWages) },
      traceMoney(ZERO),
    );
    return ZERO;
  }

  const N = periodsPerYear(input.payFrequency);

  // Worksheet 1A line 1c — annualized period wages.
  const annualized = federalTaxableWages.times(N);

  // 1d — add Step 4(a) other income.
  const adjusted1d = annualized.plus(input.w4.step4aOtherIncome);

  // 1e/1f — subtract Step 4(b) deductions.
  const adjusted1f = adjusted1d.minus(input.w4.step4bDeductions);

  // 1g — clamp at 0.
  const adjusted1g = clampNonNegative(adjusted1f);

  trace.add(
    'fit.annualize',
    {
      taxableWagesThisPeriod: traceMoney(federalTaxableWages),
      periodsPerYear: N.toString(),
      annualizedWages: traceMoney(annualized),
      step4aOtherIncome: traceMoney(input.w4.step4aOtherIncome),
      step4bDeductions: traceMoney(input.w4.step4bDeductions),
    },
    traceMoney(adjusted1g),
  );

  // Step 3 — bracket lookup.
  const table = selectFitTable(rules, input.w4.filingStatus, input.w4.step2Checkbox);
  const bracket = findBracket(table, adjusted1g);

  // 1h — tentative annual tax.
  const rate = toDecimal(bracket.rate);
  const tentativeTax = toDecimal(bracket.tentativeTax).plus(
    rate.times(adjusted1g.minus(toDecimal(bracket.ofExcessOver))),
  );

  trace.add(
    'fit.bracket-lookup',
    {
      filingStatus: input.w4.filingStatus,
      step2Checkbox: String(input.w4.step2Checkbox),
      adjustedAnnualWages: traceMoney(adjusted1g),
      bracketAtLeast: bracket.atLeast,
      bracketLessThan: bracket.lessThan,
      bracketTentativeTax: bracket.tentativeTax,
      bracketRate: bracket.rate,
      bracketOfExcessOver: bracket.ofExcessOver,
    },
    traceMoney(tentativeTax),
  );

  // Step 4 — apply Step 3 dependent credit.
  const afterDependents = decMax(tentativeTax.minus(input.w4.step3DependentsCredit), ZERO);

  trace.add(
    'fit.dependent-credit',
    {
      tentativeAnnualTax: traceMoney(tentativeTax),
      step3DependentsCredit: traceMoney(input.w4.step3DependentsCredit),
    },
    traceMoney(afterDependents),
  );

  // Step 5 — convert to per-period and add Step 4(c).
  const perPeriodBeforeExtra = afterDependents.dividedBy(N);
  const perPeriodWithExtra = perPeriodBeforeExtra.plus(input.w4.step4cExtraWithholding);

  // Step 6 — round at the natural boundary, clamp at 0.
  const rounded = roundMoney(perPeriodWithExtra);
  const final = decMax(rounded, ZERO);

  trace.add(
    'fit.per-period',
    {
      annualWithholdingAfterCredit: traceMoney(afterDependents),
      periodsPerYear: N.toString(),
      perPeriodBeforeExtra: perPeriodBeforeExtra.toString(),
      step4cExtraWithholding: traceMoney(input.w4.step4cExtraWithholding),
    },
    traceMoney(final),
  );

  return final;
}

function selectFitTable(
  rules: FederalRuleSet,
  filingStatus: FilingStatus,
  step2Checkbox: boolean,
): ReadonlyArray<FederalFitBracket> {
  const schedule = step2Checkbox
    ? rules.fit.schedules.step2Checkbox
    : rules.fit.schedules.standard;
  // FilingStatus is a closed union; this is a Record lookup, not an index signature.
  return schedule[filingStatus];
}

function findBracket(
  table: ReadonlyArray<FederalFitBracket>,
  adjustedAnnualWages: Decimal,
): FederalFitBracket {
  for (const bracket of table) {
    const lo = toDecimal(bracket.atLeast);
    const hi = bracket.lessThan === 'Infinity' ? null : toDecimal(bracket.lessThan);
    const inRange =
      adjustedAnnualWages.greaterThanOrEqualTo(lo) &&
      (hi === null || adjustedAnnualWages.lessThan(hi));
    if (inRange) return bracket;
  }
  // Unreachable if rule data is well-formed — top bracket extends to Infinity.
  throw new Error(
    `No FIT bracket matched annual wages ${adjustedAnnualWages.toString()}; rule data is malformed.`,
  );
}
