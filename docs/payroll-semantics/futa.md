# Semantic spec: Federal Unemployment Tax (FUTA) — per pay period accrual

**Spec version:** 1.0.0
**Effective tax year:** 2026
**Last reviewed:** 2026-05-02
**Owner:** payroll-domain-expert

## Plain-English description

FUTA is a federal tax paid **only by the employer** that funds the federal portion of the unemployment insurance system (administrative oversight and a loan account for state UI programs). It is a flat 6.0% on the first $7,000 of each employee's wages per calendar year, with a credit of up to 5.4% for state unemployment tax paid timely — yielding an effective 0.6% in non-credit-reduction states. The Department of Labor designates "credit reduction states" each November (states whose UI trust funds have outstanding federal loans for two-plus consecutive years), and the credit is reduced by 0.3% per additional year of outstanding loan balance, raising the effective FUTA rate accordingly. Per IRS Pub 15 §14, the engine accrues FUTA each pay period; the employer remits via Form 940 quarterly (if accumulated liability exceeds $500) or annually (if at or under $500), with the final true-up filed annually.

## Inputs

| Name | Type | Units | Source |
|---|---|---|---|
| `futaWagesThisPeriod` | Decimal | USD | Wages **subject to FUTA** for this pay period. (Note: §125 cafeteria plan reductions apply — same as FICA. §401(k) elective deferrals **are** FUTA-taxable. Imputed income generally is FUTA-taxable. The upstream gross-to-net engine produces this figure correctly per IRS Pub 15-A and the Form 940 instructions.) |
| `futaWagesYTDPriorToThisPeriod` | Decimal | USD | Year-to-date FUTA wages **before** this period for this employer/EIN. |
| `creditReductionPercent` | Decimal | percent | Per-state credit reduction figure for the year, from rule data (Schedule A of Form 940, published by DOL annually). 0.0 in non-credit-reduction states. Comes from the rule-data layer, not from this spec. |
| `stateUiPaidTimely` | boolean | — | True if the employer has paid state UI tax timely under the rules of §3302(a) and §3302(b). Comes from employer-config (or, in the future, from a SUTA-paid integration). Default true unless flagged otherwise. |
| `effectiveDate` | Date | — | Used to select rule set and year's credit-reduction list. |

The spec computes per-pay-period **accrual**. Quarterly and annual remittance scheduling is a separate concern (Form 940 / 940 instructions).

## Authoritative references

- **26 U.S.C. §3301** — FUTA tax rate (6.0%).
- **26 U.S.C. §3302** — Credits against tax (the up-to-5.4% state UI credit).
- **26 U.S.C. §3306(b)(1)** — FUTA wage base of $7,000 (statutory; not indexed; unchanged since 1983).
- **26 U.S.C. §3302(c)(2)** — Credit reduction for states with outstanding federal Title XII loans.
- **26 CFR §31.3301-1** through **§31.3306(b)(1)-1** — FUTA regulations.
- **IRS Form 940 (2026)** and instructions — https://www.irs.gov/forms-pubs/about-form-940
- **IRS Form 940 Schedule A (2026)** — Multi-State Employer and Credit Reduction Information; published annually with the year's credit-reduction state list and percentages.
- **IRS Publication 15 (2026) §14** — Federal Unemployment (FUTA) Tax. https://www.irs.gov/publications/p15
- **DOL Bureau of Labor Statistics / OUI** — credit reduction designation for the year. https://oui.doleta.gov/unemploy/
- **DOL announcement of credit reduction states** — published in the Federal Register typically mid-November preceding the FUTA filing year.

### 2026 constants (from rule data)

| Constant | Value | Source |
|---|---|---|
| `FUTA_GROSS_RATE` | 0.060 | 26 USC §3301 |
| `FUTA_WAGE_BASE` | $7,000.00 | 26 USC §3306(b)(1) |
| `MAX_STATE_CREDIT` | 0.054 | 26 USC §3302(b) |
| `EFFECTIVE_RATE_NO_REDUCTION` | 0.006 | derived: 0.060 − 0.054 |

## Sides computed

**Employer side only.**

- FUTA tax — employer cost; not withheld from employee.
- Remit destination: IRS, via **Form 940** (annual return). Deposits made via EFTPS.
  - **Quarterly deposit threshold:** if accumulated FUTA liability (sum across employees) at end of any calendar quarter exceeds $500, deposit by the last day of the month following the quarter. Otherwise carry forward.
  - **Year-end:** any remaining liability is paid with Form 940 by January 31 of the following year (February 10 if all deposits made timely).

In `CalcResult`: populates `employer_side.futa`. Does not touch `employee_side`.

## Algorithm

