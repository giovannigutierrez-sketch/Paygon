// Property test: replay round-trips for arbitrary canonical-v1 payloads.
//
// Invariant: for any canonical-v1-safe payload P and any connector that
// holds a record { sourceRecordId, payload: P } under the same per-tenant
// salt, an event written with beforePayload=null and afterPayload=P MUST
// replay cleanly — exactly one match against the 'after' side, no missing
// sides.
//
// This exercises the canonicalize-and-match flow end-to-end: payload is
// canonicalized (canonical-v1, sorted keys, JSON-escaped strings, finite
// numbers normalized), HMAC'd under the per-tenant salt, and compared to
// the event's afterHash. If the canonical form is deterministic and the
// salt is stable, the hash MUST agree.
//
// We deliberately use random tenant ids and random connectors per run to
// avoid accidental success from cached state.

import { describe, it } from 'vitest';
import fc from 'fast-check';

import type {
  AuditEventInput,
  OpaqueHandle,
  PayloadSchemaId,
  SessionId,
  TenantId,
  UserHandle,
} from '../../src/audit/events/types.js';
import { PAYLOAD_SCHEMA_ID_V1 } from '../../src/audit/canonical/canonical-v1.js';
import { createInMemoryChainStore } from '../../src/audit/chain/memory-store.js';
import { writeAuditEvent } from '../../src/audit/chain/writer.js';
import { hashSourceRecordId } from '../../src/audit/salt/key-vault.js';
import { createInMemoryKeyVault } from '../../src/audit/salt/in-memory-key-vault.js';
import { createInMemoryReplayConnector } from '../../src/audit/replay/in-memory-connector.js';
import { replayWithConnector } from '../../src/audit/replay/replay-with-connector.js';

const SESSION = 'sess-prop' as SessionId;
const ACTOR = 'user-prop' as UserHandle;

// Build a payload that canonical-v1 will accept: object with string keys
// and finite-number / string / boolean / null leaves. Same shape as
// cross-tenant-isolation.property.test.ts so we exercise the same surface.
const safeLeaf = fc.oneof(
  fc.boolean(),
  fc.constant(null),
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.double({ min: -1e9, max: 1e9, noNaN: true, noDefaultInfinity: true }),
  fc.string({ minLength: 0, maxLength: 32 }),
);
const safePayload = fc.dictionary(fc.string({ minLength: 1, maxLength: 16 }), safeLeaf, {
  minKeys: 0,
  maxKeys: 6,
});

describe('replay round-trip properties', () => {
  it('CREATE event with payload P replays to a single after-match when connector has P', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 32 }),
        safePayload,
        async (tenantStr, sourceRecordId, payload) => {
          const tenantId = tenantStr as TenantId;

          const vault = createInMemoryKeyVault();
          await vault.provisionTenant(tenantId);

          const store = createInMemoryChainStore();

          const input: AuditEventInput = {
            tenantId,
            sessionId: SESSION,
            actor: ACTOR,
            actionVerb: 'CREATE',
            targetKind: 'EMPLOYEE_HOURS',
            targetHandle: 'h-1' as OpaqueHandle,
            payloadSchemaId: PAYLOAD_SCHEMA_ID_V1 as PayloadSchemaId,
            beforePayload: null,
            afterPayload: payload,
            sourceRef: {
              connectorId: 'in-memory-test-connector',
              sourceRecordIdHash: await hashSourceRecordId(
                vault,
                tenantId,
                sourceRecordId,
              ),
              fetchedAt: '2026-05-01T12:00:00.000Z',
            },
          };

          const event = await writeAuditEvent(store, vault, input);

          const connector = createInMemoryReplayConnector(tenantId, vault, {
            initial: [{ sourceRecordId, payload }],
          });

          const result = await replayWithConnector({
            chainStore: store,
            keyVault: vault,
            connector,
            eventId: event.eventId,
          });

          // Exactly one match, on the 'after' side, naming the right id.
          if (result.matches.length !== 1) return false;
          const match = result.matches[0]!;
          if (match.matched !== 'after') return false;
          if (match.candidateSourceRecordId !== sourceRecordId) return false;
          // No missing sides — there was no beforeHash, and afterHash matched.
          if (result.missing.length !== 0) return false;
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });

  it('cross-tenant connector: replay against the wrong tenant always yields zero matches', async () => {
    // Companion property: even when the connector holds the right payload
    // under the right sourceRecordId, if it is wired to a different tenant's
    // salt the source-id-hash filter rejects everything. The replay returns
    // an unattributable result with the sole side ('after' for a CREATE)
    // listed as missing. This is the cross-tenant-isolation guarantee.
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 32 }),
        safePayload,
        async (tenantStrA, tenantStrB, sourceRecordId, payload) => {
          if (tenantStrA === tenantStrB) return true;

          const tenantA = tenantStrA as TenantId;
          const tenantB = tenantStrB as TenantId;

          const vault = createInMemoryKeyVault();
          await vault.provisionTenant(tenantA);
          await vault.provisionTenant(tenantB);

          const store = createInMemoryChainStore();
          const input: AuditEventInput = {
            tenantId: tenantA,
            sessionId: SESSION,
            actor: ACTOR,
            actionVerb: 'CREATE',
            targetKind: 'EMPLOYEE_HOURS',
            targetHandle: 'h-1' as OpaqueHandle,
            payloadSchemaId: PAYLOAD_SCHEMA_ID_V1 as PayloadSchemaId,
            beforePayload: null,
            afterPayload: payload,
            sourceRef: {
              connectorId: 'in-memory-test-connector',
              sourceRecordIdHash: await hashSourceRecordId(
                vault,
                tenantA,
                sourceRecordId,
              ),
              fetchedAt: '2026-05-01T12:00:00.000Z',
            },
          };
          const event = await writeAuditEvent(store, vault, input);

          // Connector wired to tenant B (wrong tenant for this event), but
          // holds the "right" payload under the "right" id.
          const wrongConnector = createInMemoryReplayConnector(tenantB, vault, {
            initial: [{ sourceRecordId, payload }],
          });

          const result = await replayWithConnector({
            chainStore: store,
            keyVault: vault,
            connector: wrongConnector,
            eventId: event.eventId,
          });

          if (result.matches.length !== 0) return false;
          if (result.missing.length !== 1) return false;
          if (result.missing[0] !== 'after') return false;
          return true;
        },
      ),
      { numRuns: 30 },
    );
  });
});
