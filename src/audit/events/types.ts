// Audit event types — see docs/adr/0002-audit-trail-references-only.md.
// M1 limitation: hashes use a global dev salt, not a per-tenant salt.
// M2 introduces per-tenant KMS-backed salts.

export type Sha256Hex = string & { readonly __brand: 'Sha256Hex' };
export type TenantId = string & { readonly __brand: 'TenantId' };
export type SessionId = string & { readonly __brand: 'SessionId' };
export type UserHandle = string & { readonly __brand: 'UserHandle' };
export type OpaqueHandle = string & { readonly __brand: 'OpaqueHandle' };
export type EventId = string & { readonly __brand: 'EventId' };
export type PayloadSchemaId = string & { readonly __brand: 'PayloadSchemaId' };

export const ACTION_VERBS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'AMEND',
  'VOID',
  'APPROVE',
  'SUBMIT',
  'REJECT',
] as const;
export type ActionVerb = (typeof ACTION_VERBS)[number];

export const TARGET_KINDS = [
  'EMPLOYEE_HOURS',
  'PAYROLL_RUN',
  'DEDUCTION',
  'EARNING',
  'GARNISHMENT',
  'TAX_CALCULATION',
  'CLIENT_CONFIG',
] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

// Identifies where to fetch source data for replay. The source_record_id is
// stored as a hash (HMAC under the per-tenant salt in M2; under the dev salt
// in M1) to prevent leaking client-source IDs that may themselves be PII.
export interface SourceRef {
  readonly connectorId: string;
  readonly sourceRecordIdHash: Sha256Hex;
  readonly fetchedAt: string; // ISO 8601 with timezone
}

// Caller-supplied input. Payloads are unknown values that the canonicalizer
// will reject if they contain undefined, functions, symbols, or BigInt.
export interface AuditEventInput {
  readonly tenantId: TenantId;
  readonly sessionId: SessionId;
  readonly actor: UserHandle;
  readonly actionVerb: ActionVerb;
  readonly targetKind: TargetKind;
  readonly targetHandle: OpaqueHandle;
  readonly payloadSchemaId: PayloadSchemaId;
  readonly beforePayload: unknown; // null permitted (CREATE)
  readonly afterPayload: unknown;  // null permitted (DELETE)
  readonly sourceRef: SourceRef;
}

// Persisted form. The chain is hash-linked per tenant via prevEventHash.
// The first event in a tenant's chain has prevEventHash === GENESIS_HASH.
export interface AuditEvent {
  readonly eventId: EventId;
  readonly tenantId: TenantId;
  readonly sessionId: SessionId;
  readonly actor: UserHandle;
  readonly actionVerb: ActionVerb;
  readonly targetKind: TargetKind;
  readonly targetHandle: OpaqueHandle;
  readonly occurredAt: string; // ISO 8601 with timezone, microsecond precision when available
  readonly schemaVersion: string; // event-record schema version, semver
  readonly payloadSchemaId: PayloadSchemaId;
  readonly beforeHash: Sha256Hex | null; // null when beforePayload was null
  readonly afterHash: Sha256Hex | null;  // null when afterPayload was null
  readonly sourceRef: SourceRef;
  readonly prevEventHash: Sha256Hex;
  readonly recordHash: Sha256Hex; // hash of this entire record (used as next event's prevEventHash)
}

export const EVENT_SCHEMA_VERSION = '1.0.0';

// GENESIS_HASH (the prevEventHash of every chain's first event) is computed
// in chain/hashing.ts to avoid hardcoding a fake constant here.
