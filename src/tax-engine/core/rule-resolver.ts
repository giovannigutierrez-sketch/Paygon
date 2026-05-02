// Effective-date-aware rule resolution.
//
// Rule data is JSON, immutable per `ruleSetVersion`. The engine selects the
// rule set whose `effectiveFrom..effectiveUntil` window contains the
// calculation's effective date. Rule sets are loaded lazily on first use and
// cached forever in process — they are immutable by contract.
//
// Adding a new jurisdiction is a data change: drop a JSON file under
// `rules/<jurisdiction>/<period>.json` and register it in the manifest below.
// No code in calculate.ts changes.

import federal2026 from '../rules/federal/2026.json' with { type: 'json' };

import type { FederalRuleSet } from './rule-types.js';

interface RuleSetWindow<T> {
  readonly ruleSetVersion: string;
  readonly effectiveFrom: string;        // 'YYYY-MM-DD' inclusive
  readonly effectiveUntil: string | null; // 'YYYY-MM-DD' exclusive, or null = open-ended
  readonly data: T;
}

// The federal manifest. Each entry is one effective-date window.
// Future years go in by adding a new JSON file and an entry here — no other code
// in the engine knows the year.
const FEDERAL_RULE_SETS: ReadonlyArray<RuleSetWindow<FederalRuleSet>> = Object.freeze([
  Object.freeze({
    ruleSetVersion: federal2026.ruleSetVersion,
    effectiveFrom: federal2026.effectiveFrom,
    effectiveUntil: federal2026.effectiveUntil,
    data: federal2026 as unknown as FederalRuleSet,
  }),
]);

export function resolveFederalRuleSet(effectiveDate: string): {
  readonly ruleSetVersion: string;
  readonly data: FederalRuleSet;
} {
  for (const window of FEDERAL_RULE_SETS) {
    if (effectiveDate < window.effectiveFrom) continue;
    if (window.effectiveUntil !== null && effectiveDate >= window.effectiveUntil) continue;
    return { ruleSetVersion: window.ruleSetVersion, data: window.data };
  }
  throw new Error(
    `No federal tax rule set covers effective date ${effectiveDate}. ` +
      `Available windows: ${FEDERAL_RULE_SETS.map(
        (w) => `${w.ruleSetVersion} [${w.effectiveFrom}..${w.effectiveUntil ?? 'open'})`,
      ).join(', ')}`,
  );
}
