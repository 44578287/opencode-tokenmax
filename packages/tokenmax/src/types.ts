/**
 * Shared vocabulary for the TokenMax event-driven execution runtime.
 *
 * Maps to master brief sections:
 *  - Operation lifecycle: §20 Operation Manager
 *  - Run terminal states: §17 Completion Gate
 */

/** Lifecycle state of a single tracked unit of work (an "Operation"). */
export type OperationState =
  | "CREATED"
  | "RUNNING"
  | "WAITING_EVENT"
  | "COMPLETED"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLED"

/** States from which an Operation can never transition further. */
export const OPERATION_TERMINAL_STATES: ReadonlySet<OperationState> = new Set([
  "COMPLETED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
])

export function isTerminalOperationState(state: OperationState): boolean {
  return OPERATION_TERMINAL_STATES.has(state)
}

/**
 * The only four terminal outcomes for a whole Run (§17). `finish_reason:
 * "stop"` from a model is NOT one of these — it is an input signal that the
 * Completion Gate evaluates, never a terminal state on its own.
 */
export type RunTerminalState = "DONE" | "BLOCKED" | "NEEDS_USER" | "FAILED"

/** Who an Operation belongs to. Every field is optional — fill in what applies. */
export interface OperationOwner {
  readonly session?: string
  readonly run?: string
  readonly worker?: string
  readonly dagNode?: string
}

export function ownerMatches(owner: OperationOwner, filter: OperationOwner): boolean {
  return (
    (filter.session === undefined || owner.session === filter.session) &&
    (filter.run === undefined || owner.run === filter.run) &&
    (filter.worker === undefined || owner.worker === filter.worker) &&
    (filter.dagNode === undefined || owner.dagNode === filter.dagNode)
  )
}

/** Point-in-time, serializable view of an Operation. Safe to log or snapshot. */
export interface OperationSnapshot<TResult = unknown, TError = unknown> {
  readonly id: string
  readonly type: string
  readonly owner: OperationOwner
  readonly state: OperationState
  readonly startedAt: number
  readonly lastProgressAt: number
  readonly deadline?: number
  readonly progressEvents: number
  readonly result?: TResult
  readonly error?: TError
}
