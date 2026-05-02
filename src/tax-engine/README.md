# Paygon tax engine

Roll-your-own federal + (eventually) state + local tax calculation. No
Symmetry, no CheckHQ. Rules-as-data, two-sided, effective-date-aware,
reproducible forever.

**Phase:** v1. Federal only. Oklahoma is the first state slated and will
land alongside the rest of the v1 cut (CA, NY, IL).

## How to call `calculate`

```ts
import Decimal from 'decimal.js';
import { calculate, type CalcInput, type EmployerConfig } from './calculate.js';

const input: CalcInput = {
  effectiveDate: '2026-04-15',                       // selects rule set
  payFrequency: 'BIWEEKLY',
  grossWagesThisPeriod: new Decimal('3200.00'),
  pretaxDeductionsThisPeriod: new Decimal('0'),
  ytdWagesBeforePeriod: new Decimal('40000.00'),     // for FICA wage-base + Add'l Medicare
  ytdFutaWagesBeforePeriod: new Decimal('7000.00'),  // for FUTA $7,000 cap
  w4: {
    filingStatus: 'MARRIED_FILING_JOINTLY',
    step2Checkbox: true,
    step3DependentsCredit: new Decimal('0'),
    step4aOtherIncome: new Decimal('0'),
    step4bDeductions: new Decimal('0'),
    step4cExtraWithholding: new Decimal('0'),
  },
};

const employerConfig: EmployerConfig = {
  futaCreditReductionPercent: new Decimal('0'),      // 0 unless DOL has flagged the state
};

const result = calculate(input, employerConfig);

console.log(result.employeeSide.federalIncomeTax.toFixed(2));     // FIT withheld
console.log(result.employerSide.futa.toFixed(2));                 // FUTA accrued
console.log(result.totals.employerTotalBurdenedCost.toFixed(2));  // headline number
console.log(result.trace);                                        // step-by-step audit trail
console.log(result.ruleSetVersion);                               // 'federal-2026'
```

## Public API surface

Exported from `calculate.ts`:

- `calculate(input, employerConfig) -> CalcResult` — the only entry point.
- Types: `CalcInput`, `CalcResult`, `EmployerConfig`, `W4`, `TraceStep`,
  `PayFrequency`, `FilingStatus`.

That's it. Everything else under `src/tax-engine/` is internal.

## Where rule data lives

```
src/tax-engine/rules/
├── federal/
│   └── 2026.json    <-- this is the federal-2026 rule set
└── (future) ok/, ca/, ny/, il/, ...
```

Each rule file is **immutable per `ruleSetVersion`**. To correct a typo
in rule data, do not edit the published file in place — publish a new
`ruleSetVersion` (e.g. `federal-2026-r2`) and bump the resolver. Editing a
published file silently breaks reproducibility.

JSON shape for federal: see `core/rule-types.ts`. Numbers are quoted as
strings to preserve exact decimal representation through JSON. The rule
resolver feeds them to `decimal.js`.

## How calculation flows

`calculate()` -> `calculateFederal()` -> in order:

1. Resolve federal rule set by `effectiveDate`.
2. Compute `federalTaxableWages = gross - pretax`, clamp at zero.
3. Compute FIT (employee only) — Pub 15-T Worksheet 1A.
4. Compute FICA (both sides) — SS, Medicare, Additional Medicare with
   mid-period wage-base and $200K threshold crossings.
5. Compute FUTA (employer only) — wage-base crossing + credit-reduction
   parameter.
6. Roll up `employeeNet`, `employerTotalBurdenedCost`.
7. Freeze and return.

Every step appends to the calculation `trace`. The trace is JSON-friendly
strings only — no PII, no raw `Decimal` instances, no timestamps. The
audit-trail engineer can hash it directly.

## Rounding

- Money rounds to two decimal places at "natural boundaries" — per-period
  FIT, each FICA line, FUTA accrual.
- Intermediate sub-calculations are NOT rounded (full decimal precision
  is preserved through annualization, bracket math, etc.).
- Mode: HALF_UP, centralized in `core/decimal.ts::roundMoney`. The FIT
  spec recommends HALF_EVEN — see `CHANGELOG_TAX.md` for the deviation
  rationale.

## Known input-shape caveats

- `pretaxDeductionsThisPeriod` is currently one aggregated number that
  reduces both FIT and FICA wages. The IRS distinguishes §125 cafeteria
  plan deferrals (reduce both) from §401(k) elective deferrals (reduce
  FIT only). For v1 the engine treats all pretax as §125-style. When the
  upstream gross-to-net engine surfaces both numbers separately,
  `CalcInput` will gain `ficaPretaxDeductions` and `futaPretaxDeductions`
  fields without breaking the existing API for §125-only callers.
- `stateUiPaidTimely` is hard-coded `true` in the federal orchestrator
  for v1. Spec acknowledges this is a year-end determination; the
  employer-config layer will grow a flag when needed.

## Adding a future jurisdiction (future-you, the OK landing)

When OK rule data lands:

1. Author or import the spec at `docs/payroll-semantics/state-income-tax-ok.md`
   (and any auxiliary specs — OESC SUI, OK local taxes).
2. Drop rule data at `src/tax-engine/rules/ok/2026.json`. The schema can
   reuse `core/rule-types.ts` shapes if the algorithm matches an existing
   primitive; otherwise extend `core/rule-types.ts`.
3. Add an OK manifest in `core/rule-resolver.ts` (a new function
   `resolveOklahomaRuleSet` mirroring the federal one).
4. Create `jurisdictions/oklahoma.ts` orchestrator that produces the
   OK-specific lines (state income tax + OESC SUI + any OK locals).
5. Compose into `calculate()` — the result shape gains state and local
   fields under `employeeSide` and `employerSide` per the
   tax-rules-engineer ResultShape contract.
6. Update `CHANGELOG_TAX.md` with the new rule set.

What you do NOT do:

- Add `if (state === 'OK')` anywhere. State-specific behavior lives in
  rule data + the state's own orchestrator file.
- Edit the federal orchestrator to "know about" OK.
- Mutate any published rule set — version a new one.

## Reproducibility contract

`(input, employerConfig) -> CalcResult` is a pure function. Same input,
same output, forever. The engine:

- Does not consume `Date.now()` or any wall-clock value.
- Does not consume `Math.random()` or any randomness.
- Does not perform I/O during a calculation.
- Loads rule data once at module init (statically imported JSON) — the
  rule data is itself frozen and never mutated.

`employerConfigSnapshot` is a defensive copy embedded in every result so
a downstream mutation can't retroactively alter what an audit replay
sees.

## Coordination

- New calculation? Pull the spec from `payroll-domain-expert` first.
  Engine never implements from interpretation.
- New tests? `payroll-test-author` writes them under `test/tax-vectors/`.
  This module never writes its own tests.
- Rule effective-date or rate change? `compliance-watcher` opens a
  rule-data PR; if the *shape* of the rule changes, that's an engine
  change and ADR territory.
- Trace consumers? `audit-trail-engineer` reads `result.trace` and
  hashes it via canonical-v1.
