// A canonical form is a UTF-8 byte sequence with a deterministic representation
// of a payload, suitable for hashing. Two semantically equivalent payloads must
// produce identical canonical forms regardless of input formatting (e.g., key
// order in objects, source-side whitespace).
export type CanonicalForm = Uint8Array & { readonly __brand: 'CanonicalForm' };

// A canonicalizer takes a payload and produces its canonical form. Different
// schema versions use different canonicalizers; the AuditEvent's payloadSchemaId
// identifies which one was used so the verifier can reproduce the hash.
export type Canonicalizer = (payload: unknown) => CanonicalForm;

// Errors during canonicalization indicate the payload contains values that
// are not allowed (undefined, functions, symbols, BigInt, etc.).
export class CanonicalizationError extends Error {
  constructor(
    message: string,
    public readonly path: ReadonlyArray<string | number>,
  ) {
    super(`${message} at path ${formatPath(path)}`);
    this.name = 'CanonicalizationError';
  }
}

function formatPath(path: ReadonlyArray<string | number>): string {
  if (path.length === 0) return '<root>';
  return path
    .map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`))
    .join('')
    .replace(/^\./, '');
}
