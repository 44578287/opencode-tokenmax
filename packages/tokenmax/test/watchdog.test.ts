import { describe, expect, it } from "bun:test"
import { OperationManager } from "../src/operation-manager"
import { Watchdog } from "../src/watchdog"
import { FakeClock } from "./support/fake-clock"

describe("Watchdog.sweep", () => {
  it("reports operations stalled past the threshold, with owner and timing", () => {
    const clock = new FakeClock()
    const manager = new OperationManager(clock)
    const watchdog = new Watchdog(manager, { stallThresholdMs: 1000, clock })
    manager.start({ id: "op1", type: "build", owner: { session: "s1" } })

    clock.advance(500)
    expect(watchdog.sweep()).toEqual([])

    clock.advance(600) // total 1100ms since last progress
    const stuck = watchdog.sweep()
    expect(stuck).toHaveLength(1)
    expect(stuck[0]).toMatchObject({ operationId: "op1", type: "build", owner: { session: "s1" }, state: "RUNNING" })
    expect(stuck[0]!.stalledForMs).toBe(1100)
  })

  it("does not report terminal operations, even if old", () => {
    const clock = new FakeClock()
    const manager = new OperationManager(clock)
    const watchdog = new Watchdog(manager, { stallThresholdMs: 100, clock })
    manager.start({ id: "op1", type: "build" })
    manager.complete("op1")
    clock.advance(10_000)
    expect(watchdog.sweep()).toEqual([])
  })

  it("progress() resets the stall clock", () => {
    const clock = new FakeClock()
    const manager = new OperationManager(clock)
    const watchdog = new Watchdog(manager, { stallThresholdMs: 1000, clock })
    manager.start({ id: "op1", type: "build" })
    clock.advance(900)
    manager.progress("op1")
    clock.advance(900)
    expect(watchdog.sweep()).toEqual([])
  })

  it("§26: attaches caller-supplied diagnostics (queue depth, DB state, ...) to the stuck snapshot", () => {
    const clock = new FakeClock()
    const manager = new OperationManager(clock)
    const watchdog = new Watchdog(manager, { stallThresholdMs: 100, clock })
    manager.start({ id: "op1", type: "child-session" })
    watchdog.registerDiagnostics("op1", () => ({ queueDepth: 3, dbMessageState: "pending" }))
    clock.advance(200)
    const [snapshot] = watchdog.sweep()
    expect(snapshot!.diagnostics).toEqual({ queueDepth: 3, dbMessageState: "pending" })
  })

  it("a throwing diagnostics provider does not break the sweep", () => {
    const clock = new FakeClock()
    const manager = new OperationManager(clock)
    const watchdog = new Watchdog(manager, { stallThresholdMs: 100, clock })
    manager.start({ id: "op1", type: "child-session" })
    watchdog.registerDiagnostics("op1", () => {
      throw new Error("diagnostics source unavailable")
    })
    clock.advance(200)
    const [snapshot] = watchdog.sweep()
    expect(snapshot!.diagnostics.diagnosticsError).toBe("diagnostics source unavailable")
  })

  it("start() runs a periodic supervisory sweep and can be stopped", () => {
    const clock = new FakeClock()
    const manager = new OperationManager(clock)
    const watchdog = new Watchdog(manager, { stallThresholdMs: 100, clock })
    manager.start({ id: "op1", type: "build" })

    const seenBatches: number[] = []
    const stop = watchdog.start(50, (stuck) => seenBatches.push(stuck.length))

    clock.advance(50) // 50ms since start, not yet stalled past 100ms
    clock.advance(50) // 100ms
    expect(seenBatches).toEqual([1])

    stop()
    clock.advance(1000)
    expect(seenBatches).toEqual([1]) // no further ticks after stop()
  })
})
