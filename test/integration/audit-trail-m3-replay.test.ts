// Integration tests for audit trail M3 — replay protocol.
//
// Covers the canonicalize-and-match flow: write an event, then ask the
// replay subsystem (via a connector) to confirm which candidate source
// records correspond to the event's beforeHash / afterHash.
//
// What we exercise:
//   - happy path: connector still has the matching record; both sides match
//   - source drift: connector mutated the record; sides go missing
//   - source deletion: connector dropped the record; sides go missing
//   - wrong tenant: salt mismatch yields zero candidates -> unattributable
//   - CREATE event: only afterHash exists; missing only ever names 'after'
//   - DELETE event: symmetric — only 'before'
//   - unknown event id: throws EventNotFoundError
//
// All tests use deterministic salts (saltFor) so hashes are stable across runs.

import { describe, it, expect } from 'vitest';

import type {
  AuditEventInput,
  EventId,
  OpaqueHandle,
  PayloadSchemaId,
  SessionId,
  TenantId,
  UserHandle,
} from '../../src/audit/events/types.js';
import { PAYLOAD_SCHEMA_ID_V1 } from '../../src/audit/canonical/canonical-v1.js';
import { createInMemoryChainStore } from '../../src/audit/chain/memory-store.js';
import { writeAuditEvent } from '../../src/audit/chain/writer.js';
import {
  hashSourceRecordId,
  type KeyVault,
} from '../../src/audit/salt/key-vault.js';
import { createInMemoryKeyVault } from '../../src/audit/salt/in-memory-key-vault.js';
import { createInMemoryReplayConnector } from '../../src/audit/replay/in-memory-connector.js';
import {
  EventNotFoundError,
  replayEvent,
} from '../../src/audit/replay/replay-event.js';
import { replayWithConnector } from '../../src/audit/replay/replay-with-connector.js';

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;
const SESSION = 'sess-1' as SessionId;
const ACTOR = 'user-1' as UserHandle;
const CONNECTOR_ID = 'in-memory-test-connector';
const FETCHED_AT = '2026-05-01T12:00:00.000Z';

async function setupVault(tenantIds: ReadonlyArray<TenantId>): Promise<KeyVault> {
  // Deterministic salt per tenant — same shape used in M1/M2 tests.
  const vault = createInMemoryKeyVault({
    saltFor: (tenantId) => {
      const buf = new Uint8Array(32);
      const bytes = new TextEncoder().encode(tenantId);
      for (let i = 0; i < 32; i++) {
        buf[i] = (bytes[i % bytes.length] ?? 0) ^ (i * 31);
      }
      return buf;
    },
  });
  for (const tenantId of tenantIds) {
    await vault.provisionTenant(tenantId);
  }
  return vault;
}

async function buildInput(args: {
  tenantId: TenantId;
  vault: KeyVault;
  sourceRecordId: string;
  before: unknown;
  after: unknown;
}): Promise<AuditEventInput> {
  const { tenantId, vault, sourceRecordId, before, after } = args;
  return {
    tenantId,
    sessionId: SESSION,
    actor: ACTOR,
    actionVerb: before === null ? 'CREATE' : after === null ? 'DELETE' : 'UPDATE',
    targetKind: 'EMPLOYEE_HOURS',
    targetHandle: 'h-1' as OpaqueHandle,
    payloadSchemaId: PAYLOAD_SCHEMA_ID_V1 as PayloadSchemaId,
    beforePayload: before,
    afterPayload: after,
    sourceRef: {
      connectorId: CONNECTOR_ID,
      sourceRecordIdHash: await hashSourceRecordId(vault, tenantId, sourceRecordId),
      fetchedAt: FETCHED_AT,
    },
  };
}

