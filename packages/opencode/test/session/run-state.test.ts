import { Effect, Exit, Fiber } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Session } from "@/session/session"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { MessageID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

// R2.5 -- Reliability + Event Runtime (docs/TOKENMAX-ROADMAP.md). Before
// porting anything from the frozen R2.5 prototype (packages/tokenmax on
// claude/event-driven-execution-model-ge98zn -- see
// docs/TOKENMAX-DECISIONS.md D-003), checked whether upstream OpenCode's
// CURRENT architecture already covers what that prototype's
// busy-invariant.ts/operation-manager.ts were built to solve.
//
// It does, structurally: SessionRunState's Runner (src/effect/runner.ts)
// wraps every run with `Effect.onExit(...)`, which fires on success,
// failure, AND interruption alike -- there's no code path that leaves a
// run "finished" without also transitioning the session back to idle.
// This is a stronger guarantee than the prototype's own approach
// (reactively detecting "BUSY with zero active operations" after the
// fact and correcting it) -- the state this architecture can be in is
// simply narrower.
//
// This file is the enforceable test for regression 3.6 (master brief /
// TOKENMAX-RELIABILITY.md: "mid-run permanent BUSY") against that real
// mechanism, not a reimplemented invariant checker. No dedicated test
// file for SessionRunState/status-after-completion existed before this.

const fakeResult: SessionV1.WithParts = {
  info: {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: MessageID.ascending(),
    sessionID: SessionID.make("ses_fake"),
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelV2.ID.make("test-model"),
    providerID: ProviderV2.ID.make("test"),
    variant: "xhigh",
    time: { created: Date.now() },
  },
  parts: [],
}

const it = testEffect(LayerNode.compile(LayerNode.group([SessionRunState.node, Session.node, SessionStatus.node])))

it.instance("status resolves back to idle after ensureRunning's work completes successfully", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const runState = yield* SessionRunState.Service
    const status = yield* SessionStatus.Service
    const session = yield* sessions.create({ title: "run-state test" })

    yield* runState.ensureRunning(session.id, Effect.succeed(fakeResult), Effect.succeed(fakeResult))

    const settled = yield* status.get(session.id)
    if (settled.type !== "idle") throw new Error(`expected idle after successful completion, got '${settled.type}'`)
  }),
)

it.instance("status resolves back to idle -- not stuck busy -- after ensureRunning's work fails (regression 3.6)", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const runState = yield* SessionRunState.Service
    const status = yield* SessionStatus.Service
    const session = yield* sessions.create({ title: "run-state test" })

    // ensureRunning's `work` type carries no error channel (E = never) --
    // Effect.die represents "the work crashed" as a defect instead, which
    // is how a real failure inside a run actually surfaces here.
    const exit = yield* runState
      .ensureRunning(session.id, Effect.succeed(fakeResult), Effect.die(new Error("boom")))
      .pipe(Effect.exit)

    if (Exit.isSuccess(exit)) throw new Error("expected the run to actually fail for this test to mean anything")
    const settled = yield* status.get(session.id)
    if (settled.type !== "idle")
      throw new Error(`regression 3.6: expected idle after a failed run, session is stuck '${settled.type}'`)
  }),
)

// Uses startShell rather than ensureRunning: the Runner's onBusy hook
// (src/effect/runner.ts) only fires on the startShell path -- ensureRunning
// (used by SessionPrompt's main turn loop) doesn't flip SessionStatus by
// itself, that loop sets status some other way at a higher level. startShell
// is a real, legitimate SessionRunState entry point too (SessionPrompt's own
// `shell` function uses it), and it's the one that actually exercises the
// onBusy -> onIdle cycle this test needs.
it.instance("status resolves back to idle after a shell run is cancelled mid-flight", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const runState = yield* SessionRunState.Service
    const status = yield* SessionStatus.Service
    const session = yield* sessions.create({ title: "run-state test" })

    const fiber = yield* runState.startShell(session.id, Effect.succeed(fakeResult), Effect.never).pipe(Effect.forkChild)

    // Give the fiber a moment to actually start and flip status to busy,
    // so cancel() below is racing a real in-flight run, not a not-yet-
    // started one.
    yield* Effect.sleep(10)
    const whileRunning = yield* status.get(session.id)
    if (whileRunning.type !== "busy") throw new Error("expected the session to be busy while the shell run is in flight")

    yield* runState.cancel(session.id)
    yield* Fiber.await(fiber)

    const settled = yield* status.get(session.id)
    if (settled.type !== "idle")
      throw new Error(`regression 3.6: expected idle after cancellation, session is stuck '${settled.type}'`)
  }),
)
