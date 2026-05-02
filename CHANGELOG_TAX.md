# CHANGELOG — Tax engine

A chronological record of tax rule data and engine changes. Rule data
additions are data-only; engine changes are listed when the abstraction
itself moved.

The engine's invariant: a calculation that ran on date X with rule set
version V must produce the same answer when re-run forever, against the
same V. Entries here document what V means at each cut.

---

## 2026-05-02 — Initial federal-2026 rule set

**Rule sets added:**
- `federal-2026` — effective 2026-01-01 onward (open-ended).

**Coverage:**
- Federal income tax withholding — Pub 15-T (2026) percentage method for
  automated payroll systems. All three filing statuses (MFJ, SMS, HOH),
  both Standard (Table 4) and Step-2-Checkbox (Table 5) schedules. W-4
  Steps 1–4 supported (2020-and-later W-4 only; pre-2020 allowance-method
  forms are out of scope per spec).
- FICA — Social Security 6.2% on first $184,500 each side, Medicare 1.45%
  no cap each side, Additional Medicare 0.9% above $200,000 YTD employee
  only. Mid-period crossings of both the wage base and the $200K
  threshold supported.
- FUTA — 6.0% gross / 5.4% state credit / 0.6% effective on first $7,000
  per employee. `creditReductionPercent` parameter and
  `stateUiPaidTimely` boolean both supported per spec.

**Engine changes:**
- Created `src/tax-engine/calculate.ts` public entry point.
- Created `src/tax-engine/core/` (decimal helpers, pay-frequency table,
  trace builder, rule resolver, rule-data types).
- Created `src/tax-engine/calculations/` (FIT, FICA, FUTA primitives).
- Created `src/tax-engine/jurisdictions/federal.ts` orchestrator.
- Created `src/tax-engine/rules/federal/2026.json` rule data.

**Sources:**
- IRS Publication 15-T (2026), Worksheet 1A, Tables 4 and 5.
- IRS Publication 15 (2026) §13 (rounding), §14 (FUTA).
- IRS Form 941 instructions (2026).
- SSA Press Release October 2025 (2026 wage base $184,500).
- 26 U.S.C. §3101, §3102(f), §3111, §3121(a)(1), §3301, §3302, §3306(b)(1).

**Specs implemented:**
- `docs/payroll-semantics/federal-income-tax-withholding.md` v1.0.0
- `docs/payroll-semantics/fica-social-security-and-medicare.md` v1.0.0
- `docs/payroll-semantics/futa.md` v1.0.0

**Spec deviations / open items:**
- **Rounding mode.** The FIT spec specifies HALF_EVEN (banker's rounding)
  per IRS Pub 15 §13 as the canonical engine rule. The engine ships with
  HALF_UP per the implementation brief. Centralized in
  `src/tax-engine/core/decimal.ts::roundMoney` — a one-line change to
  switch. Flagged for `payroll-domain-expert` reconciliation.
- **§401(k)-vs-§125 split.** The current `CalcInput.pretaxDeductionsThisPeriod`
  is one aggregated number that reduces both FIT and FICA wages. In
  reality §401(k) deferrals reduce FIT wages but NOT FICA/FUTA wages
  (per IRS Pub 15-B and §3306(b)(5)). For v1 the engine treats all
  pretax as §125-style. When the gross-to-net engine distinguishes,
  `CalcInput` will gain `ficaPretaxDeductions` and `futaPretaxDeductions`
  fields. Documented in `src/tax-engine/README.md`.
- **`stateUiPaidTimely` always defaults to `true`.** Spec acknowledges
  the value is determined at year-end, not per-period. Until employer
  config grows a per-period flag, the engine accrues at the credit-given
  rate; year-end true-up is the processor's responsibility.
- **DOL credit-reduction list ingestion** is owned by `compliance-watcher`.
  The 2026 list publishes November 2026; until then `creditReductionPercent`
  defaults to 0.

**Pending compliance signals to watch:**
- 2027 FIT bracket inflation indexing (Rev. Proc., typically mid-November
  2026).
- 2027 SS wage base announcement (SSA, October 2026).
- 2026 DOL credit-reduction list (Federal Register, November 2026).

**Test coverage:**
- Test vectors authored by `payroll-test-author` consume this engine via
  `src/tax-engine/calculate.ts`. The five worked examples in each spec
  are the seed corpus. Additional vectors land at the
  payroll-test-author's discretion.
