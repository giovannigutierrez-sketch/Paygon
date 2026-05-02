# Semantic spec: FICA — Social Security and Medicare (per pay period)

**Spec version:** 1.0.0
**Effective tax year:** 2026
**Last reviewed:** 2026-05-02
**Owner:** payroll-domain-expert

## Plain-English description

FICA is the combined Social Security (OASDI) and Medicare (HI) payroll tax. Employees pay 6.2% Social Security on wages up to an annual wage base, plus 1.45% Medicare on all wages, plus an additional 0.9% Medicare on wages over $200,000 in a calendar year. Employers match the 6.2% Social Security and 1.45% Medicare components, but **do not match** the additional 0.9%. This spec computes both the employee-side withholding and the employer-side liability for a single pay period, with explicit handling of mid-period crossings of the Social Security wage base and the Additional Medicare $200,000 threshold.

## Inputs

| Name | Type | Units | Source |
|---|---|---|---|
| `ficaWagesThisPeriod` | Decimal | USD | Wages **subject to FICA** for this pay period. Computed upstream. (Note: §401(k) elective deferrals **are** FICA-taxable; §125 cafeteria plan deferrals are **not**. The upstream gross-to-net engine produces this figure correctly per IRS Pub 15-B.) |
| `ssWagesYTDPriorToThisPeriod` | Decimal | USD | Year-to-date Social Security wages **before** this period, for this employer/EIN. Must reflect this employer's payments only (per §3121(a)(1) cap is per-employee per-employer). |
| `medicareWagesYTDPriorToThisPeriod` | Decimal | USD | Year-to-date Medicare wages before this period, for this employer/EIN. Used for the $200,000 Additional Medicare Tax threshold. |
| `effectiveDate` | Date | — | Date of the pay period; used to select the rule set (wage base and rates are annual). |

YTD figures are passed in by the caller. Per Paygon's no-PII-at-rest architecture, these are pulled from the client source system at session start, not stored by Paygon between sessions.

## Authoritative references

- **26 U.S.C. §3101** — Social Security and Medicare tax on employees.
- **26 U.S.C. §3111** — Social Security and Medicare tax on employers (employer match).
- **26 U.S.C. §3121(a)(1)** — Annual contribution and benefit base ("wage base") for OASDI.
- **26 U.S.C. §3101(b)(2)** — Additional Hospital Insurance (Medicare) tax of 0.9% on employees.
- **26 U.S.C. §3102(f)(1)** — Employer obligation to withhold Additional Medicare Tax once an employee's wages from that employer exceed $200,000 in the calendar year.
- **26 U.S.C. §6413(c)** — Special refunds of employment tax (employee-side multi-employer SS overcollection).
- **26 CFR §31.3101-2** — Rates of FICA tax.
- **26 CFR §31.3102-4** — Special rules regarding Additional Medicare Tax.
- **IRS Publication 15 (2026)** §9, "Withholding From Employees' Wages." https://www.irs.gov/publications/p15
- **IRS Publication 15-A (2026)** for special FICA situations.
- **IRS Form 941 instructions (2026)** — confirms the 2026 Social Security wage base of **$184,500**, rates 6.2% / 1.45% / additional 0.9%. https://www.irs.gov/instructions/i941
- **SSA Annual Contribution and Benefit Base** notice — https://www.ssa.gov/oact/cola/cbb.html (the SSA-published wage base for the year).

### 2026 constants (from rule data)

| Constant | Value | Source |
|---|---|---|
| `SS_RATE_EE` | 0.062 | 26 USC §3101(a) |
| `SS_RATE_ER` | 0.062 | 26 USC §3111(a) |
| `SS_WAGE_BASE_2026` | $184,500.00 | Form 941 instructions (03/2026); SSA Press Release 2025 |
| `MEDICARE_RATE_EE` | 0.0145 | 26 USC §3101(b)(1) |
| `MEDICARE_RATE_ER` | 0.0145 | 26 USC §3111(b) |
| `ADDL_MEDICARE_RATE` | 0.009 | 26 USC §3101(b)(2) |
| `ADDL_MEDICARE_THRESHOLD` | $200,000.00 | 26 USC §3101(b)(2) — fixed by statute, not indexed |

## Sides computed

**Both sides.**

- **Employee side:**
  - Social Security tax (6.2% up to wage base) — withheld from employee pay.
  - Medicare tax (1.45% on all wages) — withheld from employee pay.
  - Additional Medicare Tax (0.9% on wages over $200,000 YTD with this employer) — withheld from employee pay; **no employer match**.
  - Remit destination: IRS via Form 941 (combined with employer match and federal income tax withholding), through EFTPS on the employer's deposit schedule (Pub 15 §11).

