# PII Taxonomy

The canonical list of what Paygon will and won't persist. Companion to [ADR 0001](./adr/0001-no-pii-at-rest.md). Every schema change, log line, and integration design is reviewed against this document.

If you're proposing to persist something not on either list, default to **prohibited** and escalate to `zero-pii-architect`.

## Prohibited at rest in Paygon infrastructure

These values may exist in memory during an active processor session and in the encrypted, short-TTL Redis session store. They MUST NOT appear in Postgres, in logs, in error messages, in stack traces, in metrics, or in any persistent file.

### Identity
- Social Security Number (SSN)
- Individual Taxpayer Identification Number (ITIN)
- Driver's license / state ID number
- Passport / visa numbers
- Date of birth
- Full legal name (employee, dependent, beneficiary, garnishment subject)

### Contact / location
- Home street address
- Home phone number
- Personal email
- Emergency contact details

### Financial / banking
- Bank routing numbers (except encrypted under client-held KMS key — see below)
- Bank account numbers (same)
- Pay card numbers
- Direct-deposit allocation amounts attributed to specific accounts

### Compensation values
- Gross wage values (per employee, per period, or YTD)
- Net pay values (per employee, per period, or YTD)
- Tax withholding amounts (per employee)
- Pre-tax / post-tax deduction amounts (per employee)
- Bonus, commission, retro pay amounts (per employee)
- Overtime hours / amounts (per employee)
- Hourly rates, salary amounts (per employee)

### Court orders / garnishments
- Garnishment case numbers
- Court order document content
- Child-support obligor or recipient identifiers
- Tax levy notices content
- Disposable earnings calculations attributed to a specific employee

### Benefits / health
- Health plan coverage details (per employee)
- 401(k) deferral elections / amounts (per employee)
- HSA / FSA elections / amounts (per employee)
- Group-term life insurance face values (per employee)
- ACA 1095-C coverage codes (per employee, per month)
- Dependent / beneficiary identities

### Tax forms (form-level data)
- W-2 Box values per employee
- W-3 employer aggregates that imply employee detail when combined
- 1099-NEC payee details
- 1095-C employee detail rows

## Allowable persistence

These categories may live in Postgres (or other persistent stores) with normal application data protections.

### Tenant / processor org
- Processor org ID, legal name, billing address
- Processor user accounts: ID, work email, name, role, RBAC assignments, MFA enrollment status
- Subscription plan, billing data (handled under standard SaaS billing controls)

### Client metadata
- Client (employer) legal name
- Client EIN
- Client headquarters address
- Client industry classification
- Client pay schedule configurations (frequency, period dates, cutoff times)
- Client deduction-code mappings to GL accounts
- Client integration endpoint configurations (URL, auth type, sans actual credentials)
- Client state/local tax jurisdiction registrations (state ID, SUI account number, etc.)

### Opaque session handles
- Per-session UUID handles representing client and employee records. The mapping from handle to underlying identity exists only in the active session and is destroyed at session end.

### Audit events
- Actor ID (processor user)
- Action verb (created / updated / approved / submitted / voided / etc.)
- Target opaque handle
- Tenant ID
- Session ID
- Timestamp
- Schema version of the event
- `before_hash` and `after_hash` of the affected payload (SHA-256 with per-tenant salt)
- Hash chain link (previous event hash) for tamper evidence
- Event signature
- Replay metadata (which client source to re-fetch from to reconstruct values)

### Configuration / reference data
- Tax rule data tables (jurisdiction, effective date, rates, brackets — none of which is PII)
- Connector definitions and capability matrix
- System configuration

### Encrypted credential cache (special category)
- Connector credentials (API keys, OAuth refresh tokens) **encrypted at the field level using a KMS key held by the processor org's CMK in their AWS / GCP account.** Paygon stores the ciphertext but cannot decrypt without the customer's KMS authorization on each use.

## Logging rules

- Every service entrypoint MUST mount the PII-scrubbing log middleware before any user-facing handler runs.
- Log statements MAY include: opaque handles, action verbs, durations, error codes, schema versions, sanitized request shapes (key names only, not values).
- Log statements MAY NOT include: any value from the prohibited list above.
- Any log statement that includes a value variable MUST pass the variable through `redact()`.
- Tests in `test/security/log-leak.test.ts` enforce that known synthetic PII strings injected into the system never appear in log output.

## Error message rules

- User-facing error messages MAY reference opaque handles (e.g., "Employee record `0x4f2a` failed validation") but MUST NOT include the underlying identity.
- Stack traces leaving Paygon's infrastructure (sent to Sentry / observability) MUST be scrubbed by the same middleware that handles logs.

## Test fixture rules

- All test fixtures use synthetic data — generated, never derived from real records.
- The fixture generator lives at `test/fixtures/generator.ts` and uses a deterministic seed for reproducibility.
- Real PII MUST NEVER be checked into the repo, even sanitized, even in a `.gitignore`-excluded scratch folder.

## When in doubt

Default to **prohibited**. Open a question with `zero-pii-architect` and produce an ADR amendment if the answer is "actually allowable."
