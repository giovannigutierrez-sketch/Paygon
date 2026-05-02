// Public entry point for the Paygon tax engine.
//
// This file holds the public type contract and the single `calculate`
// function. Callers (the test runner, future API handlers, future audit
// orchestrators) import from here.
//
// Hard rules:
//   - Pure function. No I/O. No globals. No wall-clock dependence.
//   - Two-sided result (employee + employer). Both populated, even if zero.
//   - Decimal arithmetic only.
//   - The trace contains numeric values + step names; never PII.
//
// Federal-only for v1. State orchestrators will compose into this entry point
// (e.g., calculateFederal then calculateOklahoma) once state rule data lands.
// Adding a state must NOT introduce `if (state === 'OK')`-style branching —
// it adds a new orchestrator under jurisdictions/ and a new rule file under
// rules/<state>/.

import type Decimal from 'decimal.js';

import { calculateFederal } from './jurisdictions/federal.js';

export type PayFrequency =
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'SEMIMONTHLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMIANNUAL'
  | 'ANNUAL'
  | 'DAILY';

export type FilingStatus = 'SINGLE_OR_MFS' | 'MARRIED_FILING_JOINTLY' | 'HEAD_OF_HOUSEHOLD';

export interface W4 {
  readonly filingStatus: FilingStatus;
  readonly step2Checkbox: boolean;
  readonly step3DependentsCredit: Decimal; // annual dollars
  readonly step4aOtherIncome: Decimal;     // annual dollars
  readonly step4bDeductions: Decimal;      // annual dollars (above standard)
  readonly step4cExtraWithholding: Decimal; // per-pay-period dollars
}

export interface CalcInput {
  readonly effectiveDate: string;                // 'YYYY-MM-DD' — selects rule set
  readonly payFrequency: PayFrequency;
  readonly grossWagesThisPeriod: Decimal;        // gross before any deductions
  readonly pretaxDeductionsThisPeriod: Decimal;  // §125, §401(k), HSA, etc. — already aggregated
  readonly ytdWagesBeforePeriod: Decimal;        // YTD gross BEFORE this period (FICA wage-base + Add'l Medicare)
  readonly ytdFutaWagesBeforePeriod: Decimal;    // YTD FUTA-subject wages BEFORE this period
  readonly w4: W4;
}

export interface EmployerConfig {
  readonly futaCreditReductionPercent: Decimal; // 0 by default; set per state when DOL publishes annual list
}

export interface TraceStep {
  readonly step: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly output: string;
}

export interface CalcResult {
  readonly employeeSide: {
    readonly federalIncomeTax: Decimal;
    readonly ficaSocialSecurity: Decimal;
    readonly ficaMedicare: Decimal;
    readonly ficaAdditionalMedicare: Decimal;
  };
  readonly employerSide: {
    readonly ficaSocialSecurityMatch: Decimal;
    readonly ficaMedicareMatch: Decimal;
    readonly futa: Decimal;
  };
  readonly totals: {
    readonly employeeGross: Decimal;
    readonly federalTaxableWages: Decimal;
    readonly employeeNet: Decimal;
    readonly employerTotalBurdenedCost: Decimal;
  };
  readonly trace: ReadonlyArray<TraceStep>;
  readonly ruleSetVersion: string;
  readonly employerConfigSnapshot: EmployerConfig;
}

/**
 * Single-period payroll tax calculation for a single employee at a single
 * employer, federal-only.
 *
 * Returns a frozen `CalcResult` whose `trace` is the audit-friendly history of
 * every numeric step that produced the answer. Same input -> same output,
 * byte-for-byte (subject to the snapshot's defensive Decimal copy reference).
 */
export function calculate(input: CalcInput, employerConfig: EmployerConfig): CalcResult {
  return calculateFederal(input, employerConfig);
}
