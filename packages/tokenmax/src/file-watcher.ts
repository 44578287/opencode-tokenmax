/**
 * File / transfer wait — §24 of the master brief.
 *
 * `watchDirectory` turns raw OS filesystem events (Node's `fs.watch`, which
 * is itself event-driven — inotify/FSEvents/ReadDirectoryChangesW, never
 * polling) into the four semantic events callers actually care about:
 * FILE_CREATED / FILE_CHANGED / FILE_RENAMED / FILE_DELETED. `fs.watch`
 * alone only reports "rename" (create/delete/rename-away) or "change"; this
 * disambiguates by diffing a directory snapshot on every native event.
 *
 * `TransferWatcher` is the equivalent lifecycle for uploads/downloads:
 * TRANSFER_STARTED / TRANSFER_PROGRESS / TRANSFER_COMPLETED /
 * TRANSFER_FAILED. It has no filesystem coupling on purpose — the actual
 * transfer mechanics belong to whichever code performs the upload/download;
 * this only guarantees the lifecycle is well-formed (no orphaned STARTED
 * with no eventual terminal state) and terminal transitions are final,
 * same idempotency guarantee as the Operation Manager.
 *
 * Neither of these is estimated-time sleep-based (§24's explicit ban).
 */

import { existsSync, readdirSync, statSync, watch as fsWatch } from "node:fs"
import { join } from "node:path"
import { type Clock, systemClock } from "./clock"

export type FileEventKind = "FILE_CREATED" | "FILE_CHANGED" | "FILE_RENAMED" | "FILE_DELETED"

export interface FileEvent {
  readonly kind: FileEventKind
  readonly path: string
  readonly previousPath?: string
  readonly at: number
}

export interface WatchDirectoryOptions {
  readonly clock?: Clock
}

/**
 * Pure classification step, deliberately factored out of the `fs.watch`
 * wiring so it can be unit tested deterministically — no real filesystem,
 * no timing dependence on how a given OS/runtime batches native events.
 *
 * A single name appearing in `added` paired with a single name in
 * `removed` for the same native tick is a rename, not an unrelated
 * delete+create; anything else is reported as independent creates/deletes.
 */
export function diffDirectorySnapshot(
  dirPath: string,
  previous: ReadonlyMap<string, number>,
  next: ReadonlyMap<string, number>,
  at: number,
): FileEvent[] {
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  for (const name of next.keys()) if (!previous.has(name)) added.push(name)
  for (const name of previous.keys()) if (!next.has(name)) removed.push(name)
  for (const [name, mtime] of next) {
    if (previous.has(name) && previous.get(name) !== mtime) changed.push(name)
  }

  const events: FileEvent[] = []
  if (added.length === 1 && removed.length === 1) {
    events.push({
      kind: "FILE_RENAMED",
      path: join(dirPath, added[0]!),
      previousPath: join(dirPath, removed[0]!),
      at,
    })
  } else {
    for (const name of added) events.push({ kind: "FILE_CREATED", path: join(dirPath, name), at })
    for (const name of removed) events.push({ kind: "FILE_DELETED", path: join(dirPath, name), at })
  }
  for (const name of changed) events.push({ kind: "FILE_CHANGED", path: join(dirPath, name), at })
  return events
}

/** Watches a single directory (non-recursive) and classifies changes into the four semantic file events. */
export function watchDirectory(
  dirPath: string,
  onEvent: (event: FileEvent) => void,
  options: WatchDirectoryOptions = {},
): () => void {
  const clock = options.clock ?? systemClock

  const scan = (): Map<string, number> => {
    const out = new Map<string, number>()
    if (!existsSync(dirPath)) return out
    for (const entry of readdirSync(dirPath)) {
      try {
        out.set(entry, statSync(join(dirPath, entry)).mtimeMs)
      } catch {
        // Entry raced away between readdir and stat; treat as absent this tick.
      }
    }
    return out
  }

  let known = scan()

  const watcher = fsWatch(dirPath, { persistent: true }, () => {
    const next = scan()
    for (const event of diffDirectorySnapshot(dirPath, known, next, clock.now())) onEvent(event)
    known = next
  })

  return () => watcher.close()
}

export type TransferState = "STARTED" | "PROGRESS" | "COMPLETED" | "FAILED"

export interface TransferSnapshot {
  readonly id: string
  readonly state: TransferState
  readonly bytesTransferred: number
  readonly totalBytes?: number
  readonly startedAt: number
  readonly updatedAt: number
  readonly error?: unknown
}

type TransferListener = (snapshot: TransferSnapshot) => void

interface TransferRecord {
  snapshot: TransferSnapshot
  listeners: Set<TransferListener>
}

const TRANSFER_TERMINAL: ReadonlySet<TransferState> = new Set(["COMPLETED", "FAILED"])

export interface TransferListenerFailure {
  readonly transferId: string
  readonly error: unknown
}

/** Told about a listener that threw, instead of the failure being silently swallowed. Must never receive secrets. */
export type TransferListenerErrorSink = (failure: TransferListenerFailure) => void

export class TransferWatcher {
  private readonly records = new Map<string, TransferRecord>()

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly onListenerError?: TransferListenerErrorSink,
  ) {}

  start(id: string, totalBytes?: number): TransferSnapshot {
    if (this.records.has(id)) throw new Error(`TransferWatcher: transfer "${id}" already exists`)
    const now = this.clock.now()
    const snapshot: TransferSnapshot = {
      id,
      state: "STARTED",
      bytesTransferred: 0,
      totalBytes,
      startedAt: now,
      updatedAt: now,
    }
    this.records.set(id, { snapshot, listeners: new Set() })
    return snapshot
  }

  progress(id: string, bytesTransferred: number): TransferSnapshot | undefined {
    const record = this.records.get(id)
    if (!record) return undefined
    if (TRANSFER_TERMINAL.has(record.snapshot.state)) return record.snapshot
    record.snapshot = { ...record.snapshot, state: "PROGRESS", bytesTransferred, updatedAt: this.clock.now() }
    this.emit(record)
    return record.snapshot
  }

  complete(id: string): TransferSnapshot | undefined {
    return this.transition(id, "COMPLETED")
  }

  fail(id: string, error?: unknown): TransferSnapshot | undefined {
    return this.transition(id, "FAILED", error)
  }

  subscribe(id: string, listener: TransferListener): () => void {
    const record = this.records.get(id)
    if (!record) return () => {}
    record.listeners.add(listener)
    return () => record.listeners.delete(listener)
  }

  get(id: string): TransferSnapshot | undefined {
    return this.records.get(id)?.snapshot
  }

  private transition(id: string, state: TransferState, error?: unknown): TransferSnapshot | undefined {
    const record = this.records.get(id)
    if (!record) return undefined
    if (TRANSFER_TERMINAL.has(record.snapshot.state)) return record.snapshot
    record.snapshot = { ...record.snapshot, state, error, updatedAt: this.clock.now() }
    this.emit(record)
    return record.snapshot
  }

  private emit(record: TransferRecord): void {
    for (const listener of record.listeners) {
      try {
        listener(record.snapshot)
      } catch (error) {
        // Isolate listener failures, same as OperationManager — and report
        // them the same way: isolated is not the same as silent.
        try {
          this.onListenerError?.({ transferId: record.snapshot.id, error })
        } catch {
          // The sink itself is also a hook: a throwing sink must not break emission either.
        }
      }
    }
  }
}
