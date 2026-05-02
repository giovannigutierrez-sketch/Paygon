// Federal jurisdiction orchestration.
//
// Runs the federal calculations in the order defined by the engineer brief:
//   1. federalTaxableWages = gross - pretax (clamped at 0)
//   2. FIT (employee only)
//   3. FICA (both sides; SS, Medicare, Additional Medicare)
//   4. FUTA (employer only)
//   5. Roll-up totals
//
// State orchestrators will live alongside this file when state coverage lands
// (Oklahoma first per CLAUDE.md). They will share `core/` primitives and
// resolve their own rule sets; calculate.ts will compose them.

import Decimal from 'decimal.js';

import type { CalcInput, CalcResult, EmployerConfig } from '../calculate.js';
import { ZERO, clampNonNegative, traceMoney } from '../core/decimal.js';
import { resolveFederalRuleSet } from '../core/rule-resolver.js';
import { TraceBuilder } from '../core/trace.js';
import { computeFederalIncomeTax } from '../calculations/federal-income-tax.js';
import { computeFica } from '../calculations/fica.js';
import { computeFuta } from '../calculations/futa.js';

export function calculateFederal(input: CalcInput, employerConfig: EmployerConfig): CalcResult {
  const { ruleSetVersion, data: rules } = resolveFederalRuleSet(input.effectiveDate);
  const trace = new TraceBuilder();

  // 1. Compute federal taxable wages (gross minus pre-tax deductions, clamped).
  const federalTaxableWages = clampNonNegative(
    input.grossWagesThisPeriod.minus(input.pretaxDeductionsThisPeriod),
  );
  trace.add(
    'federal-taxable-wages',
    {
      grossWagesThisPeriod: traceMoney(input.grossWagesThisPeriod),
      pretaxDeductionsThisPeriod: traceMoney(input.pretaxDeductionsThisPeriod),
    },
    traceMoney(federalTaxableWages),
  );

  // 2. FIT — employee only.
  const fitWithholding = computeFederalIncomeTax({
    federalTaxableWages,
    input,
    rules,
    trace,
  });

  // 3. FICA — both sides.
  // FICA-subject wages: per the FICA spec, §401(k) deferrals are FICA-taxable
  // even though they reduce FIT-taxable wages. The caller is responsible for
  // upstream gross-to-net producing these correctly. For v1 this engine
  // accepts a single `pretaxDeductionsThisPeriod` figure and treats it as
  // §125-style (reduces both FIT and FICA). When the gross-to-net engine
  // distinguishes §125 vs. §401(k), CalcInput will gain a separate
  // `ficaPretaxDeductions` field — flagged in the README.
  const ficaTaxableWages = federalTaxableWages;
  const fica = computeFica({
    ficaWagesThisPeriod: ficaTaxableWages,
    ssYtdPrior: input.ytdWagesBeforePeriod,
    medicareYtdPrior: input.ytdWagesBeforePeriod,
    rules,
    trace,
  });

  // 4. FUTA — employer only. FUTA-subject wages match FICA-subject (§125
  // reduces; §401(k) does not — same caveat as above).
  const futa = computeFuta({
    futaWagesThisPeriod: ficaTaxableWages,
    futaYtdPrior: input.ytdFutaWagesBeforePeriod,
    creditReductionPercent: employerConfig.futaCreditReductionPercent,
    stateUiPaidTimely: true, // Default per spec; employer-config will gain a flag.
    rules,
    trace,
  });

  // 5. Totals.
  const employeeWithholdings = fitWithholding
    .plus(fica.employee.socialSecurity)
    .plus(fica.employee.medicare)
    .plus(fica.employee.additionalMedicare);

  // Net = gross - pretax - employee withholdings.
  // Pretax was already removed for tax purposes; it also reduces take-home.
  const employeeNet = input.grossWagesThisPeriod
    .minus(input.pretaxDeductionsThisPeriod)
    .minus(employeeWithholdings);

  const employerSideTotal = fica.employer.socialSecurityMatch
    .plus(fica.employer.medicareMatch)
    .plus(futa);

  const employerTotalBurdenedCost = input.grossWagesThisPeriod.plus(employerSideTotal);

  trace.add(
    'totals',
    {
      employeeWithholdings: traceMoney(employeeWithholdings),
      employerSideTotal: traceMoney(employerSideTotal),
    },
    `employeeNet=${traceMoney(employeeNet)}, employerTotalBurdenedCost=${traceMoney(employerTotalBurdenedCost)}`,
  );

  const result: CalcResult = Object.freeze({
    employeeSide: Object.freeze({
      federalIncomeTax: fitWithholding,
      ficaSocialSecurity: fica.employee.socialSecurity,
      ficaMedicare: fica.employee.medicare,
      ficaAdditionalMedicare: fica.employee.additionalMedicare,
    }),
    employerSide: Object.freeze({
      ficaSocialSecurityMatch: fica.employer.socialSecurityMatch,
      ficaMedicareMatch: fica.employer.medicareMatch,
      futa,
    }),
    totals: Object.freeze({
      employeeGross: input.grossWagesThisPeriod,
      federalTaxableWages,
      employeeNet,
      employerTotalBurdenedCost,
    }),
    trace: trace.build(),
    ruleSetVersion,
    employerConfigSnapshot: snapshotEmployerConfig(employerConfig),
  });

  return result;
}

function snapshotEmployerConfig(config: EmployerConfig): EmployerConfig {
  // Defensive copy + freeze so a downstream mutation can't retroactively
  // corrupt a result that was already returned. The Decimal itself is
  // immutable in decimal.js, so the reference copy is safe.
  return Object.freeze({
    futaCreditReductionPercent: new Decimal(config.futaCreditReductionPercent),
  });
}
