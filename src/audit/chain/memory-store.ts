// In-memory ChainStore for M1. Single process, no persistence across restarts.
// Mostly used by tests; can also drive a single-node dev server.
//
// Concurrency: append() takes an internal per-tenant async lock so two
// concurrent writers can't both compute their prevEventHash from the same head
// and race. The lock is process-local; multi-process deployments require a
// real (Postgres) store with row-level locking.

import type { AuditEvent, EventId, Sha256Hex, TenantId } from '../events/types.js';
import { GENESIS_HASH } from './hashing.js';
import {
  ConcurrentChainWriteError,
  DuplicateEventIdError,
  type ChainStore,
} from './types.js';

export function createInMemoryChainStore(): ChainStore {
  const eventsByTenant = new Map<TenantId, AuditEvent[]>();
  const eventsById = new Map<EventId, AuditEvent>();
  const heads = new Map<TenantId, Sha256Hex>();
  const tenantLocks = new Map<TenantId, Promise<void>>();

  async function withTenantLock<T>(tenantId: TenantId, fn: () => Promise<T>): Promise<T> {
    const prior = tenantLocks.get(tenantId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    tenantLocks.set(tenantId, prior.then(() => next));
    await prior;
    try {
      return await fn();
    } finally {
      release();
      // Cleanup: if no one chained on us in the meantime, drop the entry.
      if (tenantLocks.get(tenantId) === prior.then(() => next)) {
        tenantLocks.delete(tenantId);
      }
    }
  }

  return {
    async append(event: AuditEvent): Promise<void> {
      await withTenantLock(event.tenantId, async () => {
        if (eventsById.has(event.eventId)) {
          throw new DuplicateEventIdError(event.eventId);
        }
        const currentHead = heads.get(event.tenantId) ?? GENESIS_HASH;
        if (event.prevEventHash !== currentHead) {
          throw new ConcurrentChainWriteError(
            event.tenantId,
            event.prevEventHash,
            currentHead,
          );
        }
        const list = eventsByTenant.get(event.tenantId) ?? [];
        list.push(event);
        eventsByTenant.set(event.tenantId, list);
        eventsById.set(event.eventId, event);
        heads.set(event.tenantId, event.recordHash);
      });
    },

    async readByTenant(tenantId: TenantId): Promise<ReadonlyArray<AuditEvent>> {
      const list = eventsByTenant.get(tenantId) ?? [];
      return list.slice();
    },

    async readById(eventId: EventId): Promise<AuditEvent | undefined> {
      return eventsById.get(eventId);
    },

    async headHash(tenantId: TenantId): Promise<string> {
      return heads.get(tenantId) ?? GENESIS_HASH;
    },
  };
}
