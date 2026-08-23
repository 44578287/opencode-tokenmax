import { describe, expect, it } from "bun:test"
import { PollAbortedError, PollTimeoutError, watchUntilDone } from "../src/poll-watcher"
import { FakeClock } from "./support/fake-clock"

// Poll callbacks resolve asynchronously (like a real GitHub API call), so give the
// microtask queue a few ticks after every clock advance before asserting.
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe("watchUntilDone", () => {
  it("§23: follows the 2s/4s/8s/15s/30s(hold) backoff and resolves the instant poll() reports done", async () => {
    const clock = new FakeClock()
    const attempts: number[] = []
    let callCount = 0
    const promise = watchUntilDone<number>({
      clock,
      poll: (attempt) => {
        attempts.push(attempt)
        callCount += 1
        return Promise.resolve(callCount === 7 ? { done: true, value: 42 } : { done: false })
      },
    })

    await flush() // attempt 0, fires synchronously on construction

    const gaps = [2000, 4000, 8000, 15000, 30000, 30000]
    for (const gap of gaps) {
      clock.advance(gap)
      await flush()
    }

    const value = await promise
    expect(value).toBe(42)
    expect(attempts).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it("resolves on the very first poll if it is already done — no LLM sleep, no wasted wait", async () => {
    const clock = new FakeClock()
    const value = await watchUntilDone<string>({ clock, poll: () => Promise.resolve({ done: true, value: "ready" }) })
    expect(value).toBe("ready")
    expect(clock.pendingCount()).toBe(0)
  })

  it("rejects with PollTimeoutError once maxTotalMs is exceeded", async () => {
    const clock = new FakeClock()
    const promise = watchUntilDone<never>({
      clock,
      poll: () => Promise.resolve({ done: false }),
      maxTotalMs: 5000,
    })
    await flush()
    clock.advance(2000)
    await flush()
    clock.advance(4000) // total 6000ms, past the 5000ms budget
    await flush()
    await expect(promise).rejects.toBeInstanceOf(PollTimeoutError)
  })

  it("rejects with PollAbortedError when the signal aborts mid-wait", async () => {
    const clock = new FakeClock()
    const controller = new AbortController()
    const promise = watchUntilDone<never>({
      clock,
      poll: () => Promise.resolve({ done: false }),
      signal: controller.signal,
    })
    await flush()
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(PollAbortedError)
  })

  it("propagates a rejection from poll() instead of retrying forever", async () => {
    const clock = new FakeClock()
    const failure = new Error("GitHub API 500")
    const promise = watchUntilDone<never>({ clock, poll: () => Promise.reject(failure) })
    await expect(promise).rejects.toBe(failure)
  })
})
