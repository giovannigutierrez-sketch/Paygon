// Property-based tests for the federal tax engine.
//
// Catches what example-based vectors miss — generates thousands of inputs and
// asserts invariants that must hold across the entire valid input space.
//
// Invariants exercised here:
//   1. Two-sided completeness: every result has employeeSide and employerSide
//      with all expected keys present.
//   2. FICA match equality: employer SS match == employee SS; employer Medicare
//      match == employee Medicare. Additional Medicare 0.9% is employee-only;
//      the employer side has no field for it.
//   3. FUTA upper bound (single-period): futa <= grossWages * (0.006 + creditReductionPercent),
//      and futa >= 0 always.
//   4. Total burdened cost balance: totals.employerTotalBurdenedCost ==
//      totals.employeeGross + employerSide.ficaSocialSecurityMatch
//                            + employerSide.ficaMedicareMatch
//                            + employerSide.futa.
//   5. Reproducibility: calculate(x) called twice returns equal Decimals
//      everywhere.
//
// Wage-base crossings are exercised separately under explicit `it()` blocks
// rather than left to chance in random generation, so we know coverage there
// is intentional, not statistical.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import Decimal from 'decimal.js';

import { calculate } from '../../src/tax-engine/calculate.js';
import type {
  CalcInput,
  CalcResult,
  EmployerConfig,
  FilingStatus,
  PayFrequency,
} from '../../src/tax-engine/calculate.js';

// ---------- Generators ----------

const PAY_FREQUENCIES: ReadonlyArray<PayFrequency> = [
  'WEEKLY',
  'BIWEEKLY',
  'SEMIMONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
  'DAILY',
];

const FILING_STATUSES: ReadonlyArray<FilingStatus> = [
  'SINGLE_OR_MFS',
  'MARRIED_FILING_JOINTLY',
  'HEAD_OF_HOUSEHOLD',
];

// fast-check's fc.float returns IEEE-754 floats. We immediately wrap them in
// Decimal and round to 2 decimals for money — Decimal's own arithmetic will
// keep precision from then on. The float here is just a generator source;
// no subsequent arithmetic touches it.
const moneyArb = (min: number, max: number): fc.Arbitrary<Decimal> =>
  fc
    .float({ noNaN: true, noDefaultInfinity: true, min: Math.fround(min), max: Math.fround(max) })
    .map((n) => new Decimal(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));

const calcInputArb: fc.Arbitrary<CalcInput> = fc.record({
  effectiveDate: fc.constant('2026-06-15'),
  payFrequency: fc.constantFrom(...PAY_FREQUENCIES),
  // Bound wages per period to a realistic working range (0..50,000) so we don't
  // trivially blow past every wage base on every run. Wage-base crossings have
  // their own dedicated tests below.
  grossWagesThisPeriod: moneyArb(0, 50000),
  pretaxDeductionsThisPeriod: fc.constant(new Decimal(0)),
  // Bound YTD reasonably; covers below-base, near-base, and above-base regimes.
  ytdWagesBeforePeriod: moneyArb(0, 300000),
  ytdFutaWagesBeforePeriod: moneyArb(0, 14000),
  w4: fc.record({
    filingStatus: fc.constantFrom(...FILING_STATUSES),
    step2Checkbox: fc.boolean(),
    step3DependentsCredit: moneyArb(0, 10000),
    step4aOtherIncome: moneyArb(0, 50000),
    step4bDeductions: moneyArb(0, 50000),
    step4cExtraWithholding: moneyArb(0, 500),
  }),
});

const employerConfigArb: fc.Arbitrary<EmployerConfig> = fc.record({
  // 0..0.054 — credit reduction can never push the employer past the gross 6.0%.
  futaCreditReductionPercent: fc
    .float({ noNaN: true, noDefaultInfinity: true, min: 0, max: Math.fround(0.054) })
    .map((n) => new Decimal(n).toDecimalPlaces(4, Decimal.ROUND_HALF_UP)),
});

// ---------- Helpers ----------

