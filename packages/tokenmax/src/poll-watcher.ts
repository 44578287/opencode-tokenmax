/**
 * Adaptive polling watcher — §23 of the master brief (GitHub CI wait).
 *
 * There is no public webhook in the first version, so waiting for a GitHub
 * Actions run (or any other external state with no push channel) has to
 * poll. The rule is that the *model* never participates in that loop —
 * no "sleep 120, check again" turns. Runtime code owns a bounded,
 * backed-off poll loop and hands the model a single Operation to `await()`.
 *
 * Default backoff: 2s / 4s / 8s / 15s / 30s, then holds at 30s, matching
 * §23 exactly. Swap `poll` for any one-shot state check (workflow run
 * status, quota reset, whatever) to reuse this for other §23/§24-shaped
 * waits.
 */

import { type Clock, systemClock, type TimerHandle } from "./clock"

export type PollTick<T> = { readonly done: true; readonly value: T } | { readonly done: false }

export interface PollOptions<T> {
  readonly poll: (attempt: number) => Promise<PollTick<T>>
  /** Backoff schedule in ms. After the last entry, the interval holds steady. Defaults to [2000, 4000, 8000, 15000, 30000]. */
  readonly intervals?: readonly number[]
  readonly maxTotalMs?: number
  readonly signal?: AbortSignal
  readonly clock?: Clock
}

const DEFAULT_INTERVALS = [2000, 4000, 8000, 15000, 30000] as const

export class PollAbortedError extends Error {
  constructor() {
    super("poll watcher aborted")
    this.name = "PollAbortedError"
  }
}

export class PollTimeoutError extends Error {
  constructor(elapsedMs: number) {
    super(`poll watcher exceeded maxTotalMs (elapsed ${elapsedMs}ms)`)
    this.name = "PollTimeoutError"
  }
}

/** Polls `options.poll` on the backoff schedule until it reports `done`, the deadline elapses, or `signal` aborts. */
export function watchUntilDone<T>(options: PollOptions<T>): Promise<T> {
  const clock = options.clock ?? systemClock
  const intervals = options.intervals ?? DEFAULT_INTERVALS
  const startedAt = clock.now()
  const nextInterval = (attempt: number) => intervals[Math.min(attempt, intervals.length - 1)] ?? 30000

  return new Promise((resolve, reject) => {
    let attempt = 0
    let timer: TimerHandle | undefined
    let stopped = false

    const cleanup = () => {
      stopped = true
      if (timer !== undefined) clock.clearTimeout(timer)
      options.signal?.removeEventListener("abort", onAbort)
    }
    const onAbort = () => {
      if (stopped) return
      cleanup()
      reject(new PollAbortedError())
    }
    options.signal?.addEventListener("abort", onAbort)

    const tick = () => {
      if (stopped) return
      if (options.maxTotalMs !== undefined && clock.now() - startedAt >= options.maxTotalMs) {
        const elapsed = clock.now() - startedAt
        cleanup()
        reject(new PollTimeoutError(elapsed))
        return
      }
      options.poll(attempt).then(
        (result) => {
          if (stopped) return
          if (result.done) {
            cleanup()
            resolve(result.value)
            return
          }
          attempt += 1
          timer = clock.setTimeout(tick, nextInterval(attempt - 1))
        },
        (error) => {
          if (stopped) return
          cleanup()
          reject(error)
        },
      )
    }

    tick()
  })
}
