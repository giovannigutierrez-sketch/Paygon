# Semantic spec: Federal income tax withholding (per pay period)

**Spec version:** 1.0.0
**Effective tax year:** 2026
**Last reviewed:** 2026-05-02
**Owner:** payroll-domain-expert

## Plain-English description

Each time an employee is paid, the employer withholds federal income tax from the paycheck and remits it to the IRS. The amount withheld is calculated from a formula that takes the employee's wages for the period, projects them to an annual figure, looks up the tax in IRS-published bracket tables, applies the employee's Form W-4 adjustments (filing status, multiple-jobs checkbox, dependents, other income, deductions, extra withholding), and converts the answer back to a per-pay-period number. This spec covers only the **percentage method** for **automated payroll systems** using the **2020 or later Form W-4**. The wage-bracket method, the alternative methods (annualized, average estimated wages, etc.), and pre-2020 Forms W-4 are out of scope.

## Inputs

| Name | Type | Units | Source |
|---|---|---|---|
| `taxableWagesThisPeriod` | Decimal | USD | Gross-to-net engine after pre-tax deductions (§125, §401(k), HSA, etc.). Wages **subject to federal income tax** for this pay period. |
| `payFrequency` | enum | — | `WEEKLY` (52), `BIWEEKLY` (26), `SEMIMONTHLY` (24), `MONTHLY` (12), `QUARTERLY` (4), `SEMIANNUAL` (2), `ANNUAL` (1), `DAILY` (260). Source: employer pay-schedule config. |
| `w4.filingStatus` | enum | — | `MFJ` (Married Filing Jointly / Qualifying Surviving Spouse), `SMS` (Single / Married Filing Separately), `HOH` (Head of Household). From employee's Form W-4 Step 1(c). |
| `w4.step2Checkbox` | boolean | — | True if the employee checked the box in Step 2(c) of Form W-4. |
| `w4.step3DependentCredit` | Decimal | USD/year | Dollar amount the employee entered on Step 3 of Form W-4 (already aggregated by the employee — engine does **not** re-derive `$2,000 × children + $500 × others`). |
| `w4.step4aOtherIncome` | Decimal | USD/year | Amount on Step 4(a). Default 0 if blank. |
| `w4.step4bDeductions` | Decimal | USD/year | Amount on Step 4(b). Default 0 if blank. |
| `w4.step4cExtraWithholding` | Decimal | USD/period | Amount on Step 4(c) — already a per-pay-period figure per the Form W-4 instructions. Default 0 if blank. |
| `effectiveDate` | Date | — | Date of the pay period; used to select the rule set. |

Pre-2020 Forms W-4 (using allowances) are **out of scope** for the v1 engine. Any employee record with `w4Version < 2020` causes the engine to halt with a configuration error; the processor must collect a 2020+ Form W-4. Rationale: maintaining the legacy allowance pathway doubles the federal withholding code surface for an artifact that the IRS deprecated. New hires after 2020-01-01 cannot use the old form per Treas. Reg. notice; only existing employees may.

## Authoritative references

- **IRS Publication 15-T (2026)**, *Federal Income Tax Withholding Methods*, "Worksheet 1A. Employer's Withholding Worksheet for Percentage Method Tables for Automated Payroll Systems." https://www.irs.gov/publications/p15t
- **IRS Publication 15 (2026)**, *Employer's Tax Guide* (Circular E). https://www.irs.gov/publications/p15
- **26 U.S.C. §3402** — Income tax collected at source.
- **26 CFR §31.3402(a)-1** — General rules for withholding.
- **26 CFR §31.3402(h)(4)-1** — Withholding on the basis of average estimated wages (alternative; not used here).
- **Form W-4 (2020 revision and later)** — https://www.irs.gov/forms-pubs/about-form-w-4
- **IRS Notice 2018-92** — Initial guidance for the redesigned Form W-4.
- **IRS Pub 15-T (2026)** Tables 4 and 5 — Standard and Step-2-Checkbox Withholding Rate Schedules for Automated Payroll Systems (verbatim values reproduced in the Algorithm section).

