# ADR 0002: References-Only Audit Trail

**Status:** Accepted
**Date:** 2026-05-01
**Depends on:** [ADR 0001 — No PII At Rest](./0001-no-pii-at-rest.md)
**Owner agent:** `audit-trail-engineer`

## Context

Payroll work demands a strong audit trail. Processors get audited by their clients, by the IRS, by state DORs, and by their own internal compliance teams. "Who changed Sarah's overtime hours from 2 to 22 on Friday at 4:47pm?" must be answerable, exactly, months or years later.

The conventional answer is to record the value before and after each change. Paygon cannot do that — [ADR 0001](./0001-no-pii-at-rest.md) prohibits persisting employee values.

This ADR specifies how to maintain an audit trail strong enough for SOC 2 CC7.2, IRS payroll-records retention, and customer trust — **without** persisting any underlying values.

## Decision

Paygon's audit trail is a **references-only event log** with the following properties:

1. **Each event records hashes, not values.**
2. **Events are hash-chained per tenant** for tamper evidence.
3. **The trail is paired with a replay protocol** that reconstructs the values by re-fetching from the client's source-of-truth system, validating them against the recorded hashes.

### Event schema

```
AuditEvent {
  event_id:           UUID                  // unique per event
  tenant_id:          UUID                  // processor org
  session_id:         UUID                  // session in which the action occurred
  actor:              UserHandle            // processor user who performed the action
  action_verb:        Enum                  // e.g. CREATE, UPDATE, APPROVE, SUBMIT, VOID
  target_handle:      OpaqueHandle          // session-scoped UUID for the affected record
  target_kind:        Enum                  // e.g. EMPLOYEE_HOURS, PAYROLL_RUN, DEDUCTION
  occurred_at:        Timestamp(UTC, micro)
  schema_version:     SemVer                // version of the event schema
  before_hash:        Sha256                // hash of pre-change payload (or NULL for CREATE)
  after_hash:         Sha256                // hash of post-change payload (or NULL for DELETE)
  payload_schema_id:  String                // identifies the canonical-form schema used for hashing
  source_ref:         SourceReference       // {connector_id, source_record_id, fetched_at}
  prev_event_hash:    Sha256                // hash of the previous event in this tenant's chain
  signature:          Ed25519               // signature over the event by the Paygon service key
}
```

### Hashing rules

- All hashes are **SHA-256 with a per-tenant salt**. The salt is held in Paygon's HSM/KMS, never exported.
- Payloads are hashed in **canonical form**: keys sorted lexicographically, numbers normalized, whitespace stripped, encoding UTF-8. The `payload_schema_id` field identifies which canonicalization rules apply.
- The salt-per-tenant prevents cross-tenant correlation of "same value" events.

### Hash chain

- Each tenant has an independent event chain.
- `prev_event_hash` links each event to the prior event for that tenant, in occurrence order.
- The chain head is anchored to a Merkle root that is computed nightly per tenant and stored in a separate, write-once log (later: timestamped via a public timestamping service for external verifiability).
- Tampering with any historical event invalidates every subsequent `prev_event_hash` and the nightly Merkle root.

### Source reference

- `source_ref` records *where* to fetch the underlying value to reconstruct what the processor saw.
- It captures: `connector_id` (which integration), `source_record_id` (the ID in the source system, which may itself be PII — see "Source ref handling" below), and `fetched_at` (the source system's timestamp at fetch).
- For data the processor entered manually in-session (no source system), `source_ref` records the session ID and the input field path; the value lives in encrypted Redis until session end.

#### Source ref handling

The `source_record_id` from a client's source system is sometimes itself sensitive (e.g., the client's HRIS may use SSN as a key). To stay within ADR 0001:

- `source_record_id` is stored as a **second-layer hash**: HMAC-SHA-256 keyed by the per-tenant salt.
- When the processor re-runs the replay protocol, the connector adapter accepts the hash and the source system's record set, and finds the matching record by recomputing hashes — never by exposing the original ID through Paygon.

## Replay protocol

To reconstruct what an event saw:

1. Processor (or auditor with delegated access) initiates a replay for `event_id`.
2. Paygon presents the event metadata: `tenant_id`, `actor`, `action_verb`, `target_kind`, `occurred_at`, `source_ref` (hashed form), `before_hash`, `after_hash`, `payload_schema_id`.
3. The processor's session re-establishes a connection to the original `connector_id` and pulls the source records.
4. Each candidate source record is canonicalized and hashed using the same `payload_schema_id` and per-tenant salt.
5. The records that match `before_hash` and `after_hash` are surfaced to the processor.
6. The processor sees the reconstructed values **in their browser, never persisted**.

If the source system has changed since the event (the source record was edited or deleted), replay surfaces the discrepancy: "the source no longer matches `before_hash`." This is a feature, not a bug — it tells the auditor that the source has drifted.

