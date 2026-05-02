# Semantic spec: Oklahoma State Unemployment Insurance (OESC SUI / SUTA) — per pay period accrual

**Spec version:** 1.0.0
**Effective tax year:** 2026
**Last reviewed:** 2026-05-02
**Owner:** payroll-domain-expert

## Plain-English description

Oklahoma's State Unemployment Insurance (SUI) tax — administered by the Oklahoma Employment Security Commission (OESC) and frequently referred to as SUTA — is paid **only by the employer** to fund unemployment benefits for Oklahoma workers. The tax is the employer's per-employee contribution rate (set annually by OESC based on the employer's experience rating) multiplied by each employee's wages up to Oklahoma's annual taxable wage base (**$25,000 for 2026**, per OESC's Contribution Rates publication). New employers without an experience history pay a **1.5%** new-employer rate; experience-rated employers pay between **0.2%** and **5.8%** depending on their reserve ratio per OESC rate schedule under 40 O.S. §3-110. The engine accrues SUI each pay period using the employer's 2026 OESC rate (a per-employer config value); employers remit on Form OES-3 quarterly to OESC.

## Inputs

| Name | Type | Units | Source |
|---|---|---|---|
| `okSutaWagesThisPeriod` | Decimal | USD | Wages **subject to OK SUI** for this pay period. (Note: §125 cafeteria plan reductions apply per 40 O.S. §1-218 conformity; §401(k) elective deferrals **are** SUI-taxable per OAC 240:10. Imputed income generally is SUI-taxable. The upstream gross-to-net engine produces this figure correctly.) |
| `okSutaWagesYTDPriorToThisPeriod` | Decimal | USD | Year-to-date OK SUI-taxable wages **before** this period for this employer/OESC account. |
| `okSutaRate` | Decimal | percent (as fraction, e.g., 0.015 = 1.5%) | Per-employer 2026 contribution rate from `EmployerConfig.okSutaRate`. Set by OESC's annual rate notice (mailed to employer in Q4 of prior year, per OAC 240:10-3-7). New employers default to 0.015 (1.5%). |
| `effectiveDate` | Date | — | Used to select rule set (wage base, rate schedule). |

The spec computes per-pay-period **accrual**. Quarterly remittance scheduling on Form OES-3 is a separate concern (filing-export spec, out of scope).

## Authoritative references

- **40 O.S. §§1-101 – 9-103** — Oklahoma Employment Security Act.
- **40 O.S. §3-101** — Definitions, including "wages" for SUI purposes.
- **40 O.S. §3-105** — Contribution rates and reserve ratio schedule.
- **40 O.S. §3-106** — Taxable wage base.
- **40 O.S. §3-110** — New employer rate (1.5%).
- **40 O.S. §3-114.2** — Conditional Contribution Rate / State Experience Factor adjustments.
- **OAC 240:10** — Oklahoma Administrative Code, OESC unemployment compensation rules.
- **OESC Contribution Rates publication (2026)** — https://oklahoma.gov/oesc/employers/tax/contribution-rates.html
- **OESC Form OES-3** — Employer's Quarterly Contribution Report (out of scope here; see filing-export spec).
- **OESC employer handbook** — https://oklahoma.gov/oesc/employers.html

### 2026 constants (from rule data)

| Constant | Value | Source |
|---|---|---|
| `OK_SUI_WAGE_BASE_2026` | $25,000.00 | OESC Contribution Rates page (verified 2026-05-02): "Taxable Wage Base $25,000" |
| `OK_SUI_NEW_EMPLOYER_RATE` | 0.015 (1.5%) | OESC Contribution Rates page: "The rate for newly established employers is 1.5%." Codified at 40 O.S. §3-110. |
| `OK_SUI_MIN_RATE` | 0.002 (0.2%) | OESC Contribution Rates page: "Range of Rates 0.2% to 5.8%" |
| `OK_SUI_MAX_RATE` | 0.058 (5.8%) | OESC Contribution Rates page: "Range of Rates 0.2% to 5.8%" |
| `OK_SUI_RATE_VALIDATION_LOWER` | 0.0 | engine validation floor — voluntary contributions can drive computed rate below the schedule minimum in edge cases (out of scope; see Edge case 8) |
| `OK_SUI_RATE_VALIDATION_UPPER` | 0.058 | engine validation cap — values above 5.8% rejected as configuration errors unless `okSutaRate` carries a `surchargeJustification` flag |

