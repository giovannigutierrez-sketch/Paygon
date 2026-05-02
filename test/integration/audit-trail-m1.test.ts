// End-to-end integration tests for audit trail M1.
// Covers the happy path (write + verify) and the three failure modes the
// verifier reports: genesis-mismatch, prev-link-mismatch, record-hash-mismatch.
//
// As of M2, every test sets up a per-tenant KeyVault and provisions each
// tenant before writing. The salts here are deterministic (saltFor) so test
// hashes are stable across runs.

import { describe, it, expect } from 'vitest';

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
import type { KeyVault } from '../../src/audit/salt/key-vault.js';
import { createInMemoryKeyVault } from '../../src/audit/salt/in-memory-key-vault.js';

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;
const SESSION = 'sess-1' as SessionId;
const ACTOR = 'user-1' as UserHandle;

// Build a deterministic KeyVault and provision the supplied tenants. Tests
// that need stable hash output across runs should use this; tests that only
// care about structural invariants (chain links, verifier behavior) can also
// use it without consequence.
async function setupVault(tenantIds: ReadonlyArray<TenantId>): Promise<KeyVault> {
  const vault = createInMemoryKeyVault({
    saltFor: (tenantId) => {
      // Deterministic 32-byte salt per tenant, derived from tenantId.
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

function inputFor(
  targetHandle: string,
  before: unknown,
  after: unknown,
  tenantId: TenantId = TENANT_A,
): AuditEventInput {
  return {
    tenantId,
    sessionId: SESSION,
    actor: ACTOR,
    actionVerb: before === null ? 'CREATE' : after === null ? 'DELETE' : 'UPDATE',
    targetKind: 'EMPLOYEE_HOURS',
    targetHandle: targetHandle as OpaqueHandle,
    payloadSchemaId: PAYLOAD_SCHEMA_ID_V1 as PayloadSchemaId,
    beforePayload: before,
    afterPayload: after,
    sourceRef: {
      connectorId: 'csv-upload',
      sourceRecordIdHash:
        '0000000000000000000000000000000000000000000000000000000000000000' as Sha256Hex,
      fetchedAt: '2026-05-01T12:00:00.000Z',
    },
  };
}

// Test-only store that returns whatever events we hand it. Lets us exercise
// verifier failure modes without forcing the production store to accept
// invalid input.
function createReadOnlyStore(events: ReadonlyArray<AuditEvent>): ChainStore {
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

describe('audit trail M1', () => {
  it('writes a single event with prev = GENESIS', async () => {
    const store = createInMemoryChainStore();
    const vault = await setupVault([TENANT_A]);
    const event = await writeAuditEvent(
      store,
      vault,
      inputFor('h-1', null, { hours: 40 }),
    );
    expect(event.prevEventHash).toBe(GENESIS_HASH);
    expect(event.beforeHash).toBeNull();
    expect(event.afterHash).toMatch(/^[0-9a-f]{64}$/);
    expect(event.recordHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('chains successive events: prev points at the prior recordHash', async () => {
    const store = createInMemoryChainStore();
    const vault = await setupVault([TENANT_A]);
    const e1 = await writeAuditEvent(store, vault, inputFor('h-1', null, { hours: 40 }));
    const e2 = await writeAuditEvent(
      store,
      vault,
      inputFor('h-1', { hours: 40 }, { hours: 42 }),
    );
    expect(e2.prevEventHash).toBe(e1.recordHash);
  });

  it('verifies a clean chain', async () => {
    const store = createInMemoryChainStore();
    const vault = await setupVault([TENANT_A]);
    await writeAuditEvent(store, vault, inputFor('h-1', null, { hours: 40 }));
    await writeAuditEvent(store, vault, inputFor('h-1', { hours: 40 }, { hours: 42 }));
    await writeAuditEvent(store, vault, inputFor('h-1', { hours: 42 }, null));

    const result = await verifyChain(store, TENANT_A);
    expect(result).toEqual({ ok: true, eventCount: 3 });
  });

  it('isolates chains per tenant (heads do not interfere)', async () => {
    const store = createInMemoryChainStore();
    const vault = await setupVault([TENANT_A, TENANT_B]);
    const a1 = await writeAuditEvent(
      store,
      vault,
      inputFor('h-1', null, { hours: 1 }, TENANT_A),
    );
    const b1 = await writeAuditEvent(
      store,
      vault,
      inputFor('h-1', null, { hours: 2 }, TENANT_B),
    );
    expect(a1.prevEventHash).toBe(GENESIS_HASH);
    expect(b1.prevEventHash).toBe(GENESIS_HASH);

    const a = await verifyChain(store, TENANT_A);
    const b = await verifyChain(store, TENANT_B);
    expect(a).toEqual({ ok: true, eventCount: 1 });
    expect(b).toEqual({ ok: true, eventCount: 1 });
  });

  it('rejects duplicate appends of the same event id', async () => {
    const store = createInMemoryChainStore();
    const vault = await setupVault([TENANT_A]);
    const e1 = await writeAuditEvent(store, vault, inputFor('h-1', null, { hours: 1 }));
    await expect(store.append(e1)).rejects.toThrowError(/already exists/);
  });

  it('rejects an append whose prevEventHash does not match the head', async () => {
    const store = createInMemoryChainStore();
    const vault = await setupVault([TENANT_A]);
    await writeAuditEvent(store, vault, inputFor('h-1', null, { hours: 1 }));
    // Build a stale event that thinks the chain is still at GENESIS.
    const stale = await writeAuditEvent(
      createInMemoryChainStore(), // separate, fresh store
      vault,
      inputFor('h-2', null, { hours: 2 }),
    );
    await expect(store.append(stale)).rejects.toThrowError(/chain write race/);
  });

  it('verifier flags genesis-mismatch when first event has wrong prev', async () => {
    const realStore = createInMemoryChainStore();
    const vault = await setupVault([TENANT_A]);
    const e1 = await writeAuditEvent(realStore, vault, inputFor('h-1', null, { hours: 40 }));
    // Forge an event with the same fields but a non-GENESIS prev.
    const forged: AuditEvent = Object.freeze({
      ...e1,
      prevEventHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Sha256Hex,
    });
    const result = await verifyChain(createReadOnlyStore([forged]), TENANT_A);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('genesis-mismatch');
      expect(result.brokenAtIndex).toBe(0);
    }
  });

  it('verifier flags prev-link-mismatch when middle event is removed', async () => {
    const realStore = createInMemoryChainStore();
    const vault = await setupVault([TENANT_A]);
    await writeAuditEvent(realStore, vault, inputFor('h-1', null, { hours: 1 }));
    await writeAuditEvent(realStore, vault, inputFor('h-1', { hours: 1 }, { hours: 2 }));
    const e3 = await writeAuditEvent(
      realStore,
      vault,
      inputFor('h-1', { hours: 2 }, { hours: 3 }),
    );
    const all = await realStore.readByTenant(TENANT_A);
    // Drop the middle event, so e3 follows e1 in the visible list.
    const tampered = [all[0]!, e3];
    const result = await verifyChain(createReadOnlyStore(tampered), TENANT_A);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('prev-link-mismatch');
      expect(result.brokenAtIndex).toBe(1);
    }
  });

  it('verifier flags record-hash-mismatch when an event field is mutated', async () => {
    const realStore = createInMemoryChainStore();
    const vault = await setupVault([TENANT_A]);
    const e1 = await writeAuditEvent(realStore, vault, inputFor('h-1', null, { hours: 40 }));
    const tampered: AuditEvent = Object.freeze({
      ...e1,
      actor: 'evil-actor' as UserHandle, // mutated, but recordHash unchanged
    });
    const result = await verifyChain(createReadOnlyStore([tampered]), TENANT_A);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('record-hash-mismatch');
      expect(result.brokenAtIndex).toBe(0);
    }
  });

  it('rejects payloads containing undefined / functions / BigInt / NaN', async () => {
    const store = createInMemoryChainStore();
    const vault = await setupVault([TENANT_A]);
    await expect(
      writeAuditEvent(store, vault, inputFor('h-1', null, { x: undefined })),
    ).rejects.toThrowError(/undefined is not allowed/);
    await expect(
      writeAuditEvent(store, vault, inputFor('h-2', null, { x: () => 1 })),
    ).rejects.toThrowError(/functions are not allowed/);
    await expect(
      writeAuditEvent(store, vault, inputFor('h-3', null, { x: 1n })),
    ).rejects.toThrowError(/BigInt is not allowed/);
    await expect(
      writeAuditEvent(store, vault, inputFor('h-4', null, { x: NaN })),
    ).rejects.toThrowError(/non-finite number/);
  });

  it('produces identical hashes for payloads that differ only in key order', async () => {
    // Same tenant + same deterministic salt -> same payload hash regardless
    // of key order.
    const vault = await setupVault([TENANT_A]);
    const store1 = createInMemoryChainStore();
    const store2 = createInMemoryChainStore();
    const e1 = await writeAuditEvent(
      store1,
      vault,
      inputFor('h-1', null, { a: 1, b: 2, c: 3 }),
    );
    const e2 = await writeAuditEvent(
      store2,
      vault,
      inputFor('h-1', null, { c: 3, a: 1, b: 2 }),
    );
    expect(e1.afterHash).toBe(e2.afterHash);
  });
});
