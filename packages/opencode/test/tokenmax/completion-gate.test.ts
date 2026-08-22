import { describe, expect, test } from "bun:test"
import { evaluateCompletionGate, fallbackRoute } from "../../src/tokenmax/completion-gate"
import type { TokenMaxWorker } from "../../src/tokenmax/types"

const worker = (state: TokenMaxWorker["state"]): TokenMaxWorker => ({
  id: "w1",
  parentSessionID: "ses_root",
  childSessionID: "ses_child",
  role: "search",
  provider: "opencode",
  model: "hy3-free",
  variant: "",
  state,
  startedAt: null,
  completedAt: null,
  fallbackFrom: null,
  errorCategory: null,
})

describe("tokenmax completion gate", () => {
  test("A: future intent without tool work continues the run", () => {
    const gate = evaluateCompletionGate({
      assistantText: "I'll launch three agents now.",
      toolCalls: false,
      workers: [],
      earlyStops: 0,
    })
    expect(gate.state).toBe("INCOMPLETE")
    expect(gate.action).toBe("continue")
  })

  test("B: pending DAG worker cannot end the run", () => {
    const gate = evaluateCompletionGate({
      assistantText: "Analysis complete.",
      toolCalls: false,
      workers: [worker("completed"), worker("running")],
      earlyStops: 0,
    })
    expect(gate.state).toBe("INCOMPLETE")
    expect(gate.reason).toBe("pending_workers")
  })

  test("C: completed work plus final answer is done", () => {
    const gate = evaluateCompletionGate({
      assistantText: "The requested analysis is complete.",
      toolCalls: false,
      workers: [worker("completed")],
      earlyStops: 0,
    })
    expect(gate.state).toBe("DONE")
  })

  test("D: explicit credential request needs user input", () => {
    const gate = evaluateCompletionGate({
      assistantText: "Please provide your API key to continue.",
      toolCalls: false,
      workers: [],
      earlyStops: 0,
    })
    expect(gate.state).toBe("NEEDS_USER")
  })

  test("E: bounded no-progress stops escalate then fail", () => {
    const input = { assistantText: "Let me inspect the files next.", toolCalls: false, workers: [] }
    expect(evaluateCompletionGate({ ...input, earlyStops: 1 }).action).toBe("root_fallback")
    expect(evaluateCompletionGate({ ...input, earlyStops: 2 }).state).toBe("FAILED")
  })

  test("fallback never selects PAYG or the same route", () => {
    const route = fallbackRoute(
      [
        { providerId: "openai", modelId: "root", variant: "", billing: "SUBSCRIPTION_QUOTA", availability: "VERIFIED_CALLABLE", costKnown: true, monetaryFree: false, inputPerMtok: null, outputPerMtok: null, reasoning: true, tools: true, vision: false, contextLimit: null, health: 0.9, quotaPressure: null },
        { providerId: "xai", modelId: "fallback", variant: "high", billing: "SUBSCRIPTION_QUOTA", availability: "PROVIDER_LISTED", costKnown: true, monetaryFree: false, inputPerMtok: null, outputPerMtok: null, reasoning: true, tools: true, vision: false, contextLimit: null, health: 0.8, quotaPressure: null },
        { providerId: "paid", modelId: "blocked", variant: "", billing: "PAYG_TOKEN", availability: "VERIFIED_CALLABLE", costKnown: true, monetaryFree: false, inputPerMtok: 1, outputPerMtok: 1, reasoning: true, tools: true, vision: false, contextLimit: null, health: 1, quotaPressure: null },
      ],
      { providerID: "openai", modelID: "root" },
    )
    expect(route?.providerId).toBe("xai")
  })
})
