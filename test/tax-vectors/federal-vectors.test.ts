// Federal tax-vector runner.
//
// Walks every `*.json` under test/tax-vectors/federal/, parses it as a vector,
// runs the engine, and asserts every numeric `expected.*` field against the
// engine output via `Decimal.equals`.
//
// One vitest `it()` per vector — the reporter then names each failure with the
// vector's `id`, which makes regressions instantly diagnosable.
//
// `expected.trace_steps` is INFORMATIONAL not asserted. The engine's actual
// trace step strings will not match the spec's narrative wording byte-for-byte;
// the trace assertions live in the audit-trail and reproducibility property
// tests.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';

import { calculate } from '../../src/tax-engine/calculate.js';
import type {
  CalcInput,
  CalcResult,
  EmployerConfig,
  FilingStatus,
  PayFrequency,
  W4,
} from '../../src/tax-engine/calculate.js';

// ---------- Vector JSON shape ----------

interface VectorW4Json {
  readonly filing_status: string;
  readonly step2_checkbox: boolean;
  readonly step3_dependents_credit: string;
  readonly step4a_other_income: string;
  readonly step4b_deductions: string;
  readonly step4c_extra_withholding: string;
}

interface VectorInputJson {
  readonly pay_frequency: string;
  readonly gross_wages_this_period: string;
  readonly pretax_deductions_this_period: string;
  readonly ytd_wages_before_period: string;
  readonly ytd_futa_wages_before_period: string;
  readonly w4: VectorW4Json;
}

interface VectorEmployerSnapshotJson {
  readonly futa_credit_reduction_percent: string;
}

interface VectorExpectedEmployeeJson {
  readonly federal_income_tax: string;
  readonly fica_social_security: string;
  readonly fica_medicare: string;
  readonly fica_additional_medicare: string;
}

interface VectorExpectedEmployerJson {
  readonly fica_social_security_match: string;
  readonly fica_medicare_match: string;
  readonly futa: string;
}

interface VectorJson {
  readonly id: string;
  readonly description: string;
  readonly source: string;
  readonly rule_set_version: string;
  readonly effective_date: string;
  readonly employer_config_snapshot: VectorEmployerSnapshotJson;
  readonly input: VectorInputJson;
  readonly expected: {
    readonly employee_side: VectorExpectedEmployeeJson;
    readonly employer_side: VectorExpectedEmployerJson;
    readonly trace_steps?: ReadonlyArray<string>;
  };
}

// ---------- Vector discovery ----------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FEDERAL_ROOT = path.join(HERE, 'federal');