- **Employer side:**
  - Social Security match (6.2% up to wage base) — additional employer cost.
  - Medicare match (1.45% on all wages) — additional employer cost.
  - Remit destination: IRS via Form 941, EFTPS.
  - **No additional 0.9% Medicare match.**

In `CalcResult`:
- `employee_side.fica_social_security`
- `employee_side.fica_medicare`
- `employee_side.fica_additional_medicare`
- `employer_side.fica_social_security_match`
- `employer_side.fica_medicare_match`

## Algorithm

All arithmetic uses `Decimal` with precision ≥ 12. Per IRS Pub 15 §13, round to the nearest cent at the natural boundary (each computed tax line). HALF_EVEN per the engine's canonical rounding rule.

### `compute_employee_side(ficaWagesThisPeriod, ssWagesYTDPriorToThisPeriod, medicareWagesYTDPriorToThisPeriod)`

#### Step 1 — Social Security taxable wages this period (with wage-base crossing)

```
ssRemainingBase = max(SS_WAGE_BASE_2026 - ssWagesYTDPriorToThisPeriod, 0)
ssTaxableThisPeriod = min(ficaWagesThisPeriod, ssRemainingBase)
ssTax_employee = round(ssTaxableThisPeriod × SS_RATE_EE, 2 decimals, HALF_EVEN)
```

#### Step 2 — Medicare base (1.45%) — applies to all wages, no cap

```
medicareTax_employee = round(ficaWagesThisPeriod × MEDICARE_RATE_EE, 2 decimals, HALF_EVEN)
```

#### Step 3 — Additional Medicare Tax (0.9%) — applies only to wages over $200,000 YTD with this employer

The employer's withholding obligation under §3102(f)(1) is based on **this employer's** payments to the employee in the calendar year. The statutory threshold itself ($200,000) is the same regardless of filing status; that asymmetry (the actual taxpayer threshold on Form 1040 differs by filing status: $250K MFJ, $125K MFS, $200K others) is reconciled on the employee's Form 1040 via Form 8959. The employer applies a flat $200,000 employer-side threshold per §3102(f).

```
medicareWagesAfterThisPeriod = medicareWagesYTDPriorToThisPeriod + ficaWagesThisPeriod
addlMedicareTaxableThisPeriod =
    max(medicareWagesAfterThisPeriod - ADDL_MEDICARE_THRESHOLD, 0)
  - max(medicareWagesYTDPriorToThisPeriod - ADDL_MEDICARE_THRESHOLD, 0)

addlMedicareTax_employee =
    round(addlMedicareTaxableThisPeriod × ADDL_MEDICARE_RATE, 2 decimals, HALF_EVEN)
```

This formulation handles both:
- Threshold crossing in this period (prior YTD < $200K, post YTD > $200K) → only the portion above $200K is taxable;
- Period entirely above threshold (prior YTD ≥ $200K) → all `ficaWagesThisPeriod` are taxable at the additional 0.9%;
- Period entirely below threshold (post YTD ≤ $200K) → zero additional tax.

#### Returns

```
{
  fica_social_security: ssTax_employee,
  fica_medicare: medicareTax_employee,
  fica_additional_medicare: addlMedicareTax_employee,
}
```

### `compute_employer_side(ficaWagesThisPeriod, ssWagesYTDPriorToThisPeriod)`

#### Step 1 — Social Security employer match

```
ssRemainingBase = max(SS_WAGE_BASE_2026 - ssWagesYTDPriorToThisPeriod, 0)
ssTaxableThisPeriod = min(ficaWagesThisPeriod, ssRemainingBase)
ssTax_employer = round(ssTaxableThisPeriod × SS_RATE_ER, 2 decimals, HALF_EVEN)
```

(Identical taxable base as employee side — this is the §3121(a)(1) cap and applies to both sides equally.)

#### Step 2 — Medicare employer match (no cap, no additional 0.9%)

```
medicareTax_employer = round(ficaWagesThisPeriod × MEDICARE_RATE_ER, 2 decimals, HALF_EVEN)
```

#### Returns

```
{
  fica_social_security_match: ssTax_employer,
  fica_medicare_match: medicareTax_employer,
}
```

### Note on independent symmetry

The employee-side and employer-side Social Security and Medicare base values are mathematically identical because the rates and bases match. The engine still computes them independently — `compute_employee_side` and `compute_employer_side` do not share state — to keep the call surface symmetric with calculations like Additional Medicare Tax that are asymmetric. Implementations may share an internal `taxable_ss_this_period(...)` primitive but must round each output line independently.

