import { describe, expect, it } from "bun:test"
import { StreamWatcher } from "../src/stream-watcher"
import { FakeClock } from "./support/fake-clock"

describe("StreamWatcher", () => {
  it("completes normally when text/tool activity precedes a finish", async () => {
    const clock = new FakeClock()
    const watcher = new StreamWatcher({ clock })
    watcher.onText("hello ")
    watcher.onToolCall()
    watcher.onFinish("stop")
    const outcome = await watcher.result()
    expect(outcome).toMatchObject({ reason: "completed", chunkCount: 2, toolCallCount: 1, textLength: 6 })
  })

  it("§27: a normal finish with zero tokens, no tool calls, no reasoning is NOT a silent success", async () => {
    const clock = new FakeClock()
    const watcher = new StreamWatcher({ clock })
    watcher.onFinish("stop")
    const outcome = await watcher.result()
    expect(outcome.reason).toBe("empty-success")
  })

  it("fails on first-byte timeout when nothing arrives at all", async () => {
    const clock = new FakeClock()
    const watcher = new StreamWatcher({ clock, firstByteTimeoutMs: 2000 })
    clock.advance(2000)
    const outcome = await watcher.result()
    expect(outcome.reason).toBe("first-byte-timeout")
    expect(outcome.hadFirstByte).toBe(false)
  })

  it("a chunk before the first-byte deadline cancels it, so later silence is judged as inactivity instead", async () => {
    const clock = new FakeClock()
    const watcher = new StreamWatcher({ clock, firstByteTimeoutMs: 2000, inactivityTimeoutMs: 5000 })
    clock.advance(1000)
    watcher.onText("partial")
    clock.advance(1500) // would have tripped first-byte timeout at t=2000 if it were still armed
    expect(clock.pendingCount()).toBe(1) // only the inactivity timer remains armed
    clock.advance(3600) // now 5000ms since the last (only) chunk
    const outcome = await watcher.result()
    expect(outcome.reason).toBe("inactivity-timeout")
  })

  it("each chunk resets the inactivity window", async () => {
    const clock = new FakeClock()
    const watcher = new StreamWatcher({ clock, inactivityTimeoutMs: 1000 })
    watcher.onText("a")
    clock.advance(900)
    watcher.onText("b")
    clock.advance(900)
    watcher.onText("c")
    clock.advance(900)
    watcher.onFinish("stop")
    const outcome = await watcher.result()
    expect(outcome.reason).toBe("completed")
    expect(outcome.textLength).toBe(3)
  })

  it("enforces a bounded total timeout regardless of activity", async () => {
    const clock = new FakeClock()
    const watcher = new StreamWatcher({ clock, totalTimeoutMs: 3000, inactivityTimeoutMs: 10_000 })
    watcher.onText("a")
    clock.advance(1000)
    watcher.onText("b")
    clock.advance(2000) // total 3000ms elapsed, well within the inactivity budget
    const outcome = await watcher.result()
    expect(outcome.reason).toBe("total-timeout")
  })

  it("an explicit stream error settles immediately and carries the error", async () => {
    const clock = new FakeClock()
    const watcher = new StreamWatcher({ clock })
    const err = new Error("connection reset")
    watcher.onText("partial")
    watcher.onError(err)
    const outcome = await watcher.result()
    expect(outcome.reason).toBe("error")
    expect(outcome.error).toBe(err)
  })

  it("is idempotent: only the first settle wins, and all timers are cleared", async () => {
    const clock = new FakeClock()
    const watcher = new StreamWatcher({
      clock,
      firstByteTimeoutMs: 1000,
      inactivityTimeoutMs: 1000,
      totalTimeoutMs: 1000,
    })
    watcher.onText("x")
    watcher.onFinish("stop")
    watcher.onFinish("length") // late duplicate finish must not change the outcome
    watcher.onError(new Error("too late"))
    expect(clock.pendingCount()).toBe(0)
    const outcome = await watcher.result()
    expect(outcome.reason).toBe("completed")
    expect(outcome.finishReason).toBe("stop")
  })
})
