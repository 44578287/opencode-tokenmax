import { describe, expect, it } from "bun:test"
import { detectEarlyStop, EarlyStopTracker, evaluateStop, type RunRequirement } from "../src/completion-gate"

describe("evaluateStop", () => {
  it("regression 3.7: finish_reason=stop with unmet requirements is CONTINUE, not DONE", () => {
    const decision = evaluateStop([
      { id: "start-child-a", description: "start Agent A", satisfied: false, source: "worker" },
      { id: "start-child-b", description: "start Agent B", satisfied: true, source: "worker" },
    ])
    expect(decision.outcome).toBe("CONTINUE")
    if (decision.outcome === "CONTINUE") {
      expect(decision.pendingRequirements.map((r) => r.id)).toEqual(["start-child-a"])
    }
  })

  it("reaches DONE only once every requirement is satisfied", () => {
    const decision = evaluateStop([
      { id: "verify", description: "verifier ran", satisfied: true, source: "verification" },
    ])
    expect(decision).toEqual({ outcome: "TERMINAL", state: "DONE", reason: "all requirements satisfied at stop" })
  })

  it("an empty requirement list is trivially DONE", () => {
    expect(evaluateStop([]).outcome).toBe("TERMINAL")
  })

  it("§17/§18 boundary: evaluateStop() has no textPreview/finish_reason parameter at all — model prose cannot reach it", () => {
    // Structural guarantee, not just a convention: the only input evaluateStop() accepts is
    // requirements sourced from dag/operation/worker/verification/objective. There is no code
    // path — regex, keyword match, or otherwise — for model text to influence this decision.
    expect(evaluateStop.length).toBe(1)
    const requirements: RunRequirement[] = [
      { id: "dag-node-3", description: "final DAG node", satisfied: true, source: "dag" },
      { id: "op-42", description: "build operation", satisfied: true, source: "operation" },
      { id: "objective", description: "user objective met", satisfied: true, source: "objective" },
    ]
    expect(evaluateStop(requirements).outcome).toBe("TERMINAL")
  })
})

describe("detectEarlyStop", () => {
  it("regression 3.7: catches 'I will start three agents' followed by zero tool calls", () => {
    const check = detectEarlyStop(
      { finishReason: "stop", toolCallsInTurn: 0, textPreview: "Next I'll start Agent A, B, and C to handle this." },
      false,
    )
    expect(check.earlyStop).toBe(true)
  })

  it("catches the Chinese phrasing called out in the brief", () => {
    expect(
      detectEarlyStop({ finishReason: "stop", toolCallsInTurn: 0, textPreview: "接下来我会启动三个 Agent" }, false)
        .earlyStop,
    ).toBe(true)
  })

  it("is not early-stop when the model actually called a tool", () => {
    expect(
      detectEarlyStop({ finishReason: "stop", toolCallsInTurn: 2, textPreview: "Let me check that." }, false).earlyStop,
    ).toBe(false)
  })

  it("is not early-stop when the caller observed real progress despite the intent phrasing", () => {
    expect(
      detectEarlyStop({ finishReason: "stop", toolCallsInTurn: 0, textPreview: "Let me continue." }, true).earlyStop,
    ).toBe(false)
  })

  it("is not early-stop when finish_reason is not stop", () => {
    expect(
      detectEarlyStop({ finishReason: "tool-calls", toolCallsInTurn: 0, textPreview: "I will do X" }, false).earlyStop,
    ).toBe(false)
  })

  it("plain stop with no intent phrasing and no progress is not classified as early-stop text", () => {
    expect(detectEarlyStop({ finishReason: "stop", toolCallsInTurn: 0, textPreview: "Done." }, false).earlyStop).toBe(
      false,
    )
  })
})

describe("EarlyStopTracker", () => {
  it("walks the fixed escalation ladder and never loops forever (regression: no infinite self-retry)", () => {
    const tracker = new EarlyStopTracker()
    const actions = [1, 2, 3, 4, 5].map(() => tracker.record("run1", { earlyStop: true, progressed: false }))
    expect(actions).toEqual([
      "REQUEST_TOOL_ACTION",
      "STRONGER_INSTRUCTION",
      "ROOT_FALLBACK",
      "EXPLICIT_FAILURE",
      "EXPLICIT_FAILURE",
    ])
  })

  it("resets the streak the moment real progress is observed", () => {
    const tracker = new EarlyStopTracker()
    tracker.record("run1", { earlyStop: true, progressed: false })
    tracker.record("run1", { earlyStop: true, progressed: false })
    expect(tracker.consecutiveCount("run1")).toBe(2)
    tracker.record("run1", { earlyStop: false, progressed: true })
    expect(tracker.consecutiveCount("run1")).toBe(0)
    expect(tracker.record("run1", { earlyStop: true, progressed: false })).toBe("REQUEST_TOOL_ACTION")
  })

  it("tracks separate runs independently", () => {
    const tracker = new EarlyStopTracker()
    tracker.record("run1", { earlyStop: true, progressed: false })
    tracker.record("run1", { earlyStop: true, progressed: false })
    tracker.record("run2", { earlyStop: true, progressed: false })
    expect(tracker.consecutiveCount("run1")).toBe(2)
    expect(tracker.consecutiveCount("run2")).toBe(1)
  })
})
