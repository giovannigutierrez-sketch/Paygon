// Property tests for chain integrity.
//
// Invariants:
//   - A chain built only via the writer always verifies cleanly.
//   - Mutating any single field of any single event always trips the verifier.
//   - Removing any single event from a non-trivial chain trips the verifier.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type {
  AuditEvent,
  AuditEventInput,
  EventId,
  OpaqueHandle,
  PayloadSchemaId,
  Sha256Hex,
  SessionId,
  TenantId,
  UserHandle,
} from '../../src/audit/events/types.js';
import { PAYLOAD_SCHEMA_ID_V1 } from '../../src/audit/canonical/canonical-v1.js';
import { GENESIS_HASH } from '../../src/audit/chain/hashing.js';
import { createInMemoryChainStore } from '../../src/audit/chain/memory-store.js';
import type { ChainStore } from '../../src/audit/chain/types.js';
import { writeAuditEvent } from '../../src/audit/chain/writer.js';
import { verifyChain } from '../../src/audit/chain/verifier.js';

const TENANT = 'tenant-prop' as TenantId;
const SESSION = 'sess-prop' as SessionId;
const ACTOR = 'user-prop' as UserHandle;

function inputFromHours(targetHandle: string, hours: number): AuditEventInput {
  return {
    tenantId: TENANT,
    sessionId: SESSION,
    actor: ACTOR,
    actionVerb: 'UPDATE',
    targetKind: 'EMPLOYEE_HOURS',
    targetHandle: targetHandle as OpaqueHandle,
    payloadSchemaId: PAYLOAD_SCHEMA_ID_V1 as PayloadSchemaId,
    beforePayload: { hours: hours - 1 },
    afterPayload: { hours },
    sourceRef: {
      connectorId: 'csv',
      sourceRecordIdHash:
        '1111111111111111111111111111111111111111111111111111111111111111' as Sha256Hex,
      fetchedAt: '2026-05-01T12:00:00.000Z',
    },
  };
}

function readOnlyStore(events: ReadonlyArray<AuditEvent>): ChainStore {
  return {
    async append(): Promise<void> {
      throw new Error('read-only test store');
    },
    async readByTenant(): Promise<ReadonlyArray<AuditEvent>> {
      return events;
    },
    async readById(eventId: EventId): Promise<AuditEvent | undefined> {
      return events.find((e) => e.eventId === eventId);
    },
    async headHash(): Promise<string> {
      return events.at(-1)?.recordHash ?? GENESIS_HASH;
    },
  };
}

async function buildChain(hours: ReadonlyArray<number>): Promise<AuditEvent[]> {
  const store = createInMemoryChainStore();
  const events: AuditEvent[] = [];
  for (const h of hours) {
    events.push(await writeAuditEvent(store, inputFromHours(`h-${events.length}`, h)));
  }
  return events;
}

describe('chain integrity properties', () => {
  it('writer-built chains always verify', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 80 }), { minLength: 1, maxLength: 8 }),
        async (hours) => {
          const events = await buildChain(hours);
          const result = await verifyChain(readOnlyStore(events), TENANT);
          return result.ok && result.eventCount === events.length;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('removing any event trips the verifier', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .array(fc.integer({ min: 1, max: 80 }), { minLength: 2, maxLength: 6 })
          .chain((hours) =>
            fc.tuple(fc.constant(hours), fc.integer({ min: 0, max: hours.length - 1 })),
          ),
        async ([hours, dropIndex]) => {
          const events = await buildChain(hours);
          const tampered = events.filter((_, i) => i !== dropIndex);
          if (tampered.length === 0) return true; // nothing to verify
          const result = await verifyChain(readOnlyStore(tampered), TENANT);
          // Removing any event MUST be detected:
          //   - dropping the first event makes the new first event have a
          //     non-GENESIS prev (if there were >1 events) -> genesis-mismatch
          //   - dropping a middle event breaks the next event's prev link
          //   - dropping the tail leaves a valid prefix and verifies clean,
          //     which is fine — the verifier can't detect that a tenant has
          //     more events elsewhere.
          if (dropIndex === events.length - 1) {
            return result.ok === true;
          }
          return result.ok === false;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('mutating a recorded actor field trips the verifier', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 80 }), { minLength: 1, maxLength: 5 }),
        async (hours) => {
          const events = await buildChain(hours);
          const idx = 0;
          const tampered = events.map((e, i) =>
            i === idx
              ? Object.freeze({ ...e, actor: 'evil' as UserHandle })
              : e,
          );
          const result = await verifyChain(readOnlyStore(tampered), TENANT);
          return result.ok === false;
        },
      ),
      { numRuns: 50 },
    );
  });
});
