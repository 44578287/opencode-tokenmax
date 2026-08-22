import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Runner } from "@/effect/runner"
import { BackgroundJob } from "@/background/job"
import { Effect, Latch, Layer, Scope, Context } from "effect"
import { Session } from "./session"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"
import { activeOperations, recoverOrphanOperations } from "@/tokenmax/operation"
import { store as tokenmaxStore } from "@/tokenmax"

export interface Interface {
  readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void, Session.BusyError>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly ensureRunning: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    work: Effect.Effect<SessionV1.WithParts>,
  ) => Effect.Effect<SessionV1.WithParts>
  readonly startShell: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    work: Effect.Effect<SessionV1.WithParts>,
    ready?: Latch.Latch,
  ) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunState") {}

/**
 * Outer safety net for the "mid-run busy stall" class of bug: a session's
 * runLoop fiber is technically still Running, but nothing has made forward
 * progress (no stream event, no status transition) for a long time, so the
 * session stays BUSY forever and a plain "continue" prompt just joins the
 * same stuck Deferred (see Runner.ensureRunning) - only clicking Stop
 * unblocks it, because Runner.cancel force-fails that Deferred unconditionally.
 * This periodically detects that condition and does exactly what Stop does,
 * automatically, so the session always eventually leaves BUSY on its own.
 * Targeted fixes for the two most common underlying hangs (a stalled
 * provider stream, a child process whose stdio pipe never closes) live in
 * provider.ts and cross-spawn-spawner.ts respectively - this is the
 * catch-all for anything else (a hung subagent, an unexpected promise that
 * never settles, etc).
 */
// Read lazily (not module-load-time) so tests can shrink these via env vars
// without needing a dynamic import of this module.
function watchdogIntervalMs() {
  const v = Number(process.env["OPENCODE_TOKENMAX_WATCHDOG_INTERVAL_MS"])
  return Number.isFinite(v) && v > 0 ? v : 30_000
}
function watchdogStaleMs() {
  const v = process.env["OPENCODE_TOKENMAX_WATCHDOG_STALE_MS"]
  if (v === undefined) return 9 * 60_000
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 9 * 60_000
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const status = yield* SessionStatus.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunState.state")(function* () {
        const scope = yield* Scope.Scope
        const runners = new Map<SessionID, Runner.Runner<SessionV1.WithParts>>()
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            yield* Effect.forEach(runners.values(), (runner) => runner.cancel, {
              concurrency: "unbounded",
              discard: true,
            })
            runners.clear()
          }),
        )
        if (watchdogStaleMs() > 0) {
          yield* Effect.gen(function* () {
            yield* Effect.sleep(watchdogIntervalMs())
            const staleMs = watchdogStaleMs()
            const statuses = yield* status.list()
            const busySessionIDs = [...statuses.entries()]
              .filter(([, current]) => current.type === "busy")
              .map(([sessionID]) => sessionID)
            // A persisted operation whose owner is no longer BUSY cannot ever
            // resume a worker. Close that orphan before it can become a
            // permanent WAITING_EVENT record.
            yield* Effect.sync(() => recoverOrphanOperations(tokenmaxStore(), busySessionIDs)).pipe(Effect.ignore)
            for (const [sessionID, current] of statuses) {
              if (current.type !== "busy" || runners.get(sessionID)?.busy) continue
              const operations = yield* Effect.sync(() => activeOperations(tokenmaxStore(), sessionID)).pipe(
                Effect.catch(() => Effect.succeed([])),
              )
              if (operations.length > 0) continue
              yield* Effect.logWarning("tokenmax watchdog: recovering orphan BUSY session", { sessionID }).pipe(
                Effect.ignore,
              )
              yield* status.set(sessionID, { type: "idle" })
            }
            for (const [sessionID, r] of runners) {
              if (!r.busy) continue
              const idleFor = yield* status.idleFor(sessionID)
              if (idleFor === undefined || idleFor < staleMs) continue
              yield* Effect.logWarning("tokenmax watchdog: force-recovering stuck session", {
                sessionID,
                idleForMs: idleFor,
              }).pipe(Effect.ignore)
              // Same terminal path as the user clicking Stop: unblocks any
              // queued ensureRunning callers and returns the session to Idle,
              // regardless of whether the underlying stuck operation itself
              // ever actually settles.
              yield* r.cancel.pipe(Effect.ignore)
            }
          }).pipe(Effect.forever, Effect.forkIn(scope))
        }
        return { runners, scope }
      }),
    )

    const runner = Effect.fn("SessionRunState.runner")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
    ) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing) return existing
      const next = Runner.make<SessionV1.WithParts>(data.scope, {
        onIdle: Effect.gen(function* () {
          data.runners.delete(sessionID)
          yield* status.set(sessionID, { type: "idle" })
        }),
        onBusy: status.set(sessionID, { type: "busy" }),
        onInterrupt,
      })
      data.runners.set(sessionID, next)
      return next
    })

    const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing?.busy) yield* busyError(sessionID)
    })

    const cancel = Effect.fn("SessionRunState.cancel")(function* (sessionID: SessionID) {
      yield* cancelBackgroundJobs(background, sessionID)
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (!existing) {
        yield* status.set(sessionID, { type: "idle" })
        return
      }
      yield* existing.cancel
    })

    const ensureRunning = Effect.fn("SessionRunState.ensureRunning")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts>,
    ) {
      const r = yield* runner(sessionID, onInterrupt)
      // Runner's own `onBusy` hook only fires for `startShell`, never for
      // `ensureRunning` (the path a normal chat prompt takes), so the
      // watchdog's heartbeat clock would never start without this. Safe to
      // call unconditionally: if a run is already in progress this just
      // refreshes lastActivity, which is harmless.
      yield* status.set(sessionID, { type: "busy" })
      return yield* r.ensureRunning(work)
    })

    const startShell = Effect.fn("SessionRunState.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts>,
      ready?: Latch.Latch,
    ) {
      return yield* (yield* runner(sessionID, onInterrupt))
        .startShell(work, ready)
        .pipe(Effect.catchTag("RunnerBusy", () => Effect.fail(busyError(sessionID))))
    })

    return Service.of({ assertNotBusy, cancel, ensureRunning, startShell })
  }),
)

const cancelBackgroundJobs = Effect.fn("SessionRunState.cancelBackgroundJobs")(function* (
  background: BackgroundJob.Interface,
  sessionID: SessionID,
) {
  const jobs = yield* background.list()
  const pending = new Set<string>([sessionID])
  const cancelled = new Set<string>()
  const matches = (job: BackgroundJob.Info) => {
    if (job.status !== "running") return false
    if (cancelled.has(job.id)) return false
    if (pending.has(job.id)) return true
    if (typeof job.metadata?.sessionId === "string" && pending.has(job.metadata.sessionId)) return true
    return typeof job.metadata?.parentSessionId === "string" && pending.has(job.metadata.parentSessionId)
  }
  let batch = jobs.filter(matches)
  while (batch.length > 0) {
    yield* Effect.forEach(
      batch,
      (job) =>
        background.cancel(job.id).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              cancelled.add(job.id)
              pending.add(job.id)
              if (typeof job.metadata?.sessionId === "string") pending.add(job.metadata.sessionId)
            }),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    )
    batch = jobs.filter(matches)
  }
})

function busyError(sessionID: SessionID) {
  return new Session.BusyError({ sessionID })
}

export const node = LayerNode.make({ service: Service, layer: layer, deps: [BackgroundJob.node, SessionStatus.node] })

export * as SessionRunState from "./run-state"
