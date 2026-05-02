// In-memory ReplayConnector for M3 development and tests.
//
// Stores records as { sourceRecordId, payload } and, on fetchCandidates,
// hashes each stored record's sourceRecordId under the connector's tenant
// salt and returns the records whose hash matches the requested
// sourceRecordIdHash.
//
// A connector instance is wired to ONE tenant — that's a deliberate
// constraint. Connectors in the real world are tenant-scoped credentials +
// configuration, and the salt-per-tenant design means a connector cannot
// usefully hash sourceRecordIds for any tenant other than its own. Tests
// that want to simulate "wrong tenant" use this property by building a
// connector for tenant A and asking to replay an event from tenant B.
//
// Test affordances (add / update / delete) live on the returned object so
// integration tests can simulate source-side mutation between event-write
// time and replay time. Production connectors do not get these — they are
// driven by their actual source system.
//
// Hard rules carried from M2:
//   - Plaintext sourceRecordIds and payloads are not logged here.
//   - The connector hashes ids on demand via hashSourceRecordId() — it does
//     not cache the salt or the hashes. A KMS adapter would cache, but we
//     do not need that complexity in-memory.

import type { Sha256Hex, TenantId } from '../events/types.js';
import { hashSourceRecordId, type KeyVault } from '../salt/key-vault.js';
import type { FetchCandidatesArgs, ReplayConnector } from './connector.js';
import type { ReplayCandidate } from './replay-event.js';

export interface InMemoryConnectorRecord {
  readonly sourceRecordId: string;
  readonly payload: unknown;
}

export interface InMemoryReplayConnector extends ReplayConnector {
  // Add a record to the connector's universe. Idempotent on sourceRecordId
  // (a second add with the same id replaces the prior payload — same as
  // calling update()).
  add(record: InMemoryConnectorRecord): void;
  // Replace the payload for an existing sourceRecordId. Throws if no record
  // exists with that id — callers should use add() for new records.
  update(sourceRecordId: string, payload: unknown): void;
  // Remove a record from the connector's universe. No-op if the record does
  // not exist (matches the semantics of source systems where a delete that
  // races with a gone record should not blow up).
  delete(sourceRecordId: string): void;
}

const DEFAULT_CONNECTOR_ID = 'in-memory-test-connector';

export interface InMemoryReplayConnectorOptions {
  readonly connectorId?: string;
  readonly initial?: ReadonlyArray<InMemoryConnectorRecord>;
}

export function createInMemoryReplayConnector(
  tenantId: TenantId,
  keyVault: KeyVault,
  options: InMemoryReplayConnectorOptions = {},
): InMemoryReplayConnector {
  const connectorId = options.connectorId ?? DEFAULT_CONNECTOR_ID;
  const records = new Map<string, unknown>();

  if (options.initial) {
    for (const record of options.initial) {
      records.set(record.sourceRecordId, record.payload);
    }
  }

  return {
    connectorId,

    async fetchCandidates(args: FetchCandidatesArgs): Promise<ReadonlyArray<ReplayCandidate>> {
      // Snapshot the records map before hashing — protects against
      // concurrent add/update/delete while the async hash work runs.
      const snapshot: InMemoryConnectorRecord[] = [];
      for (const [sourceRecordId, payload] of records) {
        snapshot.push({ sourceRecordId, payload });
      }

      // The fetchedAt arg is intentionally unused — this connector only
      // knows the current state. Real connectors that support historical
      // snapshots would honor it.
      void args.fetchedAt;

      const matches: ReplayCandidate[] = [];
      for (const record of snapshot) {
        const idHash: Sha256Hex = await hashSourceRecordId(
          keyVault,
          tenantId,
          record.sourceRecordId,
        );
        if (idHash === args.sourceRecordIdHash) {
          matches.push(
            Object.freeze({
              sourceRecordId: record.sourceRecordId,
              payload: record.payload,
            }),
          );
        }
      }
      return Object.freeze(matches);
    },

    add(record: InMemoryConnectorRecord): void {
      records.set(record.sourceRecordId, record.payload);
    },

    update(sourceRecordId: string, payload: unknown): void {
      if (!records.has(sourceRecordId)) {
        throw new Error(
          `in-memory connector: cannot update unknown sourceRecordId ${sourceRecordId}`,
        );
      }
      records.set(sourceRecordId, payload);
    },

    delete(sourceRecordId: string): void {
      records.delete(sourceRecordId);
    },
  };
}
