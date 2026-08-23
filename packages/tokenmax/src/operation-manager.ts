/**
 * Operation Manager — §20 of the master brief.
 *
 * Every unit of tracked work in TokenMax (a tool call, a child session
 * turn, a build, a CI wait, a file transfer, ...) is represented as an
 * `Operation`. Nothing in the runtime is allowed to be "just pending" with
 * no owner and no lifecycle: if it can be BUSY, it must be an Operation.
 *
 * Design invariants this module enforces (see README for the regression
 * list each one closes):
 *  - A terminal state (COMPLETED/FAILED/TIMED_OUT/CANCELLED) is final.
 *    Transitioning an already-terminal Operation again is a safe no-op,
 *    not a crash — a duplicate `complete()` from a race must never take
 *    the whole session down (regression 3.2: invalid events must not kill
 *    a session).
 *  - A deadline, once set, is enforced by a single native timer callback
 *    scheduled through the injected `Clock` — never by a sleep+check loop
 *    (regression 3.8 / §19: no LLM busy-wait, no polling substitute for a
 *    real event).
 *  - A listener that throws is isolated and never prevents other
 *    listeners — or the manager itself — from observing the same event
 *    (regression 3.1/3.2: one bad hook must not break the whole pipe).
 *    Isolation is not the same as silence: pass `onListenerError` to the
 *    constructor to observe these failures (operation id, type, event kind,
 *    the caught error — never the Operation's own result/error payload,
 *    which may carry caller data) instead of losing them entirely.
 *  - `await()`'s contract has exactly two parts, and both are load-bearing:
 *      1. The OPERATION OUTCOME never rejects. FAILED/TIMED_OUT/CANCELLED
 *         resolve just like COMPLETED — callers must read `.state`. This is
 *         what makes "silent success" and "swallowed failure" both
 *         impossible by construction: there is no catch block to
 *         accidentally treat as done.
 *      2. Awaiting an UNKNOWN operation id IS a rejection (`UnknownOperationError`).
 *         That is a programmer error (a typo'd id, a stale reference to an
 *         Operation that was `prune()`d), not an operation outcome, and
 *         collapsing it into a silent `undefined` would hide real bugs.
 */

import { type Clock, systemClock, type TimerHandle } from "./clock"
import {
  isTerminalOperationState,
  type OperationOwner,
  ownerMatches,
  type OperationSnapshot,
  type OperationState,
} from "./types"

export interface StartOptions {
  readonly id?: string
  readonly type: string
  readonly owner?: OperationOwner
  /** Wall-clock budget from now. When it elapses, the Operation auto-transitions to TIMED_OUT. */
  readonly deadlineMs?: number
  /** Opaque handle for diagnostics/cancellation wiring (AbortController, child process, subscription, ...). Never inspected by this module. */
  readonly activeHandle?: unknown
}

export type OperationEvent<TResult = unknown, TError = unknown> =
  | { readonly kind: "progress"; readonly snapshot: OperationSnapshot<TResult, TError> }
  | { readonly kind: "terminal"; readonly snapshot: OperationSnapshot<TResult, TError> }

export type OperationListener<TResult = unknown, TError = unknown> = (event: OperationEvent<TResult, TError>) => void

/** Raised by `await()` when the given id was never `start()`-ed, or has been dropped by `prune()`. Never raised for an operation outcome. */
export class UnknownOperationError extends Error {
  constructor(readonly operationId: string) {
    super(`OperationManager: unknown operation "${operationId}"`)
    this.name = "UnknownOperationError"
  }
}

export interface ListenerFailure {
  readonly operationId: string
  readonly operationType: string
  readonly eventKind: "progress" | "terminal"
  readonly error: unknown
}

/** Told about a listener that threw, instead of the failure being silently swallowed. Must never receive secrets. */
export type ListenerErrorSink = (failure: ListenerFailure) => void

interface OperationRecord {
  id: string
  type: string
  owner: OperationOwner
  state: OperationState
  startedAt: number
  lastProgressAt: number
  deadline?: number
  progressEvents: number
  result?: unknown
  error?: unknown
  activeHandle?: unknown
  listeners: Set<OperationListener>
  deadlineTimer?: TimerHandle
  awaiters: Array<(snapshot: OperationSnapshot) => void>
}

let anonymousSeq = 0

