// Canonical-v1: the first canonicalization schema for Paygon audit payloads.
//
// Rules:
//   1. Allowed JSON types: null, boolean, number (finite only), string, array, object
//   2. Object keys are sorted lexicographically (recursively)
//   3. Numbers are rendered as JSON.stringify produces (no trailing zeros, lowercase exponent)
//   4. Strings are emitted in JSON-escaped form
//   5. Arrays preserve their input order
//   6. Output is UTF-8 encoded with no extraneous whitespace
//
// Rejected:
//   - undefined (not a JSON value; ambiguous semantics)
//   - functions, symbols (not data)
//   - BigInt (no canonical JSON representation; use a string if needed)
//   - NaN, Infinity, -Infinity (no JSON representation)
//   - circular references (would cause infinite recursion)
//
// Future schemas (canonical-v2, etc.) will be added side-by-side; we never
// modify a published canonicalizer because that would invalidate every event
// hashed under the old version.

import { CanonicalizationError, type CanonicalForm, type Canonicalizer } from './types.js';

const PAYLOAD_SCHEMA_ID_V1 = 'canonical.v1';

export const canonicalV1: Canonicalizer = (payload: unknown): CanonicalForm => {
  const seen = new WeakSet<object>();
  const json = stringify(payload, [], seen);
  return new TextEncoder().encode(json) as CanonicalForm;
};

export { PAYLOAD_SCHEMA_ID_V1 };

function stringify(
  value: unknown,
  path: ReadonlyArray<string | number>,
  seen: WeakSet<object>,
): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';

    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(
          `non-finite number ${String(value)} cannot be canonicalized`,
          path,
        );
      }
      return JSON.stringify(value);

    case 'string':
      return JSON.stringify(value);

    case 'undefined':
      throw new CanonicalizationError('undefined is not allowed', path);

    case 'bigint':
      throw new CanonicalizationError(
        'BigInt is not allowed; encode as a string if you need it',
        path,
      );

    case 'function':
      throw new CanonicalizationError('functions are not allowed', path);

    case 'symbol':
      throw new CanonicalizationError('symbols are not allowed', path);

    case 'object': {
      // typeof null === 'object' is handled above
      if (seen.has(value as object)) {
        throw new CanonicalizationError('circular reference', path);
      }
      seen.add(value as object);

      try {
        if (Array.isArray(value)) {
          const parts = value.map((item, i) => stringify(item, [...path, i], seen));
          return '[' + parts.join(',') + ']';
        }

        // Plain object: sort keys lexicographically (recursive on values).
        const keys = Object.keys(value as Record<string, unknown>).sort();
        const parts = keys.map((k) => {
          const v = (value as Record<string, unknown>)[k];
          return JSON.stringify(k) + ':' + stringify(v, [...path, k], seen);
        });
        return '{' + parts.join(',') + '}';
      } finally {
        seen.delete(value as object);
      }
    }

    default: {
      // Exhaustiveness guard for future JS additions.
      throw new CanonicalizationError(
        `unsupported type ${typeof value}`,
        path,
      );
    }
  }
}
