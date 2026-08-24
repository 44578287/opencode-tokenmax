export * as TokenMaxWatchdog from "./watchdog"

// R2.5 -- Reliability + Event Runtime (docs/TOKENMAX-ROADMAP.md), §26 of
// the master brief ("Watchdog / stuck diagnostics"). Adapted from the
// frozen R2.5 prototype's watchdog.ts (packages/tokenmax on
// claude/event-driven-execution-model-ge98zn -- see
// docs/TOKENMAX-DECISIONS.md D-003), NOT ported verbatim: the prototype's
// `Watchdog` class is a thin wrapper around `OperationManager.listActive()`,
// and D-011 already decided OperationManager isn't being ported (upstream's
// SessionRunState/Runner already structurally prevents the specific
// failure -- orphan BUSY -- OperationManager was mainly there to catch).
//
// What's genuinely reusable and not upstream-covered is the *stall
// detection* itself: given a list of active things with a
// "last-activity" timestamp, find the ones stalled past a threshold.
// sweep() below is that computation, decoupled from any specific active-
// thing registry (OperationManager or otherwise) -- pure, generic over
// any snapshot shaped like { id, lastActivityAt }, same "port the
// decision logic, not the class hierarchy" treatment completion-gate.ts
// got in D-012.
//
// Not yet wired to a live source: no active-run registry in this codebase
// currently tracks a per-run "last activity" timestamp for in-flight
// subagent runs (telemetry.ts records only on completion, success or
// error -- it has no "still running, last heard from at T" concept).
// Tracked honestly as not-yet-done in TOKENMAX-ROADMAP.md's R2.5 section.

export interface ActivitySnapshot {
  readonly id: string
  readonly lastActivityAt: number
}

export interface StalledSnapshot<T extends ActivitySnapshot = ActivitySnapshot> {
  readonly snapshot: T
  readonly stalledForMs: number
}

/**
 * Every snapshot in `snapshots` that has gone at least `stallThresholdMs`
 * without activity, as of `now`. Pure and on-demand -- no timers, no
 * mutation, callers decide how (or whether) to run this periodically.
 */
export function sweep<T extends ActivitySnapshot>(
  snapshots: readonly T[],
  stallThresholdMs: number,
  now: number = Date.now(),
): StalledSnapshot<T>[] {
  const out: StalledSnapshot<T>[] = []
  for (const snapshot of snapshots) {
    const stalledForMs = now - snapshot.lastActivityAt
    if (stalledForMs >= stallThresholdMs) out.push({ snapshot, stalledForMs })
  }
  return out
}
