import { describe, expect, test } from "bun:test"
import { TokenMaxWatchdog } from "@/tokenmax/watchdog"

const { sweep } = TokenMaxWatchdog

describe("sweep", () => {
  test("reports snapshots stalled at or past the threshold", () => {
    const now = 10_000
    const stuck = sweep(
      [
        { id: "a", lastActivityAt: 8_500 }, // stalled 1500ms
        { id: "b", lastActivityAt: 9_900 }, // stalled 100ms
      ],
      1_000,
      now,
    )
    expect(stuck).toHaveLength(1)
    expect(stuck[0].snapshot.id).toBe("a")
    expect(stuck[0].stalledForMs).toBe(1_500)
  })

  test("a snapshot exactly at the threshold counts as stalled (>=, not >)", () => {
    const stuck = sweep([{ id: "a", lastActivityAt: 0 }], 1_000, 1_000)
    expect(stuck).toHaveLength(1)
  })

  test("recent activity is never reported, however old the sweep threshold", () => {
    const stuck = sweep([{ id: "a", lastActivityAt: 9_999 }], 1, 10_000)
    expect(stuck).toEqual([{ snapshot: { id: "a", lastActivityAt: 9_999 }, stalledForMs: 1 }])
  })

  test("an empty snapshot list is trivially not stuck", () => {
    expect(sweep([], 0, Date.now())).toEqual([])
  })

  test("defaults `now` to the real current time when omitted", () => {
    const longAgo = Date.now() - 100_000
    const stuck = sweep([{ id: "a", lastActivityAt: longAgo }], 1_000)
    expect(stuck).toHaveLength(1)
    expect(stuck[0].stalledForMs).toBeGreaterThanOrEqual(100_000)
  })

  test("is generic over richer snapshot shapes -- extra fields survive into the result", () => {
    interface RunSnapshot extends TokenMaxWatchdog.ActivitySnapshot {
      readonly sessionID: string
      readonly subagentType: string
    }
    const snapshot: RunSnapshot = { id: "run1", lastActivityAt: 0, sessionID: "ses_1", subagentType: "general" }
    const stuck = sweep<RunSnapshot>([snapshot], 100, 500)
    expect(stuck[0].snapshot.sessionID).toBe("ses_1")
    expect(stuck[0].snapshot.subagentType).toBe("general")
  })
})