All arithmetic uses `Decimal` precision ≥ 12. Round per Pub 15 — to the nearest cent at the natural boundary. HALF_EVEN per the engine's canonical rule.

### `compute_employer_side(futaWagesThisPeriod, futaWagesYTDPriorToThisPeriod, creditReductionPercent, stateUiPaidTimely)`

#### Step 1 — Determine the employee's effective FUTA rate

```
if stateUiPaidTimely == false:
    # Lose the entire 5.4% credit per §3302(a)/(b) timely-payment requirement
    effectiveRate = FUTA_GROSS_RATE                              # 6.0%
else:
    # State credit applies, less any DOL-published credit reduction for the state
    effectiveRate = EFFECTIVE_RATE_NO_REDUCTION + creditReductionPercent
    # = 0.006 + (e.g., 0.003 → 0.009 effective; 0.000 → 0.006)
```

The `creditReductionPercent` parameter is a non-negative Decimal supplied by the rule layer. Its value depends on state and year. For 2025 wages (FUTA filed in early 2026), DOL designates the affected states; this spec treats the value as data input.

Note: §3302(a)(1) timely payment is for state UI **paid by January 31** of the year following the wage year, not by the pay-period date. The engine's per-period accrual assumes `stateUiPaidTimely = true` by default; year-end true-up under Form 940 handles any retroactive loss of credit. A separate workflow surfaces unpaid SUTA balances near year-end so the processor can true up before deposit deadlines. Out of scope here.

#### Step 2 — FUTA taxable wages this period (with $7,000 wage-base crossing)

```
futaRemainingBase = max(FUTA_WAGE_BASE - futaWagesYTDPriorToThisPeriod, 0)
futaTaxableThisPeriod = min(futaWagesThisPeriod, futaRemainingBase)
```

#### Step 3 — Compute period FUTA accrual

```
futaTax_employer = round(futaTaxableThisPeriod × effectiveRate, 2 decimals, HALF_EVEN)
```

#### Returns

```
{
  futa: futaTax_employer,
}
```

The trace event records `effectiveRate`, `creditReductionPercent`, `stateUiPaidTimely`, `futaTaxableThisPeriod`, and the resulting tax for audit.

## Edge cases

