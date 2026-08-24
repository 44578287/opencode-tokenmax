export * as TokenMaxReliability from "./reliability"

// R3 -- Intelligent Resource Scheduling (docs/TOKENMAX-ROADMAP.md):
// "Capability learning from real outcomes, historical success weighting."
// router.ts's own R2 comment named this out of scope on purpose ("building
// that here would be getting ahead of the roadmap's own ordering") --
// this is that deferred work, now that R2's selection and R2's telemetry
// recording (TokenMaxTelemetry, landed alongside the router) have real
// history to learn from.
//
// Deliberately simple and rule-based, not a learned model: a resource is
// only ever penalized once it has enough recent history to be a real
// signal, never on a single unlucky run, and a resource with NO history
// is treated as fully trusted (cold start -- new/rarely-used resources
// must stay selectable, or they'd never accumulate the history needed to
// prove themselves).

export interface OutcomeSample {
  readonly outcome: "success" | "error"
}

export interface ReliabilityScore {
  readonly successRate: number
  readonly sampleSize: number
}

export interface UnreliableOptions {
  /** Minimum samples before a poor success rate counts as a real signal. Defaults to 3. */
  readonly minSampleSize?: number
  /** Success rate at or below which a resource with enough samples is considered unreliable. Defaults to 0.5. */
  readonly minSuccessRate?: number
}

const DEFAULT_MIN_SAMPLE_SIZE = 3
const DEFAULT_MIN_SUCCESS_RATE = 0.5

/** Score a resource's recent outcome history. An empty history scores as fully trusted (cold start). */
export function score(samples: readonly OutcomeSample[]): ReliabilityScore {
  if (samples.length === 0) return { successRate: 1, sampleSize: 0 }
  const successes = samples.filter((s) => s.outcome === "success").length
  return { successRate: successes / samples.length, sampleSize: samples.length }
}

/** Whether a score's sample size is large enough, and its success rate low enough, to actually distrust the resource. */
export function isUnreliable(resourceScore: ReliabilityScore, options: UnreliableOptions = {}): boolean {
  const minSampleSize = options.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE
  const minSuccessRate = options.minSuccessRate ?? DEFAULT_MIN_SUCCESS_RATE
  if (resourceScore.sampleSize < minSampleSize) return false
  return resourceScore.successRate <= minSuccessRate
}
