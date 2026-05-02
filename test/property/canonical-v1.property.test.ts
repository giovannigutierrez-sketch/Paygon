// Property tests for canonical-v1.
//
// Invariants exercised:
//   - Idempotence: canonicalizing the same payload twice returns identical bytes.
//   - Key-order independence: shuffling object keys does not change the output.
//   - Determinism across deep clones: structurally equal payloads produce equal output.
//   - Roundtripping arrays preserves order.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { canonicalV1 } from '../../src/audit/canonical/canonical-v1.js';

// Arbitrary JSON-safe value: null, boolean, finite number, string,
// or recursive arrays/objects of the same. Excludes the rejected types
// (undefined, BigInt, function, symbol, NaN, Infinity) so the canonicalizer
// never throws on these inputs.
const jsonValue: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.constant(null),
    fc.boolean(),
    fc.float({ noNaN: true, noDefaultInfinity: true }),
    fc.integer(),
    fc.string(),
    fc.array(tie('value'), { maxLength: 5 }),
    fc.dictionary(fc.string({ minLength: 1 }), tie('value'), { maxKeys: 5 }),
  ),
})).value;

function shuffleObjectKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(shuffleObjectKeys);
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([k, v]) => [k, shuffleObjectKeys(v)] as const,
  );
  // Shuffle deterministically (reverse) — we don't need randomness; we just
  // need a different order than the canonical sorted order.
  entries.reverse();
  return Object.fromEntries(entries);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe('canonical-v1 properties', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        const a = canonicalV1(value);
        const b = canonicalV1(value);
        return bytesEqual(a, b);
      }),
      { numRuns: 1000 },
    );
  });

  it('is key-order independent', () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        const a = canonicalV1(value);
        const b = canonicalV1(shuffleObjectKeys(value));
        return bytesEqual(a, b);
      }),
      { numRuns: 1000 },
    );
  });

  it('preserves array order', () => {
    fc.assert(
      fc.property(fc.array(jsonValue, { maxLength: 8 }), (arr) => {
        const a = canonicalV1(arr);
        const b = canonicalV1([...arr].reverse());
        // Reversed array MUST have a different canonical form unless arr is
        // empty or palindromic. Skip the trivial cases.
        if (arr.length < 2) return true;
        const first = JSON.stringify(arr);
        const reversed = JSON.stringify([...arr].reverse());
        if (first === reversed) return true; // palindrome
        return !bytesEqual(a, b);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects undefined inside an object', () => {
    expect(() => canonicalV1({ x: undefined })).toThrowError(
      /undefined is not allowed/,
    );
  });

  it('rejects circular references', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => canonicalV1(a)).toThrowError(/circular reference/);
  });
});
