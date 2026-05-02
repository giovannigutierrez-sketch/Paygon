// Replay orchestrator: fetch candidates from a connector, then delegate to
// replayEvent for the canonicalize-and-match.
//
// The orchestrator's only job is plumbing — it keeps the replay primitive
// pure (no connector dependency) so that it can be tested without a
// connector and so that callers who already have candidates in hand
// (re-running replay against an already-fetched candidate set, for example)
// can call replayEvent directly.
//
// Failure modes:
//   - Event not found -> EventNotFoundError (from replayEvent).
//   - Connector cannot reach source -> bubbles up the connector's error.
//     Replay does not swallow connector failures; the caller needs to know
//     the difference between "source returned no matches" and "source is
//     down". The chain itself remains valid in both cases.
//   - Source no longer has the record -> ReplayResult with missing sides.
//     This is reportable, not exceptional.

import type { ChainStore } from '../chain/types.js';
import type { EventId } from '../events/types.js';
import type { KeyVault } from '../salt/key-vault.js';
import type { ReplayConnector } from './connector.js';
import {
  EventNotFoundError,
  replayEvent,
  type ReplayResult,
} from './replay-event.js';

export interface ReplayWithConnectorArgs {
  readonly chainStore: ChainStore;
  readonly keyVault: KeyVault;
  readonly connector: ReplayConnector;
  readonly eventId: EventId;
}

export async function replayWithConnector(
  args: ReplayWithConnectorArgs,
): Promise<ReplayResult> {
  const { chainStore, keyVault, connector, eventId } = args;

  // Look up the event first so we have the sourceRecordIdHash + fetchedAt
  // to hand the connector. EventNotFoundError surfaces here so the caller
  // doesn't waste a connector round-trip on a bad id.
  const event = await chainStore.readById(eventId);
  if (!event) {
    throw new EventNotFoundError(eventId);
  }

  const candidates = await connector.fetchCandidates({
    sourceRecordIdHash: event.sourceRef.sourceRecordIdHash,
    fetchedAt: event.sourceRef.fetchedAt,
  });

  return replayEvent({
    chainStore,
    keyVault,
    eventId,
    candidates,
  });
}
