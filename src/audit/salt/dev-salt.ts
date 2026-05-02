// M1 dev salt — a process-wide constant used as the HMAC key for hashing
// audit payloads.
//
// LIMITATION: this salt is the same for every tenant. Two tenants with
// identical payloads will produce identical hashes. That is the M1 gap
// documented in ADR 0002 and in audit-trail-engineer.md. Closed in M2 by
// per-tenant KMS-backed salts.
//
// Do not use this for any customer-facing feature.

const DEV_SALT_HEX =
  // 32 bytes of pseudo-randomness, fixed at compile time. Not secret —
  // it's checked into source. The point is to derive a stable HMAC key
  // for development, not to provide security.
  '7e4cb9d62e1f4b4a9a8e3c1d0a7f6e5b8d4c2f1a9e0b6c3d2a1f0e9d8c7b6a5e';

if (!/^[0-9a-f]{64}$/.test(DEV_SALT_HEX)) {
  throw new Error('DEV_SALT_HEX must be 64 lowercase hex characters');
}

export const DEV_SALT: Uint8Array = Uint8Array.from(
  (DEV_SALT_HEX.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
);
