// Storage interface for the audit chain. M1 has an in-memory implementation;
// post-M1 the same interface is implemented over Postgres (Drizzle).
//
// The interface is intentionally narrow: append + read by tenant + read by id.
// The verifier and writer compose these primitives; they don't reach past it.

import type { AuditEvent, EventId, TenantId } from '../events/types.js';

export interface ChainStore {
  // Append an event. Throws DuplicateEventIdError if the eventId already exists,
  // ConcurrentChainWriteError if the prevEventHash doesn't match the current
  // tenant chain head.
  append(event: AuditEvent): Promise<void>;

  // Return events for a tenant in occurrence (insertion) order.
  readByTenant(tenantId: TenantId): Promise<ReadonlyArray<AuditEvent>>;

  // Return a single event or undefined.
  readById(eventId: EventId): Promise<AuditEvent | undefined>;

  // Return the current chain head hash for a tenant. Used by the writer to
  // build the next event's prevEventHash. Returns the genesis hash if the
  // tenant has no events yet.
  headHash(tenantId: TenantId): Promise<string>;
}

export class DuplicateEventIdError extends Error {
  constructor(public readonly eventId: EventId) {
    super(`audit event already exists: ${eventId}`);
    this.name = 'DuplicateEventIdError';
  }
}

export class ConcurrentChainWriteError extends Error {
  constructor(
    public readonly tenantId: TenantId,
    public readonly expectedPrev: string,
    public readonly actualHead: string,
  ) {
    super(
      `chain write race for tenant ${tenantId}: ` +
        `expected prev ${expectedPrev}, found head ${actualHead}`,
    );
    this.name = 'ConcurrentChainWriteError';
  }
}
