export * as TokenMaxBilling from "./billing"

// R1 — Native Resource Core (docs/TOKENMAX-ROADMAP.md). Billing CLASSES are
// new TokenMax metadata layered on top of the raw per-token cost figures
// Provider.Model already carries (packages/opencode/src/provider/provider.ts
// `ProviderCost`) -- this module does not compute cost, it only categorizes
// cost that's already known, so later phases (R2's router, R3's scheduler)
// can reason about "cheap vs premium" without re-deriving thresholds
// themselves.

export type Class = "free" | "economy" | "standard" | "premium"

export interface Thresholds {
  /** Inclusive upper bound, $ per 1M tokens, blended input+output. Below or equal to this is "economy". */
  readonly economyMaxPerMTok: number
  /** Inclusive upper bound, $ per 1M tokens, blended input+output. Below or equal to this (and above economy) is "standard". Above this is "premium". */
  readonly standardMaxPerMTok: number
}

// Defaults are deliberately conservative placeholders, not a pricing
// authority -- real thresholds belong in policy (see policy.ts), which can
// override these per project/user without a code change.
export const defaultThresholds: Thresholds = {
  economyMaxPerMTok: 1,
  standardMaxPerMTok: 8,
}

export interface Cost {
  readonly input: number
  readonly output: number
}

// Blended cost per 1M tokens, weighting input and output equally -- a
// single comparable number for classification. This is intentionally not
// "expected cost for a real session" (that would need actual token-mix
// data, which R1 doesn't have yet); it's a stable ordering key.
export function blendedPerMTok(cost: Cost): number {
  return ((cost.input + cost.output) / 2) * 1_000_000
}

export function classify(cost: Cost, thresholds: Thresholds = defaultThresholds): Class {
  if (cost.input === 0 && cost.output === 0) return "free"
  const blended = blendedPerMTok(cost)
  if (blended <= thresholds.economyMaxPerMTok) return "economy"
  if (blended <= thresholds.standardMaxPerMTok) return "standard"
  return "premium"
}
