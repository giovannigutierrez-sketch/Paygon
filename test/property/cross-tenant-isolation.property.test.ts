// Property test: cross-tenant payload-hash isolation.
//
// The headline M2 invariant: for any two distinct tenants and any payload,
// the payload's hash under tenant A's salt must differ from its hash under
// tenant B's salt. With 32-byte CSPRNG salts the collision probability is
// ~2^-256 per pair — astronomically rare — so we can assert non-equality
// as a hard property.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

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
} from '../../src/audit/salt/key-vault.js';
import { createInMemoryKeyVault } from '../../src/audit/salt/in-memory-key-vault.js';

const SESSION = 'sess-prop' as SessionId;
const ACTOR = 'user-prop' as UserHandle;

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
      connectorId: 'csv',
      sourceRecordIdHash:
        '2222222222222222222222222222222222222222222222222222222222222222' as Sha256Hex,
      fetchedAt: '2026-05-01T12:00:00.000Z',
    },
  };
}

// Generate a payload that canonical-v1 will accept: object with string keys
// and finite-number / string / boolean / null leaves. (Canonical-v1 rejects
// undefined / functions / BigInt / NaN / Infinity; fast-check's jsonValue
// can produce numbers like Infinity, so we constrain explicitly.)
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

describe('cross-tenant isolation properties', () => {
  it('hash(tenantA, payload) !== hash(tenantB, payload) for distinct tenants', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 16 }),
        safePayload,
        async (tenantStrA, tenantStrB, payload) => {
          if (tenantStrA === tenantStrB) return true; // skip equal-tenant draws

          const tenantA = tenantStrA as TenantId;
          const tenantB = tenantStrB as TenantId;

          const vault = createInMemoryKeyVault();
          await vault.provisionTenant(tenantA);
          await vault.provisionTenant(tenantB);

          const storeA = createInMemoryChainStore();
          const storeB = createInMemoryChainStore();
          const eA = await writeAuditEvent(storeA, vault, inputFor(tenantA, payload));
          const eB = await writeAuditEvent(storeB, vault, inputFor(tenantB, payload));

          // afterHash is non-null because afterPayload is non-null.
          return eA.afterHash !== eB.afterHash;
        },
      ),
      { numRuns: 50 },
    );
  });

  it('source-record-id hashes are tenant-isolated', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        async (tenantStrA, tenantStrB, recordId) => {
          if (tenantStrA === tenantStrB) return true;

          const tenantA = tenantStrA as TenantId;
          const tenantB = tenantStrB as TenantId;

          const vault = createInMemoryKeyVault();
          await vault.provisionTenant(tenantA);
          await vault.provisionTenant(tenantB);

          const hA = await hashSourceRecordId(vault, tenantA, recordId);
          const hB = await hashSourceRecordId(vault, tenantB, recordId);
          return hA !== hB;
        },
      ),
      { numRuns: 50 },
    );
  });

  it('within a tenant, the same payload always hashes the same', async () => {
    // Sanity check: per-tenant determinism. (Different tenants -> different
    // hashes; same tenant -> same hash.)
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 16 }),
        safePayload,
        async (tenantStr, payload) => {
          const tenantId = tenantStr as TenantId;
          const vault = createInMemoryKeyVault();
          await vault.provisionTenant(tenantId);

          const store1 = createInMemoryChainStore();
          const store2 = createInMemoryChainStore();
          const e1 = await writeAuditEvent(store1, vault, inputFor(tenantId, payload));
          const e2 = await writeAuditEvent(store2, vault, inputFor(tenantId, payload));
          return e1.afterHash === e2.afterHash;
        },
      ),
      { numRuns: 50 },
    );
  });
});
