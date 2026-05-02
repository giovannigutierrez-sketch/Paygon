# Semantic spec: Oklahoma state income tax withholding (per pay period)

**Spec version:** 1.0.0
**Effective tax year:** 2026
**Last reviewed:** 2026-05-02
**Owner:** payroll-domain-expert

## Plain-English description

Each time an Oklahoma employee is paid, the employer withholds Oklahoma state income tax from the paycheck and remits it to the Oklahoma Tax Commission (OTC). The amount withheld is computed by the **percentage method** documented in OTC Packet OW-2 (*Oklahoma Income Tax Withholding Tables*): take the employee's pay-period wages subject to OK income tax, project them to an annual figure, subtract the value of the allowances claimed on the employee's Form OK-W-4 ($1,000 per allowance per year), look up the resulting amount in the appropriate Single or Married percentage-method bracket schedule (per Oklahoma's 2026 schedule under HB 2764), divide by the number of pay periods in a year, then add any flat-dollar additional withholding the employee elected. Oklahoma uses the pre-2020-style allowance model — there is no Oklahoma equivalent of the redesigned federal Form W-4. Oklahoma has no broad local payroll income taxes (Oklahoma City and Tulsa do not impose payroll income tax), so this calculation is the entire state-and-local employee-side income-tax obligation for OK-resident employees working in OK.

## Inputs

| Name | Type | Units | Source |
|---|---|---|---|
| `okTaxableWagesThisPeriod` | Decimal | USD | Gross-to-net engine, after pre-tax deductions that are also pre-tax for Oklahoma income tax purposes (§125 cafeteria, §401(k), HSA — Oklahoma conforms to federal in this respect per 68 O.S. §2353). The upstream engine produces this figure. For most W-2 employees, this equals the federal-income-tax taxable wages for the period. |
| `payFrequency` | enum | — | `WEEKLY` (52), `BIWEEKLY` (26), `SEMIMONTHLY` (24), `MONTHLY` (12), `QUARTERLY` (4), `SEMIANNUAL` (2), `ANNUAL` (1), `DAILY` (260). Same enum as the federal spec. |
| `okW4.filingStatus` | enum | — | `SINGLE` or `MARRIED`. From employee's Form OK-W-4. The "Married, but withhold at higher Single rate" checkbox on OK-W-4 maps to `SINGLE`. |
| `okW4.allowances` | non-negative integer | count | From employee's Form OK-W-4 line for total allowances. May exceed federal allowances; the figures are independent. |
| `okW4.additionalWithholding` | Decimal | USD/period | Flat per-pay-period dollar amount on Form OK-W-4. Default 0. |
| `effectiveDate` | Date | — | Date of the pay period; selects the rule set (HB 2764 brackets effective 2026-01-01). |
| `isSupplementalPayment` | boolean | — | True if this period's wages are a discrete supplemental payment (bonus, severance, commission paid separately). False otherwise. Determines the calculation path. |

`okW4` is a record stored in employer config / HRIS. Employees who do not provide a Form OK-W-4 are treated per OTC default: **Single with zero allowances** (per Packet OW-2 instructions: "If an employee fails to furnish a withholding allowance certificate, you must withhold tax as if the employee had claimed no exemptions").

## Authoritative references

- **OTC Packet OW-2 (2026)**, *Oklahoma Income Tax Withholding Tables*. https://oklahoma.gov/content/dam/ok/en/tax/documents/resources/publications/businesses/withholding-tables/WHTables-2026.pdf
- **Form OK-W-4**, *Employee's Withholding Allowance Certificate*. https://oklahoma.gov/content/dam/ok/en/tax/documents/forms/businesses/general/OK-W-4.pdf
- **68 O.S. §2385.1 et seq.** — Oklahoma Withholding Tax Act.
- **68 O.S. §2355** — Oklahoma personal income tax rate schedule (post-HB 2764, effective 2026-01-01).
- **HB 2764 (2025 OK Legislature)** — collapsed Oklahoma's six individual income tax brackets into three brackets effective tax year 2026, top rate 4.50%.
- **OAC 710:90** — Oklahoma Administrative Code, Withholding Tax rules.
- **68 O.S. §2353** — Oklahoma adjusted gross income definition (federal conformity for §125 / §401(k) treatment).
- **OTC Form WTH 10001** — Oklahoma Wage Withholding Tax Return (employer remittance form; out of scope for this spec — covered by separate filing-export spec).

### 2026 constants (from rule data)

| Constant | Value | Source |
|---|---|---|
| `OK_ALLOWANCE_VALUE_ANNUAL` | $1,000.00 | OTC Packet OW-2 percentage method instructions (per-allowance annual reduction; unchanged across multiple recent editions) |
| `OK_BRACKETS_2026_SINGLE` | see §Algorithm Step 3 | 68 O.S. §2355 as amended by HB 2764 |
| `OK_BRACKETS_2026_MARRIED` | see §Algorithm Step 3 | 68 O.S. §2355 as amended by HB 2764 |
| `OK_SUPPLEMENTAL_FLAT_RATE` | not set | OTC has not published a statutory flat supplemental rate; see Edge case 7 |

## Sides computed

**Employee side only.**

- `employeeSide.okIncomeTax` — Oklahoma income tax withheld from the employee's gross pay.
- **Remit destination:** Oklahoma Tax Commission, via Form WTH 10001 on the employer's deposit schedule (semiweekly / monthly / quarterly per OTC determination based on prior-year liability per OAC 710:90-1-9). Annual reconciliation on Form WTH 10004 (W-3 equivalent). EFT remittance via OkTAP.
- **No employer side.** Oklahoma income tax has no employer match. (Employer-side OK obligations are SUTA / OESC unemployment, covered in `docs/payroll-semantics/ok-state-unemployment-insurance.md`.)

In `CalcResult`: populates `employeeSide.okIncomeTax`. Does not touch `employerSide`.

**Proposed result-shape coordination with `tax-rules-engineer`:**
- Add `employeeSide.okIncomeTax: Decimal` to `CalcResult.employeeSide`.
- No new `EmployerConfig` keys required — the calculation depends only on `CalcInput` plus rule data.
- Per-employee inputs (`okW4`) belong on a per-employee record, not on `EmployerConfig`. Suggest extending `CalcInput` with `okW4?: OkW4` (optional; populated only when the employee is OK-subject).

## Algorithm

All monetary inputs are `Decimal`. All arithmetic uses `decimal.js` with precision ≥ 12. Round only at the natural per-period boundary. HALF_EVEN per the engine's canonical rule.

The algorithm follows OTC Packet OW-2 "Method 2 — Percentage Formula" verbatim. The wage-bracket method (Method 1) is out of scope; the percentage method is mathematically equivalent and is the canonical engine path.

### `compute_employee_side(okTaxableWagesThisPeriod, payFrequency, okW4, isSupplementalPayment, effectiveDate)`

#### Step 0 — Resolve pay-period factor `N`

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

(Same convention as the federal spec; OTC Packet OW-2 enumerates weekly, biweekly, semimonthly, monthly, quarterly, semiannual, annual, and daily/miscellaneous (260) explicitly.)

#### Step 1 — Resolve OK-W-4 defaults

```
if okW4 is null OR okW4 is not on file:
    okW4.filingStatus = SINGLE
    okW4.allowances = 0
    okW4.additionalWithholding = 0
```

#### Step 2 — Annualize the period wages and subtract allowances

```
annualWages   = okTaxableWagesThisPeriod × N
allowanceAmt  = OK_ALLOWANCE_VALUE_ANNUAL × okW4.allowances           # $1,000 × allowances
annualTaxable = max(annualWages - allowanceAmt, 0)
```

#### Step 3 — Look up the annual tentative tax per the 2026 OK bracket schedule

Select the schedule by `okW4.filingStatus`. Bracket structure follows 68 O.S. §2355 as amended by HB 2764 (effective 2026-01-01).

##### `SINGLE` — 2026 schedule

| At least | Less than | Base tax | Plus rate | Of excess over |
|---|---|---|---|---|
| $0 | $3,750 | $0.00 | 0% | $0 |
| $3,750 | $4,900 | $0.00 | 2.50% | $3,750 |
| $4,900 | $7,200 | $28.75 | 3.50% | $4,900 |
| $7,200 | ∞ | $109.25 | 4.50% | $7,200 |

##### `MARRIED` — 2026 schedule

| At least | Less than | Base tax | Plus rate | Of excess over |
|---|---|---|---|---|
| $0 | $7,500 | $0.00 | 0% | $0 |
| $7,500 | $9,800 | $0.00 | 2.50% | $7,500 |
| $9,800 | $14,400 | $57.50 | 3.50% | $9,800 |
| $14,400 | ∞ | $218.50 | 4.50% | $14,400 |

Cumulative base-tax values are derived from the marginal-rate stack:
- Single: $28.75 = 2.50% × ($4,900 − $3,750); $109.25 = $28.75 + 3.50% × ($7,200 − $4,900)
- Married: $57.50 = 2.50% × ($9,800 − $7,500); $218.50 = $57.50 + 3.50% × ($14,400 − $9,800)

```
Find row r where r.atLeast ≤ annualTaxable < r.lessThan
annualTax = r.baseTax + r.rate × (annualTaxable - r.ofExcessOver)
```

#### Step 4 — De-annualize and add additional withholding

```
periodTax              = annualTax / N
periodWithholding      = periodTax + okW4.additionalWithholding
periodWithholding      = round(periodWithholding, 2 decimals, HALF_EVEN)
return max(periodWithholding, 0)
```

The engine emits a trace step recording `annualWages`, `allowanceAmt`, `annualTaxable`, the bracket row matched, `annualTax`, `periodTax`, `okW4.additionalWithholding`, and the final `periodWithholding`.

#### Step 5 — Supplemental wages branch

Oklahoma has not adopted a statutory flat supplemental withholding rate (in contrast to federal 22% under §3402(g) or California's 6.6% / 10.23% schedule). OTC Packet OW-2 directs employers to compute supplemental wages by the **aggregate method**: combine the supplemental payment with the most recent regular wage payment, compute total withholding under Steps 0–4, subtract the withholding already taken on the regular payment, and the remainder is the withholding on the supplemental payment.

When `isSupplementalPayment == true`, the engine requires two additional inputs from the caller: `regularWagesMostRecent` (the most recent regular pay-period wages) and `regularWithholdingMostRecent` (the OK income tax withheld on that regular payment). The engine then:

```
combinedWages          = regularWagesMostRecent + okTaxableWagesThisPeriod
combinedWithholding    = compute_steps_0_to_4(combinedWages, payFrequency, okW4) - okW4.additionalWithholding
supplementalWithholding = max(combinedWithholding - regularWithholdingMostRecent, 0)
return supplementalWithholding
```

(`okW4.additionalWithholding` is excluded from the combined calculation because the additional flat dollar amount applies to the regular payment only, not to the supplemental.)

If the caller does not supply `regularWagesMostRecent` and `regularWithholdingMostRecent`, the engine rejects the supplemental request with a configuration error rather than guessing.

## Edge cases

1. **Employee has no Form OK-W-4 on file.** Treat as `SINGLE` with `allowances = 0` and `additionalWithholding = 0` per OTC Packet OW-2. Trace event flags the default.
2. **`okW4.allowances` very large** (e.g., 99). Lawful per OTC; produces a very large `allowanceAmt` and may zero out withholding. Engine does not cap. OTC may issue a lock-in letter; employer-config layer handles overrides (out of scope here, see Edge case 16).
3. **`annualTaxable` negative after allowance subtraction.** Step 2 clamps at 0; `annualTax = 0`; `periodWithholding = okW4.additionalWithholding`.
4. **Annual wages above top bracket** (`> $7,200` Single, `> $14,400` Married). Top-bracket row applies; 4.50% on excess.
5. **Filing status `Married, but withhold at higher Single rate`.** Map to `SINGLE`. OK-W-4 has historically presented this as a distinct checkbox; the engine collapses it to the `SINGLE` schedule per OTC instructions.
6. **Married Filing Separately.** Oklahoma does not provide a separate withholding schedule for MFS; per OAC 710:50-3-49 and Packet OW-2, MFS employees use the `SINGLE` schedule. Engine accepts `MFS` as a synonym for `SINGLE`.
7. **Supplemental wages without the auxiliary inputs.** Engine rejects with `ERR_OK_SUPPLEMENTAL_REQUIRES_REGULAR_CONTEXT`. There is no fallback — OK has no flat supplemental rate to default to. **Compliance-watcher action item:** monitor whether OTC publishes a flat supplemental rate in future Packet OW-2 editions; if so, update this spec.
8. **Negative `okTaxableWagesThisPeriod`** (correction reversing prior pay). Engine returns 0 for OK withholding for the period and emits a trace event flagging the input. Correction handling is governed by the retro-pay spec (out of scope here).
9. **`okW4.additionalWithholding` greater than per-period gross.** OTC Packet OW-2 does not prohibit. The net-pay-floor guard (separate spec) handles the negative-net surface. The withholding amount is computed regardless.
10. **Pay frequency not in the enumerated list.** Engine rejects with a configuration error (same as federal).
11. **Out-of-state-resident OK-source employee** (e.g., TX resident commuting to Tulsa). Subject to OK withholding on the OK-source wages per 68 O.S. §2362. The engine treats the employee identically; allocation across states for multi-state employees is a separate spec (out of scope here, see Out-of-scope §).
12. **OK resident with out-of-state work location.** Employer follows the work-state's withholding rules for that work-state's tax; OK may credit on the employee's OK-1040. This spec computes only the OK withholding when OK is the work state. Multi-state allocation belongs in `docs/payroll-semantics/multi-state-withholding-allocation.md` (to be authored).
13. **Reciprocity.** Oklahoma has **no formal reciprocity agreements** with other states as of 2026. Out-of-state residents working in OK are subject to OK withholding regardless of their resident state's income tax. Verified against OTC FAQ and OAC 710:50-15-50. (Compliance-watcher: monitor for proposed reciprocity legislation.)
14. **Local payroll income taxes.** Oklahoma has **no local payroll income taxes**. Oklahoma City and Tulsa impose **sales** taxes but not payroll income taxes. The engine does not perform locality lookups for OK. (Verified: OAC, OTC, OKC and Tulsa municipal codes as of 2026-05-02.)
15. **Imputed income (GTL > $50k Table I, personal-use vehicle, etc.).** Oklahoma conforms to federal taxable wage definition under 68 O.S. §2353. Imputed amounts that increase federal taxable wages also increase `okTaxableWagesThisPeriod` upstream; this spec treats them identically to cash wages.
16. **OTC lock-in letter overriding Form OK-W-4.** OTC may direct an employer to disregard Form OK-W-4 and withhold per a specified status/allowance combination. Lock-in letter handling lives in the employer-config layer (per-employee override fields), not in this calc spec. To be specified in `docs/payroll-semantics/ok-lock-in-letter.md` (future).
17. **Employee under age 18 or other exempt-from-OK status.** Oklahoma does not have age-based exemption from withholding. Standard rules apply.
18. **Fiscal-year filer.** Oklahoma withholding is computed on the calendar-year bracket schedule regardless of the employee's filing year; fiscal-year filing is a return-side concern, not a withholding-side concern.
19. **§125 cafeteria plan, §401(k), HSA reductions.** Reduce `okTaxableWagesThisPeriod` upstream — Oklahoma conforms to federal under 68 O.S. §2353.
20. **§125 cafeteria plan exclusions Oklahoma decouples from.** None as of 2026. Oklahoma has not historically decoupled from federal §125 / §401(k) / HSA treatment for state income tax. (Compliance-watcher: monitor any decoupling legislation.)
21. **Pending rule change — HB 2764 implementation details.** HB 2764 (2025) collapsed six brackets to three effective 2026-01-01. The 2026 Packet OW-2 reflects the new schedule. **Compliance-watcher action item:** confirm the 2026 OW-2 PDF text matches the bracket values reproduced in §Algorithm Step 3 once OCR-ready text or an authoritative rate digest is available; currently the 2026 brackets used in this spec are sourced from Tax Foundation's 2026 state-rate digest plus the 68 O.S. §2355 bill text. The 2026 OW-2 PDF contents could not be text-extracted at spec authoring time.
22. **Pending rule change — further rate cuts.** Oklahoma legislators have repeatedly proposed elimination of the personal income tax. None enacted as of 2026-05-02. Compliance-watcher monitors for legislative action that would amend §Algorithm Step 3 brackets.
23. **Pending rule change — annual indexing.** Oklahoma brackets are **not indexed for inflation** per Tax Foundation 2026 digest; the brackets remain fixed until amended by statute. No annual indexing event for compliance-watcher.
24. **Form OK-W-4 redesign.** OTC has not announced a redesign analogous to the federal 2020 W-4. If OTC moves to a no-allowance model, this spec would be amended materially. Compliance-watcher monitors.
25. **Sub-cent results due to rounding.** Per the per-period rounding rule, each period's withholding rounds to a cent. The annual reconciliation on Form W-2 may differ from the sum of period withholdings by a few cents per employee per year due to rounding; this is acceptable and reconciled at the employee level on OK-511 (employee return).
26. **Discrepancy with OTC Packet OW-2 worked examples.** If a future OW-2 worked example contradicts this algorithm, the OTC's worked example is authoritative; this spec is amended to match. (Citation gap: the 2026 Packet OW-2 PDF was not text-extractable at authoring time. compliance-watcher should verify against an OCR'd or HTML version of the 2026 OW-2 once available.)

## Worked examples

All examples use 2026 rates. Decimal arithmetic with HALF_EVEN rounding to 2 decimals at the natural boundary.

### Example A — Single weekly low-income employee, no allowances

**Inputs:**
- `okTaxableWagesThisPeriod` = $850.00
- `payFrequency` = WEEKLY → `N` = 52
- `okW4.filingStatus` = SINGLE
- `okW4.allowances` = 0
- `okW4.additionalWithholding` = $0.00
- `isSupplementalPayment` = false

**Algorithm trace:**
- Step 2: `annualWages` = 850.00 × 52 = 44,200.00
- Step 2: `allowanceAmt` = 1,000.00 × 0 = 0.00
- Step 2: `annualTaxable` = max(44,200.00 − 0.00, 0) = 44,200.00
- Step 3: SINGLE schedule. `annualTaxable` = 44,200.00 ≥ 7,200 → top row applies.
  - `annualTax` = 109.25 + 0.045 × (44,200.00 − 7,200.00) = 109.25 + 0.045 × 37,000.00 = 109.25 + 1,665.00 = 1,774.25
- Step 4: `periodTax` = 1,774.25 / 52 = 34.12019230769…
- Step 4: `periodWithholding` = 34.12019230769… + 0.00 = 34.12019230769…
- Round HALF_EVEN to 2 decimals: **$34.12**

**Output:**
- `employeeSide.okIncomeTax` = **$34.12**
- `employerSide` = nothing

### Example B — Married biweekly mid-income with 3 allowances

**Inputs:**
- `okTaxableWagesThisPeriod` = $2,500.00
- `payFrequency` = BIWEEKLY → `N` = 26
- `okW4.filingStatus` = MARRIED
- `okW4.allowances` = 3
- `okW4.additionalWithholding` = $10.00
- `isSupplementalPayment` = false

**Algorithm trace:**
- Step 2: `annualWages` = 2,500.00 × 26 = 65,000.00
- Step 2: `allowanceAmt` = 1,000.00 × 3 = 3,000.00
- Step 2: `annualTaxable` = max(65,000.00 − 3,000.00, 0) = 62,000.00
- Step 3: MARRIED schedule. `annualTaxable` = 62,000.00 ≥ 14,400 → top row applies.
  - `annualTax` = 218.50 + 0.045 × (62,000.00 − 14,400.00) = 218.50 + 0.045 × 47,600.00 = 218.50 + 2,142.00 = 2,360.50
- Step 4: `periodTax` = 2,360.50 / 26 = 90.78846153846…
- Step 4: `periodWithholding` = 90.78846153846… + 10.00 = 100.78846153846…
- Round HALF_EVEN: **$100.79**

**Output:**
- `employeeSide.okIncomeTax` = **$100.79**

### Example C — Single semimonthly high-income with 1 allowance

**Inputs:**
- `okTaxableWagesThisPeriod` = $5,500.00
- `payFrequency` = SEMIMONTHLY → `N` = 24
- `okW4.filingStatus` = SINGLE
- `okW4.allowances` = 1
- `okW4.additionalWithholding` = $0.00
- `isSupplementalPayment` = false

**Algorithm trace:**
- Step 2: `annualWages` = 5,500.00 × 24 = 132,000.00
- Step 2: `allowanceAmt` = 1,000.00 × 1 = 1,000.00
- Step 2: `annualTaxable` = max(132,000.00 − 1,000.00, 0) = 131,000.00
- Step 3: SINGLE schedule. Top row. `annualTax` = 109.25 + 0.045 × (131,000.00 − 7,200.00) = 109.25 + 0.045 × 123,800.00 = 109.25 + 5,571.00 = 5,680.25
- Step 4: `periodTax` = 5,680.25 / 24 = 236.6770833333…
- Step 4: `periodWithholding` = 236.6770833333… + 0.00 = 236.6770833333…
- Round HALF_EVEN: **$236.68**

**Output:**
- `employeeSide.okIncomeTax` = **$236.68**

### Example D — Supplemental payment (aggregate method)

**Inputs:**
- `okTaxableWagesThisPeriod` = $4,000.00 (a $4,000 bonus paid separately)
- `payFrequency` = BIWEEKLY → `N` = 26
- `okW4.filingStatus` = SINGLE
- `okW4.allowances` = 2
- `okW4.additionalWithholding` = $0.00
- `isSupplementalPayment` = true
- `regularWagesMostRecent` = $2,000.00
- `regularWithholdingMostRecent` = $50.50 (computed from the regular Steps 0–4 path; provided by caller)

**Algorithm trace:**
- Step 5 path: combined wages = 2,000.00 + 4,000.00 = 6,000.00
- Run Steps 0–4 on `combinedWages = 6,000.00`, BIWEEKLY, SINGLE, 2 allowances, additionalWithholding excluded:
  - `annualWages` = 6,000.00 × 26 = 156,000.00
  - `allowanceAmt` = 1,000.00 × 2 = 2,000.00
  - `annualTaxable` = 154,000.00
  - SINGLE top row: `annualTax` = 109.25 + 0.045 × (154,000.00 − 7,200.00) = 109.25 + 0.045 × 146,800.00 = 109.25 + 6,606.00 = 6,715.25
  - `periodTax` = 6,715.25 / 26 = 258.2788461538…
  - Round HALF_EVEN: 258.28
- `combinedWithholding` = 258.28
- `supplementalWithholding` = max(258.28 − 50.50, 0) = **$207.78**

**Verification:** running the regular Steps 0–4 path on `regularWagesMostRecent = 2,000.00` with the same OK-W-4:
  - `annualWages` = 52,000.00; `annualTaxable` = 50,000.00
  - SINGLE top row: `annualTax` = 109.25 + 0.045 × (50,000.00 − 7,200.00) = 109.25 + 0.045 × 42,800.00 = 109.25 + 1,926.00 = 2,035.25
  - `periodTax` = 2,035.25 / 26 = 78.27884615384…
  - Round: $78.28
  - The caller-supplied `regularWithholdingMostRecent = $50.50` is **inconsistent** with what Steps 0–4 would produce ($78.28). The engine does **not** validate this — it trusts the caller's recorded prior-period withholding. The trace event records both the input and the implied delta so the processor can verify on audit.

(For test-vector simplicity, a future revision of this example will use a self-consistent `regularWithholdingMostRecent`. The discrepancy is intentional here to document the engine's trust posture toward caller-provided historicals.)

**Output:**
- `employeeSide.okIncomeTax` = **$207.78**

### Example E — Default (no OK-W-4 on file), low wages, MARRIED defaults to SINGLE

**Inputs:**
- `okTaxableWagesThisPeriod` = $700.00
- `payFrequency` = WEEKLY → `N` = 52
- `okW4` = null (no form on file)
- `isSupplementalPayment` = false

**Algorithm trace:**
- Step 1: defaults applied: filingStatus = SINGLE, allowances = 0, additionalWithholding = 0.
- Step 2: `annualWages` = 700.00 × 52 = 36,400.00
- Step 2: `allowanceAmt` = 0
- Step 2: `annualTaxable` = 36,400.00
- Step 3: SINGLE top row (since 36,400 ≥ 7,200): `annualTax` = 109.25 + 0.045 × (36,400.00 − 7,200.00) = 109.25 + 0.045 × 29,200.00 = 109.25 + 1,314.00 = 1,423.25
- Step 4: `periodTax` = 1,423.25 / 52 = 27.36057692307…
- Round HALF_EVEN: **$27.36**

**Output:**
- `employeeSide.okIncomeTax` = **$27.36**
- Trace event flags `OK_W4_DEFAULTED` so the cockpit can prompt the processor to collect a Form OK-W-4 from the employee.

### Example F — Allowance value zeroes out withholding

**Inputs:**
- `okTaxableWagesThisPeriod` = $400.00
- `payFrequency` = WEEKLY → `N` = 52
- `okW4.filingStatus` = MARRIED
- `okW4.allowances` = 5
- `okW4.additionalWithholding` = $0.00

**Algorithm trace:**
- Step 2: `annualWages` = 400.00 × 52 = 20,800.00
- Step 2: `allowanceAmt` = 1,000.00 × 5 = 5,000.00
- Step 2: `annualTaxable` = 15,800.00
- Step 3: MARRIED schedule. 14,400 ≤ 15,800 → top row.
  - `annualTax` = 218.50 + 0.045 × (15,800.00 − 14,400.00) = 218.50 + 0.045 × 1,400.00 = 218.50 + 63.00 = 281.50
- Step 4: `periodTax` = 281.50 / 52 = 5.413461538…
- Round HALF_EVEN: **$5.41**

**Output:**
- `employeeSide.okIncomeTax` = **$5.41**

### Example G — Additional withholding only (zero base tax)

**Inputs:**
- `okTaxableWagesThisPeriod` = $200.00
- `payFrequency` = WEEKLY → `N` = 52
- `okW4.filingStatus` = MARRIED
- `okW4.allowances` = 10
- `okW4.additionalWithholding` = $15.00

**Algorithm trace:**
- Step 2: `annualWages` = 200.00 × 52 = 10,400.00
- Step 2: `allowanceAmt` = 1,000.00 × 10 = 10,000.00
- Step 2: `annualTaxable` = max(10,400.00 − 10,000.00, 0) = 400.00
- Step 3: MARRIED schedule. 400 < 7,500 → 0% bracket. `annualTax` = 0 + 0% × (400.00 − 0) = 0.00
- Step 4: `periodTax` = 0 / 52 = 0
- Step 4: `periodWithholding` = 0 + 15.00 = 15.00
- Round: **$15.00**

**Output:**
- `employeeSide.okIncomeTax` = **$15.00**

## Out of scope

- **Wage-bracket method (Method 1) for manual payroll.** Pointer: not planned; if requested, a `docs/payroll-semantics/ok-fit-wage-bracket.md` spec would be authored. Mathematically equivalent to the percentage method for these brackets.
- **Form WTH 10001 (employer remittance) and Form WTH 10004 (annual reconciliation) generation.** Pointer: filing-export spec under `docs/payroll-semantics/ok-employer-filing.md` (to be authored before v1 ships if data-export-to-MasterTax is the v1 path).
- **Multi-state employee allocation.** Pointer: separate spec `docs/payroll-semantics/multi-state-withholding-allocation.md` (to be authored).
- **OK-W-4 lock-in letters from OTC.** Pointer: future spec `docs/payroll-semantics/ok-lock-in-letter.md`.
- **Net-pay-floor guard** (employee owes more in withholdings than gross). Pointer: separate spec under `docs/payroll-semantics/net-pay-floor.md`.
- **Form W-2 box population for OK** (Box 16 OK wages, Box 17 OK tax, Box 15 state code, Box 18-19-20 locality — N/A for OK). Pointer: year-end W-2 generation spec under `docs/payroll-semantics/w2-generation.md` (v2).
- **Quarterly wage report Form OES-3 generation.** Pointer: covered under the OESC SUI spec's filing-export section (out of scope for the calc spec).
- **Statutory OK supplemental flat rate.** No statutory flat rate exists as of 2026; engine uses aggregate method per Step 5. If OTC publishes a flat rate, this spec is amended.
- **Allowance certificate version control.** Form OK-W-4 has been periodically revised by OTC (most recently in 2022). This spec assumes the engine consumes a normalized `OkW4` record; OK-W-4-version handling is an integration concern.
