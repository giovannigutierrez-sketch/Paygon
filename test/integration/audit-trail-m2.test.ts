// Integration tests for audit trail M2 — per-tenant salt management.
//
// Closes the M1 cross-tenant correlation gap: two tenants with identical
// payloads now produce different hashes, because each tenant has its own
// random 32-byte salt.
//
// Also covers the operational invariants:
//   - provisioning is idempotent (re-provisioning returns the existing salt;
//     does NOT regenerate, which would invalidate prior events).
//   - writing without provisioning throws TenantNotProvisionedError.
//   - the helper hashSourceRecordId() uses the same per-tenant salt and is
//     deterministic for a given (tenant, plaintext) pair.

import { describe, it, expect } from 'vitest';

import type {
  AuditEventInput,
  OpaqueHandle,
  PayloadSchemaId,
  Sha256Hex,
  SessionId,
  TenantId,
  UserHandle,
} from '../../src/audit/events/types.js';
import { PAYLOAD_SCHEMA_ID_V1 } from '../../src/audit/canonical/canonical-v1.js';
import { createInMemoryChainStore } from '../../src/audit/chain/memory-store.js';
import { writeAuditEvent } from '../../src/audit/chain/writer.js';
import {
  hashSourceRecordId,
  TenantNotProvisionedError,
} from '../../src/audit/salt/key-vault.js';
import { createInMemoryKeyVault } from '../../src/audit/salt/in-memory-key-vault.js';

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;
const SESSION = 'sess-1' as SessionId;
const ACTOR = 'user-1' as UserHandle;

function inputFor(tenantId: TenantId, payload: unknown): AuditEventInput {
  return {
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
      connectorId: 'csv-upload',
      sourceRecordIdHash:
        '0000000000000000000000000000000000000000000000000000000000000000' as Sha256Hex,
      fetchedAt: '2026-05-01T12:00:00.000Z',
    },
  };
}

describe('audit trail M2 — per-tenant salt', () => {
  it('provisioning is idempotent: same salt returned on re-provision', async () => {
    const vault = createInMemoryKeyVault();
    const first = await vault.provisionTenant(TENANT_A);
    const second = await vault.provisionTenant(TENANT_A);
    // Same bytes (NOT the same reference — defensive copies).
    expect(first.length).toBe(32);
    expect(second.length).toBe(32);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('idempotent provisioning preserves prior audit-event hashes', async () => {
    // The reason idempotency matters: re-provisioning must NOT regenerate
    // the salt, because every prior event's beforeHash/afterHash was
    // computed under the original salt and would no longer reproduce.
    const vault = createInMemoryKeyVault();
    await vault.provisionTenant(TENANT_A);

    const store = createInMemoryChainStore();
    const e1 = await writeAuditEvent(store, vault, inputFor(TENANT_A, { hours: 40 }));

    // Re-provision — must be a no-op.
    await vault.provisionTenant(TENANT_A);

    // Write the same payload again under a fresh chain. Hashes should match
    // e1.afterHash because the salt is preserved.
    const store2 = createInMemoryChainStore();
    const e2 = await writeAuditEvent(store2, vault, inputFor(TENANT_A, { hours: 40 }));
    expect(e2.afterHash).toBe(e1.afterHash);
  });

  it('writing without provisioning throws TenantNotProvisionedError', async () => {
    const vault = createInMemoryKeyVault();
    const store = createInMemoryChainStore();
    await expect(
      writeAuditEvent(store, vault, inputFor(TENANT_A, { hours: 40 })),
    ).rejects.toBeInstanceOf(TenantNotProvisionedError);
  });

  it('two tenants with identical payloads produce different afterHash values', async () => {
    // The headline M1 -> M2 invariant. Random per-tenant salts make this
    // overwhelmingly likely; with 32-byte salts the collision probability
    // is ~2^-256.
    const vault = createInMemoryKeyVault();
    await vault.provisionTenant(TENANT_A);
    await vault.provisionTenant(TENANT_B);

    const storeA = createInMemoryChainStore();
    const storeB = createInMemoryChainStore();

    const eA = await writeAuditEvent(storeA, vault, inputFor(TENANT_A, { hours: 40 }));
    const eB = await writeAuditEvent(storeB, vault, inputFor(TENANT_B, { hours: 40 }));

    expect(eA.afterHash).not.toBeNull();
    expect(eB.afterHash).not.toBeNull();
    expect(eA.afterHash).not.toBe(eB.afterHash);
  });

  it('hashSourceRecordId uses the per-tenant salt and is deterministic', async () => {
    const vault = createInMemoryKeyVault();
    await vault.provisionTenant(TENANT_A);
    await vault.provisionTenant(TENANT_B);

    const idA1 = await hashSourceRecordId(vault, TENANT_A, 'EMP-12345');
    const idA2 = await hashSourceRecordId(vault, TENANT_A, 'EMP-12345');
    const idB = await hashSourceRecordId(vault, TENANT_B, 'EMP-12345');

    // Stable for (tenant, plaintext).
    expect(idA1).toBe(idA2);
    // Cross-tenant isolated: same plaintext in different tenants -> different hashes.
    expect(idA1).not.toBe(idB);
    // Looks like a hex sha256.
    expect(idA1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashSourceRecordId on an unprovisioned tenant throws', async () => {
    const vault = createInMemoryKeyVault();
    await expect(
      hashSourceRecordId(vault, TENANT_A, 'EMP-12345'),
    ).rejects.toBeInstanceOf(TenantNotProvisionedError);
  });

  it('saltFor override is honored and produces stable hashes across runs', async () => {
    // Two vaults with the same saltFor produce identical hashes for the
    // same payload. (Not a security property — a test ergonomics property.
    // Production code MUST NOT pass saltFor.)
    const seed = (tenantId: TenantId): Uint8Array => {
      const buf = new Uint8Array(32);
      const bytes = new TextEncoder().encode(tenantId);
      for (let i = 0; i < 32; i++) buf[i] = (bytes[i % bytes.length] ?? 0) ^ i;
      return buf;
    };

    const vault1 = createInMemoryKeyVault({ saltFor: seed });
    const vault2 = createInMemoryKeyVault({ saltFor: seed });
    await vault1.provisionTenant(TENANT_A);
    await vault2.provisionTenant(TENANT_A);

    const store1 = createInMemoryChainStore();
    const store2 = createInMemoryChainStore();
    const e1 = await writeAuditEvent(store1, vault1, inputFor(TENANT_A, { hours: 40 }));
    const e2 = await writeAuditEvent(store2, vault2, inputFor(TENANT_A, { hours: 40 }));
    expect(e1.afterHash).toBe(e2.afterHash);
  });

  it('saltFor with wrong length is rejected', async () => {
    const vault = createInMemoryKeyVault({
      saltFor: () => new Uint8Array(16), // wrong length
    });
    await expect(vault.provisionTenant(TENANT_A)).rejects.toThrowError(
      /returned 16 bytes; expected 32/,
    );
  });

  it('vault returns defensive copies (mutating caller-side does not affect vault)', async () => {
    const vault = createInMemoryKeyVault();
    const first = await vault.provisionTenant(TENANT_A);
    // Mutate the returned bytes — must not affect the vault's stored salt.
    first.fill(0xff);
    const fetched = await vault.getTenantSalt(TENANT_A);
    // If the vault had returned a live reference, fetched would now be all 0xFF.
    expect(fetched.every((b) => b === 0xff)).toBe(false);
  });
});
