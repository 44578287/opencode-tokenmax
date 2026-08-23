/**
 * Every timer in this package goes through a `Clock` instead of calling
 * `setTimeout`/`Date.now` directly.
 *
 * Two reasons:
 *  1. Tests need to assert real timeout/backoff behavior (deadlines, drain
 *     grace, adaptive polling) without actually sleeping for seconds — see
 *     `test/support/fake-clock.ts`.
 *  2. It keeps this package free of any Bun-only or Node-only global so it
 *     can run inside either runtime (Bun core, or an Electron/Node host) —
 *     see TOKENMAX regression 3.4 in the master brief: TokenMax code must
 *     not assume a specific runtime.
 *
 * `systemClock` is the default used everywhere in this package; pass a
 * fake clock explicitly to get deterministic tests.
 */

export type TimerHandle = { readonly __timerHandle: unique symbol }

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as TimerHandle,
  clearTimeout: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
}
