import { describe, expect, it } from "bun:test"
import { watchProcess } from "../src/process-watcher"
import { FakeClock } from "./support/fake-clock"
import { FakeProcess } from "./support/fake-emitter"

describe("watchProcess", () => {
  it("regression 3.8: resolves the instant exit fires, never after a fixed sleep", async () => {
    const clock = new FakeClock()
    const proc = new FakeProcess()
    const result = watchProcess(proc, { clock })

    proc.stdout.emit("data", "building...\n")
    proc.emit("exit", 0, null)
    proc.stdout.emit("close")
    proc.stderr.emit("close")
    // Both streams closed on their own -> no need to even wait out the drain grace window.
    const resolved = await result
    expect(resolved.exitCode).toBe(0)
    expect(resolved.stdout).toBe("building...\n")
    expect(resolved.drainedCleanly).toBe(true)
  })

  it("a process that fails at second 3 resolves at second 3, not on some assumed 5-minute build time", async () => {
    const clock = new FakeClock()
    const proc = new FakeProcess()
    const result = watchProcess(proc, { clock })

    clock.advance(3000)
    proc.stderr.emit("data", "error: build failed\n")
    proc.emit("exit", 1, null)
    proc.stdout.emit("close")
    proc.stderr.emit("close")
    const resolved = await result
    expect(resolved.exitCode).toBe(1)
    expect(resolved.durationMs).toBe(3000)
    expect(resolved.stderr).toContain("build failed")
  })

  it("regression §22: exit fires but a grandchild still holds the pipe open — never hangs, finalizes after the drain grace", async () => {
    const clock = new FakeClock()
    const proc = new FakeProcess()
    const result = watchProcess(proc, { clock, drainGraceMs: 300 })

    proc.emit("exit", 0, null)
    // Neither stream ever emits close/end — simulating a grandchild holding stdout/stderr open on Windows.
    let settled = false
    result.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false) // not yet — still inside the grace window

    clock.advance(299)
    await Promise.resolve()
    expect(settled).toBe(false)

    clock.advance(1)
    const resolved = await result
    expect(resolved.exitCode).toBe(0)
    expect(resolved.drainedCleanly).toBe(false) // detached forcibly, not a clean drain
  })

  it("kills and finalizes with timedOut:true when the process never exits within the deadline", async () => {
    const clock = new FakeClock()
    const proc = new FakeProcess()
    const result = watchProcess(proc, { clock, deadlineMs: 5000 })

    clock.advance(5000)
    const resolved = await result
    expect(resolved.timedOut).toBe(true)
    expect(resolved.exitCode).toBeNull()
    expect(proc.killed).toBe(true)
  })

  it("an error event rejects immediately instead of waiting for a phantom exit", async () => {
    const clock = new FakeClock()
    const proc = new FakeProcess()
    const result = watchProcess(proc, { clock })
    const failure = new Error("spawn ENOENT")
    proc.emit("error", failure)
    await expect(result).rejects.toBe(failure)
  })

  it("streams every chunk to onOutput as it arrives", async () => {
    const clock = new FakeClock()
    const proc = new FakeProcess()
    const seen: string[] = []
    const result = watchProcess(proc, { clock, onOutput: (chunk) => seen.push(`${chunk.stream}:${chunk.text}`) })
    proc.stdout.emit("data", "a")
    proc.stderr.emit("data", "b")
    proc.emit("exit", 0, null)
    proc.stdout.emit("close")
    proc.stderr.emit("close")
    await result
    expect(seen).toEqual(["stdout:a", "stderr:b"])
  })
})
