// In-memory KeyVault for M2 development and tests.
//
// Generates 32 bytes of CSPRNG randomness per tenant at provisioning time.
// Holds salts in a process-local Map. No persistence — restarting the
// process loses all salts, which would in turn invalidate every audit event
// the lost salts ever signed. That is acceptable for dev/test ONLY.
// Production uses a KMS-backed adapter (M3+).
//
// Idempotency: provisionTenant() is intentionally a no-op when the tenant
// already has a salt. Overwriting would silently break the entire audit
// chain for that tenant — every prior event's beforeHash/afterHash would
// no longer reproduce, and replay would be impossible. We treat that as a
// programmer error and refuse to do it.
//
// Test seed override: pass { saltFor } to deterministically pin per-tenant
// salts for tests that need stable hash outputs across runs. Production
// code MUST NOT pass this — the whole point of per-tenant salts is that
// no one outside the vault knows them.

import { randomBytes } from 'node:crypto';

import type { TenantId } from '../events/types.js';
import { type KeyVault, TenantNotProvisionedError } from './key-vault.js';

export interface InMemoryKeyVaultOptions {
  // Optional deterministic salt source for tests. Receives tenantId, returns
  // 32 bytes. Production must not supply this.
  readonly saltFor?: (tenantId: TenantId) => Uint8Array;
}

export function createInMemoryKeyVault(
  options: InMemoryKeyVaultOptions = {},
): KeyVault {
  const salts = new Map<TenantId, Uint8Array>();

  function generateSalt(tenantId: TenantId): Uint8Array {
    if (options.saltFor) {
      const supplied = options.saltFor(tenantId);
      if (supplied.length !== 32) {
        // Length check only — the bytes themselves are key material and
        // must NOT appear in error messages.
        throw new Error(
          `saltFor(${tenantId}) returned ${supplied.length} bytes; expected 32`,
        );
      }
      // Defensive copy so callers can't mutate stored salt material.
      return Uint8Array.from(supplied);
    }
    return Uint8Array.from(randomBytes(32));
  }

  return {
    async getTenantSalt(tenantId: TenantId): Promise<Uint8Array> {
      const salt = salts.get(tenantId);
      if (!salt) {
        throw new TenantNotProvisionedError(tenantId);
      }
      // Return a defensive copy: callers must not mutate vault state, and
      // we never want a reference to the live salt to escape the vault.
      return Uint8Array.from(salt);
    },

    async provisionTenant(tenantId: TenantId): Promise<Uint8Array> {
      // Idempotent: return existing salt without regenerating. Re-generating
      // here would invalidate every prior audit event for the tenant.
      const existing = salts.get(tenantId);
      if (existing) {
        return Uint8Array.from(existing);
      }
      const fresh = generateSalt(tenantId);
      salts.set(tenantId, fresh);
      return Uint8Array.from(fresh);
    },
  };
}
