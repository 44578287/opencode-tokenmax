import { describe, expect, it } from "bun:test"
import { OperationManager, UnknownOperationError } from "../src/operation-manager"
import { FakeClock } from "./support/fake-clock"

describe("OperationManager", () => {
  it("starts RUNNING and completes with a result", () => {
    const manager = new OperationManager(new FakeClock())
    const started = manager.start({ id: "op1", type: "test" })
    expect(started.state).toBe("RUNNING")
    expect(started.progressEvents).toBe(0)

    const completed = manager.complete("op1", { ok: true })
    expect(completed?.state).toBe("COMPLETED")
    expect(completed?.result).toEqual({ ok: true })
  })

  it("regression 3.6: a terminal operation never moves again on a duplicate transition", () => {
    const manager = new OperationManager(new FakeClock())
    manager.start({ id: "op1", type: "test" })
    const completed = manager.complete("op1", "first")
    // A race (e.g. duplicate stream 'end' + 'error') calling fail() after complete() must be a no-op.
    const afterFail = manager.fail("op1", "should not apply")
    const afterCancel = manager.cancel("op1", "should not apply either")
    expect(completed?.state).toBe("COMPLETED")
    expect(afterFail?.state).toBe("COMPLETED")
    expect(afterCancel?.state).toBe("COMPLETED")
    expect(afterFail?.result).toBe("first")
    expect(afterCancel?.result).toBe("first")
    expect(afterFail?.error).toBeUndefined()
    expect(afterCancel?.error).toBeUndefined()
  })

  it("progress() wakes WAITING_EVENT back to RUNNING and bumps lastProgressAt", () => {
    const clock = new FakeClock()
    const manager = new OperationManager(clock)
    manager.start({ id: "op1", type: "test" })
    manager.waitForEvent("op1")
    expect(manager.get("op1")?.state).toBe("WAITING_EVENT")

    clock.advance(50)
    const progressed = manager.progress("op1")
    expect(progressed?.state).toBe("RUNNING")
    expect(progressed?.progressEvents).toBe(1)
    expect(progressed?.lastProgressAt).toBe(50)
  })

  it("progress() on a terminal operation is a no-op", () => {
    const manager = new OperationManager(new FakeClock())
    manager.start({ id: "op1", type: "test" })
    manager.complete("op1")
    const after = manager.progress("op1")
    expect(after?.state).toBe("COMPLETED")
    expect(after?.progressEvents).toBe(0)
  })

  it("enforces a deadline via a single scheduled timer, never a poll loop", () => {
    const clock = new FakeClock()
    const manager = new OperationManager(clock)
    manager.start({ id: "op1", type: "test", deadlineMs: 1000 })
    expect(clock.pendingCount()).toBe(1)

    clock.advance(999)
    expect(manager.get("op1")?.state).toBe("RUNNING")

    clock.advance(1)
    expect(manager.get("op1")?.state).toBe("TIMED_OUT")
    expect(clock.pendingCount()).toBe(0)
  })

  it("progress before the deadline does not cancel the deadline timer (it is a hard budget)", () => {
    const clock = new FakeClock()
    const manager = new OperationManager(clock)
    manager.start({ id: "op1", type: "test", deadlineMs: 1000 })
    clock.advance(500)
    manager.progress("op1")
    clock.advance(500)
    expect(manager.get("op1")?.state).toBe("TIMED_OUT")
  })

  it("completing before the deadline clears the timer so it can never fire late", () => {
    const clock = new FakeClock()
    const manager = new OperationManager(clock)
    manager.start({ id: "op1", type: "test", deadlineMs: 1000 })
    manager.complete("op1", "done")
    expect(clock.pendingCount()).toBe(0)
    clock.advance(2000)
    expect(manager.get("op1")?.state).toBe("COMPLETED")
  })

  it("resume() preserves startedAt but bumps lastProgressAt and can re-arm a fresh deadline", () => {
    const clock = new FakeClock()
    const manager = new OperationManager(clock)
    // Resuming a TIMED_OUT operation (e.g. after a crash-restart replay) must be a no-op: terminal is final.
    manager.start({ id: "op1", type: "test", deadlineMs: 1000 })
    clock.advance(1500)
    expect(manager.get("op1")?.state).toBe("TIMED_OUT")
    expect(manager.resume("op1")?.state).toBe("TIMED_OUT")

    // resume()'s real use case: re-attach supervision to a still-active operation without losing startedAt.
    const started = manager.start({ id: "op2", type: "test" })
    manager.waitForEvent("op2")
    clock.advance(10)
    const resumed = manager.resume("op2", { deadlineMs: 2000 })
    expect(resumed?.state).toBe("RUNNING")
    expect(resumed?.startedAt).toBe(started.startedAt)
    expect(resumed?.lastProgressAt).toBe(started.startedAt + 10)
    clock.advance(1999)
    expect(manager.get("op2")?.state).toBe("RUNNING")
    clock.advance(1)
    expect(manager.get("op2")?.state).toBe("TIMED_OUT")
  })

  it("await() resolves with the terminal snapshot and never rejects, even on FAILED", async () => {
    const manager = new OperationManager(new FakeClock())
    manager.start({ id: "op1", type: "test" })
    const pending = manager.await("op1")
    manager.fail("op1", new Error("boom"))
    const snapshot = await pending
    expect(snapshot.state).toBe("FAILED")
    expect((snapshot.error as Error).message).toBe("boom")
  })

  it("await() resolves immediately when the operation is already terminal", async () => {
    const manager = new OperationManager(new FakeClock())
    manager.start({ id: "op1", type: "test" })
    manager.complete("op1", "x")
    const snapshot = await manager.await("op1")
    expect(snapshot.state).toBe("COMPLETED")
  })

  it("await() contract part 2: an UNKNOWN id rejects with UnknownOperationError — a programmer error, not an outcome", async () => {
    const manager = new OperationManager(new FakeClock())
    await expect(manager.await("never-started")).rejects.toBeInstanceOf(UnknownOperationError)
  })

  it("isolates a throwing listener so other listeners and the manager keep working", () => {
    const manager = new OperationManager(new FakeClock())
    manager.start({ id: "op1", type: "test" })
    const seen: string[] = []
    manager.subscribe("op1", () => {
      throw new Error("bad plugin hook")
    })
    manager.subscribe("op1", (event) => seen.push(event.kind))
    expect(() => manager.progress("op1")).not.toThrow()
    expect(seen).toEqual(["progress"])
  })

  it("isolation is not silence: a throwing listener is reported to the optional error sink", () => {
    const failures: Array<{ operationId: string; operationType: string; eventKind: string }> = []
    const manager = new OperationManager(new FakeClock(), (failure) => {
      failures.push({
        operationId: failure.operationId,
        operationType: failure.operationType,
        eventKind: failure.eventKind,
      })
    })
    manager.start({ id: "op1", type: "child-session" })
    manager.subscribe("op1", () => {
      throw new Error("bad plugin hook")
    })
    manager.progress("op1")
    manager.complete("op1")
    expect(failures).toEqual([
      { operationId: "op1", operationType: "child-session", eventKind: "progress" },
      { operationId: "op1", operationType: "child-session", eventKind: "terminal" },
    ])
  })

  it("a throwing error sink is itself isolated and never breaks emission", () => {
    const manager = new OperationManager(new FakeClock(), () => {
      throw new Error("telemetry backend unavailable")
    })
    manager.start({ id: "op1", type: "test" })
    const seen: string[] = []
    manager.subscribe("op1", () => {
      throw new Error("bad plugin hook")
    })
    manager.subscribe("op1", (event) => seen.push(event.kind))
    expect(() => manager.progress("op1")).not.toThrow()
    expect(seen).toEqual(["progress"])
  })

  it("the error sink never receives the Operation's own result/error payload, only id/type/eventKind/error", () => {
    const manager = new OperationManager(new FakeClock(), (failure) => {
      expect(Object.keys(failure).sort()).toEqual(["error", "eventKind", "operationId", "operationType"])
    })
    manager.start({ id: "op1", type: "test" })
    manager.subscribe("op1", () => {
      throw new Error("bad plugin hook")
    })
    manager.complete("op1", { secret: "should never reach the sink via this path" })
  })

  it("listActive scopes by owner and excludes terminal operations", () => {
    const manager = new OperationManager(new FakeClock())
    manager.start({ id: "a", type: "test", owner: { session: "s1" } })
    manager.start({ id: "b", type: "test", owner: { session: "s1" } })
    manager.start({ id: "c", type: "test", owner: { session: "s2" } })
    manager.complete("b")

    const activeForS1 = manager.listActive({ session: "s1" })
    expect(activeForS1.map((snapshot) => snapshot.id)).toEqual(["a"])
    expect(manager.listActive({ session: "s2" }).map((snapshot) => snapshot.id)).toEqual(["c"])
    expect(
      manager
        .listActive()
        .map((snapshot) => snapshot.id)
        .sort(),
    ).toEqual(["a", "c"])
  })

  it("prune() drops terminal records older than the given age and leaves the rest", () => {
    const clock = new FakeClock()
    const manager = new OperationManager(clock)
    manager.start({ id: "old", type: "test" })
    manager.complete("old")
    clock.advance(10_000)
    manager.start({ id: "recent", type: "test" })
    manager.complete("recent")

    const dropped = manager.prune(5000)
    expect(dropped).toBe(1)
    expect(manager.get("old")).toBeUndefined()
    expect(manager.get("recent")).toBeDefined()
  })

  it("starting a duplicate id throws instead of silently overwriting an in-flight operation", () => {
    const manager = new OperationManager(new FakeClock())
    manager.start({ id: "op1", type: "test" })
    expect(() => manager.start({ id: "op1", type: "test" })).toThrow()
  })
})
