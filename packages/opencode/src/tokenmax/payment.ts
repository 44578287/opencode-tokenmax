export * as TokenMaxPayment from "./payment"

// R1 -- Native Resource Core (docs/TOKENMAX-ROADMAP.md), Architecture
// §"Billing classification". This is the PAYMENT MODEL of a resource --
// how it's paid for -- which is a DIFFERENT axis from billing.ts's price
// TIER (free/economy/standard/premium, "how expensive per token"). Both are
// useful and both live on a Resource:
//
//   billing.ts Class : how expensive per token   (free/economy/standard/premium)
//   payment.ts Model : how it's paid for         (see Model below)
//
// The load-bearing distinction the Architecture doc calls out:
// SUBSCRIPTION_QUOTA != PAYG_TOKEN. A subscription (Claude Pro/Max,
// ChatGPT, ...) is already paid for -- using it burns quota (an
// opportunity cost) but adds no NEW cash cost, whereas PAYG_TOKEN adds
// real cash per call. Getting this wrong is exactly how a router ends up
// needlessly avoiding resources the user already paid for, or needlessly
// favoring soon-to-expire subscription quota over a trivial PAYG call.
// This slice only CLASSIFIES; R3's utility routing (B5) is what will
// actually treat subscription-quota cash cost as ~0.

export type Model =
  | "free"
  | "subscription_quota"
  | "promotional_credit"
  | "local"
  | "payg_token"
  | "unknown"

export interface Cost {
  readonly input: number
  readonly output: number
}

export interface ClassifyInput {
  readonly cost: Cost
  /** Whether the resource is actually connected. Catalog-only resources have no known payment model. */
  readonly connected: boolean
  /**
   * The credential type the connected provider authenticates with, from
   * Auth.Service ("oauth" | "api" | "wellknown"), or undefined if the
   * provider is connected without stored credentials (e.g. a purely
   * env-configured or local provider).
   */
  readonly authType?: "oauth" | "api" | "wellknown"
  /** The provider's baseURL, if any -- used only to detect a local endpoint. */
  readonly baseURL?: string
}

function isFree(cost: Cost): boolean {
  return cost.input === 0 && cost.output === 0
}

// A local endpoint: loopback host, or a 0.0.0.0 bind. Deliberately
// conservative -- only addresses that are unambiguously local, never a
// heuristic on the provider name (which a later slice with real provider
// metadata could add).
function isLocalBaseURL(baseURL: string | undefined): boolean {
  if (!baseURL) return false
  let host: string
  try {
    // WHATWG URL returns an IPv6 hostname bracketed ("[::1]") -- normalize.
    host = new URL(baseURL).hostname.toLowerCase().replace(/^\[|\]$/g, "")
  } catch {
    return false
  }
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1"
}

/**
 * Classify how a resource is paid for, from what R1 can honestly observe:
 * its cost, whether it's connected, its auth credential type, and its
 * endpoint. `promotional_credit` is never emitted -- there is no reliable
 * signal for it yet (some providers grant free credits with no marker), so
 * inventing it would be dishonest; such resources fall through to
 * `payg_token` or `unknown` until a real signal exists.
 */
export function classify(input: ClassifyInput): Model {
  // Catalog-only: we don't know how the user would end up paying for a
  // resource they haven't connected. A $0 model is free regardless; anything
  // else is unknown until connected.
  if (!input.connected) return isFree(input.cost) ? "free" : "unknown"

  // A local endpoint is local regardless of any nominal per-token cost --
  // the compute is the user's own machine, not a billed remote call.
  if (isLocalBaseURL(input.baseURL)) return "local"

  if (isFree(input.cost)) return "free"

  // oauth == authenticated via a subscription-style login: the cash was
  // already paid, per-token figures are the PAYG-equivalent rate, not new
  // cash cost. api/wellknown keys are billed per token == real PAYG.
  if (input.authType === "oauth") return "subscription_quota"
  if (input.authType === "api" || input.authType === "wellknown") return "payg_token"

  // Connected, non-free, non-local, but no stored credential type to
  // distinguish subscription from PAYG (e.g. a bare env-configured key we
  // can't inspect). Honest: unknown, not a guessed PAYG.
  return "unknown"
}
