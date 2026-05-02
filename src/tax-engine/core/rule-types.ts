// Type shape of the JSON rule files.
//
// These types describe the on-disk JSON exactly. Numeric fields are strings
// because (a) JSON has no Decimal type and (b) IEEE-754 round-tripping (e.g.
// 0.062 -> 0.06199999999999...) would silently corrupt cents at scale. The
// rule resolver hands these strings to `decimal.js` constructors.
//
// Schema changes require an ADR (per tax-rules-engineer.md). To bump the
// schema, branch the type and version the JSON files; do not mutate this in
// place.

import type { FilingStatus } from '../calculate.js';

export interface FederalFitBracket {
  readonly atLeast: string;       // annual taxable wages, lower bound (inclusive)
  readonly lessThan: string;      // annual taxable wages, upper bound (exclusive); 'Infinity' for top
  readonly tentativeTax: string;  // base tax at the lower bound
  readonly rate: string;          // marginal rate (e.g., "0.22")
  readonly ofExcessOver: string;  // annual taxable wages threshold the rate applies above
}

export type FederalFitTable = Readonly<Record<FilingStatus, ReadonlyArray<FederalFitBracket>>>;

export interface FederalFitRules {
  readonly method: string;
  readonly schedules: {
    readonly standard: FederalFitTable;
    readonly step2Checkbox: FederalFitTable;
  };
}

export interface FederalFicaRules {
  readonly socialSecurity: { readonly rate: string; readonly wageBase: string };
  readonly medicare: { readonly rate: string };
  readonly additionalMedicare: { readonly rate: string; readonly thresholdYTD: string };
}

export interface FederalFutaRules {
  readonly grossRate: string;
  readonly stateCredit: string;
  readonly wageBase: string;
}

export interface FederalRuleSet {
  readonly ruleSetVersion: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly source: string;
  readonly fica: FederalFicaRules;
  readonly futa: FederalFutaRules;
  readonly fit: FederalFitRules;
}