## Sides computed

- **Employee side only.** Federal income tax withholding is withheld from the employee's gross pay and remitted to the IRS by the employer.
- **Remit destination:** IRS, via Form 941 (quarterly) — combined with FICA — using EFTPS. Schedule depends on the employer's deposit schedule (monthly vs. semiweekly), governed by IRS Pub 15 §11.
- **No employer match.** The employer does not pay anything on top.

In `CalcResult`: populates `employee_side.federal_income_tax`. Does not touch `employer_side`.

## Algorithm

All monetary inputs are `Decimal`. All arithmetic uses `decimal.js` with precision ≥ 12. Per IRS Pub 15-T Worksheet 1A, intermediate values within the worksheet are kept to full precision and rounded only at line 1l (the final withholding amount), to the nearest cent. Half-cent rounding follows banker's rounding (HALF_EVEN) per IRS Pub 15 §13 ("Rounding"); employers may alternatively use HALF_UP, but the engine uses HALF_EVEN as the canonical rule.

### Step 0 — Resolve pay-period factor `N`

```
N = {
  DAILY: 260,
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMIMONTHLY: 24,
  MONTHLY: 12,
  QUARTERLY: 4,
  SEMIANNUAL: 2,
  ANNUAL: 1,
}[payFrequency]
```

(Pub 15-T Worksheet 1A line 1b uses 260 for daily/miscellaneous payroll periods.)

### Step 1 — Annualize taxable wages (Worksheet 1A lines 1a–1d)

```
1a = taxableWagesThisPeriod
1b = N
1c = 1a × 1b                                # annualized period wages
1d = 1c + w4.step4aOtherIncome              # add Step 4(a)
```

### Step 2 — Apply Step 4(b) deductions and the standard adjustment (lines 1e–1g)

The percentage-method tables already build in the standard deduction. The worksheet additionally subtracts the Step 4(b) figure (extra deductions the employee claims).

```
1e = w4.step4bDeductions
1f = 1d - 1e                                # adjusted annual wages before tables
1g = max(1f, 0)                             # negative becomes 0; tables go from $0 up
```

### Step 3 — Look up tentative tax (lines 1h–1i)

Select the table according to `w4.step2Checkbox` and `w4.filingStatus`:

#### Standard table (Step 2 box NOT checked) — Pub 15-T 2026 Table 4

**Married Filing Jointly / Qualifying Surviving Spouse (`MFJ`):**

| At least | Less than | Tentative tax | Plus rate | Of excess over |
|---|---|---|---|---|
| $0 | $19,300 | $0.00 | 0% | $0 |
| $19,300 | $44,100 | $0.00 | 10% | $19,300 |
| $44,100 | $120,100 | $2,480.00 | 12% | $44,100 |
| $120,100 | $230,700 | $11,600.00 | 22% | $120,100 |
| $230,700 | $422,850 | $35,932.00 | 24% | $230,700 |
| $422,850 | $531,750 | $82,048.00 | 32% | $422,850 |
| $531,750 | $788,000 | $116,896.00 | 35% | $531,750 |
| $788,000 | ∞ | $206,583.50 | 37% | $788,000 |

**Single or Married Filing Separately (`SMS`):**

| At least | Less than | Tentative tax | Plus rate | Of excess over |
|---|---|---|---|---|
| $0 | $7,500 | $0.00 | 0% | $0 |
| $7,500 | $19,900 | $0.00 | 10% | $7,500 |
| $19,900 | $57,900 | $1,240.00 | 12% | $19,900 |
| $57,900 | $113,200 | $5,800.00 | 22% | $57,900 |
| $113,200 | $209,275 | $17,966.00 | 24% | $113,200 |
| $209,275 | $263,725 | $41,024.00 | 32% | $209,275 |
| $263,725 | $648,100 | $58,448.00 | 35% | $263,725 |
| $648,100 | ∞ | $192,979.25 | 37% | $648,100 |

**Head of Household (`HOH`):**

