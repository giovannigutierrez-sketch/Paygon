// Calculation trace primitives.
//
// The trace records what happened during a calculation in a form the audit-trail
// engineer can hash. By design it contains:
//   - step name (human-readable)
//   - inputs (decimal-as-string, never raw Decimal — JSON-friendly + reproducible)
//   - output (decimal-as-string)
//
// And it never contains:
//   - employee names, SSNs, employer names, EINs, addresses (no PII)
//   - timestamps (no wall-clock dependence)
//   - random nonces (no nondeterminism)
//
// `payroll-test-author`-driven reproducibility tests will compare traces
// byte-for-byte across runs.

import type { TraceStep } from '../calculate.js';

export class TraceBuilder {
  private readonly steps: TraceStep[] = [];

  add(step: string, inputs: Readonly<Record<string, string>>, output: string): void {
    this.steps.push({
      step,
      inputs: Object.freeze({ ...inputs }),
      output,
    });
  }

  build(): ReadonlyArray<TraceStep> {
    return Object.freeze([...this.steps]);
  }
}