describe('audit trail M3 — replay protocol', () => {
  it('happy path: UPDATE event replays with both before and after matched', async () => {
    const vault = await setupVault([TENANT_A]);
    const store = createInMemoryChainStore();

    const before = { hours: 40 };
    const after = { hours: 42 };
    const event = await writeAuditEvent(
      store,
      vault,
      await buildInput({
        tenantId: TENANT_A,
        vault,
        sourceRecordId: 'EMP-001',
        before,
        after,
      }),
    );

    // Connector has TWO versions of the record's history surfaced as separate
    // candidate payloads. The replay protocol matches each against the
    // event's hashes. (In practice the connector can return any number of
    // candidates — they all share the same sourceRecordId hash, so they all
    // pass the source-id filter, and replay tells us which of their payloads
    // hashed to which side.)
    const connector = createInMemoryReplayConnector(TENANT_A, vault, {
      initial: [
        { sourceRecordId: 'EMP-001', payload: before },
      ],
    });
    // Add the "after" snapshot under the same sourceRecordId — the connector
    // is keyed by id, so this overwrites. To exercise both sides, we instead
    // pass both candidates explicitly to replayEvent.
    const result = await replayEvent({
      chainStore: store,
      keyVault: vault,
      eventId: event.eventId,
      candidates: [
        { sourceRecordId: 'EMP-001', payload: before },
        { sourceRecordId: 'EMP-001', payload: after },
      ],
    });
    void connector; // keep the symbol to ensure the constructor still typechecks

    expect(result.eventId).toBe(event.eventId);
    expect(result.missing).toEqual([]);
    // Two matches, one per side.
    const matchedSides = result.matches.map((m) => m.matched).sort();
    expect(matchedSides).toEqual(['after', 'before']);
    // Both matched candidates point at the same source record id.
    for (const m of result.matches) {
      expect(m.candidateSourceRecordId).toBe('EMP-001');
    }
  });

  it('happy path via connector orchestrator: connector holds the after snapshot', async () => {
    // The connector represents the source system at the moment of replay.
    // After an UPDATE, the source system shows the after-state. So replay
    // matches 'after' and reports 'before' as missing — that is correct
    // behavior, not drift, because 'before' is by definition no longer in
    // the source.
    const vault = await setupVault([TENANT_A]);
    const store = createInMemoryChainStore();

    const before = { hours: 40 };
    const after = { hours: 42 };
    const event = await writeAuditEvent(
      store,
      vault,
      await buildInput({
        tenantId: TENANT_A,
        vault,
        sourceRecordId: 'EMP-001',
        before,
        after,
      }),
    );

    const connector = createInMemoryReplayConnector(TENANT_A, vault, {
      initial: [{ sourceRecordId: 'EMP-001', payload: after }],
    });

    const result = await replayWithConnector({
      chainStore: store,
      keyVault: vault,
      connector,
      eventId: event.eventId,
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.matched).toBe('after');
    expect(result.matches[0]?.candidateSourceRecordId).toBe('EMP-001');
    expect(result.missing).toEqual(['before']);
  });

  it('source drift: connector record was mutated; both sides go missing', async () => {
    const vault = await setupVault([TENANT_A]);
    const store = createInMemoryChainStore();

    const event = await writeAuditEvent(
      store,
      vault,
      await buildInput({
        tenantId: TENANT_A,
        vault,
        sourceRecordId: 'EMP-001',
        before: { hours: 40 },
        after: { hours: 42 },
      }),
    );

    // Source drifted to a totally different value after the event was written.
    const connector = createInMemoryReplayConnector(TENANT_A, vault, {
      initial: [{ sourceRecordId: 'EMP-001', payload: { hours: 999 } }],
    });

    const result = await replayWithConnector({
      chainStore: store,
      keyVault: vault,
      connector,
      eventId: event.eventId,
    });

    expect(result.matches).toEqual([]);
    // The drifted candidate passed the source-id filter (id is unchanged),
    // but its payload hashed to neither side -> both sides are missing.
    expect([...result.missing].sort()).toEqual(['after', 'before']);
  });

  it('source deletion: connector no longer has the record; both sides missing', async () => {
    const vault = await setupVault([TENANT_A]);
    const store = createInMemoryChainStore();

    const event = await writeAuditEvent(
      store,
      vault,
      await buildInput({
        tenantId: TENANT_A,
        vault,
        sourceRecordId: 'EMP-001',
        before: { hours: 40 },
        after: { hours: 42 },
      }),
    );

    const connector = createInMemoryReplayConnector(TENANT_A, vault, {
      initial: [{ sourceRecordId: 'EMP-001', payload: { hours: 40 } }],
    });
    connector.delete('EMP-001');

    const result = await replayWithConnector({
      chainStore: store,
      keyVault: vault,
      connector,
      eventId: event.eventId,
    });

    expect(result.matches).toEqual([]);
    expect([...result.missing].sort()).toEqual(['after', 'before']);
  });

  it('wrong-tenant connector: salt mismatch yields zero matches', async () => {
    // Connector is wired to tenant A's vault. The event was written under
    // tenant B. A's salt won't reproduce B's sourceRecordIdHash, so no
    // candidate passes the filter — the result is unattributable.
    const vault = await setupVault([TENANT_A, TENANT_B]);
    const store = createInMemoryChainStore();

    const event = await writeAuditEvent(
      store,
      vault,
      await buildInput({
        tenantId: TENANT_B,
        vault,
        sourceRecordId: 'EMP-001',
        before: { hours: 40 },
        after: { hours: 42 },
      }),
    );

    // Wrong tenant — connector hashes ids under TENANT_A's salt.
    const wrongTenantConnector = createInMemoryReplayConnector(TENANT_A, vault, {
      initial: [{ sourceRecordId: 'EMP-001', payload: { hours: 42 } }],
    });

    const result = await replayWithConnector({
      chainStore: store,
      keyVault: vault,
      connector: wrongTenantConnector,
      eventId: event.eventId,
    });

    expect(result.matches).toEqual([]);
    // Event has both sides hashed; both are unattributable.
    expect([...result.missing].sort()).toEqual(['after', 'before']);
  });

  it('CREATE event: matches after only, missing tracks after only on drift', async () => {
    const vault = await setupVault([TENANT_A]);
    const store = createInMemoryChainStore();

    const event = await writeAuditEvent(
      store,
      vault,
      await buildInput({
        tenantId: TENANT_A,
        vault,
        sourceRecordId: 'EMP-001',
        before: null,
        after: { hours: 40 },
      }),
    );

    // Happy: connector has the after-payload.
    const happyConnector = createInMemoryReplayConnector(TENANT_A, vault, {
      initial: [{ sourceRecordId: 'EMP-001', payload: { hours: 40 } }],
    });
    const happy = await replayWithConnector({
      chainStore: store,
      keyVault: vault,
      connector: happyConnector,
      eventId: event.eventId,
    });
    expect(happy.matches).toHaveLength(1);
    expect(happy.matches[0]?.matched).toBe('after');
    expect(happy.missing).toEqual([]);

    // Drift: connector's record changed.
    const driftConnector = createInMemoryReplayConnector(TENANT_A, vault, {
      initial: [{ sourceRecordId: 'EMP-001', payload: { hours: 999 } }],
    });
    const drift = await replayWithConnector({
      chainStore: store,
      keyVault: vault,
      connector: driftConnector,
      eventId: event.eventId,
    });
    expect(drift.matches).toEqual([]);
    // Only 'after' is missing — there was no beforeHash to miss.
    expect(drift.missing).toEqual(['after']);
  });

  it('DELETE event: matches before only, missing tracks before only on drift', async () => {
    const vault = await setupVault([TENANT_A]);
    const store = createInMemoryChainStore();

    const event = await writeAuditEvent(
      store,
      vault,
      await buildInput({
        tenantId: TENANT_A,
        vault,
        sourceRecordId: 'EMP-001',
        before: { hours: 40 },
        after: null,
      }),
    );

    // Source still has the pre-delete payload (e.g., a soft delete the
    // connector exposes as-of fetchedAt).
    const happyConnector = createInMemoryReplayConnector(TENANT_A, vault, {
      initial: [{ sourceRecordId: 'EMP-001', payload: { hours: 40 } }],
    });
    const happy = await replayWithConnector({
      chainStore: store,
      keyVault: vault,
      connector: happyConnector,
      eventId: event.eventId,
    });
    expect(happy.matches).toHaveLength(1);
    expect(happy.matches[0]?.matched).toBe('before');
    expect(happy.missing).toEqual([]);

    // Drift: source mutated post-delete-event.
    const driftConnector = createInMemoryReplayConnector(TENANT_A, vault, {
      initial: [{ sourceRecordId: 'EMP-001', payload: { hours: 1 } }],
    });
    const drift = await replayWithConnector({
      chainStore: store,
      keyVault: vault,
      connector: driftConnector,
      eventId: event.eventId,
    });
    expect(drift.matches).toEqual([]);
    expect(drift.missing).toEqual(['before']);
  });

  it('unknown event id throws EventNotFoundError', async () => {
    const vault = await setupVault([TENANT_A]);
    const store = createInMemoryChainStore();
    const connector = createInMemoryReplayConnector(TENANT_A, vault);

    await expect(
      replayWithConnector({
        chainStore: store,
        keyVault: vault,
        connector,
        eventId: 'no-such-event' as EventId,
      }),
    ).rejects.toBeInstanceOf(EventNotFoundError);

    // Same via the primitive directly.
    await expect(
      replayEvent({
        chainStore: store,
        keyVault: vault,
        eventId: 'also-not-real' as EventId,
        candidates: [],
      }),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it('no-op event (before === after): single candidate matches both sides', async () => {
    // Edge case: an event whose before and after are identical. Both hashes
    // are equal, so a candidate matching either matches both. Replay surfaces
    // matched: 'both' to make this explicit (rather than silently appearing
    // twice in the matches list).
    const vault = await setupVault([TENANT_A]);
    const store = createInMemoryChainStore();

    const payload = { hours: 40 };
    const event = await writeAuditEvent(
      store,
      vault,
      await buildInput({
        tenantId: TENANT_A,
        vault,
        sourceRecordId: 'EMP-001',
        before: payload,
        after: payload,
      }),
    );

    const connector = createInMemoryReplayConnector(TENANT_A, vault, {
      initial: [{ sourceRecordId: 'EMP-001', payload }],
    });
    const result = await replayWithConnector({
      chainStore: store,
      keyVault: vault,
      connector,
      eventId: event.eventId,
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.matched).toBe('both');
    expect(result.missing).toEqual([]);
  });

  it('connector returns frozen results that the orchestrator does not mutate', async () => {
    const vault = await setupVault([TENANT_A]);
    const store = createInMemoryChainStore();

    const event = await writeAuditEvent(
      store,
      vault,
      await buildInput({
        tenantId: TENANT_A,
        vault,
        sourceRecordId: 'EMP-001',
        before: null,
        after: { hours: 40 },
      }),
    );

    const connector = createInMemoryReplayConnector(TENANT_A, vault, {
      initial: [{ sourceRecordId: 'EMP-001', payload: { hours: 40 } }],
    });

    const result = await replayWithConnector({
      chainStore: store,
      keyVault: vault,
      connector,
      eventId: event.eventId,
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.matches)).toBe(true);
    expect(Object.isFrozen(result.missing)).toBe(true);
  });

  it('replay does NOT return candidate payloads — only source-record-id confirmations', async () => {
    // Hard invariant carried from M1/M2: payloads never leak via replay.
    const vault = await setupVault([TENANT_A]);
    const store = createInMemoryChainStore();

    const secret = { ssn: '123-45-6789', hours: 40 };
    const event = await writeAuditEvent(
      store,
      vault,
      await buildInput({
        tenantId: TENANT_A,
        vault,
        sourceRecordId: 'EMP-SECRET',
        before: null,
        after: secret,
      }),
    );

    const connector = createInMemoryReplayConnector(TENANT_A, vault, {
      initial: [{ sourceRecordId: 'EMP-SECRET', payload: secret }],
    });

    const result = await replayWithConnector({
      chainStore: store,
      keyVault: vault,
      connector,
      eventId: event.eventId,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('123-45-6789');
    expect(serialized).not.toContain('"hours"');
    // The structural shape: matches contain candidate ids + a side label;
    // nothing else.
    for (const match of result.matches) {
      expect(Object.keys(match).sort()).toEqual([
        'candidateSourceRecordId',
        'matched',
      ]);
    }
  });
});
