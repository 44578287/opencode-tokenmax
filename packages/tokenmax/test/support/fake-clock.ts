import type { Clock, TimerHandle } from "../../src/clock"

/**
 * Deterministic virtual clock for testing timeout/backoff/deadline logic
 * without real sleeping. `advance(ms)` moves virtual time forward and fires
 * any callbacks whose scheduled time has been reached, in schedule order —
 * including callbacks newly scheduled by a callback that just fired (e.g. a
 * scheduled `complete()` inside a `setTimeout` handler that itself arms
 * another timer), matching real event-loop semantics.
 */
export class FakeClock implements Clock {
  private current = 0
  private nextId = 1
  private readonly scheduled = new Map<number, { readonly time: number; readonly fn: () => void }>()

  now(): number {
    return this.current
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++
    this.scheduled.set(id, { time: this.current + Math.max(0, ms), fn })
    return id as unknown as TimerHandle
  }

  clearTimeout(handle: TimerHandle): void {
    this.scheduled.delete(handle as unknown as number)
  }

  /** Advances virtual time by `ms`, firing every due callback in time order. */
  advance(ms: number): void {
    const target = this.current + ms
    for (;;) {
      let dueId: number | undefined
      let dueTime = Infinity
      for (const [id, entry] of this.scheduled) {
        if (entry.time <= target && entry.time < dueTime) {
          dueTime = entry.time
          dueId = id
        }
      }
      if (dueId === undefined) break
      const entry = this.scheduled.get(dueId)!
      this.scheduled.delete(dueId)
      this.current = entry.time
      entry.fn()
    }
    this.current = target
  }

  pendingCount(): number {
    return this.scheduled.size
  }
}
