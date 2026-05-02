// ReplayConnector contract.
//
// A connector is the bridge between Paygon's audit chain and a client's
// source-of-truth system (HRIS, payroll provider, accounting package, etc.).
// During replay, the audit subsystem hands the connector the recorded
// sourceRecordIdHash and asks "fetch all candidate records that could have
// been the one this event recorded". The connector calls the source system,
// returns whatever candidates it can find, and the replay primitive then
// canonicalizes + hashes them against the event's beforeHash / afterHash.
//
// Why "candidates" rather than "the record"? Because the connector cannot
// resolve sourceRecordIdHash back to a plaintext source-record id — the
// salted hash is not invertible. The connector's job is to enumerate the
// records it knows about, hash each one's id under the same per-tenant salt,
// and surface the ones whose hashes match. In M3 the in-memory connector
// does this exhaustively over its own state. Real connectors (ADP,
// QuickBooks, etc.) will cache the hash<->record mapping at fetch-from-
// source time so they don't have to re-hash the entire universe each time.
//
// The contract:
//   - connectorId is a stable string used by SourceRef.connectorId. Every
//     event records which connector it came from.
//   - fetchCandidates returns a frozen ReadonlyArray. The replay primitive
//     never mutates it; the connector should treat its return value as
//     immutable from the caller's perspective.
//   - The connector MUST NOT log candidate payloads or raw sourceRecordIds.
//     (Plaintext source-record ids may themselves be PII per ADR 0001.)
//   - The fetchedAt argument is the timestamp the audit subsystem is
//     replaying for; connectors that support time-travel (point-in-time
//     queries) should honor it. M3's in-memory connector ignores it (it
//     only knows the current state).

import type { Sha256Hex } from '../events/types.js';
import type { ReplayCandidate } from './replay-event.js';

export interface FetchCandidatesArgs {
  // The hash of the source record's id, under the per-tenant salt. Connectors
  // CANNOT invert this; they must enumerate their records and re-hash to find
  // matches. (See connector.ts header for why.)
  readonly sourceRecordIdHash: Sha256Hex;
  // ISO 8601 timestamp the replay is targeting. Connectors that support
  // historical snapshots should query as-of this moment; M3's in-memory
  // connector returns current state and ignores this.
  readonly fetchedAt: string;
}

export interface ReplayConnector {
  // Stable id; matches SourceRef.connectorId on events written via this
  // connector. The replay orchestrator does not check the id (the chain
  // store is the source of truth) — it is exposed for diagnostics and
  // for future routing logic that picks the right connector by id.
  readonly connectorId: string;

  // Return all candidate records whose sourceRecordIdHash matches the
  // requested hash, hashing each candidate's id under the per-tenant salt.
  // Returns an empty array if no candidates match (the source record was
  // deleted, the connector is wired to the wrong tenant, etc.).
  fetchCandidates(args: FetchCandidatesArgs): Promise<ReadonlyArray<ReplayCandidate>>;
}
