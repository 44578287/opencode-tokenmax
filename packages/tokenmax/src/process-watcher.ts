/**
 * Event-driven process watcher — §21 (local process/build) and §22
 * (Windows pipe / child process) of the master brief.
 *
 * Two rules this enforces:
 *
 *  1. No sleep-based build waiting (§21, regression 3.8): resolve the
 *     instant the process actually exits, whether that is 3 seconds or 5
 *     minutes in. Never `sleep(N)` and then check.
 *
 *  2. Process exit is authoritative, but stdout/stderr pipes are not
 *     (§22): on some platforms — Windows in particular — a grandchild
 *     process can inherit and hold open the parent's stdout/stderr pipe
 *     after the direct child has already exited, and waiting for those
 *     streams to naturally emit `end`/`close` can hang forever. So: once
 *     `exit` fires, give buffered output a short, bounded "drain grace"
 *     window to flush, then forcibly detach the collectors and finalize
 *     with whatever was captured. The Operation always reaches a terminal
 *     state — it is never held open by a pipe nobody is going to close.
 *
 * Only duck-types on the process/stream shape (`ProcessLike`) — no
 * `node:child_process` import — so this stays usable from any runtime that
 * hands it something exit/data/error-event-shaped (Bun's `spawn`, Node's
 * `child_process`, or a test double).
 */

import { type Clock, systemClock } from "./clock"

export interface ReadableLike {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown
  on(event: "close" | "end", listener: () => void): unknown
  off?(event: string, listener: (...args: unknown[]) => void): unknown
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface ProcessLike {
  readonly stdout?: ReadableLike | null
  readonly stderr?: ReadableLike | null
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
  off?(event: string, listener: (...args: unknown[]) => void): unknown
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown
  kill?(signal?: NodeJS.Signals | number): boolean
}

export interface WatchProcessOptions {
  /** Bounded window after `exit` to let buffered stdout/stderr flush. Default 300ms. */
  readonly drainGraceMs?: number
  /** Overall wall-clock budget; if the process never exits, resolve with `timedOut: true` and attempt `kill()`. */
  readonly deadlineMs?: number
  readonly maxBufferBytes?: number
  readonly onOutput?: (chunk: { readonly stream: "stdout" | "stderr"; readonly text: string }) => void
  readonly clock?: Clock
}

export interface ProcessResult {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly exitedAt?: number
  readonly durationMs: number
  /** True if both stdout and stderr closed on their own before the drain grace window elapsed. */
  readonly drainedCleanly: boolean
  readonly timedOut: boolean
}

const DEFAULT_DRAIN_GRACE_MS = 300

export function watchProcess(proc: ProcessLike, options: WatchProcessOptions = {}): Promise<ProcessResult> {
  const clock = options.clock ?? systemClock
  const drainGraceMs = options.drainGraceMs ?? DEFAULT_DRAIN_GRACE_MS
  const maxBufferBytes = options.maxBufferBytes ?? 10 * 1024 * 1024
  const startedAt = clock.now()

  return new Promise((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let stdoutClosed = !proc.stdout
    let stderrClosed = !proc.stderr
    let deadlineTimer: ReturnType<Clock["setTimeout"]> | undefined
    let graceTimer: ReturnType<Clock["setTimeout"]> | undefined

    const cleanupStream = (stream: ReadableLike | null | undefined, listener: (...args: any[]) => void) => {
      if (!stream) return
      const remove = stream.off ?? stream.removeListener
      remove?.call(stream, "data", listener)
      remove?.call(stream, "close", listener)
      remove?.call(stream, "end", listener)
    }

    const onStdoutData = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8")
      if (stdoutBytes < maxBufferBytes) {
        stdout += text
        stdoutBytes += text.length
      }
      options.onOutput?.({ stream: "stdout", text })
    }
    const onStderrData = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8")
      if (stderrBytes < maxBufferBytes) {
        stderr += text
        stderrBytes += text.length
      }
      options.onOutput?.({ stream: "stderr", text })
    }
    const onStdoutClose = () => {
      stdoutClosed = true
      maybeFinalizeAfterExit()
    }
    const onStderrClose = () => {
      stderrClosed = true
      maybeFinalizeAfterExit()
    }

    proc.stdout?.on("data", onStdoutData)
    proc.stdout?.on("close", onStdoutClose)
    proc.stdout?.on("end", onStdoutClose)
    proc.stderr?.on("data", onStderrData)
    proc.stderr?.on("close", onStderrClose)
    proc.stderr?.on("end", onStderrClose)

    let exited = false
    let exitCode: number | null = null
    let exitSignal: NodeJS.Signals | null = null
    let exitedAt: number | undefined

    function maybeFinalizeAfterExit() {
      if (!exited || settled) return
      if (stdoutClosed && stderrClosed) {
        finalize(true)
      }
    }

    function finalize(drainedCleanly: boolean, timedOut = false) {
      if (settled) return
      settled = true
      if (deadlineTimer !== undefined) clock.clearTimeout(deadlineTimer)
      if (graceTimer !== undefined) clock.clearTimeout(graceTimer)
      cleanupStream(proc.stdout, onStdoutData)
      cleanupStream(proc.stderr, onStderrData)
      resolve({
        exitCode,
        signal: exitSignal,
        stdout,
        stderr,
        exitedAt,
        durationMs: clock.now() - startedAt,
        drainedCleanly,
        timedOut,
      })
    }

    proc.on("error", (error) => {
      if (settled) return
      settled = true
      if (deadlineTimer !== undefined) clock.clearTimeout(deadlineTimer)
      if (graceTimer !== undefined) clock.clearTimeout(graceTimer)
      reject(error)
    })

    proc.on("exit", (code, signal) => {
      if (exited) return
      exited = true
      exitCode = code
      exitSignal = signal
      exitedAt = clock.now()
      if (stdoutClosed && stderrClosed) {
        finalize(true)
        return
      }
      // Exit is authoritative. Give buffered output a bounded grace window
      // to drain naturally; if a grandchild is still holding a pipe open,
      // we detach and finalize anyway rather than hang (regression: §22).
      graceTimer = clock.setTimeout(() => finalize(false), drainGraceMs)
    })

    if (options.deadlineMs !== undefined) {
      deadlineTimer = clock.setTimeout(() => {
        if (settled) return
        try {
          proc.kill?.()
        } catch {
          // best-effort; finalize regardless
        }
        finalize(false, true)
      }, options.deadlineMs)
    }
  })
}