export class OperationManager {
  private readonly records = new Map<string, OperationRecord>()

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly onListenerError?: ListenerErrorSink,
  ) {}

  /** CREATED -> RUNNING. Registers the deadline timer (if any) and returns the initial snapshot. */
  start<TResult = unknown, TError = unknown>(options: StartOptions): OperationSnapshot<TResult, TError> {
    const id = options.id ?? `op_${++anonymousSeq}_${this.clock.now().toString(36)}`
    if (this.records.has(id)) {
      throw new Error(`OperationManager: operation "${id}" already exists`)
    }
    const now = this.clock.now()
    const record: OperationRecord = {
      id,
      type: options.type,
      owner: options.owner ?? {},
      state: "RUNNING",
      startedAt: now,
      lastProgressAt: now,
      deadline: options.deadlineMs === undefined ? undefined : now + options.deadlineMs,
      progressEvents: 0,
      activeHandle: options.activeHandle,
      listeners: new Set(),
      awaiters: [],
    }
    this.records.set(id, record)
    if (options.deadlineMs !== undefined) {
      this.armDeadline(record, options.deadlineMs)
    }
    return this.toSnapshot(record) as OperationSnapshot<TResult, TError>
  }

  /** Subscribe to progress/terminal events for one Operation. Returns an unsubscribe function. */
  subscribe<TResult = unknown, TError = unknown>(id: string, listener: OperationListener<TResult, TError>): () => void {
    const record = this.records.get(id)
    if (!record) return () => {}
    record.listeners.add(listener as OperationListener)
    return () => record.listeners.delete(listener as OperationListener)
  }

  /** Mark activity: bumps lastProgressAt, wakes WAITING_EVENT/CREATED back to RUNNING. No-op on a terminal Operation. */
  progress<TResult = unknown, TError = unknown>(
    id: string,
    patch?: { readonly note?: string },
  ): OperationSnapshot<TResult, TError> | undefined {
    const record = this.records.get(id)
    if (!record) return undefined
    if (isTerminalOperationState(record.state)) return this.toSnapshot(record) as OperationSnapshot<TResult, TError>
    record.lastProgressAt = this.clock.now()
    record.progressEvents += 1
    if (record.state === "WAITING_EVENT" || record.state === "CREATED") {
      record.state = "RUNNING"
    }
    void patch
    const snapshot = this.toSnapshot(record)
    this.emit(record, { kind: "progress", snapshot })
    return snapshot as OperationSnapshot<TResult, TError>
  }

  /** RUNNING -> WAITING_EVENT: the Operation is now blocked on an external event source (CI, file, stream, ...), not abandoned. */
  waitForEvent<TResult = unknown, TError = unknown>(id: string): OperationSnapshot<TResult, TError> | undefined {
    return this.transition(id, "WAITING_EVENT")
  }

  complete<TResult = unknown, TError = unknown>(
    id: string,
    result?: TResult,
  ): OperationSnapshot<TResult, TError> | undefined {
    return this.transition(id, "COMPLETED", { result })
  }

  fail<TResult = unknown, TError = unknown>(
    id: string,
    error?: TError,
  ): OperationSnapshot<TResult, TError> | undefined {
    return this.transition(id, "FAILED", { error })
  }

  cancel<TResult = unknown, TError = unknown>(
    id: string,
    reason?: string,
  ): OperationSnapshot<TResult, TError> | undefined {
    return this.transition(id, "CANCELLED", { error: reason as unknown as TError })
  }

  /** Called by the deadline timer, or directly by a caller that independently detected a timeout. */
  timeout<TResult = unknown, TError = unknown>(id: string): OperationSnapshot<TResult, TError> | undefined {
    return this.transition(id, "TIMED_OUT")
  }

  /**
   * Re-attach supervision to an Operation that was rehydrated (process restart, DAG resume) without
   * resetting `startedAt`. Bumps `lastProgressAt` and optionally re-arms a fresh deadline. No-op if terminal.
   */
  resume<TResult = unknown, TError = unknown>(
    id: string,
    options?: { readonly deadlineMs?: number },
  ): OperationSnapshot<TResult, TError> | undefined {
    const record = this.records.get(id)
    if (!record) return undefined
    if (isTerminalOperationState(record.state)) return this.toSnapshot(record) as OperationSnapshot<TResult, TError>
    record.lastProgressAt = this.clock.now()
    if (record.state === "CREATED" || record.state === "WAITING_EVENT") record.state = "RUNNING"
    if (options?.deadlineMs !== undefined) {
      this.clearDeadline(record)
      record.deadline = this.clock.now() + options.deadlineMs
      this.armDeadline(record, options.deadlineMs)
    }
    return this.toSnapshot(record) as OperationSnapshot<TResult, TError>
  }

  /**
   * Resolves with the final snapshot once the Operation reaches ANY terminal
   * state (COMPLETED/FAILED/TIMED_OUT/CANCELLED) — the outcome itself never
   * rejects; read `.state`. Rejects with `UnknownOperationError` only when
   * `id` was never started, or was dropped by `prune()` — that is a
   * programmer error, not an operation outcome.
   */
  await<TResult = unknown, TError = unknown>(id: string): Promise<OperationSnapshot<TResult, TError>> {
    const record = this.records.get(id)
    if (!record) return Promise.reject(new UnknownOperationError(id))
    if (isTerminalOperationState(record.state)) {
      return Promise.resolve(this.toSnapshot(record) as OperationSnapshot<TResult, TError>)
    }
    return new Promise((resolve) => {
      record.awaiters.push(resolve as (snapshot: OperationSnapshot) => void)
    })
  }

  get<TResult = unknown, TError = unknown>(id: string): OperationSnapshot<TResult, TError> | undefined {
    const record = this.records.get(id)
    return record ? (this.toSnapshot(record) as OperationSnapshot<TResult, TError>) : undefined
  }

  /** Non-terminal operations, optionally scoped by owner (e.g. { session: sessionID }). */
  listActive(filter?: OperationOwner): OperationSnapshot[] {
    const out: OperationSnapshot[] = []
    for (const record of this.records.values()) {
      if (isTerminalOperationState(record.state)) continue
      if (filter && !ownerMatches(record.owner, filter)) continue
      out.push(this.toSnapshot(record))
    }
    return out
  }

  /** All operations (including terminal), optionally scoped by owner. For diagnostics only. */
  list(filter?: OperationOwner): OperationSnapshot[] {
    const out: OperationSnapshot[] = []
    for (const record of this.records.values()) {
      if (filter && !ownerMatches(record.owner, filter)) continue
      out.push(this.toSnapshot(record))
    }
    return out
  }

  /** Drops terminal records older than `olderThanMs` from `now` so long-lived managers don't leak memory. */
  prune(olderThanMs: number, now: number = this.clock.now()): number {
    let dropped = 0
    for (const [id, record] of this.records) {
      if (isTerminalOperationState(record.state) && now - record.lastProgressAt > olderThanMs) {
        this.records.delete(id)
        dropped += 1
      }
    }
    return dropped
  }

  private transition<TResult, TError>(
    id: string,
    next: OperationState,
    patch?: { result?: TResult; error?: TError },
  ): OperationSnapshot<TResult, TError> | undefined {
    const record = this.records.get(id)
    if (!record) return undefined
    // Idempotent guard: a terminal Operation never moves again. A duplicate
    // complete()/fail()/cancel() call (e.g. from a race between a stream's
    // "end" and its "error" handler) must be a no-op, not a crash.
    if (isTerminalOperationState(record.state)) {
      return this.toSnapshot(record) as OperationSnapshot<TResult, TError>
    }
    record.state = next
    record.lastProgressAt = this.clock.now()
    if (patch && "result" in patch) record.result = patch.result
    if (patch && "error" in patch) record.error = patch.error
    if (isTerminalOperationState(next)) {
      this.clearDeadline(record)
    }
    const snapshot = this.toSnapshot(record) as OperationSnapshot<TResult, TError>
    this.emit(record, { kind: isTerminalOperationState(next) ? "terminal" : "progress", snapshot })
    if (isTerminalOperationState(next)) {
      const awaiters = record.awaiters
      record.awaiters = []
      for (const resolve of awaiters) resolve(snapshot)
    }
    return snapshot
  }

  private armDeadline(record: OperationRecord, deadlineMs: number): void {
    record.deadlineTimer = this.clock.setTimeout(() => {
      this.timeout(record.id)
    }, deadlineMs)
  }

  private clearDeadline(record: OperationRecord): void {
    if (record.deadlineTimer !== undefined) {
      this.clock.clearTimeout(record.deadlineTimer)
      record.deadlineTimer = undefined
    }
  }

  private emit(record: OperationRecord, event: OperationEvent): void {
    for (const listener of record.listeners) {
      try {
        listener(event)
      } catch (error) {
        // A throwing listener must not break emission to the remaining
        // listeners, nor bubble up and take down the manager. Isolation
        // matches the plugin-hook-failure lesson in the master brief (§3.1).
        // Isolated is not the same as silent: report it if a sink was given.
        // Only operation id/type/event kind and the caught error are
        // reported — never the Operation's own result/error payload.
        try {
          this.onListenerError?.({
            operationId: record.id,
            operationType: record.type,
            eventKind: event.kind,
            error,
          })
        } catch {
          // The sink itself is also a hook: a throwing sink must not break emission either.
        }
      }
    }
  }

  private toSnapshot(record: OperationRecord): OperationSnapshot {
    return {
      id: record.id,
      type: record.type,
      owner: record.owner,
      state: record.state,
      startedAt: record.startedAt,
      lastProgressAt: record.lastProgressAt,
      deadline: record.deadline,
      progressEvents: record.progressEvents,
      result: record.result,
      error: record.error,
    }
  }
}
