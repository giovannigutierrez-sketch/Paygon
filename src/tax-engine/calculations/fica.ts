// FICA — Social Security, Medicare, Additional Medicare.
//
// Source: docs/payroll-semantics/fica-social-security-and-medicare.md
//
// Two-sided:
//   employee — SS (6.2% to wage base), Medicare (1.45% no cap), Additional
//              Medicare (0.9% above $200K YTD with this employer)
//   employer — SS match (6.2% to wage base), Medicare match (1.45% no cap)
//              NO additional Medicare match.
//
// Five output lines round independently per the spec's sum-of-rounded rule.
// Mid-period crossings of both the SS wage base and the $200K Additional
// Medicare threshold are handled here.

import Decimal from 'decimal.js';

import type { CalcInput } from '../calculate.js';
import { ZERO, clampNonNegative, decMax, decMin, roundMoney, toDecimal, traceMoney } from '../core/decimal.js';
import type { TraceBuilder } from '../core/trace.js';
import type { FederalRuleSet } from '../core/rule-types.js';

interface FicaArgs {
  readonly ficaWagesThisPeriod: Decimal;       // FICA-subject wages this period
  readonly ssYtdPrior: Decimal;                // SS wages YTD before this period
  readonly medicareYtdPrior: Decimal;          // Medicare wages YTD before this period
  readonly rules: FederalRuleSet;
  readonly trace: TraceBuilder;
}

export interface FicaResult {
  readonly employee: {
    readonly socialSecurity: Decimal;
    readonly medicare: Decimal;
    readonly additionalMedicare: Decimal;
  };
  readonly employer: {
    readonly socialSecurityMatch: Decimal;
    readonly medicareMatch: Decimal;
  };
}

export function computeFica({
  ficaWagesThisPeriod,
  ssYtdPrior,
  medicareYtdPrior,
  rules,
  trace,
}: FicaArgs): FicaResult {
  const ssRate = toDecimal(rules.fica.socialSecurity.rate);
  const ssWageBase = toDecimal(rules.fica.socialSecurity.wageBase);
  const medicareRate = toDecimal(rules.fica.medicare.rate);
  const addlRate = toDecimal(rules.fica.additionalMedicare.rate);
  const addlThreshold = toDecimal(rules.fica.additionalMedicare.thresholdYTD);

  // ---- Social Security (employee + employer share the same taxable base) ----
  const ssRemainingBase = clampNonNegative(ssWageBase.minus(ssYtdPrior));
  const ssTaxable = decMin(ficaWagesThisPeriod, ssRemainingBase);

  // Per the spec's "Note on independent symmetry": compute and round each line
  // independently even when bases match.
  const ssEmployee = roundMoney(ssTaxable.times(ssRate));
  const ssEmployer = roundMoney(ssTaxable.times(ssRate));

  trace.add(
    'fica.social-security',
    {
      ficaWagesThisPeriod: traceMoney(ficaWagesThisPeriod),
      ssYtdPrior: traceMoney(ssYtdPrior),
      ssWageBase: ssWageBase.toString(),
      ssRemainingBase: traceMoney(ssRemainingBase),
      ssTaxableThisPeriod: traceMoney(ssTaxable),
      ssRate: ssRate.toString(),
    },
    `employee=${traceMoney(ssEmployee)}, employer=${traceMoney(ssEmployer)}`,
  );

  // ---- Medicare base 1.45% (no cap, both sides) ----
  const medicareEmployee = roundMoney(ficaWagesThisPeriod.times(medicareRate));
  const medicareEmployer = roundMoney(ficaWagesThisPeriod.times(medicareRate));

  trace.add(
    'fica.medicare',
    {
      ficaWagesThisPeriod: traceMoney(ficaWagesThisPeriod),
      medicareRate: medicareRate.toString(),
    },
    `employee=${traceMoney(medicareEmployee)}, employer=${traceMoney(medicareEmployer)}`,
  );

  // ---- Additional Medicare 0.9% (employee only, above $200K YTD) ----
  // Differential formula: tax only the slice that crosses the threshold.
  const medicareYtdAfter = medicareYtdPrior.plus(ficaWagesThisPeriod);
  const addlTaxableThisPeriod = decMax(medicareYtdAfter.minus(addlThreshold), ZERO).minus(
    decMax(medicareYtdPrior.minus(addlThreshold), ZERO),
  );
  const addlMedicareEmployee = roundMoney(addlTaxableThisPeriod.times(addlRate));

  trace.add(
    'fica.additional-medicare',
    {
      medicareYtdPrior: traceMoney(medicareYtdPrior),
      ficaWagesThisPeriod: traceMoney(ficaWagesThisPeriod),
      addlThreshold: addlThreshold.toString(),
      addlTaxableThisPeriod: traceMoney(addlTaxableThisPeriod),
      addlRate: addlRate.toString(),
    },
    traceMoney(addlMedicareEmployee),
  );

  return {
    employee: {
      socialSecurity: ssEmployee,
      medicare: medicareEmployee,
      additionalMedicare: addlMedicareEmployee,
    },
    employer: {
      socialSecurityMatch: ssEmployer,
      medicareMatch: medicareEmployer,
    },
  };
}

// Reference imports kept stable so consumers can `import type { CalcInput }` here
// if needed; not currently re-exported.
export type { CalcInput };
