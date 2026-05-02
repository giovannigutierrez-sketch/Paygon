# Paygon

Paygon is a payroll processing tool built **for payroll processors** — the specialists at mid-size service bureaus, PEOs, and accounting firms who run payroll for many client companies.

The product wedge is inverting the data-residency model of incumbents (Paycom, Paycor, Paylocity, ADP, Workday): **clients own their data; Paygon brings the cockpit, calculation engine, workflow, and integrations to the client's data**, persisting nothing prohibited.

## Read these first

Before doing any non-trivial work, read:

1. [docs/adr/0001-no-pii-at-rest.md](docs/adr/0001-no-pii-at-rest.md) — the foundational architecture decision.
2. [docs/PII_TAXONOMY.md](docs/PII_TAXONOMY.md) — what we will and won't persist.
3. [docs/adr/0002-audit-trail-references-only.md](docs/adr/0002-audit-trail-references-only.md) — the audit trail design.

These three documents constrain every other decision. They override defaults from your training.

## Specialist agents

Eight specialist agents live in `.claude/agents/`. Use them rather than improvising.

| Agent | When to invoke |
|---|---|
| [zero-pii-architect](.claude/agents/zero-pii-architect.md) | **Before** any schema, log, integration, or audit change. Review-only; produces ADRs. |
| [payroll-domain-expert](.claude/agents/payroll-domain-expert.md) | Anything touching gross-to-net math, deductions, fringe benefits, garnishments, year-end forms. Produces specs with worked examples. |
| [tax-rules-engineer](.claude/agents/tax-rules-engineer.md) | Implementing the tax engine. Owns `src/tax-engine/` and the rules-as-data tables. |
| [audit-trail-engineer](.claude/agents/audit-trail-engineer.md) | Any auditable action, event schema, hash chain or replay work. Owns `src/audit/`. |
| [compliance-watcher](.claude/agents/compliance-watcher.md) | Quarterly, plus any time a regulation changes. Maintains `CHANGELOG_REGULATORY.md`. |
| [multi-client-ux](.claude/agents/multi-client-ux.md) | Any UI work — screens, shortcuts, lists, batch ops. Owns the cockpit. |
| [integration-builder](.claude/agents/integration-builder.md) | Any inbound/outbound connector, file-format work, credential handling. Owns `src/connectors/`. |
| [payroll-test-author](.claude/agents/payroll-test-author.md) | After any tax/payroll feature lands. Owns `test/tax-vectors/` and `test/property/`. |

## Hard rules (the principle layer)

Every agent enforces these. Internalize them:

