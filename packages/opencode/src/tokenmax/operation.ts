import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"
import { ChildProcess } from "effect/unstable/process"
import { Effect, Stream } from "effect"
import { AppProcess } from "@opencode-ai/core/process"
import type { Store } from "./persist"
import type { OperationState, OperationType, TokenMaxOperation } from "./types"
import { recordEvent } from "./telemetry"

const TERMINAL = new Set<OperationState>(["COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED"])

export function isTerminalOperation(state: OperationState) {
  return TERMINAL.has(state)
}

export function startOperation(
  store: Store,
  input: Omit<TokenMaxOperation, "id" | "state" | "startedAt" | "lastProgressAt" | "result" | "error" | "completedAt"> & {
    id?: string
  },
): TokenMaxOperation {
  const now = new Date().toISOString()
  const operation: TokenMaxOperation = {
    id: input.id ?? randomUUID(),
    type: input.type,
    ownerSessionID: input.ownerSessionID,
    ownerRunID: input.ownerRunID,
    ownerWorkerID: input.ownerWorkerID,
    ownerDagNode: input.ownerDagNode,
    state: "CREATED",
    startedAt: now,
    lastProgressAt: now,
    deadlineAt: input.deadlineAt,
    activeHandle: input.activeHandle,
    result: null,
    error: null,
    completedAt: null,
  }
  store.db.run(
    `INSERT INTO operations(id,type,owner_session_id,owner_run_id,owner_worker_id,owner_dag_node,state,started_at,last_progress_at,deadline_at,active_handle,result,error,completed_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      operation.id,
      operation.type,
      operation.ownerSessionID,
      operation.ownerRunID,
      operation.ownerWorkerID,
      operation.ownerDagNode,
      operation.state,
      operation.startedAt,
      operation.lastProgressAt,
      operation.deadlineAt,
      operation.activeHandle,
      null,
      null,
      null,
    ],
  )
  recordOperationEvent(store, operation.id, "OPERATION_CREATED", { type: operation.type })
  return operation
}

export function updateOperation(
  store: Store,
  id: string,
  update: Partial<Pick<TokenMaxOperation, "state" | "activeHandle" | "result" | "error" | "completedAt">>,
): TokenMaxOperation | undefined {
  const current = getOperation(store, id)
  if (!current || isTerminalOperation(current.state)) return current
  const now = new Date().toISOString()
  const state = update.state ?? current.state
  const completedAt = isTerminalOperation(state) ? update.completedAt ?? now : null
  const result = update.result === undefined ? current.result : update.result
  const error = update.error === undefined ? current.error : update.error
  const handle = update.activeHandle === undefined ? current.activeHandle : update.activeHandle
  store.db.run(
    `UPDATE operations SET state=?,last_progress_at=?,active_handle=?,result=?,error=?,completed_at=? WHERE id=?`,
    [state, now, handle, json(result), json(error), completedAt, id],
  )
  const next = getOperation(store, id)
  if (next) {
    syncWorkerProjection(store, next)
    recordOperationEvent(store, id, `OPERATION_${state}`, { result, error })
  }
  return next
}

export function progressOperation(store: Store, id: string, kind: string, payload?: Record<string, unknown>) {
  const current = getOperation(store, id)
  if (!current || isTerminalOperation(current.state)) return current
  const now = new Date().toISOString()
  const state = current.state === "CREATED" ? "RUNNING" : current.state
  store.db.run("UPDATE operations SET state=?,last_progress_at=? WHERE id=?", [state, now, id])
  recordOperationEvent(store, id, kind, payload)
  return getOperation(store, id)
}

export function completeOperation(store: Store, id: string, result?: Record<string, unknown>) {
  return updateOperation(store, id, { state: "COMPLETED", result: result ?? {} })
}

export function failOperation(store: Store, id: string, error?: Record<string, unknown>) {
  return updateOperation(store, id, { state: "FAILED", error: error ?? {} })
}

export function cancelOperation(store: Store, id: string, error?: Record<string, unknown>) {
  return updateOperation(store, id, { state: "CANCELLED", error: error ?? {} })
}

export function timeoutOperation(store: Store, id: string, error?: Record<string, unknown>) {
  return updateOperation(store, id, { state: "TIMED_OUT", error: error ?? { category: "OPERATION_STALLED" } })
}

export function getOperation(store: Store, id: string): TokenMaxOperation | undefined {
  const row = store.db.query("SELECT * FROM operations WHERE id=?").get(id) as Record<string, unknown> | undefined
  return row ? rowToOperation(row) : undefined
}

export function listOperations(store: Store, sessionID?: string): TokenMaxOperation[] {
  const rows = sessionID
    ? (store.db.query("SELECT * FROM operations WHERE owner_session_id=? ORDER BY started_at DESC").all(sessionID) as Record<string, unknown>[])
    : (store.db.query("SELECT * FROM operations ORDER BY started_at DESC LIMIT 100").all() as Record<string, unknown>[])
  return rows.map(rowToOperation)
}

export function operationTelemetrySummary(store: Store) {
  const operations = store.db.query("SELECT COUNT(*) AS n FROM operations").get() as { n: number }
  const waiting = store.db
    .query("SELECT COUNT(*) AS n FROM operations WHERE state IN ('CREATED','RUNNING','WAITING_EVENT')")
    .get() as { n: number }
  const byType = store.db
    .query("SELECT type, COUNT(*) AS n FROM operations GROUP BY type ORDER BY type")
    .all() as Array<{ type: string; n: number }>
  const events = store.db
    .query("SELECT kind, COUNT(*) AS n FROM operation_events GROUP BY kind ORDER BY kind")
    .all() as Array<{ kind: string; n: number }>
  return { operations: operations.n, waiting: waiting.n, byType, events }
}

export function activeOperations(store: Store, sessionID?: string) {
  return listOperations(store, sessionID).filter((operation) => !isTerminalOperation(operation.state))
}

export function recoverOrphanOperations(store: Store, busySessionIDs: Iterable<string>) {
  const busy = new Set(busySessionIDs)
  const recovered: string[] = []
  for (const operation of activeOperations(store)) {
    if (operation.ownerSessionID && !busy.has(operation.ownerSessionID)) {
      cancelOperation(store, operation.id, { category: "ORPHAN_OPERATION", message: "owner session is no longer BUSY" })
      recovered.push(operation.id)
    }
  }
  return recovered
}

/**
 * Runtime-owned operation coordinator. LLM code never waits by sleeping: it
 * registers an operation, subscribes to terminal events, and yields control.
 * A deadline is an explicit operation contract, not a guessed wait duration.
 */
export class OperationManager {
  private readonly listeners = new Map<string, Set<(operation: TokenMaxOperation) => void>>()

  constructor(private readonly store: Store) {}

  start(input: Parameters<typeof startOperation>[1]) {
    const operation = startOperation(this.store, input)
    this.emit(operation)
    return operation
  }

  subscribe(id: string, listener: (operation: TokenMaxOperation) => void) {
    const listeners = this.listeners.get(id) ?? new Set<(operation: TokenMaxOperation) => void>()
    listeners.add(listener)
    this.listeners.set(id, listeners)
    const current = getOperation(this.store, id)
    if (current) listener(current)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(id)
    }
  }

  progress(id: string, kind: string, payload?: Record<string, unknown>) {
    return this.change(progressOperation(this.store, id, kind, payload))
  }

  complete(id: string, result?: Record<string, unknown>) {
    return this.change(completeOperation(this.store, id, result))
  }

  fail(id: string, error?: Record<string, unknown>) {
    return this.change(failOperation(this.store, id, error))
  }

  cancel(id: string, error?: Record<string, unknown>) {
    return this.change(cancelOperation(this.store, id, error))
  }

  timeout(id: string, error?: Record<string, unknown>) {
    return this.change(timeoutOperation(this.store, id, error))
  }

  resume(id: string) {
    const current = getOperation(this.store, id)
    if (!current || isTerminalOperation(current.state)) return current
    return this.change(updateOperation(this.store, id, { state: "RUNNING" }))
  }

  waitForEvent(id: string) {
    const current = getOperation(this.store, id)
    if (!current || isTerminalOperation(current.state)) return current
    return this.change(updateOperation(this.store, id, { state: "WAITING_EVENT" }))
  }

  /** Resolves only from a terminal event or the explicitly declared deadline. */
  await(id: string): Promise<TokenMaxOperation> {
    const current = getOperation(this.store, id)
    if (!current) return Promise.reject(new Error(`Operation not found: ${id}`))
    if (isTerminalOperation(current.state)) return Promise.resolve(current)
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe(id, (operation) => {
        if (!isTerminalOperation(operation.state)) return
        unsubscribe()
        resolve(operation)
      })
      if (!current.deadlineAt) return
      const remaining = Date.parse(current.deadlineAt) - Date.now()
      if (remaining <= 0) {
        const timedOut = this.timeout(id, { category: "OPERATION_TIMEOUT" })
        if (timedOut) resolve(timedOut)
        return
      }
      const timer = setTimeout(() => {
        const timedOut = this.timeout(id, { category: "OPERATION_TIMEOUT" })
        if (timedOut) resolve(timedOut)
      }, remaining)
      this.subscribe(id, (operation) => {
        if (isTerminalOperation(operation.state)) clearTimeout(timer)
      })
    })
  }

  inspect(now = Date.now()) {
    const timedOut: TokenMaxOperation[] = []
    for (const operation of activeOperations(this.store)) {
      if (!operation.deadlineAt || Date.parse(operation.deadlineAt) > now) continue
      const next = this.timeout(operation.id, { category: "OPERATION_TIMEOUT" })
      if (next) timedOut.push(next)
    }
    return timedOut
  }

  events(id: string, limit?: number) {
    return listOperationEvents(this.store, id, limit)
  }

  private change(operation: TokenMaxOperation | undefined) {
    if (operation) this.emit(operation)
    return operation
  }

  private emit(operation: TokenMaxOperation) {
    for (const listener of this.listeners.get(operation.id) ?? []) listener(operation)
  }
}

export function startGitHubActionsOperation(
  manager: OperationManager,
  input: Omit<Parameters<OperationManager["start"]>[0], "type"> & { runID: string },
) {
  return manager.start({ ...input, type: "GITHUB_ACTIONS", activeHandle: `gh-run:${input.runID}` })
}

export function githubWatchCommand(runID: string, cwd?: string) {
  return ChildProcess.make("gh", ["run", "watch", runID, "--exit-status"], {
    cwd,
    extendEnv: true,
    stdin: "ignore",
  })
}

export function startFileOperation(
  manager: OperationManager,
  input: Omit<Parameters<OperationManager["start"]>[0], "type" | "activeHandle"> & {
    directory: string
    target: string
  },
) {
  const operation = manager.start({ ...input, type: "FILE", activeHandle: input.target })
  manager.waitForEvent(operation.id)
  const watcher = fs.watch(input.directory, (_event, filename) => {
    const changed = filename ? String(filename) : ""
    if (changed && changed !== input.target && !changed.endsWith(`/${input.target}`) && !changed.endsWith(`\\${input.target}`)) {
      return
    }
    const target = path.join(input.directory, input.target)
    if (!fs.existsSync(target)) return
    manager.complete(operation.id, { event: "FILE_CREATED", path: target })
  })
  const unsubscribe = manager.subscribe(operation.id, (next) => {
    if (isTerminalOperation(next.state)) watcher.close()
  })
  return { operation, close: () => { unsubscribe(); watcher.close() } }
}

export const runGitHubActionsOperation = (input: {
  manager: OperationManager
  operation: TokenMaxOperation
  runID: string
  cwd?: string
}) =>
  runProcessOperation({
    manager: input.manager,
    store: undefined,
    operation: input.operation,
    command: githubWatchCommand(input.runID, input.cwd),
  })

/**
 * Runs a direct child process as an Operation. The OS exit event is
 * authoritative; output collectors are intentionally not awaited, so a
 * grandchild retaining stdout/stderr cannot keep the owner operation pending.
 */
export const runProcessOperation = (input: {
  manager: OperationManager
  store?: Store
  operation: TokenMaxOperation
  command: ChildProcess.Command
  likelyFailure?: RegExp
}) =>
  Effect.gen(function* () {
    const spawner = yield* AppProcess.Service
    const handle = yield* spawner.spawn(input.command)
    const pid = String(handle.pid)
    input.manager.resume(input.operation.id)
    input.manager.progress(input.operation.id, "PROCESS_STARTED", { pid })

    const observe = (stream: Stream.Stream<Uint8Array, unknown>, kind: "PROCESS_STDOUT" | "PROCESS_STDERR") =>
      stream.pipe(
        Stream.decodeText,
        Stream.splitLines,
        Stream.filter((line) => line.length > 0),
        Stream.runForEach((line) =>
          Effect.sync(() => {
            input.manager.progress(input.operation.id, kind, { line })
            if (input.likelyFailure?.test(line)) {
              input.manager.progress(input.operation.id, "PROCESS_PROBABLE_FAILURE", { line })
            }
          }),
        ),
        Effect.catch(() => Effect.void),
      )

    yield* Effect.forkScoped(observe(handle.stdout, "PROCESS_STDOUT"))
    yield* Effect.forkScoped(observe(handle.stderr, "PROCESS_STDERR"))
    const exitCode = yield* handle.exitCode
    input.manager.progress(input.operation.id, "PROCESS_EXIT", { exitCode, pid })
    if (exitCode === 0) {
      return input.manager.complete(input.operation.id, { exitCode, pid })!
    }
    return input.manager.fail(input.operation.id, {
      exitCode,
      pid,
      category: "PROCESS_EXIT",
      outputSummary: operationOutputSummary(input.manager, input.operation.id),
    })!
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        input.manager.fail(input.operation.id, { category: "PROCESS_ERROR", message: error instanceof Error ? error.message : String(error) })
        throw error
      }),
    ),
  )

export function recordOperationEvent(store: Store, operationID: string, kind: string, payload?: Record<string, unknown>) {
  store.db.run("INSERT INTO operation_events(operation_id,ts,kind,payload) VALUES(?,?,?,?)", [
    operationID,
    new Date().toISOString(),
    kind,
    json(payload ?? {}),
  ])
  recordEvent(store, kind.toLowerCase(), undefined, { operationID, ...payload })
}

export function listOperationEvents(store: Store, operationID: string, limit = 30) {
  return store.db
    .query("SELECT ts,kind,payload FROM operation_events WHERE operation_id=? ORDER BY id DESC LIMIT ?")
    .all(operationID, limit)
    .reverse() as Array<{ ts: string; kind: string; payload: string | null }>
}

function operationOutputSummary(manager: OperationManager, operationID: string) {
  const events = manager.events(operationID, 20)
  return events
    .filter((event) => event.kind === "PROCESS_STDOUT" || event.kind === "PROCESS_STDERR")
    .map((event) => {
      try {
        return String((JSON.parse(event.payload ?? "{}") as { line?: string }).line ?? "")
      } catch {
        return event.payload ?? ""
      }
    })
    .filter(Boolean)
    .join("\n")
}

function json(value: Record<string, unknown> | null | undefined) {
  return value == null ? null : JSON.stringify(value)
}

function rowToOperation(row: Record<string, unknown>): TokenMaxOperation {
  return {
    id: String(row.id),
    type: String(row.type) as OperationType,
    ownerSessionID: row.owner_session_id == null ? null : String(row.owner_session_id),
    ownerRunID: row.owner_run_id == null ? null : String(row.owner_run_id),
    ownerWorkerID: row.owner_worker_id == null ? null : String(row.owner_worker_id),
    ownerDagNode: row.owner_dag_node == null ? null : String(row.owner_dag_node),
    state: String(row.state) as OperationState,
    startedAt: String(row.started_at),
    lastProgressAt: String(row.last_progress_at),
    deadlineAt: row.deadline_at == null ? null : String(row.deadline_at),
    activeHandle: row.active_handle == null ? null : String(row.active_handle),
    result: parseJson(row.result),
    error: parseJson(row.error),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
  }
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return { raw: value }
  }
}

function syncWorkerProjection(store: Store, operation: TokenMaxOperation) {
  if (!operation.ownerWorkerID) return
  const workerState =
    operation.state === "WAITING_EVENT"
      ? "waiting_event"
      : operation.state === "RUNNING"
        ? "running"
        : operation.state === "COMPLETED"
          ? "completed"
          : operation.state === "FAILED" || operation.state === "TIMED_OUT"
            ? "failed"
            : operation.state === "CANCELLED"
              ? "cancelled"
              : undefined
  if (!workerState) return
  const terminal = workerState === "completed" || workerState === "failed" || workerState === "cancelled"
  store.db.run("UPDATE workers SET state=?, completed_at=CASE WHEN ? THEN ? ELSE completed_at END WHERE id=?", [
    workerState,
    terminal ? 1 : 0,
    terminal ? new Date().toISOString() : null,
    operation.ownerWorkerID,
  ])
}