function assertResultShape(result: CalcResult): void {
  expect(result.employeeSide).toBeDefined();
  expect(result.employerSide).toBeDefined();
  expect(result.totals).toBeDefined();
  expect(result.trace).toBeDefined();
  expect(result.ruleSetVersion).toBeTypeOf('string');

  // All employee-side keys present (with Decimal values, possibly zero).
  expect(Decimal.isDecimal(result.employeeSide.federalIncomeTax)).toBe(true);
  expect(Decimal.isDecimal(result.employeeSide.ficaSocialSecurity)).toBe(true);
  expect(Decimal.isDecimal(result.employeeSide.ficaMedicare)).toBe(true);
  expect(Decimal.isDecimal(result.employeeSide.ficaAdditionalMedicare)).toBe(true);

  // All employer-side keys present.
  expect(Decimal.isDecimal(result.employerSide.ficaSocialSecurityMatch)).toBe(true);
  expect(Decimal.isDecimal(result.employerSide.ficaMedicareMatch)).toBe(true);
  expect(Decimal.isDecimal(result.employerSide.futa)).toBe(true);

  // Totals.
  expect(Decimal.isDecimal(result.totals.employeeGross)).toBe(true);
  expect(Decimal.isDecimal(result.totals.federalTaxableWages)).toBe(true);
  expect(Decimal.isDecimal(result.totals.employeeNet)).toBe(true);
  expect(Decimal.isDecimal(result.totals.employerTotalBurdenedCost)).toBe(true);
}

const PROPERTY_RUNS = 1000;

// ---------- Tests ----------

