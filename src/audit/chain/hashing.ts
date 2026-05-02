// Hashing primitives for the audit chain.
// SHA-256 for chain links and the GENESIS constant.
// HMAC-SHA-256 for payload hashes, keyed by the per-tenant salt loaded from
// the KeyVault (see src/audit/salt/key-vault.ts). The salt never appears in
// this module's API surface — callers pass it as the `key` parameter and
// must never log or otherwise leak the bytes.

import { createHash, createHmac } from 'node:crypto';

import type { AuditEvent, Sha256Hex } from '../events/types.js';

export function sha256Hex(input: Uint8Array | string): Sha256Hex {
  const hash = createHash('sha256');
  hash.update(typeof input === 'string' ? Buffer.from(input, 'utf8') : input);
  return hash.digest('hex') as Sha256Hex;
}

export function hmacSha256Hex(key: Uint8Array, input: Uint8Array | string): Sha256Hex {
  const mac = createHmac('sha256', key);
  mac.update(typeof input === 'string' ? Buffer.from(input, 'utf8') : input);
  return mac.digest('hex') as Sha256Hex;
}

// GENESIS is the prevEventHash of the first event in every tenant's chain.
// Computed at module load from a fixed seed string so the verifier and writer
// always agree without anyone having to copy a magic constant.
export const GENESIS_HASH: Sha256Hex = sha256Hex('GENESIS');

// Hash of the entire AuditEvent record. This is what the next event in the
// chain will use as its prevEventHash. The hash must be stable regardless
// of property order in serialization, so we hash a canonicalized form of
// a fixed shape.
export function hashAuditRecord(event: AuditEvent): Sha256Hex {
  // We build a stable string explicitly rather than relying on JSON.stringify's
  // (undefined) key order. Brand-typed fields are plain strings at runtime.
  const parts: string[] = [
    `eventId=${event.eventId}`,
    `tenantId=${event.tenantId}`,
    `sessionId=${event.sessionId}`,
    `actor=${event.actor}`,
    `actionVerb=${event.actionVerb}`,
    `targetKind=${event.targetKind}`,
    `targetHandle=${event.targetHandle}`,
    `occurredAt=${event.occurredAt}`,
    `schemaVersion=${event.schemaVersion}`,
    `payloadSchemaId=${event.payloadSchemaId}`,
    `beforeHash=${event.beforeHash ?? ''}`,
    `afterHash=${event.afterHash ?? ''}`,
    `sourceRef.connectorId=${event.sourceRef.connectorId}`,
    `sourceRef.sourceRecordIdHash=${event.sourceRef.sourceRecordIdHash}`,
    `sourceRef.fetchedAt=${event.sourceRef.fetchedAt}`,
    `prevEventHash=${event.prevEventHash}`,
  ];
  return sha256Hex(parts.join('\n'));
}