function walk(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

function loadVector(filePath: string): VectorJson {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as VectorJson;
}

// ---------- Vector → engine input adapter ----------

const VALID_PAY_FREQUENCIES: ReadonlySet<PayFrequency> = new Set<PayFrequency>([
  'WEEKLY',
  'BIWEEKLY',
  'SEMIMONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
  'DAILY',
]);

const VALID_FILING_STATUSES: ReadonlySet<FilingStatus> = new Set<FilingStatus>([
  'SINGLE_OR_MFS',
  'MARRIED_FILING_JOINTLY',
  'HEAD_OF_HOUSEHOLD',
]);

function asPayFrequency(s: string): PayFrequency {
  if (!VALID_PAY_FREQUENCIES.has(s as PayFrequency)) {
    throw new Error(`Vector specifies invalid pay_frequency: ${s}`);
  }
  return s as PayFrequency;
}

function asFilingStatus(s: string): FilingStatus {
  if (!VALID_FILING_STATUSES.has(s as FilingStatus)) {
    throw new Error(`Vector specifies invalid filing_status: ${s}`);
  }
  return s as FilingStatus;
}

function buildW4(json: VectorW4Json): W4 {
  return {
    filingStatus: asFilingStatus(json.filing_status),
    step2Checkbox: json.step2_checkbox,
    step3DependentsCredit: new Decimal(json.step3_dependents_credit),
    step4aOtherIncome: new Decimal(json.step4a_other_income),
    step4bDeductions: new Decimal(json.step4b_deductions),
    step4cExtraWithholding: new Decimal(json.step4c_extra_withholding),
  };
}

function buildInput(vector: VectorJson): CalcInput {
  return {
    effectiveDate: vector.effective_date,
    payFrequency: asPayFrequency(vector.input.pay_frequency),
    grossWagesThisPeriod: new Decimal(vector.input.gross_wages_this_period),
    pretaxDeductionsThisPeriod: new Decimal(vector.input.pretax_deductions_this_period),
    ytdWagesBeforePeriod: new Decimal(vector.input.ytd_wages_before_period),
    ytdFutaWagesBeforePeriod: new Decimal(vector.input.ytd_futa_wages_before_period),
    w4: buildW4(vector.input.w4),
  };
}

function buildEmployerConfig(vector: VectorJson): EmployerConfig {
  return {
    futaCreditReductionPercent: new Decimal(
      vector.employer_config_snapshot.futa_credit_reduction_percent,
    ),
  };
}

// ---------- Decimal-aware assertion ----------

function expectDecimalEquals(
  actual: Decimal,
  expected: string,
  label: string,
  vectorId: string,
  result: CalcResult,
): void {
  const expectedDec = new Decimal(expected);
  if (!actual.equals(expectedDec)) {
    const msg =
      `Vector "${vectorId}" — field ${label} mismatch:\n` +
      `  expected: ${expectedDec.toFixed(2)}\n` +
      `  actual:   ${actual.toFixed(2)}\n` +
      `Trace (engine):\n` +
      result.trace
        .map(
          (s, i) =>
            `  [${i}] ${s.step} :: inputs=${JSON.stringify(s.inputs)} :: out=${s.output}`,
        )
        .join('\n');
    expect.fail(msg);
  }
  // Even on success, run the strict expect so vitest counts the assertion.
  expect(actual.equals(expectedDec)).toBe(true);
}

// ---------- Test registration ----------

const vectorPaths = walk(FEDERAL_ROOT);

describe('federal tax vectors', () => {
  if (vectorPaths.length === 0) {
    it.skip('no vectors discovered under test/tax-vectors/federal/', () => {
      // empty
    });
    return;
  }

  for (const filePath of vectorPaths) {
    const vector = loadVector(filePath);
    const relPath = path.relative(FEDERAL_ROOT, filePath).replace(/\\/g, '/');

    it(`${vector.id} — ${vector.description} [${relPath}]`, () => {
      const input = buildInput(vector);
      const employerConfig = buildEmployerConfig(vector);

      const result = calculate(input, employerConfig);

      // Two-sided completeness — non-negotiable hard rule #4.
      expect(result.employeeSide).toBeDefined();
      expect(result.employerSide).toBeDefined();

      // Employee-side assertions
      expectDecimalEquals(
        result.employeeSide.federalIncomeTax,
        vector.expected.employee_side.federal_income_tax,
        'employeeSide.federalIncomeTax',
        vector.id,
        result,
      );
      expectDecimalEquals(
        result.employeeSide.ficaSocialSecurity,
        vector.expected.employee_side.fica_social_security,
        'employeeSide.ficaSocialSecurity',
        vector.id,
        result,
      );
      expectDecimalEquals(
        result.employeeSide.ficaMedicare,
        vector.expected.employee_side.fica_medicare,
        'employeeSide.ficaMedicare',
        vector.id,
        result,
      );
      expectDecimalEquals(
        result.employeeSide.ficaAdditionalMedicare,
        vector.expected.employee_side.fica_additional_medicare,
        'employeeSide.ficaAdditionalMedicare',
        vector.id,
        result,
      );

      // Employer-side assertions
      expectDecimalEquals(
        result.employerSide.ficaSocialSecurityMatch,
        vector.expected.employer_side.fica_social_security_match,
        'employerSide.ficaSocialSecurityMatch',
        vector.id,
        result,
      );
      expectDecimalEquals(
        result.employerSide.ficaMedicareMatch,
        vector.expected.employer_side.fica_medicare_match,
        'employerSide.ficaMedicareMatch',
        vector.id,
        result,
      );
      expectDecimalEquals(
        result.employerSide.futa,
        vector.expected.employer_side.futa,
        'employerSide.futa',
        vector.id,
        result,
      );

      // Defensive: rule_set_version on the result must match the vector.
      expect(result.ruleSetVersion).toBe(vector.rule_set_version);
    });
  }
});