## Edge cases

1. **Period straddles the Social Security wage base.** Handled by `ssRemainingBase = max(BASE - YTD_prior, 0)` then `min(period_wages, remaining)`. Worked example B shows the math.
2. **Employee already over the wage base coming into the period.** `ssRemainingBase = 0`; `ssTaxableThisPeriod = 0`; both employee and employer SS lines are $0.00. Medicare continues unchanged.
3. **Period straddles the $200,000 Additional Medicare threshold.** Worked example C shows the differential calculation. Only the post-threshold slice gets the 0.9%.
4. **Employee already over $200,000 YTD coming into the period.** All `ficaWagesThisPeriod` are subject to Additional Medicare Tax at 0.9% (in addition to the regular 1.45%).
5. **Multiple employers in the same year (employee perspective).** Each employer applies the Social Security wage base independently against **that employer's** wages — §3121(a)(1). An employee with two employers each paying $150,000 has $300,000 of SS wages reported (no per-employee cap applied at the employer level). The employee recovers the over-collected SS via §6413(c) on their personal Form 1040 (Schedule 3, Line 11). **The engine does not apply §6413(c)** — that is an employee-side personal tax credit, not a payroll-period adjustment. Out of scope.
6. **Multiple employers and Additional Medicare Tax.** Each employer's $200,000 threshold is independent. The employee may owe additional 0.9% across employers when total wages > $200,000 even if no single employer exceeds $200,000 — reconciled on Form 8959. **Out of scope for the engine.**
7. **Common paymaster (§3121(s) and §3306(p)).** Two related corporations using a single paymaster may treat themselves as a single employer for FICA wage-base purposes. **Out of scope for v1**; engine treats each EIN independently. To support common-paymaster relationships, employer-config will need a "paymaster aggregation group" field; flag for compliance-watcher and a future spec amendment.
8. **Successor employer (§3121(a)(1) flush language; Rev. Proc. 2004-53).** A successor that acquires substantially all assets of a predecessor in a transaction described in §3121(a)(1)(B) may include predecessor wages in the current-year wage-base calculation. **Out of scope for v1**; engine treats the new employment as starting fresh. To be addressed when M&A onboarding flow lands.
9. **Statutory employees** (e.g., full-time life insurance salespeople, certain delivery drivers per §3121(d)(3)). Subject to FICA but not FIT withholding. Out of scope here; calculator inputs assume `ficaWagesThisPeriod` is correctly populated.
10. **Tipped employees.** Cash tips ≥ $20/month are FICA wages (§3121(a)(12)). Allocated tips and the FICA tip credit (§45B) are **out of scope** for this spec; pointer to a future `docs/payroll-semantics/fica-tipped-wages.md`.
11. **Imputed income** (e.g., GTL > $50k Table I, personal use of company vehicle, certain fringe benefits): subject to FICA and counted in `ficaWagesThisPeriod` upstream. This spec applies the rates without distinguishing source.
12. **Pre-tax deductions reducing FICA wages.** Per IRS Pub 15-B: §125 cafeteria plan elections (health, dental, vision, FSA, HSA via §125) reduce FICA wages. §401(k) and §403(b) elective deferrals **do not** reduce FICA wages. The upstream gross-to-net engine produces `ficaWagesThisPeriod` that already reflects this — this spec does not re-apply.
13. **Employee receives a refund or correction in the period (negative wages).** The §3121 wage-base accounting must reverse correctly: `ssWagesYTDPriorToThisPeriod` reflects net YTD wages including reversals; the calculation produces a negative tax for the period (a refund). Engine returns the negative value and emits a trace event flagging the unusual sign; downstream gross-to-net handles the negative withholding presentation. Cross-quarter corrections require Form 941-X (out of scope for engine; signaled to compliance reporting).
14. **Wage-base change mid-year.** The Social Security wage base is set annually before the year begins (SSA October announcement); the engine does not contemplate mid-year base changes. If Congress amends the base mid-year, a rule-set version bump with `effective_from` mid-year would be required. Flag for compliance-watcher.
15. **Additional Medicare Tax — request to over-withhold.** An employee cannot request the employer apply Additional Medicare Tax below the $200,000 threshold (§3102(f)(1) is mandatory at $200K, not optional below). If an employee wants additional Medicare-related withholding to cover anticipated Form 1040 liability for a married couple's $250K threshold or for self-employment income, it must be done via Form W-4 Step 4(c) extra federal income tax withholding, not via FICA. Engine does not provide a knob for this.
16. **Employer's pre-existing FICA exemption.** Some employers (qualifying religious orders, certain government entities under §3121(b)) are exempt from FICA. Out of scope for v1; engine assumes a covered employer. Engine will reject a configuration claiming exemption until a separate spec lands.
17. **H-2A agricultural workers.** Wages paid to H-2A workers are exempt from FICA (§3121(b)(1) flush). Out of scope for v1; pointer to future `docs/payroll-semantics/agricultural-payroll.md`.
18. **Pending rule change — wage-base annual increase.** SSA publishes the next year's wage base each October. The 2027 figure will land before any 2027 payroll runs. Flag for compliance-watcher.
19. **Pending rule change — Additional Medicare $200,000 threshold.** Statutory and not indexed; would require Congressional action. Flag only if such legislation introduces.
20. **Decimal precision and rounding boundary.** Each of the five output lines (employee SS, employee Medicare, employee Additional Medicare, employer SS match, employer Medicare match) rounds independently. Sum-of-rounded vs. round-of-sum differs by sub-cent amounts — the engine uses sum-of-rounded (round each line then sum) per the §3121 line-by-line withholding obligation.