**Note on the conditional factor:** OESC's Contribution Rates page mentions "For rates of 0.1% to 0.9%, simply add 0.6%. For rates of 1.0% or greater, multiply the rate by 1.667." This is OESC's *rate-schedule transformation* — i.e., how OESC publishes the *base reserve-ratio rate* and converts it into the *effective contribution rate* on the employer's annual rate notice. By the time the rate reaches `EmployerConfig.okSutaRate`, the transformation has already been applied: the engine receives the **effective rate** the employer is to apply, not a raw reserve-ratio figure. **The engine MUST NOT re-apply this transformation.** The transformation is documented here for compliance-watcher's awareness only.

## Sides computed

**Employer side only.**

- `employerSide.stateEmployerPrograms.okSuta` — Oklahoma SUI employer contribution.
- **Remit destination:** Oklahoma Employment Security Commission (OESC) via **Form OES-3**, Employer's Quarterly Contribution Report. Due by the last day of the month following the close of each calendar quarter (April 30, July 31, October 31, January 31). EFT remittance via OESC's online employer portal (EZ Tax Express).
- **No employee side.** Oklahoma does not authorize employee SUI contributions; the entire SUI burden is on the employer per 40 O.S. §3-104.

In `CalcResult`: populates `employerSide.stateEmployerPrograms.okSuta`. Does not touch `employeeSide`.

**Proposed result-shape coordination with `tax-rules-engineer`:**
- Add `employerSide.stateEmployerPrograms: { readonly okSuta: Decimal; ... }` to `CalcResult.employerSide`. The `stateEmployerPrograms` namespace anticipates v1's CA / NY / IL employer-side state programs (CA ETT, NY MCTMT, etc.) and v2+'s state PFML programs without requiring a `CalcResult` reshape every time a state lands.
- Add `okSutaRate: Decimal` to `EmployerConfig`. The value is per-employer, set annually from the OESC rate notice. Default (engine fallback) = 0.015 if undefined; emit a trace warning when defaulting because new-employer status should be an explicit configuration fact, not an inferred default.
- The `EmployerConfig` snapshot included in `CalcResult` already preserves `futaCreditReductionPercent`; adding `okSutaRate` follows the same pattern and is essential for the audit hash chain (rate changes mid-year must be visible in the trace).

## Algorithm

All arithmetic uses `Decimal` precision ≥ 12. Round at the natural per-period boundary. HALF_EVEN per the engine's canonical rule.

### `compute_employer_side(okSutaWagesThisPeriod, okSutaWagesYTDPriorToThisPeriod, okSutaRate)`

#### Step 1 — Validate the rate

```
if okSutaRate < OK_SUI_RATE_VALIDATION_LOWER OR okSutaRate > OK_SUI_RATE_VALIDATION_UPPER:
    reject with ERR_OK_SUTA_RATE_OUT_OF_RANGE
```

The lower bound is 0% (occurs only with voluntary contributions or special programs — out of scope; see Edge case 8). The upper bound is 5.8%. A value above 5.8% indicates either a configuration error or an OESC delinquency surcharge under 40 O.S. §3-110.1, which is out of scope for v1 and surfaces as an exception. (Compliance-watcher: monitor for OESC surcharge programs that would push rates above 5.8% and warrant amending the validation cap.)

#### Step 2 — OK SUI taxable wages this period (with $25,000 wage-base crossing)

```
okSutaRemainingBase    = max(OK_SUI_WAGE_BASE_2026 - okSutaWagesYTDPriorToThisPeriod, 0)
okSutaTaxableThisPeriod = min(okSutaWagesThisPeriod, okSutaRemainingBase)
```

