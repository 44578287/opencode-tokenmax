export * as TokenMaxAvailability from "./availability"

// R1 -- Native Resource Core (docs/TOKENMAX-ROADMAP.md), Architecture
// §"Availability, separate from capability". Availability is a resource's
// *reachability* state, tracked independently of its capability/cost: an
// auth failure or a 429 changes availability, never capability. A model
// with a high capability score and AVAILABILITY=auth_invalid is still that
// same capable model -- it's just not currently callable.
//
// Honest scope note for this first slice: only two of the states below are
// ever actually emitted yet -- `catalog_only` (known to exist via
// ModelsDev, but not connected) and `provider_listed` (the provider is
// configured/initialized in Provider.Service, so it's listed and
// presumed callable). Reaching `verified_callable` would require a real
// probe call, and `throttled`/`temp_unavailable`/`auth_invalid`/
// `model_not_found` require observing a real failure -- those are populated
// by a later availability-verification slice, not fabricated here. The full
// enum is defined now so the Resource shape and any UI/consumer don't have
// to change when those states start being produced (see
// docs/TOKENMAX-ROADMAP.md's R1 "not yet done").

export type State =
  | "catalog_only"
  | "provider_listed"
  | "verified_callable"
  | "throttled"
  | "temp_unavailable"
  | "auth_invalid"
  | "model_not_found"
  | "stale"
  | "unknown"

/**
 * Whether a resource in this state can currently be dispatched to. Only
 * `provider_listed` and `verified_callable` are callable; a `catalog_only`
 * resource is a suggestion (something the user *could* configure), not a
 * usable resource. The failure/unknown states are all non-callable.
 */
export function isCallable(state: State): boolean {
  return state === "provider_listed" || state === "verified_callable"
}

/**
 * The honest availability of a resource given only what R1 can observe
 * without a live probe: connected (in Provider.Service.list()) => listed
 * and presumed callable; otherwise it's catalog-only.
 */
export function fromConnected(connected: boolean): State {
  return connected ? "provider_listed" : "catalog_only"
}