describe('federal engine invariants (property)', () => {
  it('two-sided completeness — every result has employeeSide AND employerSide AND totals', () => {
    fc.assert(
      fc.property(calcInputArb, employerConfigArb, (input, config) => {
        const result = calculate(input, config);
        assertResultShape(result);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('FICA match equality — employer SS match equals employee SS; employer Medicare match equals employee Medicare', () => {
    fc.assert(
      fc.property(calcInputArb, employerConfigArb, (input, config) => {
        const result = calculate(input, config);
        // Employer matches employee FICA exactly, line-by-line, per §3111.
        expect(
          result.employerSide.ficaSocialSecurityMatch.equals(result.employeeSide.ficaSocialSecurity),
        ).toBe(true);
        expect(
          result.employerSide.ficaMedicareMatch.equals(result.employeeSide.ficaMedicare),
        ).toBe(true);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('Additional Medicare 0.9% is employee-only — the employer side has no matching field', () => {
    // Confirm structurally:
    //   - employerSide has exactly three keys: ficaSocialSecurityMatch,
    //     ficaMedicareMatch, futa.
    //   - employeeSide carries the ficaAdditionalMedicare field (a Decimal).
    // §3101(b)(2) imposes the 0.9% on employees; §3111 has no matching
    // employer-side line.
    const expectedEmployerKeys = ['ficaMedicareMatch', 'ficaSocialSecurityMatch', 'futa'].sort();
    fc.assert(
      fc.property(calcInputArb, employerConfigArb, (input, config) => {
        const result = calculate(input, config);
        const employerKeys = Object.keys(result.employerSide).sort();
        expect(employerKeys).toEqual(expectedEmployerKeys);
        expect(Decimal.isDecimal(result.employeeSide.ficaAdditionalMedicare)).toBe(true);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('FUTA per-period upper bound — futa <= grossWages * (0.006 + creditReduction); futa >= 0', () => {
    fc.assert(
      fc.property(calcInputArb, employerConfigArb, (input, config) => {
        const result = calculate(input, config);
        const upperBoundRate = new Decimal('0.006').plus(config.futaCreditReductionPercent);
        const upperBound = input.grossWagesThisPeriod.times(upperBoundRate);
        // Allow a 1-cent rounding slack in either direction (HALF_UP can round
        // up by up to 0.005, and the bound was computed without rounding).
        const slack = new Decimal('0.01');
        expect(result.employerSide.futa.lte(upperBound.plus(slack))).toBe(true);
        expect(result.employerSide.futa.gte(0)).toBe(true);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('total burdened cost balance — totals == employeeGross + sum(employer-side amounts)', () => {
    fc.assert(
      fc.property(calcInputArb, employerConfigArb, (input, config) => {
        const result = calculate(input, config);
        const expected = result.totals.employeeGross
          .plus(result.employerSide.ficaSocialSecurityMatch)
          .plus(result.employerSide.ficaMedicareMatch)
          .plus(result.employerSide.futa);
        expect(result.totals.employerTotalBurdenedCost.equals(expected)).toBe(true);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('reproducibility — same input twice returns equal Decimals at every numeric field', () => {
    fc.assert(
      fc.property(calcInputArb, employerConfigArb, (input, config) => {
        const r1 = calculate(input, config);
        const r2 = calculate(input, config);

        // Employee side
        expect(r1.employeeSide.federalIncomeTax.equals(r2.employeeSide.federalIncomeTax)).toBe(true);
        expect(r1.employeeSide.ficaSocialSecurity.equals(r2.employeeSide.ficaSocialSecurity)).toBe(
          true,
        );
        expect(r1.employeeSide.ficaMedicare.equals(r2.employeeSide.ficaMedicare)).toBe(true);
        expect(
          r1.employeeSide.ficaAdditionalMedicare.equals(r2.employeeSide.ficaAdditionalMedicare),
        ).toBe(true);

        // Employer side
        expect(
          r1.employerSide.ficaSocialSecurityMatch.equals(r2.employerSide.ficaSocialSecurityMatch),
        ).toBe(true);
        expect(r1.employerSide.ficaMedicareMatch.equals(r2.employerSide.ficaMedicareMatch)).toBe(
          true,
        );
        expect(r1.employerSide.futa.equals(r2.employerSide.futa)).toBe(true);

        // Totals
        expect(r1.totals.employeeGross.equals(r2.totals.employeeGross)).toBe(true);
        expect(r1.totals.federalTaxableWages.equals(r2.totals.federalTaxableWages)).toBe(true);
        expect(r1.totals.employeeNet.equals(r2.totals.employeeNet)).toBe(true);
        expect(
          r1.totals.employerTotalBurdenedCost.equals(r2.totals.employerTotalBurdenedCost),
        ).toBe(true);

        // RuleSetVersion is data-equal.
        expect(r1.ruleSetVersion).toBe(r2.ruleSetVersion);
      }),
      // 100 runs as the role doc specifies for reproducibility, not 1000 —
      // each run does double the work and the property is structural.
      { numRuns: 100 },
    );
  });
});

// ---------- Wage-base crossing — explicit, deterministic ----------

describe('federal engine invariants — explicit wage-base crossings', () => {
  const baseInput: CalcInput = {
    effectiveDate: '2026-06-15',
    payFrequency: 'BIWEEKLY',
    grossWagesThisPeriod: new Decimal('10000.00'),
    pretaxDeductionsThisPeriod: new Decimal(0),
    ytdWagesBeforePeriod: new Decimal('180000.00'), // straddles 184500 SS base
    ytdFutaWagesBeforePeriod: new Decimal('7000.00'), // already at FUTA cap
    w4: {
      filingStatus: 'SINGLE_OR_MFS',
      step2Checkbox: false,
      step3DependentsCredit: new Decimal(0),
      step4aOtherIncome: new Decimal(0),
      step4bDeductions: new Decimal(0),
      step4cExtraWithholding: new Decimal(0),
    },
  };
  const baseConfig: EmployerConfig = { futaCreditReductionPercent: new Decimal(0) };

  it('SS wage base mid-period crossing: employer SS match equals employee SS (capped)', () => {
    const result = calculate(baseInput, baseConfig);
    expect(
      result.employerSide.ficaSocialSecurityMatch.equals(result.employeeSide.ficaSocialSecurity),
    ).toBe(true);
    // The taxable slice is $4,500; SS tax should be $279.00 each side.
    expect(result.employeeSide.ficaSocialSecurity.equals(new Decimal('279.00'))).toBe(true);
  });

  it('FUTA already at cap going in — period FUTA is exactly $0.00', () => {
    const result = calculate(baseInput, baseConfig);
    expect(result.employerSide.futa.equals(new Decimal(0))).toBe(true);
  });

  it('Additional Medicare 0.9% threshold crossing — only the over-$200K slice is taxed; no employer match', () => {
    // ytd = 195000, period = 10000 → post = 205000; 5000 over threshold; tax = 45.00
    const input: CalcInput = {
      ...baseInput,
      ytdWagesBeforePeriod: new Decimal('195000.00'),
    };
    const result = calculate(input, baseConfig);
    expect(result.employeeSide.ficaAdditionalMedicare.equals(new Decimal('45.00'))).toBe(true);

    // Employer-side has no additional-medicare field. Confirm:
    const employerKeys = Object.keys(result.employerSide);
    expect(employerKeys).not.toContain('ficaAdditionalMedicareMatch');
  });

  it('FUTA crosses $7,000 mid-period: only the below-cap slice is taxable', () => {
    // ytd = 6000, period = 2000 → 1000 taxable, 1000 above cap
    const input: CalcInput = {
      ...baseInput,
      grossWagesThisPeriod: new Decimal('2000.00'),
      ytdWagesBeforePeriod: new Decimal('6000.00'),
      ytdFutaWagesBeforePeriod: new Decimal('6000.00'),
    };
    const result = calculate(input, baseConfig);
    // 1000 * 0.006 = 6.00
    expect(result.employerSide.futa.equals(new Decimal('6.00'))).toBe(true);
  });
});