## Worked examples

All examples use 2026 rates: SS wage base $184,500, SS rate 6.2% each side, Medicare 1.45% each side, Additional Medicare 0.9% employee-only, threshold $200,000.

### Example A — Below-base regular biweekly period

**Inputs:**
- `ficaWagesThisPeriod` = $4,000.00
- `ssWagesYTDPriorToThisPeriod` = $40,000.00
- `medicareWagesYTDPriorToThisPeriod` = $40,000.00

**Employee side:**
- `ssRemainingBase` = max(184,500.00 − 40,000.00, 0) = 144,500.00
- `ssTaxableThisPeriod` = min(4,000.00, 144,500.00) = 4,000.00
- `ssTax_employee` = round(4,000.00 × 0.062, 2) = round(248.00, 2) = **$248.00**
- `medicareTax_employee` = round(4,000.00 × 0.0145, 2) = round(58.00, 2) = **$58.00**
- `medicareWagesAfterThisPeriod` = 40,000.00 + 4,000.00 = 44,000.00
- `addlMedicareTaxableThisPeriod` = max(44,000.00 − 200,000.00, 0) − max(40,000.00 − 200,000.00, 0) = 0 − 0 = 0
- `addlMedicareTax_employee` = **$0.00**

**Employer side:**
- `ssTax_employer` = round(4,000.00 × 0.062, 2) = **$248.00**
- `medicareTax_employer` = round(4,000.00 × 0.0145, 2) = **$58.00**

**CalcResult fields:**
- `employee_side.fica_social_security` = $248.00
- `employee_side.fica_medicare` = $58.00
- `employee_side.fica_additional_medicare` = $0.00
- `employer_side.fica_social_security_match` = $248.00
- `employer_side.fica_medicare_match` = $58.00

### Example B — Period crosses the Social Security wage base

**Inputs:**
- `ficaWagesThisPeriod` = $10,000.00
- `ssWagesYTDPriorToThisPeriod` = $180,000.00
- `medicareWagesYTDPriorToThisPeriod` = $180,000.00

**Employee side:**
- `ssRemainingBase` = max(184,500.00 − 180,000.00, 0) = 4,500.00
- `ssTaxableThisPeriod` = min(10,000.00, 4,500.00) = 4,500.00
- `ssTax_employee` = round(4,500.00 × 0.062, 2) = round(279.00, 2) = **$279.00**
- `medicareTax_employee` = round(10,000.00 × 0.0145, 2) = round(145.00, 2) = **$145.00**
- `medicareWagesAfterThisPeriod` = 180,000.00 + 10,000.00 = 190,000.00
- `addlMedicareTaxableThisPeriod` = max(190,000.00 − 200,000.00, 0) − max(180,000.00 − 200,000.00, 0) = 0 − 0 = 0
- `addlMedicareTax_employee` = **$0.00**

**Employer side:**
- `ssTax_employer` = round(4,500.00 × 0.062, 2) = **$279.00**
- `medicareTax_employer` = round(10,000.00 × 0.0145, 2) = **$145.00**

**CalcResult:**
- `employee_side.fica_social_security` = $279.00 (only the $4,500 below-base slice)
- `employee_side.fica_medicare` = $145.00 (full $10,000)
- `employee_side.fica_additional_medicare` = $0.00 (still below $200K YTD)
- `employer_side.fica_social_security_match` = $279.00
- `employer_side.fica_medicare_match` = $145.00

(Subsequent periods in 2026 for this employee will see `ssTaxableThisPeriod = 0` for both sides until the calendar year resets.)

### Example C — Period crosses the $200,000 Additional Medicare threshold

