/**
 * Watchdog / stuck diagnostics — §26 of the master brief.
 *
 * `sweep()` is a pure, on-demand function: given the manager and "now", it
 * returns every non-terminal Operation that has gone longer than
 * `stallThresholdMs` without a `progress()` call, packaged as a
 * `StuckSnapshot`. Tests call it directly with a fixed `now` — no timers
 * involved, no flakiness.
 *
 * `start()` is a convenience periodic supervisory sweep for production use.
 * It is explicitly NOT the mechanism that resolves Operations — Operations
 * only ever resolve via `progress()/complete()/fail()/timeout()` driven by
 * real events. The sweep is a safety net that produces a diagnostic
 * snapshot for a human/dashboard/log, not a substitute completion signal —
 * see §19's "no busy-wait" rule, which this does not violate because it
 * never blocks and never treats "still stalled" as an event to act on
 * other than reporting it.
 */

import { type Clock, systemClock, type TimerHandle } from "./clock"
import type { OperationManager } from "./operation-manager"
import type { OperationOwner, OperationState } from "./types"

export type DiagnosticsProvider = () => Record<string, unknown>

export interface StuckSnapshot {
  readonly operationId: string
  readonly type: string
  readonly owner: OperationOwner
  readonly state: OperationState
  readonly startedAt: number
  readonly lastProgressAt: number
  readonly stalledForMs: number
  readonly deadline?: number
  readonly diagnostics: Record<string, unknown>
  readonly capturedAt: number
}

export interface WatchdogOptions {
  readonly stallThresholdMs: number
  readonly clock?: Clock
}

export class Watchdog {
  private readonly clock: Clock
  private readonly diagnosticsProviders = new Map<string, DiagnosticsProvider>()
  private timer?: TimerHandle

  constructor(
    private readonly manager: OperationManager,
    private readonly options: WatchdogOptions,
  ) {
    this.clock = options.clock ?? systemClock
  }

  /** Attach caller-supplied diagnostic context (queue depth, abort controller state, DB message state, ...) to an Operation ID. */
  registerDiagnostics(operationId: string, provider: DiagnosticsProvider): void {
    this.diagnosticsProviders.set(operationId, provider)
  }

  unregisterDiagnostics(operationId: string): void {
    this.diagnosticsProviders.delete(operationId)
  }

  /** Pure: every currently-active Operation stalled past the threshold, as of `now`. */
  sweep(now: number = this.clock.now()): StuckSnapshot[] {
    const out: StuckSnapshot[] = []
    for (const snapshot of this.manager.listActive()) {
      const stalledForMs = now - snapshot.lastProgressAt
      if (stalledForMs < this.options.stallThresholdMs) continue
      const provider = this.diagnosticsProviders.get(snapshot.id)
      let diagnostics: Record<string, unknown> = {}
      try {
        diagnostics = provider ? provider() : {}
      } catch (error) {
        diagnostics = { diagnosticsError: error instanceof Error ? error.message : String(error) }
      }
      out.push({
        operationId: snapshot.id,
        type: snapshot.type,
        owner: snapshot.owner,
        state: snapshot.state,
        startedAt: snapshot.startedAt,
        lastProgressAt: snapshot.lastProgressAt,
        stalledForMs,
        deadline: snapshot.deadline,
        diagnostics,
        capturedAt: now,
      })
    }
    return out
  }

  /** Runs `sweep()` every `intervalMs` and hands stuck snapshots to `onStuck`. Returns a stop function. */
  start(intervalMs: number, onStuck: (snapshots: StuckSnapshot[]) => void): () => void {
    const tick = () => {
      const stuck = this.sweep()
      if (stuck.length > 0) onStuck(stuck)
      this.timer = this.clock.setTimeout(tick, intervalMs)
    }
    this.timer = this.clock.setTimeout(tick, intervalMs)
    return () => {
      if (this.timer !== undefined) {
        this.clock.clearTimeout(this.timer)
        this.timer = undefined
      }
    }
  }
}
