// Replay primitive — given an audit event id and a list of candidate source
// records, confirm which candidate(s) match the event's beforeHash / afterHash.
//
// This is the canonicalize-and-match core of ADR 0002's replay protocol. It
// is intentionally pure: it reads from the chain store and key vault, runs
// the canonicalizer, and returns matches by source-record-id ONLY. It never
// returns the candidate's payload — the caller already has it; replay just
// confirms which of the candidates' payloads are the ones the event recorded.
//
// Hard invariants (carried forward from M1 + M2):
//   - Payloads do not leak through the return value.
//   - Payloads are not logged.
//   - Hashes are HMAC-SHA-256 keyed by the per-tenant salt loaded from the
//     KeyVault — same key that the writer used.
//   - The replay function must NOT throw on drift / deletion / wrong tenant —
//     those are reportable outcomes, not exceptions. The only exception is a
//     missing event id (the caller's reference is wrong; there is nothing to
//     replay).
//
// The function attempts to filter candidates by sourceRecordIdHash before
// hashing payloads. That is a defense-in-depth check, not a correctness one:
//   - it confirms we are replaying against the right tenant + the right
//     source record set (a wrong-tenant connector will hash sourceRecordIds
//     under the wrong salt and yield zero matches);
//   - it short-circuits payload work when no candidate could ever match
//     (e.g., the connector returned an unrelated record set).
//
// If the source-id-hash filter rejects every candidate, replay returns the
// "unattributable" result: an empty matches list and a missing list naming
// every side the event had a hash for.

import type { ChainStore } from '../chain/types.js';
import { hmacSha256Hex } from '../chain/hashing.js';
import { canonicalV1, PAYLOAD_SCHEMA_ID_V1 } from '../canonical/canonical-v1.js';
import type { EventId, Sha256Hex } from '../events/types.js';
import { hashSourceRecordId, type KeyVault } from '../salt/key-vault.js';

export type ReplaySide = 'before' | 'after';

export interface ReplayCandidate {
  // The source record's ID, NOT yet hashed. Caller hands raw IDs from the
  // source system; replayEvent hashes them internally under the tenant salt
  // and discards the plaintext.
  readonly sourceRecordId: string;
  // The full record payload as the source system returns it. Canonicalized
  // and hashed under the tenant salt; never logged, never returned.
  readonly payload: unknown;
}

export interface ReplayMatch {
  // The raw source-record id of the candidate that matched. (The caller
  // supplied it; we are echoing back which one it was.)
  readonly candidateSourceRecordId: string;
  // Which side of the event this candidate matched. 'both' means the
  // candidate's payload hashed identically to both beforeHash and afterHash —
  // unusual, only possible for no-op events whose beforePayload === afterPayload.
  readonly matched: ReplaySide | 'both';
}

export interface ReplayResult {
  readonly eventId: EventId;
  // Matches against the event's beforeHash and/or afterHash. Empty if no
  // candidate could be attributed to this event.
  readonly matches: ReadonlyArray<ReplayMatch>;
  // Drift indicator: which sides the event had a non-null hash for that no
  // candidate matched. Sorted ['before', 'after'] for stable output.
  readonly missing: ReadonlyArray<ReplaySide>;
}

export class EventNotFoundError extends Error {
  constructor(public readonly eventId: EventId) {
    super(`audit event not found: ${eventId}`);
    this.name = 'EventNotFoundError';
  }
}

export interface ReplayEventArgs {
  readonly chainStore: ChainStore;
  readonly keyVault: KeyVault;
  readonly eventId: EventId;
  readonly candidates: ReadonlyArray<ReplayCandidate>;
}

export async function replayEvent(args: ReplayEventArgs): Promise<ReplayResult> {
  const { chainStore, keyVault, eventId, candidates } = args;

  const event = await chainStore.readById(eventId);
  if (!event) {
    throw new EventNotFoundError(eventId);
  }

  // M3 only supports canonical-v1 payloads. If a future event was written
  // under a different schema id, replay must use that canonicalizer — fail
  // loudly rather than silently mishash.
  if (event.payloadSchemaId !== PAYLOAD_SCHEMA_ID_V1) {
    throw new Error(
      `replay does not yet support payloadSchemaId ${event.payloadSchemaId}; ` +
        `only ${PAYLOAD_SCHEMA_ID_V1} is implemented`,
    );
  }

  // Sides that the event has a hash for. If beforeHash is null (CREATE), we
  // do not consider 'before' missing — there was nothing to match.
  const sidesWithHash: ReplaySide[] = [];
  if (event.beforeHash !== null) sidesWithHash.push('before');
  if (event.afterHash !== null) sidesWithHash.push('after');

  // Filter candidates to those whose sourceRecordId hashes to the event's
  // recorded sourceRecordIdHash. This is the per-tenant salt check — wrong
  // tenant -> wrong salt -> zero matches.
  const expectedSourceIdHash = event.sourceRef.sourceRecordIdHash;
  const filteredCandidates: ReplayCandidate[] = [];
  for (const candidate of candidates) {
    const candidateIdHash = await hashSourceRecordId(
      keyVault,
      event.tenantId,
      candidate.sourceRecordId,
    );
    if (candidateIdHash === expectedSourceIdHash) {
      filteredCandidates.push(candidate);
    }
  }

  if (filteredCandidates.length === 0) {
    // Unattributable: no candidate matches the source-record-id filter.
    // Every side the event had a hash for is missing.
    return Object.freeze({
      eventId,
      matches: Object.freeze([]),
      missing: Object.freeze([...sidesWithHash]),
    });
  }

  // Hash each filtered candidate's payload and compare against beforeHash /
  // afterHash. Track per-side matches so we can compute "missing".
  const tenantSalt = await keyVault.getTenantSalt(event.tenantId);
  const matches: ReplayMatch[] = [];
  const matchedSides = new Set<ReplaySide>();

  for (const candidate of filteredCandidates) {
    let candidateHash: Sha256Hex;
    try {
      candidateHash = hmacSha256Hex(tenantSalt, canonicalV1(candidate.payload));
    } catch {
      // The candidate payload couldn't be canonicalized (e.g., contains
      // undefined / BigInt / function). It cannot match either hash; skip.
      // We swallow the error rather than surface it because some connectors
      // are not strict about JSON shape, and one bad record should not
      // poison the whole replay.
      continue;
    }

    const matchesBefore =
      event.beforeHash !== null && candidateHash === event.beforeHash;
    const matchesAfter =
      event.afterHash !== null && candidateHash === event.afterHash;

    if (matchesBefore && matchesAfter) {
      matches.push(
        Object.freeze({
          candidateSourceRecordId: candidate.sourceRecordId,
          matched: 'both' as const,
        }),
      );
      matchedSides.add('before');
      matchedSides.add('after');
    } else if (matchesBefore) {
      matches.push(
        Object.freeze({
          candidateSourceRecordId: candidate.sourceRecordId,
          matched: 'before' as const,
        }),
      );
      matchedSides.add('before');
    } else if (matchesAfter) {
      matches.push(
        Object.freeze({
          candidateSourceRecordId: candidate.sourceRecordId,
          matched: 'after' as const,
        }),
      );
      matchedSides.add('after');
    }
    // If neither side matched, this candidate has drifted; it does not
    // appear in matches and contributes nothing to matchedSides.
  }

  const missing = sidesWithHash.filter((side) => !matchedSides.has(side));

  return Object.freeze({
    eventId,
    matches: Object.freeze(matches),
    missing: Object.freeze(missing),
  });
}