## Consequences

### Positive

- Satisfies SOC 2 CC7.2 (security event logging) without holding the data the events describe.
- Tamper-evident: the hash chain plus nightly Merkle anchoring resists silent modification.
- No new PII surface: the audit trail itself is metadata + hashes.
- Survives departing employees / rotated source systems via the canonicalization spec — same canonical form yields same hash even if the source system reformats data.

### Negative / Tradeoffs

- Replay requires a live connection to the original source system. If a customer rotates connectors or shuts down a system, historical replay degrades to "the hashes are valid but we can't reconstruct values."
- Initial implementation is non-trivial — canonicalization rules, per-tenant salt management, hash-chain integrity verification, signature key rotation.
- Auditors unfamiliar with the model will ask "where's the value?" — we need a clear customer-facing explainer.
- Processors who manually enter values in-session lose replayability after the session's Redis TTL expires (8h). Documented and accepted; the audit event still records *that* the change happened, *when*, *by whom*, and the hash of *what*.

### What this rules out

- Naive "diff history" UIs that show old-value → new-value side-by-side from Paygon's own storage.
- Cross-tenant queries like "find all events that touched value X" — the per-tenant salt makes such queries impossible by design.

## Implementation milestones

1. **M1 — Event schema + writer.** Single-tenant hash chain, no Merkle anchoring, no replay UI. Hash and write events; verify chain on read.
2. **M2 — Per-tenant salt, KMS-backed.** Add salt management, signature keys, key rotation procedure.
3. **M3 — Replay protocol.** First connector adapter implements the canonicalize-and-match replay flow.
4. **M4 — Nightly Merkle anchoring.** Per-tenant Merkle root computed and stored to a separate append-only log.
5. **M5 — External timestamping.** Anchor Merkle roots to an external timestamping authority for third-party verifiability.
6. **M6 — Auditor view.** Read-only auditor role with delegated, time-boxed access to a customer's chain + replay UI.

## Enforcement

- The `audit-trail-engineer` agent ([.claude/agents/audit-trail-engineer.md](../../.claude/agents/audit-trail-engineer.md)) reviews every PR that touches `src/audit/` or that introduces new auditable actions.
- A CI check validates the event schema against the canonical-form spec for every commit that touches `payload_schema_id` definitions.
- Any audit event that *would* require raw values to be useful is treated as a design failure — the calling feature must be redesigned, not the audit trail.

## M2 implementation status

**Landed (2026-05-02):** per-tenant salt management.

- `src/audit/salt/key-vault.ts` defines the `KeyVault` interface (`getTenantSalt`, `provisionTenant`) and the `TenantNotProvisionedError` thrown when a caller tries to write before provisioning. Also exports `hashSourceRecordId(keyVault, tenantId, plaintext)` — the canonical helper for filling in `SourceRef.sourceRecordIdHash`.
- `src/audit/salt/in-memory-key-vault.ts` provides `createInMemoryKeyVault()`. Generates 32 bytes of `crypto.randomBytes` per tenant, stores them in a process-local `Map`, returns defensive copies. Idempotent on re-provision (re-generating would invalidate every prior event for the tenant, which would be catastrophic). Accepts an optional `saltFor` test seed for deterministic test fixtures; production code MUST NOT pass it.
- `writeAuditEvent(store, keyVault, input, options?)` now takes the `KeyVault` as a required argument, loads the per-tenant salt via `getTenantSalt`, and HMACs canonical payloads under that salt. The writer rejects events for unprovisioned tenants.
- The legacy `DEV_SALT` constant has been deleted; all references removed.
- The verifier still does NOT recompute payload hashes (only chain links + recordHash). Full payload-hash re-verification is part of replay (M3+).

**Test surface:** `test/integration/audit-trail-m2.test.ts` covers idempotent provisioning, missing-provisioning errors, two-tenant hash divergence on identical payloads, the `hashSourceRecordId` helper, and defensive-copy behavior. `test/property/cross-tenant-isolation.property.test.ts` exercises the cross-tenant-divergence and within-tenant-determinism invariants over random JSON payloads and random tenant pairs.

**Known limitations carried into M3:**

- The in-memory vault loses all salts on process restart. Production exposure requires a KMS-backed adapter implementing the same `KeyVault` interface — that is the first M3 deliverable.
- Ed25519 signing of events is still not implemented. Until M3 lands signing + key rotation, integrity rests on the hash chain alone (which is sufficient against a non-privileged tamperer but not against an attacker who can rewrite the entire chain).
- Replay (canonicalize + match against `before_hash` / `after_hash`) is not implemented. Hashes can be reproduced today only via internal tests.
- No Merkle anchoring yet. The chain head is not yet checkpointed off-system.