| At least | Less than | Tentative tax | Plus rate | Of excess over |
|---|---|---|---|---|
| $0 | $15,550 | $0.00 | 0% | $0 |
| $15,550 | $33,250 | $0.00 | 10% | $15,550 |
| $33,250 | $83,000 | $1,770.00 | 12% | $33,250 |
| $83,000 | $121,250 | $7,740.00 | 22% | $83,000 |
| $121,250 | $217,300 | $16,155.00 | 24% | $121,250 |
| $217,300 | $271,750 | $39,207.00 | 32% | $217,300 |
| $271,750 | $656,150 | $56,631.00 | 35% | $271,750 |
| $656,150 | ∞ | $191,171.00 | 37% | $656,150 |

#### Step-2-Checkbox table (Step 2 box checked) — Pub 15-T 2026 Table 5

**Married Filing Jointly (`MFJ`):**

| At least | Less than | Tentative tax | Plus rate | Of excess over |
|---|---|---|---|---|
| $0 | $16,100 | $0.00 | 0% | $0 |
| $16,100 | $28,500 | $0.00 | 10% | $16,100 |
| $28,500 | $66,500 | $1,240.00 | 12% | $28,500 |
| $66,500 | $121,800 | $5,800.00 | 22% | $66,500 |
| $121,800 | $217,875 | $17,966.00 | 24% | $121,800 |
| $217,875 | $272,325 | $41,024.00 | 32% | $217,875 |
| $272,325 | $400,450 | $58,448.00 | 35% | $272,325 |
| $400,450 | ∞ | $103,291.75 | 37% | $400,450 |

**Single or Married Filing Separately (`SMS`):**

| At least | Less than | Tentative tax | Plus rate | Of excess over |
|---|---|---|---|---|
| $0 | $8,050 | $0.00 | 0% | $0 |
| $8,050 | $14,250 | $0.00 | 10% | $8,050 |
| $14,250 | $33,250 | $620.00 | 12% | $14,250 |
| $33,250 | $60,900 | $2,900.00 | 22% | $33,250 |
| $60,900 | $108,938 | $8,983.00 | 24% | $60,900 |
| $108,938 | $136,163 | $20,512.00 | 32% | $108,938 |
| $136,163 | $328,350 | $29,224.00 | 35% | $136,163 |
| $328,350 | ∞ | $96,489.63 | 37% | $328,350 |

**Head of Household (`HOH`):**

| At least | Less than | Tentative tax | Plus rate | Of excess over |
|---|---|---|---|---|
| $0 | $12,075 | $0.00 | 0% | $0 |
| $12,075 | $20,925 | $0.00 | 10% | $12,075 |
| $20,925 | $45,800 | $885.00 | 12% | $20,925 |
| $45,800 | $64,925 | $3,870.00 | 22% | $45,800 |
| $64,925 | $112,950 | $8,077.50 | 24% | $64,925 |
| $112,950 | $140,175 | $19,603.50 | 32% | $112,950 |
| $140,175 | $332,375 | $28,315.50 | 35% | $140,175 |
| $332,375 | ∞ | $95,585.50 | 37% | $332,375 |

```
Find row r where r.atLeast ≤ 1g < r.lessThan
1h = r.tentativeTax + r.rate × (1g - r.ofExcessOver)
1i = 1h                                     # tentative annual withholding
```

### Step 4 — Apply Step 3 dependent credit (lines 1j–1k)

```
1j = w4.step3DependentCredit                # already a dollar amount per Form W-4
1k = max(1i - 1j, 0)                        # annual withholding cannot go negative
```

### Step 5 — Convert to per-period and add Step 4(c) (lines 1l–1n)

```
1l = 1k / N                                 # per-period withholding before extra
1m = w4.step4cExtraWithholding              # already per-period
1n = 1l + 1m                                # final per-period withholding
```

### Step 6 — Round

```
withholding = round(1n, 2 decimals, HALF_EVEN)
return max(withholding, 0)                  # never negative
```

## Edge cases

