// Audit event writer.
//
// Flow per emit:
//   1. Canonicalize beforePayload and afterPayload (canonical-v1).
//   2. HMAC-SHA-256 each canonical form under the dev salt to produce
//      beforeHash and afterHash. The plaintext payloads are discarded
//      from this function's locals as soon as their hashes are computed.
//   3. Read the tenant's current chain head; that becomes prevEventHash.
//   4. Construct the AuditEvent shape, compute its recordHash.
//   5. Append to the store, which atomically validates that prevEventHash
//      still matches the head (race detection).
//
// What the writer DOES NOT do:
//   - log payload contents
//   - return payload contents to the caller
//   - persist payload contents anywhere

import { randomUUID } from 'node:crypto';

import type {
  AuditEvent,
  AuditEventInput,
  EventId,
  Sha256Hex,
} from '../events/types.js';
import { EVENT_SCHEMA_VERSION } from '../events/types.js';
import { canonicalV1, PAYLOAD_SCHEMA_ID_V1 } from '../canonical/canonical-v1.js';
import { DEV_SALT } from '../salt/dev-salt.js';
import { hashAuditRecord, hmacSha256Hex } from './hashing.js';
import type { ChainStore } from './types.js';

export interface WriteOptions {
  // Optional override clock; defaults to Date.now(). Used by tests.
  readonly now?: () => Date;
}

export async function writeAuditEvent(
  store: ChainStore,
  input: AuditEventInput,
  options: WriteOptions = {},
): Promise<AuditEvent> {
  if (input.payloadSchemaId !== PAYLOAD_SCHEMA_ID_V1) {
    throw new Error(
      `payloadSchemaId ${input.payloadSchemaId} not supported in M1; only ${PAYLOAD_SCHEMA_ID_V1}`,
    );
  }

  const beforeHash: Sha256Hex | null =
    input.beforePayload === null
      ? null
      : hmacSha256Hex(DEV_SALT, canonicalV1(input.beforePayload));

  const afterHash: Sha256Hex | null =
    input.afterPayload === null
      ? null
      : hmacSha256Hex(DEV_SALT, canonicalV1(input.afterPayload));

  const occurredAt = (options.now?.() ?? new Date()).toISOString();
  const prevEventHash = (await store.headHash(input.tenantId)) as Sha256Hex;
  const eventId = randomUUID() as EventId;

  // hashAuditRecord intentionally does NOT consume recordHash, so we can
  // construct the event in one shot, compute the hash over its other fields,
  // and emit a single frozen final value.
  const fields = {
    eventId,
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    actor: input.actor,
    actionVerb: input.actionVerb,
    targetKind: input.targetKind,
    targetHandle: input.targetHandle,
    occurredAt,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchemaId: input.payloadSchemaId,
    beforeHash,
    afterHash,
    sourceRef: Object.freeze({ ...input.sourceRef }),
    prevEventHash,
  } as const;

  const recordHash = hashAuditRecord({
    ...fields,
    recordHash: '' as Sha256Hex, // unused by hashAuditRecord
  });

  const final: AuditEvent = Object.freeze({ ...fields, recordHash });
  await store.append(final);
  return final;
}