**What M2 explicitly closes:** the M1 cross-tenant correlation gap. As of M2, two tenants with identical payloads produce different hashes, and an attacker with read access to one tenant's chain cannot use it to identify "same value" events in any other tenant's chain.

## M3 implementation status

**Landed (2026-05-02), narrowed scope:** replay protocol against an in-memory mock connector. Postgres-backed `ChainStore` and AWS KMS-backed `KeyVault` adapter are deferred to follow-on milestones (M3.5, M3.6); the in-memory store and in-memory `KeyVault` from M2 are sufficient surface to prove out the canonicalize-and-match flow.

- `src/audit/replay/replay-event.ts` exports `replayEvent(args)` — the pure canonicalize-and-match primitive. Loads the event by id (throws `EventNotFoundError` on miss), filters caller-supplied candidates by re-hashing each candidate's `sourceRecordId` under the per-tenant salt and comparing to `event.sourceRef.sourceRecordIdHash`, then canonicalizes each surviving candidate's payload (`canonical-v1`), HMACs under the tenant salt, and records which candidates matched `beforeHash` / `afterHash`. Returns a `ReplayResult` with two fields: `matches` (per-candidate `{ candidateSourceRecordId, matched: 'before' | 'after' | 'both' }`) and `missing` (subset of `['before', 'after']` that the event had a hash for but no candidate matched).
- `src/audit/replay/connector.ts` defines the `ReplayConnector` interface — the contract `integration-builder` will fulfill for real connectors. A connector exposes `connectorId` and `fetchCandidates({ sourceRecordIdHash, fetchedAt })`. Connectors cannot invert the salted hash; they enumerate their records and return matches.
- `src/audit/replay/in-memory-connector.ts` implements an `InMemoryReplayConnector` for dev/test. It is wired to a single tenant + KeyVault at construction (a deliberate constraint — connectors are tenant-scoped in production). Test affordances `add` / `update` / `delete` let integration tests simulate source-side mutation between event-write time and replay time.
- `src/audit/replay/replay-with-connector.ts` is the orchestrator that combines connector + `replayEvent`. Looks the event up, asks the connector for candidates, delegates to the replay primitive.

**Hard invariants enforced by the replay primitive:**

- Replay does NOT return candidate payloads. The result names which `sourceRecordId` matched which side; the caller already has the payloads. (See the test `replay does NOT return candidate payloads` in `test/integration/audit-trail-m3-replay.test.ts` — it scans `JSON.stringify(result)` for embedded payload values to enforce the invariant.)
- Replay does NOT log payloads. Locals holding canonical forms / HMAC outputs are short-lived and not surfaced through any error path.
- Wrong tenant -> zero matches. A connector wired to tenant A cannot replay an event from tenant B because tenant A's salt produces different `sourceRecordIdHash` values. The result is unattributable: empty `matches`, full `missing`.
- Source drift / deletion is reportable, not exceptional. The chain remains valid; the result simply names which sides the source could no longer reproduce.
- Unknown event id is the ONLY exception (`EventNotFoundError`). The caller's reference is wrong; there is nothing to replay.

**Test surface:** `test/integration/audit-trail-m3-replay.test.ts` covers happy path (UPDATE + connector with after-state, CREATE + after match, DELETE + before match), source drift, source deletion, wrong-tenant connector, no-op event (`before === after` -> `'both'` match), unknown event id, frozen result invariant, and the no-payload-leak invariant. `test/property/replay-roundtrip.property.test.ts` exercises the canonicalize-and-match flow over arbitrary canonical-v1-safe payloads, plus the cross-tenant unattributability companion property.

**Carried forward into M3.5+:**

- Postgres-backed `ChainStore` (Drizzle) for durability.
- KMS-backed `KeyVault` adapter so per-tenant salts survive process restart.
- Ed25519 signing of audit records + key rotation procedure.
- Real connector implementations (`integration-builder`'s domain) using the M3 contract.
- Merkle anchoring (M4), external timestamping (M5), auditor view (M6).

**What M3 explicitly closes:** there is now a working canonicalize-and-match read path from the audit chain back to source records, gated by per-tenant salt equality. A processor can take an event id, hand the audit subsystem candidate records from the source system, and get back a structured confirmation of which candidate(s) match the event's recorded hashes — without Paygon ever holding the values past the replay HTTP request.

## Open questions deferred

- **Manual-entry replay beyond TTL.** Processors who enter values manually in-session lose replay capability after 8h. Whether to extend TTL for "approved-and-submitted" sessions, or require export-to-customer-storage for long-term replay, is a v1 product decision.
- **Cross-tenant auditor access.** The current model assumes one tenant per audit. Service bureaus' clients may want to audit across the bureau's whole chain; that's a future model, out of scope here.
- **Public-timestamping authority choice.** OpenTimestamps vs. a commercial timestamping service vs. custom transparency log. Defer to M5.