1. **No PII at rest in Paygon's persistent stores.** Postgres holds tenant + client *metadata*, opaque session handles, audit hashes. Redis holds working-set data, encrypted, ≤8h TTL. Client source systems own the actual values.
2. **Audit trail records hashes, not values.** Replay reconstructs by re-fetching from the client's source. See ADR 0002.
3. **Tax engine is rules-as-data.** No `if (state === 'CA')` branches. Rules live in versioned JSON under `src/tax-engine/rules/`. Effective-date-aware. Reproducible forever.
4. **Tax engine is two-sided.** Every calculation produces both employee-side amounts (income tax withholding, FICA employee, state withholding, employee SDI/PFL, deductions, garnishments) and employer-side amounts (FICA employer match, FUTA, SUTA, state employer programs like CA ETT / NY MCTMT / state PFML employer portions, local employer taxes, workers' comp accrual). The `totals.employer_total_burdened_cost` is the headline number processors will care about. A calculation that returns only one side is incomplete.
5. **No prohibited field in logs. Ever.** Not at DEBUG, not in stack traces, not in metric labels. The PII-scrubbing log middleware enforces this; tests verify.
6. **Synthetic test fixtures only.** Real PII never enters the repo.
7. **Connector credentials encrypted under the customer's KMS.** Paygon cannot decrypt without per-use customer authorization.
8. **Decimal arithmetic for money.** Never IEEE-754 floats. Use `decimal.js` or equivalent with explicit precision and rounding rules.

## Tech stack

- **Runtime:** Node.js 22 LTS + TypeScript 5.6, strict mode.
- **Backend:** Fastify (schema-first, fast, good TS ergonomics).
- **Frontend:** Next.js 15 App Router + React 19 + TanStack Table. Tailwind + shadcn/ui.
- **Database:** Postgres 16 (Supabase or Neon managed). Drizzle ORM.
- **Session store:** Redis (Upstash).
- **Background jobs:** BullMQ on Redis.
- **Auth:** WorkOS (SSO/SAML day-one — service bureaus require it).
- **Hosting:** Vercel (frontend) + Fly.io or Railway (backend).
- **Observability:** OpenTelemetry → Honeycomb. PII-scrubbing log middleware required at every entrypoint.

Production runs on Linux containers; Windows is a developer environment only.

## Repo layout (target)

```
.
├── .claude/agents/         # specialist agent definitions
├── docs/
│   ├── adr/                # architecture decision records
│   ├── payroll-semantics/  # specs from payroll-domain-expert
│   ├── tax-rules/          # human-readable rule narratives
│   ├── ux/screens/         # screen specs from multi-client-ux
│   ├── regulatory-digests/ # quarterly digests from compliance-watcher
│   └── PII_TAXONOMY.md
├── src/
│   ├── tax-engine/         # roll-your-own engine; rules-as-data
│   ├── audit/              # references-only audit trail
│   ├── connectors/         # inbound/outbound integrations
│   ├── ui/                 # cockpit components
│   └── app/                # Next.js routes
├── test/
│   ├── tax-vectors/        # canonical test cases
│   ├── property/           # fast-check property tests
│   ├── integration/        # connector tests
│   ├── fixtures/           # synthetic data generator
│   └── security/           # log-leak tests, PII assertions
├── CHANGELOG_REGULATORY.md
├── CHANGELOG_TAX.md
├── CLAUDE.md
└── package.json
```

## Phased delivery (from the Foundation Plan)

- **MVP (months 1–4):** auth + tenant isolation + RBAC + audit trail v1 + Friday cockpit + exception triage + one inbound connector + CSV upload. **No tax calculation yet.** First customer pilots in Oklahoma.
- **v1 (months 5–12):** federal tax engine + **OK (launch state, first)** + CA, NY, IL + garnishments + compliance limit checks + 3 more integrations + approval routing + filing-data export to MasterTax.
- **v2 (months 13–24):** 10+ more states (TX, FL, PA, OH, GA, NC, NJ, MA, VA, WA, AZ, CO) + year-end reconciliation + W-2/1099/1095 generation (data only, not direct filing) + multi-state nexus detector + public API.
- **v3+:** direct filing, evaluated against demand.

**Why Oklahoma first:** the company is Oklahoma-based and the founder will sign initial customers there. The first paying customers are Oklahoma service bureaus — OK rule data, OK test vectors, and OK-aware compliance monitoring all land before any other state's work.

## Working style for this codebase

- **Spec before code on calculations.** A tax/payroll feature without a `docs/payroll-semantics/` spec is not ready to implement. Engage `payroll-domain-expert` first.
- **Review before merge on schemas.** Any persistence change goes through `zero-pii-architect`. No exceptions.
- **Tests before release on calculations.** `payroll-test-author` adds vectors for every new calculation before it ships.
- **Connectors are streaming, not batched.** No `imported_records` table. Re-pull on session start.
- **Use side panels, not modals, on the critical path.**
- **Every action has a keyboard shortcut.**

## Out of scope (for clarity)

- In-product AI agents — deferred. The Foundation Plan covers the build-time agent set only.
- Direct tax filing — v3+ at earliest.
- Self-service employee portals — never (would require persistent employee data).
- Persistent cross-period reporting from Paygon's storage — no (re-fetch from source on demand).

## Foundation plan reference

The full Foundation Plan that produced this repo's architecture lives at `C:\Users\User\.claude\plans\i-would-like-to-groovy-mitten.md`. When in doubt about scope or sequencing, refer back.
