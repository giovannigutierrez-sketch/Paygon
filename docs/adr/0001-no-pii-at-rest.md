# ADR 0001: No PII At Rest

**Status:** Accepted
**Date:** 2026-05-01
**Supersedes:** none
**Superseded by:** none

## Context

Paygon is a payroll processing tool built for payroll specialists at mid-size service bureaus (50–500 client payrolls each). The payroll-software market is dominated by data-resident SaaS platforms — Paycom, Paycor, Paylocity, ADP Workforce Now, Workday — that require client and employee data to live in the vendor's database. Service bureaus juggling many client systems carry the corresponding PII risk and lock-in cost.

Paygon's product wedge is to **invert that model**: clients own their data; Paygon brings the cockpit, the calculation engine, the workflow orchestration, and the integrations *to* the client's data without persisting the underlying employee/client records.

This is not a security feature added on top of an otherwise normal SaaS architecture. It is the architecture.

## Decision

**Paygon's persistent stores hold no client or employee PII at rest.**

Concretely:

- **Postgres** (the system of record for Paygon itself) may store:
  - Tenant / processor-org records (the bureau itself, its users, its RBAC).
  - Client *metadata* — legal name, EIN, pay schedule configs, deduction-code mappings, integration endpoint configs (sans credentials).
  - Opaque per-session client/employee handles (UUIDs scoped to a session).
  - Audit events — actor, action verb, target opaque handle, timestamps, payload hashes, schema versions, signatures. **Never the underlying values.**
  - Session metadata — session ID, processor user, tenant, lifecycle timestamps.

- **Redis** (session/working-set store) may temporarily hold the live working set of an in-flight payroll run: imported hours, draft earnings, draft deductions, gross-to-net previews. **Encrypted at rest, TTL ≤ 8 hours, auto-purged at session end.** This is the only place actual employee values live in Paygon infrastructure, and only transiently.

- **Client data sources** (the client's HRIS, time clock, bank, GL system, benefits carrier) are pulled from on demand at session start, processed in memory, pushed to destination, and forgotten when the session ends.

- **Encrypted credential cache** — for connectors that require persistent credentials (e.g., a stored API key for a recurring time-clock pull), credentials are encrypted with a KMS key held by the **processor's organization**, not Paygon. Paygon cannot decrypt without the customer's key.

**What we do NOT persist in Paygon's infrastructure:**

- SSN, ITIN
- Date of birth
- Full legal employee name
- Home address
- Bank routing / account numbers (except encrypted under client-held key — see above)
- Driver's license / state ID numbers
- Garnishment case numbers, court-order content
- Dependent or beneficiary information
- ACA / 1095-C medical coverage details
- Year-to-date wage / tax / deduction values

The full enumeration lives in [docs/PII_TAXONOMY.md](../PII_TAXONOMY.md).

## Consequences

### Positive

- **Reduced SOC 2 audit scope.** No data-at-rest encryption story for PII because we don't have the data. Customer DPAs become simpler.
- **No lock-in.** Customers can leave at any time without data extraction projects. This is a sales advantage against incumbents.
- **Smaller breach blast radius.** A Paygon database compromise yields metadata, hashes, and connector configs — not employee records.
- **Forces good architecture.** Every feature has to justify how it works with ephemeral data. This pushes us toward streaming pipelines and stateless calculations, which scale better.

### Negative / Tradeoffs

- **Audit trail is harder.** "Who changed what" cannot record the values themselves. We use payload hashes + replay against client source. See [ADR 0002](./0002-audit-trail-references-only.md).
- **Slower first-load per session.** Each session re-pulls from client sources. Mitigated by encrypted Redis caching during the session.
- **Reporting is constrained.** Cross-period analytics that would need persisted aggregates (e.g., "show me YTD overtime trends across all your clients") have to be either (a) computed from re-pulled source data, (b) computed from audit-event aggregates, or (c) explicitly out of scope.
- **Customer onboarding requires connector setup.** No "upload a CSV once and we'll remember everything" — every session is a fresh pull. We mitigate with strong connector UX.
- **In-product AI features require care.** Any LLM-backed assistance (deferred per the Foundation Plan) operates on session-scoped data passed in for the duration of a single processor action.

### What this rules out

- A "self-service employee portal" where employees log in to view their own pay history. Pay history lives in the client's source system, not ours.
- Persistent payroll history reports owned by Paygon. We can generate them from client source on demand; we cannot serve them from cache after the session closes.
- Caching employee records across sessions for "speed."
- Logging that includes employee names, SSNs, addresses, or wage values — not even at DEBUG. The PII-scrubbing log middleware is enforced by `zero-pii-architect`.

## Enforcement

- The `zero-pii-architect` agent ([.claude/agents/zero-pii-architect.md](../../.claude/agents/zero-pii-architect.md)) reviews every schema change, log line, persistence-layer addition, and integration design against this ADR.
- Schema migrations are gated by a CI check that flags any new column matching the prohibited patterns from `PII_TAXONOMY.md`.
- The PII-scrubbing log middleware is required in every service entrypoint. Tests enforce that known PII values do not appear in log output.

## Open questions deferred

- **EIN classification.** EIN is treated as allowable persistence here because the product cannot function without it (it identifies which client a payroll belongs to and is required for filing). Stricter interpretation would force per-session EIN handles, which is doable but adds friction. Revisit if customer demand emerges.
- **Client legal name.** Same status as EIN — allowable, revisit if demand.
- **Processor billing data.** Out of scope of this ADR; covered under standard SaaS billing data handling, not payroll PII.