1. **Period entirely below the $7,000 wage base.** `futaTaxableThisPeriod = futaWagesThisPeriod`; standard 0.6% rate (or higher with credit reduction).
2. **Period crosses the $7,000 wage base.** `futaRemainingBase = 7,000 − YTD_prior` clamped to 0; only the slice up to $7,000 is taxable. Worked example B.
3. **Period entirely above the $7,000 wage base** (employee already over $7,000 YTD). `futaRemainingBase = 0`; taxable = 0; tax = $0.00. Worked example C.
4. **Credit reduction state.** The `creditReductionPercent` is a positive Decimal (e.g., 0.003 = 0.3%). Effective rate climbs to 0.009 (0.9%) for first additional reduction year, 0.012 for second, etc., per §3302(c)(2). The spec is parameterized; the rule layer supplies the year's per-state values.
5. **Lost credit due to untimely state UI payment.** `stateUiPaidTimely = false` collapses the credit; effective rate is 6.0% on all FUTA-taxable wages up to $7,000. Surface a high-severity exception in the cockpit.
6. **Employer registered in multiple states.** Each state's wages are subject to that state's potential credit reduction; the per-employee $7,000 base is **per-employee, not per-state-per-employee**. An employee who earns $4,000 in CA and $4,000 in OK has $7,000 of FUTA-taxable wages total ($4,000 in CA + $3,000 in OK at OK rates, in the order paid). Schedule A of Form 940 allocates each employee's FUTA wages to states. **The engine handles this by applying the wage base per-employee globally and by carrying a `state` attribute on each period's FUTA wages**; the spec parameter `creditReductionPercent` is the rate for the state of the period being computed. A separate multi-state-allocation spec governs the carve-up; pointer below.
7. **New employee starting mid-year.** First $7,000 of wages from this employer in the calendar year is FUTA-taxable, regardless of when in the year the employment began. No proration. Worked example D.
8. **Employee terminated and rehired in the same year, same employer.** Wages aggregate — the $7,000 cap applies to the employee for the year with this employer, not per employment spell. Engine relies on accurate `futaWagesYTDPriorToThisPeriod` from the source system; no special handling required by this spec.
9. **Successor employer (§3121 / §3306(b)(1) flush language).** A successor that acquires substantially all assets from a predecessor may credit predecessor wages toward the $7,000 cap. **Out of scope for v1**; engine treats new employment as starting at $0 YTD. Flag for compliance-watcher and a future spec.
10. **§501(c)(3) tax-exempt employers.** Exempt from FUTA per §3306(c)(8). Out of scope for v1; engine assumes a non-exempt employer. Configuration flag will reject calculation until a separate spec lands.
11. **Government employers** (state, political subdivisions, federal). Generally exempt from FUTA per §3306(c)(7). Out of scope for v1.
12. **Indian tribal governments.** Exempt under §3306(c)(7) if elected. Out of scope for v1.
13. **Agricultural and household employers.** Different FUTA threshold tests (§3306(a)(1) and (a)(2)). Out of scope for v1.
14. **Wages paid to children under 21 by parent, or to spouse.** Exempt from FUTA per §3306(c)(5). Out of scope for v1; engine assumes all employees are FUTA-covered. To be supported by employer-config flag in a future spec.
15. **§125 cafeteria plan reductions.** Reduce FUTA wages (same as FICA). Upstream gross-to-net engine produces `futaWagesThisPeriod` correctly.
16. **§401(k) elective deferrals.** Do NOT reduce FUTA wages — §3306(b)(5) explicitly. Upstream engine handles.
17. **Imputed income (GTL > $50k, etc.).** FUTA-taxable. Upstream engine includes in `futaWagesThisPeriod`.
18. **Negative wages (correction in the period).** Engine applies the wage-base ceiling against net YTD; negative period wages produce negative FUTA accrual (a refund). Trace event flags the unusual sign. Cross-quarter corrections involve Form 940 amendment (no separate "Form 940-X"; corrections are made on a corrected Form 940 — out of scope here).
19. **Period with zero FUTA wages.** All values 0; tax 0; emit trace event recording $0.00 to ease audit.
20. **Pending rule change — annual DOL credit reduction list.** Updated each November for the prior year's loan balances. The 2025 credit-reduction list (affecting Q4 2025 / Form 940 filed January 2026) was finalized by DOL in November 2025; the 2026 list (for Form 940 filed January 2027) will publish in November 2026. **Flag for compliance-watcher to ingest the 2026 list when published. The engine treats `creditReductionPercent` as a data input and changes only require rule-data updates, never code.**
21. **Pending rule change — proposed FUTA rate increases.** Periodically Congress considers raising the 6.0% rate or the $7,000 wage base. Neither is law as of the spec date. Flag for compliance-watcher to monitor.
22. **Pending rule change — temporary FUTA surtax.** A 0.2% FUTA surtax expired in 2011; subsequent extensions have not been enacted as of 2026. If reinstated, it becomes part of `FUTA_GROSS_RATE` rule data.
23. **Mid-period rate change.** FUTA rates and wage base do not change mid-year by historical practice; if Congress acts, rule-data effective dating handles it.
24. **Sub-cent results due to rounding.** Per the per-period rounding rule, each period's accrual rounds to a cent. The Form 940 annual reconciliation may differ from the sum of period accruals by a few cents per employee per year due to rounding; this is acceptable per IRS Pub 15.
25. **Verify against authoritative 2026 source at landing time.** As of this spec authoring (2026-05-02), the 2025 wage-year credit-reduction states have been published by DOL; the 2026 wage-year list will not publish until November 2026. The engine must operate without the 2026 list during 2026 with `creditReductionPercent = 0.0` until DOL publishes — and then apply retroactively to the year's wages on Form 940.

## Worked examples

All examples assume non-credit-reduction state, `creditReductionPercent = 0`, `stateUiPaidTimely = true`, effectiveRate = 0.006.

### Example A — Early-year sub-$7,000 weekly period

**Inputs:**
- `futaWagesThisPeriod` = $1,500.00
- `futaWagesYTDPriorToThisPeriod` = $0.00
- `creditReductionPercent` = 0.000
- `stateUiPaidTimely` = true

**Computation:**
- `effectiveRate` = 0.006 + 0.000 = 0.006
- `futaRemainingBase` = max(7,000.00 − 0.00, 0) = 7,000.00
- `futaTaxableThisPeriod` = min(1,500.00, 7,000.00) = 1,500.00
- `futaTax_employer` = round(1,500.00 × 0.006, 2) = round(9.00, 2) = **$9.00**

**CalcResult:** `employer_side.futa` = **$9.00**

### Example B — Period crosses the $7,000 wage base

**Inputs:**
- `futaWagesThisPeriod` = $2,000.00
- `futaWagesYTDPriorToThisPeriod` = $6,000.00
- `creditReductionPercent` = 0.000
- `stateUiPaidTimely` = true

**Computation:**
- `effectiveRate` = 0.006
- `futaRemainingBase` = max(7,000.00 − 6,000.00, 0) = 1,000.00
- `futaTaxableThisPeriod` = min(2,000.00, 1,000.00) = 1,000.00
- `futaTax_employer` = round(1,000.00 × 0.006, 2) = round(6.00, 2) = **$6.00**