1. **Negative `taxableWagesThisPeriod`** (e.g., a void/correction reverses prior pay). The percentage-method worksheet does not contemplate negative wages. Engine returns `0` for FIT withholding for the period and emits a trace event flagging the input; correction handling is governed by a separate retro-pay spec (out of scope here).
2. **`step3DependentCredit > tentativeTax`.** Worksheet line 1k clamps at 0. Per IRS Pub 15-T, the employer does not refund the excess; the employee recovers it via the Form 1040 reconciliation.
3. **`step4bDeductions > step4aOtherIncome + annualizedWages`.** Line 1g clamps at 0; tentative tax is 0; final withholding is `step4cExtraWithholding` only.
4. **`step4cExtraWithholding` greater than per-period gross.** The withholding can mathematically exceed the gross. Pub 15-T does not prohibit this. The gross-to-net engine (separately) must check that net pay does not go negative; if it would, the engine surfaces an exception for the processor (handled by a separate net-pay-floor spec, out of scope here).
5. **Step 2 box checked but `step3DependentCredit` is also non-zero.** Permitted by Form W-4 — both apply simultaneously. The tables already factor in the higher-rate assumption; the dependent credit reduces from the higher tentative tax.
6. **Pay frequency not in the enumerated list** (e.g., a one-off bonus with no period). Engine rejects; the supplemental wages spec (out of scope here, separate spec under `docs/payroll-semantics/supplemental-wages.md` to be authored) handles flat 22% / aggregate methods.
7. **Pre-2020 Form W-4.** Engine rejects with a configuration error. Operator must obtain a 2020+ W-4 from the employee.
8. **Filing status `MFS` (Married Filing Separately).** Treated identically to `Single` for withholding per Form W-4 — the Form W-4 collapses S and MFS into a single Step 1(c) box. Engine accepts both `S` and `MFS` and routes to the `SMS` table.
9. **Multiple jobs without Step 2 box checked.** Spec assumes the employee's choice is captured on the W-4 as-is. The engine does not infer multiple jobs from external signals.
10. **Mid-year W-4 change.** A new W-4 takes effect on the first payroll on or after the date the employer is required to give effect to it (Treas. Reg. §31.3402(f)(3)-1). Effective-date resolution lives at the rule-set selection layer; this spec assumes the W-4 record passed in is already the correct one for `effectiveDate`.
11. **Imputed income (e.g., GTL > $50k Table I).** Imputed amounts that are subject to FIT withholding flow into `taxableWagesThisPeriod` upstream; this spec treats them identically to cash wages.
12. **§125, §401(k), HSA pre-tax deductions.** Already excluded from `taxableWagesThisPeriod` upstream. This spec does not re-deduct them.
13. **Employee with $0 wages this period (unpaid leave, terminated mid-period, etc.).** All worksheet lines compute to 0; final withholding is `step4cExtraWithholding`. If the employee has no pay to withhold from, the engine surfaces an exception (handled upstream, not in this spec).
14. **Annualized wages exceed top bracket** (`>$788,000` MFJ standard, etc.). The top-bracket row applies; rate 37% on excess.
15. **Step 4(c) extra withholding is negative.** Form W-4 instructions disallow negative entries. Engine validates `step4cExtraWithholding ≥ 0` at config time; rejects if negative.
16. **Pending rule change — annual indexing.** Bracket thresholds are indexed annually for inflation. The 2027 tables will publish in late 2026 (typically mid-November via Rev. Proc.). `compliance-watcher` must add a 2027 rule set before the first 2027 payroll. Flag for compliance-watcher.
17. **Pending rule change — Form W-4 redesigns.** The IRS revised Form W-4 in 2020 and may revise again. A new Step (e.g., Step 5 or beyond) would require a spec amendment, not just rule-data. Flag for compliance-watcher.
18. **NRA (nonresident alien) employees.** Pub 15-T Worksheet 1A for an NRA requires an additional annual amount to be **added** to wages before table lookup (per Pub 15-T 2026 Table for NRAs — separate from Tables 4 and 5). **Out of scope for v1**; engine rejects employees flagged as NRA until a separate NRA spec (`docs/payroll-semantics/federal-fit-nra.md`) lands.
19. **Household employees / agricultural workers.** Different deposit and form requirements (Schedule H / Form 943). The withholding math is identical; out of scope here only because the v1 engine targets W-2 wage payrolls under Form 941.
20. **Discrepancy with Pub 15-T worked examples.** If a future Pub 15-T example contradicts this algorithm, the IRS's worked example is authoritative; this spec is amended to match.

