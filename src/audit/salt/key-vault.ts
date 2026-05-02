// Per-tenant salt management — the M2 closing of the M1 cross-tenant
// correlation gap.
//
// A KeyVault holds the HMAC key (the "salt") used to hash payloads and
// source-record IDs for a given tenant. Each tenant gets a fresh 32-byte
// random salt at provisioning time. The same payload hashed under two
// different tenants' salts MUST produce different hashes — that is the
// invariant that prevents anyone (including Paygon itself) from correlating
// "same value" events across tenants.
//
// Operational rules (apply to every implementation, in-memory or KMS):
//   - Salts are KEY MATERIAL. Never log them. Never include them in error
//     messages. Never return them outside the audit subsystem.
//   - Provisioning is IDEMPOTENT. Re-provisioning a tenant returns the
//     existing salt. Overwriting would invalidate every prior audit event
//     for that tenant — a catastrophic integrity failure.
//   - Salts never leave the vault except via getTenantSalt(); they are not
//     serializable, exportable, or logged.
//
// In M2 the only implementation is in-memory (for development and tests).
// M3 introduces a real KMS-backed adapter; the interface stays stable.
//
// Helper hashSourceRecordId() lives below — callers should use it to produce
// the SourceRef.sourceRecordIdHash, which by ADR 0002 is HMAC-SHA-256 keyed
// by the same per-tenant salt as payload hashes.

import type { Sha256Hex, TenantId } from '../events/types.js';
import { hmacSha256Hex } from '../chain/hashing.js';

export interface KeyVault {
  // Returns the current per-tenant salt (the HMAC key used for payload +
  // sourceRecordId hashes). Throws TenantNotProvisionedError if the tenant
  // has no salt yet — callers must provision before first event.
  getTenantSalt(tenantId: TenantId): Promise<Uint8Array>;

  // Provision a new tenant: generate a fresh salt, store it under the
  // tenant id, return it. Idempotent: if the tenant already has a salt,
  // return the existing one (do NOT overwrite — that would invalidate
  // every existing event for that tenant).
  provisionTenant(tenantId: TenantId): Promise<Uint8Array>;
}

export class TenantNotProvisionedError extends Error {
  constructor(public readonly tenantId: TenantId) {
    // Intentionally does NOT include any salt material. The tenantId is a
    // metadata identifier (not PII per ADR 0001) and is safe to surface.
    super(
      `tenant ${tenantId} has no salt provisioned; ` +
        `call keyVault.provisionTenant(tenantId) before writing events`,
    );
    this.name = 'TenantNotProvisionedError';
  }
}

// Compute the HMAC-SHA-256 hash of a source-system record id under the
// tenant's salt. Callers that build an AuditEventInput should use this to
// fill in SourceRef.sourceRecordIdHash. The plaintext sourceRecordId is
// discarded from this function's locals immediately after hashing.
//
// Background: a client's source system may key records by something that
// is itself sensitive (e.g., SSN-as-key in legacy HRIS). We never persist
// the plaintext id anywhere — only the salted hash, which is resistant to
// rainbow-table attacks (the salt is per-tenant and HSM-only in production).
export async function hashSourceRecordId(
  keyVault: KeyVault,
  tenantId: TenantId,
  sourceRecordId: string,
): Promise<Sha256Hex> {
  const salt = await keyVault.getTenantSalt(tenantId);
  return hmacSha256Hex(salt, sourceRecordId);
}