**CalcResult:** `employer_side.futa` = **$6.00**. Subsequent periods in the year for this employee will produce $0.00 FUTA.

### Example C — Period after employee already over $7,000 YTD

**Inputs:**
- `futaWagesThisPeriod` = $3,000.00
- `futaWagesYTDPriorToThisPeriod` = $9,500.00
- `creditReductionPercent` = 0.000
- `stateUiPaidTimely` = true

**Computation:**
- `effectiveRate` = 0.006
- `futaRemainingBase` = max(7,000.00 − 9,500.00, 0) = 0
- `futaTaxableThisPeriod` = min(3,000.00, 0) = 0
- `futaTax_employer` = round(0 × 0.006, 2) = **$0.00**

**CalcResult:** `employer_side.futa` = **$0.00**

### Example D — New hire mid-year (first period above wage base)

**Inputs:**
- `futaWagesThisPeriod` = $9,000.00 (employee's first paycheck of the year — large lump-sum hire bonus + wages)
- `futaWagesYTDPriorToThisPeriod` = $0.00
- `creditReductionPercent` = 0.000
- `stateUiPaidTimely` = true

**Computation:**
- `effectiveRate` = 0.006
- `futaRemainingBase` = max(7,000.00 − 0.00, 0) = 7,000.00
- `futaTaxableThisPeriod` = min(9,000.00, 7,000.00) = 7,000.00 (entire $7,000 cap consumed in one period)
- `futaTax_employer` = round(7,000.00 × 0.006, 2) = round(42.00, 2) = **$42.00**

**CalcResult:** `employer_side.futa` = **$42.00**. All subsequent periods this year for this employee: $0.00.

### Example E — Credit reduction state (hypothetical 0.3% reduction)

**Inputs:**
- `futaWagesThisPeriod` = $2,500.00
- `futaWagesYTDPriorToThisPeriod` = $0.00
- `creditReductionPercent` = 0.003 (0.3% — typical first-year credit reduction)
- `stateUiPaidTimely` = true

**Computation:**
- `effectiveRate` = 0.006 + 0.003 = 0.009
- `futaRemainingBase` = 7,000.00
- `futaTaxableThisPeriod` = min(2,500.00, 7,000.00) = 2,500.00
- `futaTax_employer` = round(2,500.00 × 0.009, 2) = round(22.50, 2) = **$22.50**

**CalcResult:** `employer_side.futa` = **$22.50**

### Example F — Lost full credit due to untimely state UI payment

**Inputs:**
- `futaWagesThisPeriod` = $4,000.00
- `futaWagesYTDPriorToThisPeriod` = $0.00
- `creditReductionPercent` = 0.000
- `stateUiPaidTimely` = false

**Computation:**
- `effectiveRate` = 0.060 (full gross rate; credit lost)
- `futaRemainingBase` = 7,000.00
- `futaTaxableThisPeriod` = min(4,000.00, 7,000.00) = 4,000.00
- `futaTax_employer` = round(4,000.00 × 0.060, 2) = round(240.00, 2) = **$240.00**

**CalcResult:** `employer_side.futa` = **$240.00**. The engine surfaces a high-severity exception alert ("untimely SUTA may have eliminated the FUTA state credit — verify before deposit").

## Out of scope

- **Form 940 deposit scheduling and the $500 quarterly threshold logic.** Pointer: separate spec under `docs/payroll-semantics/futa-deposit-scheduling.md` (to be authored before v1 ships).
- **Multi-state employee FUTA wage allocation across states.** Pointer: separate spec `docs/payroll-semantics/futa-multistate-allocation.md` — coordinate with state-income-tax allocation in the same module.
- **Successor employer wage-base inheritance** (§3306(b)(1) flush). Pointer: future spec `docs/payroll-semantics/futa-successor-employer.md`.
- **§501(c)(3) and government employer exemptions.** Pointer: future spec when first such customer onboards.
- **Agricultural / household employer FUTA threshold tests.** Pointer: future spec.
- **Family-member exempt wages (§3306(c)(5)).** Pointer: future spec.
- **DOL credit-reduction list ingestion.** Pointer: rule-data process owned by `compliance-watcher`. The engine consumes the list as data; ingestion automation is separate.
- **Form 940 generation / filing.** Pointer: v2+ filing-export spec; engine produces the per-period accrual that feeds the filing module.
- **Year-end true-up logic** (reconcile sum of period accruals against the Schedule A allocation). Pointer: separate spec `docs/payroll-semantics/futa-year-end-truup.md`.
