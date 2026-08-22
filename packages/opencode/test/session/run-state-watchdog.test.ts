import { describe, expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Fiber } from "effect"
import { SessionRunState } from "@/session/run-state"
import { SessionID, MessageID } from "@/session/schema"
import { testEffect, pollWithTimeout } from "../lib/effect"

const it = testEffect(LayerNode.compile(SessionRunState.node))

function fakeMessage(sessionID: SessionID, text: string): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: MessageID.ascending(),
      sessionID,
      mode: "general",
      agent: "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: "test-model",
      providerID: "test",
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [],
  } as unknown as SessionV1.WithParts
  // (parts left empty and cast: this fixture only needs an identity to flow
  // through Runner/ensureRunning, not to be rendered - the exact shape of an
  // empty-history WithParts is an implementation detail of session.ts we
  // don't need to reproduce here.)
  void text
}

const isBusy = (state: SessionRunState.Interface, sessionID: SessionID) =>
  state.assertNotBusy(sessionID).pipe(
    Effect.as(false),
    Effect.orElseSucceed(() => true),
  )

// tokenmax: mid-run busy stall fix - end-to-end regression test.
//
// Before this fix, once a session's runLoop fiber was Running, a second
// `ensureRunning` call (what a plain "continue" prompt does) just joined the
// same stuck Deferred instead of starting anything new (see
// runner.test.ts "second ensureRunning ignores new work if already
// running" - that behavior itself is correct and unchanged). If the first
// run's work effect never settled (a hung provider stream, a zombie child
// process, an unresponsive subagent, ...) the session stayed BUSY forever
// with no way out except a manual Stop, which force-fails the run
// unconditionally regardless of whether the underlying work ever finishes.
//
// The fix adds an outer watchdog (run-state.ts) that periodically checks,
// for every busy runner, how long it's been since the session last made
// forward progress (SessionStatus.touch/idleFor, wired from every stream
// event in processor.ts). Past a threshold it does exactly what Stop does
// -- calls `runner.cancel` -- automatically, so BUSY always eventually
// resolves without the user having to notice and click Stop themselves.
describe("SessionRunState watchdog (mid-run busy stall fix)", () => {
  it.instance("auto-recovers a session whose work never makes progress", () =>
    Effect.gen(function* () {
      const previous = {
        interval: process.env["OPENCODE_TOKENMAX_WATCHDOG_INTERVAL_MS"],
        stale: process.env["OPENCODE_TOKENMAX_WATCHDOG_STALE_MS"],
      }
      process.env["OPENCODE_TOKENMAX_WATCHDOG_INTERVAL_MS"] = "20"
      process.env["OPENCODE_TOKENMAX_WATCHDOG_STALE_MS"] = "60"

      try {
        const state = yield* SessionRunState.Service
        const sessionID = SessionID.make("ses_watchdog_test")

        // Simulates the class of bug this fixes: work that starts, then
        // NEVER produces another stream event / status transition again
        // (no processor.ts handleEvent call => no status.touch => idleFor
        // just keeps growing). Effect.never never settles on its own -
        // only an external cancel (the watchdog, or a manual Stop) can end
        // this run.
        const started = yield* Deferred.make<void>()
        const stuckWork = Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          return yield* Effect.never.pipe(Effect.as(fakeMessage(sessionID, "should never resolve")))
        })

        const runFiber = yield* state
          .ensureRunning(sessionID, Effect.succeed(fakeMessage(sessionID, "interrupted")), stuckWork)
          .pipe(Effect.forkChild)
        yield* Deferred.await(started)

        // Confirm it's actually stuck busy first (this is the "before Stop"
        // state a real user would see).
        yield* pollWithTimeout(
          isBusy(state, sessionID).pipe(Effect.map((busy) => (busy ? true : undefined))),
          "session never became busy",
          "1 second",
        )

        // A plain "continue" (a second ensureRunning call) must NOT be
        // required to unstick it - the watchdog should resolve this on its
        // own within a couple of its poll intervals, with nobody calling
        // cancel manually.
        const outcome = yield* pollWithTimeout(
          isBusy(state, sessionID).pipe(Effect.map((busy) => (busy ? undefined : true))),
          "watchdog never force-recovered the stuck session",
          "2 seconds",
        )
        expect(outcome).toBe(true)

        // The originally-stuck caller must actually resolve too (not just
        // stay leaked/forgotten in the background) - same terminal path as
        // a manual Stop, resolved with the configured onInterrupt fallback.
        const runResult = yield* Fiber.join(runFiber).pipe(Effect.timeout("500 millis"))
        expect(runResult.info.sessionID).toBe(sessionID)

        // And the session must be usable again afterwards without any
        // manual intervention - new work can start immediately.
        const after = yield* state.ensureRunning(
          sessionID,
          Effect.succeed(fakeMessage(sessionID, "interrupted")),
          Effect.succeed(fakeMessage(sessionID, "fresh-work")),
        )
        expect(after.info.sessionID).toBe(sessionID)
      } finally {
        if (previous.interval === undefined) delete process.env["OPENCODE_TOKENMAX_WATCHDOG_INTERVAL_MS"]
        else process.env["OPENCODE_TOKENMAX_WATCHDOG_INTERVAL_MS"] = previous.interval
        if (previous.stale === undefined) delete process.env["OPENCODE_TOKENMAX_WATCHDOG_STALE_MS"]
        else process.env["OPENCODE_TOKENMAX_WATCHDOG_STALE_MS"] = previous.stale
      }
    }),
  )

  it.instance("does not touch sessions that are making progress", () =>
    Effect.gen(function* () {
      const previous = {
        interval: process.env["OPENCODE_TOKENMAX_WATCHDOG_INTERVAL_MS"],
        stale: process.env["OPENCODE_TOKENMAX_WATCHDOG_STALE_MS"],
      }
      process.env["OPENCODE_TOKENMAX_WATCHDOG_INTERVAL_MS"] = "20"
      process.env["OPENCODE_TOKENMAX_WATCHDOG_STALE_MS"] = "9999999"

      try {
        const state = yield* SessionRunState.Service
        const sessionID = SessionID.make("ses_watchdog_healthy")

        const gate = yield* Deferred.make<void>()
        const resultFiber = yield* state
          .ensureRunning(
            sessionID,
            Effect.succeed(fakeMessage(sessionID, "interrupted")),
            Deferred.await(gate).pipe(Effect.as(fakeMessage(sessionID, "done-normally"))),
          )
          .pipe(Effect.forkChild)

        yield* Effect.sleep("80 millis")
        yield* Deferred.succeed(gate, undefined)
        const result = yield* Fiber.join(resultFiber).pipe(Effect.timeout("1 second"))
        expect(result.info.sessionID).toBe(sessionID)
      } finally {
        if (previous.interval === undefined) delete process.env["OPENCODE_TOKENMAX_WATCHDOG_INTERVAL_MS"]
        else process.env["OPENCODE_TOKENMAX_WATCHDOG_INTERVAL_MS"] = previous.interval
        if (previous.stale === undefined) delete process.env["OPENCODE_TOKENMAX_WATCHDOG_STALE_MS"]
        else process.env["OPENCODE_TOKENMAX_WATCHDOG_STALE_MS"] = previous.stale
      }
    }),
  )
})
