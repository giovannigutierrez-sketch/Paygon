# Tax vectors

Canonical input/expected-output cases for Paygon's tax engine. Each `.json`
file under this directory describes a single tax calculation and the values
the engine must produce. The runner walks the tree, registers one vitest
`it()` per file, and asserts every numeric `expected.*` field via
`Decimal.equals` (no IEEE-754 float comparisons, ever).

## Format

Every vector follows this exact JSON shape:

```json
{
  "id": "fit-spec-example-a-single-weekly",
  "description": "Plain-English summary that becomes the test name",
  "source": "Pointer to the spec / publication / regression issue",
  "rule_set_version": "federal-2026-q1",
  "effective_date": "2026-01-15",
  "employer_config_snapshot": {
    "futa_credit_reduction_percent": "0.000"
  },
  "input": {
    "pay_frequency": "WEEKLY",
    "gross_wages_this_period": "1500.00",
    "pretax_deductions_this_period": "0.00",
    "ytd_wages_before_period": "0.00",
    "ytd_futa_wages_before_period": "0.00",
    "w4": {
      "filing_status": "SINGLE_OR_MFS",
      "step2_checkbox": false,
      "step3_dependents_credit": "0.00",
      "step4a_other_income": "0.00",
      "step4b_deductions": "0.00",
      "step4c_extra_withholding": "0.00"
    }
  },
  "expected": {
    "employee_side": {
      "federal_income_tax": "196.58",
      "fica_social_security": "93.00",
      "fica_medicare": "21.75",
      "fica_additional_medicare": "0.00"
    },
    "employer_side": {
      "fica_social_security_match": "93.00",
      "fica_medicare_match": "21.75",
      "futa": "9.00"
    },
    "trace_steps": [
      "annualize: 1500 * 52 = 78000",
      "...narrative..."
    ]
  }
}
```

### Field rules

- **All money is a string.** JSON has no `Decimal`; IEEE-754 round-trips silently
  corrupt cents at scale (`0.062` becomes `0.06199999999999...`). The runner
  parses each string with `new Decimal(...)` and compares with `Decimal.equals`.
- **`id` must be unique** across the whole corpus. The runner uses it in the
  vitest test name; vitest's reporter then names each failure with the vector
  id, so a regression points instantly to the file.
- **`id` should be stable** across rewrites. Renaming churns CI history.
- **`filing_status`** is one of `SINGLE_OR_MFS`, `MARRIED_FILING_JOINTLY`,
  `HEAD_OF_HOUSEHOLD`. (Aligned with `calculate.ts` `FilingStatus`.)
- **`pay_frequency`** is one of `WEEKLY | BIWEEKLY | SEMIMONTHLY | MONTHLY |
  QUARTERLY | SEMIANNUAL | ANNUAL | DAILY`.
- **Both `employee_side` and `employer_side` MUST be present** (CLAUDE.md hard
  rule #4). A vector that only checks one side is incomplete.
- **`trace_steps` is INFORMATIONAL, not asserted.** The engine's actual trace
  step strings will not match a spec's narrative wording byte-for-byte. Asserting
  exact step text would create test churn every time the engine refactored
  internal step names. The trace is still recorded in every vector for
  documentation and audit, and its hash-equivalence across re-runs is exercised
  by the property test under `test/property/federal-engine-invariants.property.test.ts`
  (reproducibility invariant).

## Layout

```
federal/
  ├── employee-side/     # FIT vectors — federal income tax withholding
  └── employer-side/     # FICA + FUTA vectors — employer match + employer-only FUTA
ok/                      # Oklahoma — launch state, lands first
ca/, ny/, il/            # post-launch states
multi-state/             # reciprocity, allocation, nexus
workers-comp/            # class-code × payroll × ex-mod
garnishments/            # CCPA stacking, child support priority
```

The federal split between `employee-side/` and `employer-side/` is by primary
signal, not by exclusivity — every vector asserts both sides regardless of
which folder it lives in. We file by which math the vector is uniquely
exercising. FICA wage-base crossings, for example, live under `employer-side/`
because the matching machinery is what's distinctive — the employee math is
straightforward.

## How to add a new vector

1. **Identify a worked example** in:
   - IRS Pub 15-T (FIT)
   - IRS Pub 15 §9 (FICA), §14 (FUTA)
   - State DOR worked examples (state withholding, SUTA)
   - The corresponding spec under `docs/payroll-semantics/`
   - A regression bug — every fix gets a vector before the patch lands
   - An adversarial case (see `payroll-test-author.md` for the canonical list)
2. **Pick a stable `id`.** Convention so far: `<calc>-<source>-example-<n>-<short-tag>`.
3. **Lift the inputs verbatim.** Don't paraphrase wages or YTDs — match the
   source exactly, or you've lifted a different vector.
4. **Compute expected values by hand** or from the source — never by running
   the engine and copying the output. The point of the vector is to prove the
   engine matches an external authority, not to memorize what the engine does.
5. **Fill `trace_steps`** with the spec's narrative or your own
   step-by-step. Informational; helps the next person diagnose a failure.
6. **Run the runner.** It walks the tree on every test invocation; new files
   are picked up automatically. No manifest to update.

## Why traces aren't asserted

The trace serves three purposes:

1. **Audit reconstruction** — `audit-trail-engineer` hashes the trace as part
   of the audit chain. The hash is asserted (in audit chain tests), not the
   raw step strings.
2. **Reproducibility** — re-running the same input produces an identical trace
   byte-for-byte. Asserted in the property test, not vector-by-vector.
3. **Human debugging** — a developer reading a failure reads the trace to
   understand what the engine thought it was doing.

Asserting individual step strings in vectors would couple every test to the
engine's internal phrasing, which churns whenever the engine refactors. The
numeric outputs are what regulators and employees care about; those are what
we assert.

## Hard rules (carry-overs from CLAUDE.md and `payroll-test-author.md`)

1. **Synthetic data only.** No real names, no real SSNs, no real wage
   numbers from real people. Public IRS / state-DOR examples are reference
   material; that's fine. Anything else is a violation of CLAUDE.md hard
   rule #6.
2. **Decimal arithmetic everywhere.** Never `===` on money; always
   `Decimal.equals`.
3. **Both sides always.** A vector with only `employee_side` populated, or
   missing keys, is rejected by the runner.
4. **One vector, one `it()`.** Failures name the vector id directly — this is
   how a CI red turns into a one-click navigation to the offending JSON.

## Source pointers

- `docs/payroll-semantics/federal-income-tax-withholding.md` — 4 worked
  examples, lifted to `federal/employee-side/fit-spec-example-{a,b,c,d}-*.json`
- `docs/payroll-semantics/fica-social-security-and-medicare.md` — 4 worked
  examples, lifted to `federal/employer-side/fica-spec-example-{a,b,c,d}-*.json`
- `docs/payroll-semantics/futa.md` — 6 worked examples (A through F), lifted to
  `federal/employer-side/futa-spec-example-{a,b,c,d,e,f}-*.json`. Example F
  ("lost full credit due to untimely SUTA") is modeled via
  `futa_credit_reduction_percent = 0.054` because the v1 engine contract does
  not expose a separate `stateUiPaidTimely` knob; the math is identical.