This mirrors the FUTA wage-base crossing pattern in `docs/payroll-semantics/futa.md` Step 2; the only differences are the base value ($25,000 vs. $7,000) and the YTD ledger is the OESC-account YTD, not the employee's all-employer YTD. (See Edge case 5 on multi-employer wage-base behavior — it does **not** mirror FUTA.)

#### Step 3 — Compute period SUI accrual

```
okSutaTax_employer = round(okSutaTaxableThisPeriod × okSutaRate, 2 decimals, HALF_EVEN)
```

#### Returns

```
{
  okSuta: okSutaTax_employer,
}
```

The trace event records `okSutaRate`, `okSutaWagesYTDPriorToThisPeriod`, `okSutaRemainingBase`, `okSutaTaxableThisPeriod`, and the resulting tax for audit. The `EmployerConfig` snapshot in `CalcResult` records the rate as configured, supporting future replay-from-source.

## Edge cases

1. **Period entirely below the $25,000 wage base.** `okSutaTaxableThisPeriod = okSutaWagesThisPeriod`; tax = wages × `okSutaRate`. Worked example A.
2. **Period crosses the $25,000 wage base.** `okSutaRemainingBase = 25,000 − YTD_prior` clamped to 0; only the slice up to $25,000 is taxable. Worked example B.
3. **Period entirely above the $25,000 wage base** (employee already over $25,000 YTD on this OESC account). `okSutaRemainingBase = 0`; taxable = 0; tax = $0.00. Worked example C.
4. **New employee starting mid-year.** First $25,000 of wages from this employer's OESC account in the calendar year is SUI-taxable, regardless of when in the year the employment began. No proration. Same pattern as FUTA.
5. **Employee with multiple OK employers in the same year.** The $25,000 base resets per employer per OESC account — unlike FUTA's per-employee-globally-across-employers cap, OK SUI follows the **per-employer** model standard to state UI (40 O.S. §3-106). An employee who earns $20,000 at Employer A and $20,000 at Employer B in 2026 has $40,000 of SUI-taxable wages total ($20,000 at each employer's rate). The engine handles this by tracking `okSutaWagesYTDPriorToThisPeriod` per-employer; multi-employer awareness is not required at the engine level — each employer's payroll calculation is self-contained.
6. **Employee terminated and rehired in the same year, same employer / same OESC account.** Wages aggregate — the $25,000 cap applies to the employee for the year on this OESC account, not per employment spell. Engine relies on accurate `okSutaWagesYTDPriorToThisPeriod`.
7. **Successor employer in a §3306-style transfer.** Per 40 O.S. §3-111, a successor that acquires substantially all of a predecessor's Oklahoma operations may inherit the predecessor's experience rating and may credit predecessor wages toward the $25,000 cap. **Out of scope for v1**; engine treats new OESC accounts as starting at $0 YTD with no inherited wages. Flag for compliance-watcher and a future spec `docs/payroll-semantics/ok-suta-successor-employer.md`.
8. **Voluntary contributions.** Per 40 O.S. §3-110.2, an employer may make a **voluntary contribution** to OESC by March 31 of a year that retroactively reduces the rate for that year (by improving the reserve ratio used in the rate-setting formula). This is an **annual filing decision**, not a per-period calculation. The engine accepts whatever `okSutaRate` is on file at calculation time. If the employer makes a voluntary contribution that retroactively reduces the rate, the engine must be re-run for the affected periods with the new rate (or a year-end true-up adjustment must be issued). **Out of scope for v1**; documented for awareness.
9. **Agricultural employees.** Per 40 O.S. §1-210(7), agricultural labor is generally exempt from Oklahoma SUI unless the employer paid $20,000+ in cash wages in any quarter of the current or preceding calendar year, or employed 10+ workers on at least 20 days. Engine assumes non-agricultural employment by default. If an employer is agricultural and below the threshold, the engine should compute SUI = $0 — but this is **out of scope for v1**, with a configuration flag `EmployerConfig.okAgriculturalExempt` to be specified in a future spec when a customer requires it.
10. **Domestic / household employees.** Per 40 O.S. §1-210(8), domestic service in a private home is exempt from Oklahoma SUI unless the employer paid $1,000+ in cash wages in any quarter. Out of scope for v1; future spec.
11. **Family employees** (sole proprietor's child under 21, spouse, parent). Per 40 O.S. §1-210(6), exempt from Oklahoma SUI. Out of scope for v1; engine assumes all employees are SUI-covered. Future spec `docs/payroll-semantics/ok-suta-family-employee-exemption.md`.
12. **Religious / charitable §501(c)(3) employers.** Per 40 O.S. §1-210(13), §501(c)(3) employers may elect to be **reimbursing employers** rather than contributing employers — they reimburse OESC for actual benefits paid rather than paying contributions. The engine's `okSuta` calculation does not apply to reimbursing employers. Out of scope for v1; configuration flag `EmployerConfig.okReimbursingEmployer` to be added when a customer requires it.
13. **Government employers** (state, county, municipal). Subject to OESC under 40 O.S. §1-210(11) but typically as reimbursing employers. Out of scope for v1.
14. **Indian tribal governments.** Subject to OESC under 40 O.S. §1-210(11)(d) post-2000-amendment. Out of scope for v1.
15. **Out-of-state-employer registration thresholds.** A non-Oklahoma employer becomes liable for OK SUI on Oklahoma-source wages once Oklahoma is the "state of coverage" under the four-step localization-of-work test (40 O.S. §1-210(g) — service localized in OK; or base of operations / direction-and-control in OK; or residence in OK with some OK service). Determining the state of coverage is **out of scope for this calc spec** — the engine assumes the per-employee per-period record arrives with the OK-coverage determination already made upstream. Multi-state allocation is `docs/payroll-semantics/multi-state-suta-allocation.md` (to be authored).
16. **§125 cafeteria plan reductions.** Reduce OK SUI wages (Oklahoma conforms per 40 O.S. §1-218 wage definition incorporating federal §3306(b) by reference). Upstream engine produces `okSutaWagesThisPeriod` correctly.
17. **§401(k) elective deferrals.** Do **NOT** reduce OK SUI wages — same as FUTA, per 40 O.S. §1-218 incorporating §3306(b)(5) by reference. Upstream engine handles.
18. **Imputed income** (GTL > $50k Table I, etc.). SUI-taxable. Upstream engine includes in `okSutaWagesThisPeriod`.
19. **Negative wages** (correction in the period). Engine applies the wage-base ceiling against net YTD; negative period wages produce negative SUI accrual (a refund). Trace event flags the unusual sign. Cross-quarter corrections are handled on Form OES-3 amendment (out of scope here).
20. **Period with zero SUI wages.** All values 0; tax 0; emit trace event recording $0.00.
21. **Rate change mid-year.** OESC rates are set annually at calendar-year boundary per 40 O.S. §3-110.1; mid-year changes are rare but can occur via OESC re-determination after audit or appeal. The engine's rule-data layer supports effective-date-aware rate values; the `EmployerConfig.okSutaRate` value at the time of calculation is what applies. Replay against historical rates is supported via the audit trail's `employerConfigSnapshot`.
22. **Pending rule change — annual wage base.** The OK SUI wage base is set annually under 40 O.S. §3-106(b)(2) by reference to the state average annual wage. The 2026 figure is $25,000 (verified 2026-05-02). The 2027 figure will be published by OESC in late 2026. **Compliance-watcher action item:** ingest the 2027 wage base when published.
23. **Pending rule change — annual rate range and conditional factor.** The 0.2%–5.8% range and the conditional-factor transformation (add 0.6% / multiply by 1.667) are set per 40 O.S. §3-110.1 by reference to the State Experience Factor (a function of the OESC trust fund balance). They may change for 2027. **Compliance-watcher action item:** monitor OESC's annual Contribution Rates publication and update the rule-data validation bounds when changed. The transformation itself is upstream of `okSutaRate` — the engine consumes the post-transformation effective rate from `EmployerConfig.okSutaRate`.
24. **Pending rule change — federal credit reduction interaction.** Oklahoma's UI trust fund balance affects whether OK appears on the DOL Title XII credit-reduction list (which feeds FUTA via `EmployerConfig.futaCreditReductionPercent`). As of 2026-05-02, Oklahoma is **not** a credit-reduction state. Compliance-watcher tracks via the FUTA spec; no direct impact on this OK SUI spec.
25. **Sub-cent results due to rounding.** Per the per-period rounding rule, each period's accrual rounds to a cent. The Form OES-3 quarterly reconciliation may differ from the sum of period accruals by a few cents per employee per quarter due to rounding; OESC accepts this within its rounding tolerance per OAC 240:10-3-15.
26. **OESC citation gap — bracket-bound effective dates.** OESC's Contribution Rates web page does not display an explicit "for tax year 2026" header in its body text but does reference a 2026 rate chart. The values used in this spec ($25,000 wage base, 1.5% new-employer rate, 0.2%–5.8% range) were retrieved via WebFetch on 2026-05-02 and are presumed to be the 2026 figures. **Compliance-watcher action item:** verify against the dated 2026 OESC rate chart PDF (which was not text-extractable at WebFetch time) and against any OESC employer handbook update.

## Worked examples

All examples assume `okSutaRate` = 0.015 (new-employer 2026 rate) unless stated. Decimal arithmetic with HALF_EVEN rounding to 2 decimals.

### Example A — Early-year sub-wage-base employee (new employer rate)

**Inputs:**
- `okSutaWagesThisPeriod` = $1,500.00
- `okSutaWagesYTDPriorToThisPeriod` = $0.00
- `okSutaRate` = 0.015

**Computation:**
- Step 2: `okSutaRemainingBase` = max(25,000.00 − 0.00, 0) = 25,000.00
- Step 2: `okSutaTaxableThisPeriod` = min(1,500.00, 25,000.00) = 1,500.00
- Step 3: `okSutaTax_employer` = round(1,500.00 × 0.015, 2) = round(22.50, 2) = **$22.50**

**CalcResult:** `employerSide.stateEmployerPrograms.okSuta` = **$22.50**

### Example B — Period crosses the $25,000 wage base

**Inputs:**
- `okSutaWagesThisPeriod` = $4,000.00
- `okSutaWagesYTDPriorToThisPeriod` = $23,500.00
- `okSutaRate` = 0.015

**Computation:**
- Step 2: `okSutaRemainingBase` = max(25,000.00 − 23,500.00, 0) = 1,500.00
- Step 2: `okSutaTaxableThisPeriod` = min(4,000.00, 1,500.00) = 1,500.00
- Step 3: `okSutaTax_employer` = round(1,500.00 × 0.015, 2) = round(22.50, 2) = **$22.50**

**CalcResult:** `employerSide.stateEmployerPrograms.okSuta` = **$22.50**. Subsequent periods this year for this employee on this OESC account: $0.00.

### Example C — Period after employee already over $25,000 YTD (zero accrual)

**Inputs:**
- `okSutaWagesThisPeriod` = $3,200.00
- `okSutaWagesYTDPriorToThisPeriod` = $28,000.00
- `okSutaRate` = 0.015

**Computation:**
- Step 2: `okSutaRemainingBase` = max(25,000.00 − 28,000.00, 0) = 0
- Step 2: `okSutaTaxableThisPeriod` = min(3,200.00, 0) = 0
- Step 3: `okSutaTax_employer` = round(0 × 0.015, 2) = **$0.00**

**CalcResult:** `employerSide.stateEmployerPrograms.okSuta` = **$0.00**

### Example D — Experience-rated employer at minimum rate (0.2%)

**Inputs:**
- `okSutaWagesThisPeriod` = $5,000.00
- `okSutaWagesYTDPriorToThisPeriod` = $0.00
- `okSutaRate` = 0.002 (employer with strong claims history at minimum experience rate)

**Computation:**
- Step 2: `okSutaRemainingBase` = 25,000.00
- Step 2: `okSutaTaxableThisPeriod` = min(5,000.00, 25,000.00) = 5,000.00
- Step 3: `okSutaTax_employer` = round(5,000.00 × 0.002, 2) = round(10.00, 2) = **$10.00**

**CalcResult:** `employerSide.stateEmployerPrograms.okSuta` = **$10.00**

### Example E — Experience-rated employer at maximum rate (5.8%)

**Inputs:**
- `okSutaWagesThisPeriod` = $2,000.00
- `okSutaWagesYTDPriorToThisPeriod` = $0.00
- `okSutaRate` = 0.058 (employer with extensive claims history at maximum rate)

**Computation:**
- Step 2: `okSutaRemainingBase` = 25,000.00
- Step 2: `okSutaTaxableThisPeriod` = min(2,000.00, 25,000.00) = 2,000.00
- Step 3: `okSutaTax_employer` = round(2,000.00 × 0.058, 2) = round(116.00, 2) = **$116.00**

**CalcResult:** `employerSide.stateEmployerPrograms.okSuta` = **$116.00**

### Example F — New hire mid-year, lump-sum first paycheck above wage base

**Inputs:**
- `okSutaWagesThisPeriod` = $30,000.00 (signing bonus + first month of wages, all paid in one period)
- `okSutaWagesYTDPriorToThisPeriod` = $0.00
- `okSutaRate` = 0.015

**Computation:**
- Step 2: `okSutaRemainingBase` = max(25,000.00 − 0.00, 0) = 25,000.00
- Step 2: `okSutaTaxableThisPeriod` = min(30,000.00, 25,000.00) = 25,000.00 (entire $25,000 cap consumed in one period)
- Step 3: `okSutaTax_employer` = round(25,000.00 × 0.015, 2) = round(375.00, 2) = **$375.00**

**CalcResult:** `employerSide.stateEmployerPrograms.okSuta` = **$375.00**. All subsequent periods this year for this employee on this OESC account: $0.00.

### Example G — Wage-base crossing with experience-rated rate (precision check)

**Inputs:**
- `okSutaWagesThisPeriod` = $3,333.33
- `okSutaWagesYTDPriorToThisPeriod` = $24,166.67
- `okSutaRate` = 0.0273

**Computation:**
- Step 2: `okSutaRemainingBase` = max(25,000.00 − 24,166.67, 0) = 833.33
- Step 2: `okSutaTaxableThisPeriod` = min(3,333.33, 833.33) = 833.33
- Step 3: 833.33 × 0.0273 = 22.7499090 (exact unrounded product to 7 decimals)
  - 22.7499090 lies between 22.74 and 22.75; the midpoint is 22.745.
  - 22.7499090 > 22.745, so it rounds up to 22.75 under both HALF_EVEN and HALF_UP. (HALF_EVEN's tie-breaking rule activates only when the dropped portion is exactly 0.5 cent; here the dropped portion is 0.99090, well above 0.5.)
  - `okSutaTax_employer` = **$22.75**

**CalcResult:** `employerSide.stateEmployerPrograms.okSuta` = **$22.75**

### Example H — Zero wages period

**Inputs:**
- `okSutaWagesThisPeriod` = $0.00 (employee on unpaid leave for the period)
- `okSutaWagesYTDPriorToThisPeriod` = $12,000.00
- `okSutaRate` = 0.015

**Computation:**
- Step 2: `okSutaRemainingBase` = max(25,000.00 − 12,000.00, 0) = 13,000.00
- Step 2: `okSutaTaxableThisPeriod` = min(0.00, 13,000.00) = 0.00
- Step 3: `okSutaTax_employer` = round(0 × 0.015, 2) = **$0.00**

**CalcResult:** `employerSide.stateEmployerPrograms.okSuta` = **$0.00** (trace event records $0.00 for audit completeness).

### Example I — HALF_EVEN tie-breaking exercise

**Inputs:**
- `okSutaWagesThisPeriod` = $1,000.00
- `okSutaWagesYTDPriorToThisPeriod` = $0.00
- `okSutaRate` = 0.0265

**Computation:**
- Step 2: `okSutaRemainingBase` = 25,000.00
- Step 2: `okSutaTaxableThisPeriod` = min(1,000.00, 25,000.00) = 1,000.00
- Step 3: 1,000.00 × 0.0265 = 26.5000000 (exact)
  - 26.5000000 is the exact midpoint between 26.50 and... wait, 26.50 is already 2 decimals — no rounding needed.
  - `okSutaTax_employer` = round(26.50, 2) = **$26.50**

**CalcResult:** `employerSide.stateEmployerPrograms.okSuta` = **$26.50**

### Example J — HALF_EVEN tie-breaking with sub-cent midpoint

**Inputs:**
- `okSutaWagesThisPeriod` = $100.10
- `okSutaWagesYTDPriorToThisPeriod` = $0.00
- `okSutaRate` = 0.025

**Computation:**
- Step 2: `okSutaRemainingBase` = 25,000.00
- Step 2: `okSutaTaxableThisPeriod` = min(100.10, 25,000.00) = 100.10
- Step 3: 100.10 × 0.025 = 2.5025000 (exact)
  - 2.5025 lies between 2.50 and 2.51; the midpoint is 2.505.
  - 2.5025 < 2.505, so it rounds down to 2.50 under both HALF_EVEN and HALF_UP.
  - `okSutaTax_employer` = **$2.50**

**CalcResult:** `employerSide.stateEmployerPrograms.okSuta` = **$2.50**

(Examples I and J document the engine's rounding semantics for `payroll-test-author`'s vector library; both edge into the rounding boundary deliberately. A true HALF_EVEN tie occurs only when the dropped portion is exactly 0.005 — e.g., wages × rate = $X.XX5000…0 with no further non-zero digit. Such cases are vanishingly rare in real payroll inputs but must round to the **nearest even cent** per the engine's canonical rule.)

## Out of scope

- **Form OES-3 (Employer's Quarterly Contribution Report) generation.** Pointer: filing-export spec under `docs/payroll-semantics/ok-suta-quarterly-filing.md` (to be authored before v1 ships if data-export-to-MasterTax is the v1 path).
- **OESC rate notice ingestion.** Pointer: integration spec under `docs/connectors/oesc-rate-notice-ingest.md` (future); for v1 the rate is processor-entered into `EmployerConfig`.
- **Voluntary contribution decision support.** Pointer: future product feature outside the calc spec — a tool to help the processor decide whether a voluntary contribution by March 31 will reduce the next year's rate enough to justify the contribution. Spec to be authored if/when productized.
- **Successor employer wage-base inheritance** (40 O.S. §3-111). Pointer: future spec `docs/payroll-semantics/ok-suta-successor-employer.md`.
- **§501(c)(3) reimbursing-employer election.** Pointer: future spec when first such customer onboards.
- **Government / tribal employer handling.** Pointer: future spec.
- **Agricultural / domestic / family-member exempt wages.** Pointer: future specs as customers require them.
- **OESC delinquency surcharge (40 O.S. §3-110.1).** Pointer: future spec `docs/payroll-semantics/ok-suta-delinquency-surcharge.md`.
- **Multi-state SUI allocation** (employee working in multiple states with OK as one). Pointer: separate spec `docs/payroll-semantics/multi-state-suta-allocation.md`.
- **Workers' compensation insurance accrual.** Pointer: separate spec `docs/payroll-semantics/workers-compensation-accrual.md` — engine computes accrual, OK customers remit to private carriers (OK is not a monopolistic-fund state).
- **Form W-2 / W-3 box population.** Pointer: year-end W-2 generation spec.
