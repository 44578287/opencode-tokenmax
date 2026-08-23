/**
 * Provider stream reliability — §27 of the master brief.
 *
 * Three timeouts a provider stream must be held to:
 *  - first-byte timeout: something must arrive before this elapses, or the
 *    connection is treated as dead, not "still warming up".
 *  - inactivity timeout: reset on every chunk; if nothing arrives for this
 *    long mid-stream, the stream is stalled, not just slow.
 *  - bounded total timeout: an overall budget regardless of activity.
 *
 * And one rule that has nothing to do with timers: if the stream reports
 * a normal finish but produced zero tokens, no reasoning, no text and no
 * tool call, that is NOT a silent success. `onFinish()` classifies that
 * case as `"empty-success"` in the outcome, specifically so callers can't
 * accidentally treat "the provider said it finished" as "the provider did
 * something".
 *
 * Push-based (`onText`/`onToolCall`/`onFinish`/`onError`) to match how
 * provider SDKs typically deliver stream events, and testable without real
 * waiting via the injectable `Clock`.
 */

import { type Clock, systemClock, type TimerHandle } from "./clock"

export type StreamOutcomeReason =
  | "completed"
  | "empty-success"
  | "first-byte-timeout"
  | "inactivity-timeout"
  | "total-timeout"
  | "error"

export interface StreamOutcome {
  readonly reason: StreamOutcomeReason
  readonly hadFirstByte: boolean
  readonly chunkCount: number
  readonly toolCallCount: number
  readonly textLength: number
  readonly finishReason?: string
  readonly durationMs: number
  readonly error?: unknown
}

export interface StreamWatcherOptions {
  readonly firstByteTimeoutMs?: number
  readonly inactivityTimeoutMs?: number
  readonly totalTimeoutMs?: number
  readonly clock?: Clock
}

export class StreamWatcher {
  private readonly clock: Clock
  private readonly startedAt: number
  private readonly inactivityTimeoutMs?: number
  private settled = false
  private hadFirstByte = false
  private chunkCount = 0
  private toolCallCount = 0
  private textLength = 0
  private firstByteTimer?: TimerHandle
  private inactivityTimer?: TimerHandle
  private totalTimer?: TimerHandle
  private resolveOutcome!: (outcome: StreamOutcome) => void
  private readonly promise: Promise<StreamOutcome>

  constructor(options: StreamWatcherOptions = {}) {
    this.clock = options.clock ?? systemClock
    this.startedAt = this.clock.now()
    this.inactivityTimeoutMs = options.inactivityTimeoutMs
    this.promise = new Promise((resolve) => {
      this.resolveOutcome = resolve
    })
    if (options.firstByteTimeoutMs !== undefined) {
      this.firstByteTimer = this.clock.setTimeout(() => this.settle("first-byte-timeout"), options.firstByteTimeoutMs)
    }
    if (options.totalTimeoutMs !== undefined) {
      this.totalTimer = this.clock.setTimeout(() => this.settle("total-timeout"), options.totalTimeoutMs)
    }
    if (this.inactivityTimeoutMs !== undefined) {
      this.armInactivity()
    }
  }

  onText(text: string): void {
    this.markActivity()
    this.textLength += text.length
    this.chunkCount += 1
  }

  onReasoning(text: string): void {
    this.markActivity()
    this.textLength += text.length
    this.chunkCount += 1
  }

  onToolCall(): void {
    this.markActivity()
    this.toolCallCount += 1
    this.chunkCount += 1
  }

  onFinish(finishReason?: string): void {
    if (this.settled) return
    const empty = this.chunkCount === 0 && this.toolCallCount === 0 && this.textLength === 0
    this.settle(empty ? "empty-success" : "completed", finishReason)
  }

  onError(error: unknown): void {
    this.settle("error", undefined, error)
  }

  result(): Promise<StreamOutcome> {
    return this.promise
  }

  private markActivity(): void {
    this.hadFirstByte = true
    if (this.firstByteTimer !== undefined) {
      this.clock.clearTimeout(this.firstByteTimer)
      this.firstByteTimer = undefined
    }
    this.armInactivity()
  }

  private armInactivity(): void {
    if (this.inactivityTimeoutMs === undefined) return
    if (this.inactivityTimer !== undefined) this.clock.clearTimeout(this.inactivityTimer)
    this.inactivityTimer = this.clock.setTimeout(() => this.settle("inactivity-timeout"), this.inactivityTimeoutMs)
  }

  private settle(reason: StreamOutcomeReason, finishReason?: string, error?: unknown): void {
    if (this.settled) return
    this.settled = true
    if (this.firstByteTimer !== undefined) this.clock.clearTimeout(this.firstByteTimer)
    if (this.inactivityTimer !== undefined) this.clock.clearTimeout(this.inactivityTimer)
    if (this.totalTimer !== undefined) this.clock.clearTimeout(this.totalTimer)
    this.resolveOutcome({
      reason,
      hadFirstByte: this.hadFirstByte,
      chunkCount: this.chunkCount,
      toolCallCount: this.toolCallCount,
      textLength: this.textLength,
      finishReason,
      durationMs: this.clock.now() - this.startedAt,
      error,
    })
  }
}