## Worked examples

All examples use 2026 rates. Decimal arithmetic with HALF_EVEN rounding to 2 decimals at the natural boundary.

### Example A — Single weekly employee, no adjustments

**Inputs:**
- `taxableWagesThisPeriod` = $1,500.00
- `payFrequency` = WEEKLY → `N` = 52
- `w4.filingStatus` = SMS
- `w4.step2Checkbox` = false
- `w4.step3DependentCredit` = $0
- `w4.step4aOtherIncome` = $0
- `w4.step4bDeductions` = $0
- `w4.step4cExtraWithholding` = $0

**Worksheet:**
- 1a = 1,500.00
- 1b = 52
- 1c = 1,500.00 × 52 = 78,000.00
- 1d = 78,000.00 + 0 = 78,000.00
- 1e = 0
- 1f = 78,000.00 − 0 = 78,000.00
- 1g = max(78,000.00, 0) = 78,000.00
- Table: SMS standard. Row: at least $57,900, less than $113,200 → tentative $5,800.00 + 22% over $57,900.
- 1h = 5,800.00 + 0.22 × (78,000.00 − 57,900.00) = 5,800.00 + 0.22 × 20,100.00 = 5,800.00 + 4,422.00 = 10,222.00
- 1i = 10,222.00
- 1j = 0
- 1k = max(10,222.00 − 0, 0) = 10,222.00
- 1l = 10,222.00 / 52 = 196.5769230769… → keep full precision until line 1n
- 1m = 0
- 1n = 196.5769230769… + 0 = 196.5769230769…
- Round HALF_EVEN to 2 decimals: **$196.58**

**Output:**
- `employee_side.federal_income_tax` = **$196.58**
- `employer_side` = nothing (FIT has no employer side)

### Example B — MFJ biweekly with Step 2 checkbox

**Inputs:**
- `taxableWagesThisPeriod` = $3,200.00
- `payFrequency` = BIWEEKLY → `N` = 26
- `w4.filingStatus` = MFJ
- `w4.step2Checkbox` = true
- `w4.step3DependentCredit` = $0
- `w4.step4aOtherIncome` = $0
- `w4.step4bDeductions` = $0
- `w4.step4cExtraWithholding` = $0

**Worksheet:**
- 1a = 3,200.00
- 1b = 26
- 1c = 3,200.00 × 26 = 83,200.00
- 1d = 83,200.00
- 1e = 0
- 1f = 83,200.00
- 1g = 83,200.00
- Table: MFJ Step-2-Checkbox. Row: at least $66,500, less than $121,800 → tentative $5,800.00 + 22% over $66,500.
- 1h = 5,800.00 + 0.22 × (83,200.00 − 66,500.00) = 5,800.00 + 0.22 × 16,700.00 = 5,800.00 + 3,674.00 = 9,474.00
- 1i = 9,474.00
- 1j = 0
- 1k = 9,474.00
- 1l = 9,474.00 / 26 = 364.3846153846…
- 1m = 0
- 1n = 364.3846153846…
- Round HALF_EVEN: **$364.38**

**Output:**
- `employee_side.federal_income_tax` = **$364.38**

### Example C — HOH semimonthly with Step 3 dependents and Step 4(c) extra

**Inputs:**
- `taxableWagesThisPeriod` = $2,800.00
- `payFrequency` = SEMIMONTHLY → `N` = 24
- `w4.filingStatus` = HOH
- `w4.step2Checkbox` = false
- `w4.step3DependentCredit` = $4,500.00 (e.g., 2 qualifying children under 17 = $4,000 + 1 other dependent = $500)
- `w4.step4aOtherIncome` = $1,200.00
- `w4.step4bDeductions` = $2,000.00
- `w4.step4cExtraWithholding` = $25.00

