/**
 * Completion Gate — §17 and early-stop detection — §18 of the master brief.
 *
 * Core invariant this module exists to enforce:
 *
 *     finish_reason === "stop"   !=   the run is actually done
 *
 * A model can say "let me start three agents to do X, Y, Z" and then stop
 * without calling a single tool. The Completion Gate is the runtime-side
 * check that catches that: it never trusts model prose as evidence of
 * progress, only Operation state and explicit `RunRequirement`s supplied by
 * the caller (pending DAG nodes, workers promised but not started,
 * verifiers not yet run, the user's objective not yet satisfied).
 *
 * `evaluateStop()` — the ONLY function in this module that can produce a
 * TERMINAL outcome — never looks at model text. It only ever inspects
 * `RunRequirement.satisfied`, and every `RunRequirement` must declare a
 * `source` from the closed list below. There is deliberately no
 * `"model-text"`/`"regex"` source: natural-language intent detection
 * (`detectEarlyStop` / `EarlyStopTracker`, further down this file) is a
 * SEPARATE, SECONDARY heuristic. It never constructs a `RunRequirement` and
 * never gates DONE — it only recommends an escalation action (nag for a
 * tool call, use a stronger instruction, fall back to a different root
 * model, or fail explicitly) when a model announces intent with no
 * observable progress. Do not wire it into `evaluateStop()`'s pending list;
 * that would let model prose become the completion state machine, which is
 * exactly what this module exists to prevent.
 *
 * A Run has exactly four terminal states: DONE, BLOCKED, NEEDS_USER, FAILED.
 * This module never invents a BLOCKED/NEEDS_USER on its own — those are
 * always requested explicitly by the caller, who has the domain context to
 * know the difference between "waiting on an event" and "waiting on a
 * human".
 */

import type { RunTerminalState } from "./types"

/**
 * Where a `RunRequirement`'s truth comes from. Closed on purpose: every
 * requirement must be traceable to runtime state, never to parsed model
 * text. Extend this list (DAG/Operations/workers/verification/objective are
 * the sources the master brief names) rather than adding an escape hatch
 * for "the model said so".
 */
export type RequirementSource = "dag" | "operation" | "worker" | "verification" | "objective"

export interface RunRequirement {
  readonly id: string
  readonly description: string
  readonly satisfied: boolean
  readonly source: RequirementSource
}

export interface ModelFinishSignal {
  readonly finishReason: string
  readonly toolCallsInTurn: number
  readonly textPreview?: string
}

export type CompletionDecision =
  | { readonly outcome: "CONTINUE"; readonly reason: string; readonly pendingRequirements: readonly RunRequirement[] }
  | { readonly outcome: "TERMINAL"; readonly state: RunTerminalState; readonly reason: string }

/**
 * Evaluate a model turn that ended with `finish_reason: "stop"` against the
 * requirements the caller currently knows about. Only reaches a TERMINAL
 * "DONE" outcome when every requirement is satisfied.
 */
export function evaluateStop(requirements: readonly RunRequirement[]): CompletionDecision {
  const pending = requirements.filter((requirement) => !requirement.satisfied)
  if (pending.length > 0) {
    return {
      outcome: "CONTINUE",
      reason: `model reported stop, but ${pending.length} requirement(s) unmet: ${pending.map((requirement) => requirement.id).join(", ")}`,
      pendingRequirements: pending,
    }
  }
  return { outcome: "TERMINAL", state: "DONE", reason: "all requirements satisfied at stop" }
}

// Phrases that announce future action without taking it. English and the
// Chinese phrasing called out explicitly in the master brief §18.
const INTENT_PHRASES = [
  /\bi will\b/i,
  /\blet me\b/i,
  /\bnext,?\s*i(?:'ll| will)\b/i,
  /\bnow,?\s*i(?:'ll| will)\b/i,
  /接下来我会/,
  /让我/,
  /现在开始/,
  /我将/,
]

export interface EarlyStopCheck {
  readonly earlyStop: boolean
  readonly matchedPhrase?: string
}

/**
 * A turn is an early-stop when the model's own text announces it is about
 * to act, but it stopped without calling any tool and without any other
 * caller-observed progress.
 */
export function detectEarlyStop(signal: ModelFinishSignal, progressed: boolean): EarlyStopCheck {
  if (signal.finishReason !== "stop") return { earlyStop: false }
  if (signal.toolCallsInTurn > 0) return { earlyStop: false }
  if (progressed) return { earlyStop: false }
  const text = signal.textPreview ?? ""
  for (const pattern of INTENT_PHRASES) {
    if (pattern.test(text)) {
      return { earlyStop: true, matchedPhrase: pattern.source }
    }
  }
  return { earlyStop: false }
}

export type EscalationAction =
  | "NONE"
  | "REQUEST_TOOL_ACTION"
  | "STRONGER_INSTRUCTION"
  | "ROOT_FALLBACK"
  | "EXPLICIT_FAILURE"

export interface EarlyStopTrackerOptions {
  /** Consecutive early-stops before each escalation step. Defaults to [1, 2, 3, 4]. */
  readonly thresholds?: readonly [request: number, stronger: number, fallback: number, fail: number]
}

/**
 * Tracks consecutive early-stops per run and walks the fixed escalation
 * ladder from §18: request an explicit tool action, then a stronger
 * instruction, then fall back to a different root model, then give up with
 * an explicit FAILED — never an infinite self-retry loop.
 *
 * `record()` returns a RECOMMENDATION, not a state transition: this class
 * holds no reference to an `OperationManager` or any Run state and cannot
 * itself fail/complete anything. Even `"EXPLICIT_FAILURE"` is advisory —
 * the caller decides whether and how to actually call `.fail()` on the
 * relevant Operation. This keeps early-stop detection strictly downstream
 * of, and never a substitute for, the authoritative requirement sources.
 */
export class EarlyStopTracker {
  private readonly counts = new Map<string, number>()
  private readonly thresholds: readonly [number, number, number, number]

  constructor(options: EarlyStopTrackerOptions = {}) {
    this.thresholds = options.thresholds ?? [1, 2, 3, 4]
  }

  /** Report one turn's outcome for `runId`. Returns the escalation action to take, if any. */
  record(runId: string, outcome: { readonly earlyStop: boolean; readonly progressed: boolean }): EscalationAction {
    if (outcome.progressed || !outcome.earlyStop) {
      this.counts.delete(runId)
      return "NONE"
    }
    const next = (this.counts.get(runId) ?? 0) + 1
    this.counts.set(runId, next)
    const [request, stronger, fallback, fail] = this.thresholds
    if (next >= fail) return "EXPLICIT_FAILURE"
    if (next >= fallback) return "ROOT_FALLBACK"
    if (next >= stronger) return "STRONGER_INSTRUCTION"
    if (next >= request) return "REQUEST_TOOL_ACTION"
    return "NONE"
  }

  reset(runId: string): void {
    this.counts.delete(runId)
  }

  consecutiveCount(runId: string): number {
    return this.counts.get(runId) ?? 0
  }
}
