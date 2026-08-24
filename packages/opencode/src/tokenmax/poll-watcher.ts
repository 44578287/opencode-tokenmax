export * as TokenMaxPollWatcher from "./poll-watcher"

// R2.5 -- Reliability + Event Runtime (docs/TOKENMAX-ROADMAP.md), regression
// 3.8 in docs/TOKENMAX-RELIABILITY.md ("busy-wait / sleep-based waiting").
// The prototype's own poll-watcher.ts (frozen R2.5 prototype, packages/
// tokenmax on claude/event-driven-execution-model-ge98zn -- see
// docs/TOKENMAX-DECISIONS.md D-003) is the intended foundation for a
// GitHub CI watcher (no public webhook for a first version, so waiting on
// a GitHub Actions run has to poll) -- but it's a hand-rolled Promise +
// custom Clock class with manual AbortSignal wiring. This codebase is
// Effect-native throughout, and Effect's own structured concurrency
// already gives interruption/cancellation for free (no AbortSignal
// plumbing needed -- interrupting the enclosing fiber interrupts this
// loop's `Effect.sleep` automatically). Reimplemented as a small
// Effect-based function rather than porting the class, per the D-001
// reuse criteria's "does it match current native architecture" question
// -- the *behavior* (bounded exponential-then-flat backoff, resolve the
// instant the poll reports done, bounded total wait) is what's actually
// reused, not the Promise-based shape it originally shipped in.
//
// The rule this exists to enforce: the model never participates in a
// "sleep, then check" loop. Runtime code owns a bounded, backed-off poll
// loop and hands the model a single Effect to await -- this module IS
// that mechanism, reusable for any one-shot external-state check (a
// GitHub Actions run's status, a quota reset, or any other §23/§24-shaped
// wait), not just GitHub CI specifically.
//
// Not yet wired to a real GitHub Actions poll -- there is no GitHub
// credential source plumbed into this app for that use case yet (the
// existing octokit usage in cli/cmd/github.handler.ts is the OPPOSITE
// direction: OpenCode running *as* a GitHub Action responding to webhook
// events, not OpenCode polling GitHub's API from an ordinary session).
// Tracked honestly as not-yet-done in TOKENMAX-ROADMAP.md's R2.5 section.

import { Data, Effect } from "effect"

export interface PollDone<T> {
  readonly done: true
  readonly value: T
}

export interface PollPending {
  readonly done: false
}

export type PollTick<T> = PollDone<T> | PollPending

export class PollTimeoutError extends Data.TaggedError("TokenMaxPollTimeoutError")<{
  readonly elapsedMs: number
}> {}

export interface PollOptions {
  /** Backoff schedule in ms. After the last entry, the interval holds steady. Defaults to [2000, 4000, 8000, 15000, 30000]. */
  readonly intervals?: readonly number[]
  readonly maxTotalMs?: number
}

const DEFAULT_INTERVALS = [2000, 4000, 8000, 15000, 30000] as const

/**
 * Polls `poll` on the given backoff schedule until it reports `done`, or
 * fails with `PollTimeoutError` once `maxTotalMs` elapses. Interruption is
 * automatic -- interrupting the fiber this runs on (e.g. the caller's
 * session being cancelled) interrupts an in-flight `Effect.sleep` and
 * unwinds the loop, same as any other Effect.
 */
export function watchUntilDone<T, E, R>(
  poll: (attempt: number) => Effect.Effect<PollTick<T>, E, R>,
  options: PollOptions = {},
): Effect.Effect<T, E | PollTimeoutError, R> {
  const intervals = options.intervals ?? DEFAULT_INTERVALS
  const nextIntervalMs = (attempt: number) => intervals[Math.min(attempt, intervals.length - 1)] ?? 30_000

  return Effect.gen(function* () {
    const startedAt = Date.now()
    let attempt = 0
    while (true) {
      if (options.maxTotalMs !== undefined) {
        const elapsedMs = Date.now() - startedAt
        if (elapsedMs >= options.maxTotalMs) return yield* Effect.fail(new PollTimeoutError({ elapsedMs }))
      }
      const tick = yield* poll(attempt)
      if (tick.done) return tick.value
      yield* Effect.sleep(nextIntervalMs(attempt))
      attempt += 1
    }
  })
}