**Worksheet:**
- 1a = 2,800.00
- 1b = 24
- 1c = 2,800.00 × 24 = 67,200.00
- 1d = 67,200.00 + 1,200.00 = 68,400.00
- 1e = 2,000.00
- 1f = 68,400.00 − 2,000.00 = 66,400.00
- 1g = 66,400.00
- Table: HOH standard. Row: at least $33,250, less than $83,000 → tentative $1,770.00 + 12% over $33,250.
- 1h = 1,770.00 + 0.12 × (66,400.00 − 33,250.00) = 1,770.00 + 0.12 × 33,150.00 = 1,770.00 + 3,978.00 = 5,748.00
- 1i = 5,748.00
- 1j = 4,500.00
- 1k = max(5,748.00 − 4,500.00, 0) = 1,248.00
- 1l = 1,248.00 / 24 = 52.00
- 1m = 25.00
- 1n = 52.00 + 25.00 = 77.00
- Round: **$77.00**

**Output:**
- `employee_side.federal_income_tax` = **$77.00**

### Example D — Step 3 credit exceeds tentative tax (low-wage edge case)

**Inputs:**
- `taxableWagesThisPeriod` = $900.00
- `payFrequency` = WEEKLY → `N` = 52
- `w4.filingStatus` = MFJ
- `w4.step2Checkbox` = false
- `w4.step3DependentCredit` = $6,000.00 (3 qualifying children)
- All else 0

**Worksheet:**
- 1c = 900.00 × 52 = 46,800.00
- 1d = 46,800.00; 1f = 46,800.00; 1g = 46,800.00
- Table: MFJ standard. Row: at least $44,100, less than $120,100 → $2,480.00 + 12% over $44,100.
- 1h = 2,480.00 + 0.12 × (46,800.00 − 44,100.00) = 2,480.00 + 0.12 × 2,700.00 = 2,480.00 + 324.00 = 2,804.00
- 1i = 2,804.00
- 1j = 6,000.00
- 1k = max(2,804.00 − 6,000.00, 0) = 0.00
- 1l = 0 / 52 = 0
- 1n = 0 + 0 = 0

**Output:**
- `employee_side.federal_income_tax` = **$0.00**

(The unused $3,196 of dependent credit is recovered by the employee on Form 1040, not by Paygon.)

## Out of scope

- **Wage-bracket method** for manual payroll. v1 is software-only. Pointer: not planned; if requested, a `docs/payroll-semantics/federal-fit-wage-bracket.md` spec would be authored.
- **Pre-2020 Form W-4 (allowance method).** Pointer: rejected by engine. Will not be supported.
- **Supplemental wages (bonuses, commissions paid separately from regular wages).** Pointer: separate spec `docs/payroll-semantics/supplemental-wages-flat-and-aggregate.md` (to be authored).
- **NRA (nonresident alien) wage adjustments.** Pointer: separate spec `docs/payroll-semantics/federal-fit-nra.md` (to be authored before the first NRA payroll).
- **Periodic pension and annuity withholding** (Worksheet 1B). Pointer: not in v1 scope (Paygon serves W-2 wage payrolls).
- **State and local income tax withholding.** Pointer: per-state specs under `docs/payroll-semantics/state-income-tax-<state>.md`.
- **Additional Medicare Tax** (0.9% over $200K). Pointer: covered in `docs/payroll-semantics/fica-social-security-and-medicare.md`.
- **Lock-in letters from the IRS** (notice 2810C / 2811C overriding Form W-4 entries). Pointer: lives in employer-config layer (per-employee override field), not in this calc spec. To be specified separately.
- **Net-pay-floor guard** (employee owes more in withholdings than gross pay). Pointer: separate spec under `docs/payroll-semantics/net-pay-floor.md`.
