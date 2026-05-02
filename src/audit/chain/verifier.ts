// Audit chain verifier.
//
// Walks a tenant's events in order and confirms:
//   1. The first event's prevEventHash equals GENESIS_HASH.
//   2. Each subsequent event's prevEventHash equals the prior event's recordHash.
//   3. Each event's stored recordHash equals a freshly computed hashAuditRecord
//      over its other fields. This catches in-place tampering of any field.
//
// Returns a structured result. Does not throw on tamper (callers usually want
// to surface the failure point, not bubble an exception).

import type { AuditEvent, Sha256Hex, TenantId } from '../events/types.js';
import { GENESIS_HASH, hashAuditRecord } from './hashing.js';
import type { ChainStore } from './types.js';

export type VerifyResult =
  | { readonly ok: true; readonly eventCount: number }
  | {
      readonly ok: false;
      readonly eventCount: number;
      readonly brokenAtIndex: number;
      readonly brokenEventId: string;
      readonly reason: VerifyFailureReason;
      readonly expected?: string;
      readonly actual?: string;
    };

export type VerifyFailureReason =
  | 'genesis-mismatch'
  | 'prev-link-mismatch'
  | 'record-hash-mismatch';

export async function verifyChain(
  store: ChainStore,
  tenantId: TenantId,
): Promise<VerifyResult> {
  const events = await store.readByTenant(tenantId);

  let expectedPrev: Sha256Hex = GENESIS_HASH;

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!; // safe: bounded by events.length

    // Check chain link.
    if (event.prevEventHash !== expectedPrev) {
      return {
        ok: false,
        eventCount: events.length,
        brokenAtIndex: i,
        brokenEventId: event.eventId,
        reason: i === 0 ? 'genesis-mismatch' : 'prev-link-mismatch',
        expected: expectedPrev,
        actual: event.prevEventHash,
      };
    }

    // Recompute the record hash and compare to the stored one.
    const expectedRecordHash = hashAuditRecord({
      ...event,
      recordHash: '' as Sha256Hex, // unused by hashAuditRecord; kept for type shape
    });
    if (event.recordHash !== expectedRecordHash) {
      return {
        ok: false,
        eventCount: events.length,
        brokenAtIndex: i,
        brokenEventId: event.eventId,
        reason: 'record-hash-mismatch',
        expected: expectedRecordHash,
        actual: event.recordHash,
      };
    }

    expectedPrev = event.recordHash;
  }

  return { ok: true, eventCount: events.length };
}
