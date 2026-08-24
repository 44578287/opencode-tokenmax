import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber } from "effect"
import { TokenMaxPollWatcher } from "@/tokenmax/poll-watcher"
import { it } from "../lib/effect"

const { watchUntilDone, PollTimeoutError } = TokenMaxPollWatcher

// it.live (real clock), not it.effect (TestClock): TestClock requires
// explicit time advancement to resolve a suspended Effect.sleep, which
// would need careful fiber-interleaving control for little benefit here --
// the real default backoff VALUES ([2000, 4000, 8000, 15000, 30000]) are
// plainly visible as DEFAULT_INTERVALS in the source, so proving the exact
// schedule numerically isn't what these tests need to establish. What
// matters -- attempt sequencing, resolving the instant poll() reports
// done, timing out, and interrupting cleanly -- is exercised just as well
// with tiny real intervals, matching the precedent in
// test/session/run-state.test.ts (real Effect.sleep(10), it.instance).

it.live("resolves the instant poll() reports done, on the very first attempt -- no wasted wait", () =>
  Effect.gen(function* () {
    const value = yield* watchUntilDone<string, never, never>(() => Effect.succeed({ done: true, value: "ready" }))
    expect(value).toBe("ready")
  }),
)

it.live("regression 3.8: retries with the configured backoff until done, never a fixed model-driven sleep", () =>
  Effect.gen(function* () {
    const attempts: number[] = []
    let callCount = 0
    const poll = (attempt: number) => {
      attempts.push(attempt)
      callCount += 1
      return Effect.succeed(callCount === 4 ? { done: true as const, value: 42 } : { done: false as const })
    }

    // Tiny real intervals so this test runs fast -- watchUntilDone's own
    // logic (attempt sequencing, resolving on done) is what's under test,
    // not the literal default 2s/4s/8s/15s/30s schedule (which is just
    // data passed to the same function, not separately meaningful here).
    const value = yield* watchUntilDone(poll, { intervals: [1, 1, 1] })

    expect(value).toBe(42)
    expect(attempts).toEqual([0, 1, 2, 3])
  }),
)

it.live("fails with PollTimeoutError once maxTotalMs elapses, never polling forever", () =>
  Effect.gen(function* () {
    const exit = yield* watchUntilDone<never, never, never>(() => Effect.succeed({ done: false }), {
      intervals: [5],
      maxTotalMs: 12,
    }).pipe(Effect.exit)

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = Cause.squash(exit.cause)
      expect(failure).toBeInstanceOf(PollTimeoutError)
    }
  }),
)

it.live("interrupting the caller's fiber stops the poll loop mid-wait -- no orphaned polling", () =>
  Effect.gen(function* () {
    let pollCount = 0
    const fiber = yield* watchUntilDone<never, never, never>(() => {
      pollCount += 1
      return Effect.succeed({ done: false })
    }, { intervals: [50] }).pipe(Effect.forkChild)

    yield* Effect.sleep(5) // let it start polling and enter its sleep
    yield* Fiber.interrupt(fiber)

    const countAfterInterrupt = pollCount
    yield* Effect.sleep(80) // long enough that a still-running loop would have polled again
    expect(pollCount).toBe(countAfterInterrupt)
  }),
)