**Inputs:**
- `ficaWagesThisPeriod` = $15,000.00
- `ssWagesYTDPriorToThisPeriod` = $190,000.00
- `medicareWagesYTDPriorToThisPeriod` = $190,000.00

(Employee is approaching but not yet over the SS base, and crosses the Additional Medicare threshold this period.)

**Employee side:**
- `ssRemainingBase` = max(184,500.00 − 190,000.00, 0) = 0  *(already over SS base)*

  Wait — `ssWagesYTDPriorToThisPeriod = 190,000` exceeds the 2026 base of $184,500. This implies the employee crossed the base in a previous period. The engine handles this correctly:
- `ssTaxableThisPeriod` = min(15,000.00, 0) = 0
- `ssTax_employee` = round(0 × 0.062, 2) = **$0.00**
- `medicareTax_employee` = round(15,000.00 × 0.0145, 2) = round(217.50, 2) = **$217.50**
- `medicareWagesAfterThisPeriod` = 190,000.00 + 15,000.00 = 205,000.00
- `addlMedicareTaxableThisPeriod` = max(205,000.00 − 200,000.00, 0) − max(190,000.00 − 200,000.00, 0) = 5,000.00 − 0 = 5,000.00
- `addlMedicareTax_employee` = round(5,000.00 × 0.009, 2) = round(45.00, 2) = **$45.00**

**Employer side:**
- `ssTax_employer` = **$0.00** (already over base)
- `medicareTax_employer` = round(15,000.00 × 0.0145, 2) = **$217.50**
- (No Additional Medicare match.)

**CalcResult:**
- `employee_side.fica_social_security` = $0.00
- `employee_side.fica_medicare` = $217.50
- `employee_side.fica_additional_medicare` = $45.00
- `employer_side.fica_social_security_match` = $0.00
- `employer_side.fica_medicare_match` = $217.50

(Total employee Medicare-related withholding this period: $262.50. Employer Medicare match: $217.50.)

### Example D — Period entirely above $200,000 threshold

**Inputs:**
- `ficaWagesThisPeriod` = $20,000.00
- `ssWagesYTDPriorToThisPeriod` = $250,000.00
- `medicareWagesYTDPriorToThisPeriod` = $250,000.00

**Employee side:**
- `ssRemainingBase` = max(184,500.00 − 250,000.00, 0) = 0
- `ssTaxableThisPeriod` = min(20,000.00, 0) = 0
- `ssTax_employee` = **$0.00**
- `medicareTax_employee` = round(20,000.00 × 0.0145, 2) = **$290.00**
- `addlMedicareTaxableThisPeriod` = max(270,000.00 − 200,000.00, 0) − max(250,000.00 − 200,000.00, 0) = 70,000.00 − 50,000.00 = 20,000.00
- `addlMedicareTax_employee` = round(20,000.00 × 0.009, 2) = **$180.00**

**Employer side:**
- `ssTax_employer` = **$0.00**
- `medicareTax_employer` = round(20,000.00 × 0.0145, 2) = **$290.00**

**CalcResult:**
- `employee_side.fica_social_security` = $0.00
- `employee_side.fica_medicare` = $290.00
- `employee_side.fica_additional_medicare` = $180.00
- `employer_side.fica_social_security_match` = $0.00
- `employer_side.fica_medicare_match` = $290.00

## Out of scope

- **§6413(c) employee-side multi-employer Social Security overcollection refund.** The employee claims this credit on Form 1040, Schedule 3, Line 11. Engine cannot detect it (Paygon sees one employer at a time). Pointer: not engine logic; informational message in the year-end W-2 review UI is a future enhancement.
- **Common paymaster aggregation (§3121(s)).** Pointer: future spec `docs/payroll-semantics/fica-common-paymaster.md` once a customer needs it.
- **Successor employer wage-base inheritance (§3121(a)(1)(B); Rev. Proc. 2004-53).** Pointer: future spec `docs/payroll-semantics/fica-successor-employer.md`.
- **FICA tip wages and FICA tip credit (§45B).** Pointer: future spec `docs/payroll-semantics/fica-tipped-wages.md`.
- **Statutory employees and statutory non-employees (§3121(d)).** Pointer: future spec.
- **Section 218 agreements** (state and local government employees voluntarily under FICA). Pointer: future spec when first government-customer onboards.
- **Disabled/retired status partial exemptions, §3121(b) exemption categories.** Pointer: covered case-by-case as customers surface.
- **FICA rate changes by Congress.** Out of scope of the spec itself; rule-data update with new `effective_from`.
- **Form 941-X correction handling.** Spec computes the period; correction reporting is a separate workflow.
