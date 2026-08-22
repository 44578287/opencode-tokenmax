import type { Route, TokenMaxWorker } from "./types"

export type CompletionState = "DONE" | "BLOCKED" | "NEEDS_USER" | "FAILED" | "INCOMPLETE"

export type CompletionGate = {
  state: CompletionState
  reason?: "pending_workers" | "worker_failed" | "future_intent" | "needs_user" | "early_stop_limit"
  action?: "continue" | "root_fallback" | "fail"
  instruction?: string
}

const futureIntent = [
  /\bi will\b/i,
  /\blet me\b/i,
  /\bnext i(?:'ll| will)\b/i,
  /\bnow i(?:'ll| will)\b/i,
  /\bi(?:'ll| will) launch\b/i,
  /\bthen i(?:'ll| will)\b/i,
  /接下来我会/,
  /现在开始/,
  /让我/,
  /我将/,
]

const needsUser = [
  /\b(?:please )?(?:provide|enter|share) (?:your )?(?:password|token|api key|path)\b/i,
  /\bi need (?:your )?(?:password|token|api key|path)\b/i,
  /需要.{0,12}(?:密码|令牌|路径|授权)/,
  /请.{0,12}(?:提供|输入).{0,12}(?:密码|令牌|路径|授权)/,
]

export function assistantText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim()
}

export function evaluateCompletionGate(input: {
  assistantText: string
  toolCalls: boolean
  workers: TokenMaxWorker[]
  earlyStops: number
}): CompletionGate {
  const active = input.workers.filter(
    (worker) => worker.state === "queued" || worker.state === "running" || worker.state === "waiting_event",
  )
  if (active.length > 0) {
    return {
      state: "INCOMPLETE",
      reason: "pending_workers",
      action: "continue",
      instruction: "TokenMax has pending workers. Wait for their results, then verify and complete the user objective before finalizing.",
    }
  }

  if (input.workers.length > 0 && input.workers.every((worker) => worker.state === "failed" || worker.state === "cancelled")) {
    return { state: "BLOCKED", reason: "worker_failed" }
  }

  if (needsUser.some((pattern) => pattern.test(input.assistantText))) {
    return { state: "NEEDS_USER", reason: "needs_user" }
  }

  if (!input.toolCalls && futureIntent.some((pattern) => pattern.test(input.assistantText))) {
    if (input.earlyStops >= 2) {
      return { state: "FAILED", reason: "early_stop_limit", action: "fail" }
    }
    if (input.earlyStops === 1) {
      return {
        state: "INCOMPLETE",
        reason: "future_intent",
        action: "root_fallback",
        instruction:
          "The prior root turn declared work but executed none. Execute the next concrete tool or worker dispatch now. Do not describe future work and stop.",
      }
    }
    return {
      state: "INCOMPLETE",
      reason: "future_intent",
      action: "continue",
      instruction:
        "Completion gate rejected the prior response because it only declared future work. Perform the concrete tool calls or worker dispatch now, then report results.",
    }
  }

  return { state: "DONE" }
}

export function fallbackRoute(routes: Route[], current: { providerID: string; modelID: string; variant?: string }) {
  return routes
    .filter((route) => {
      if (route.billing === "PAYG_TOKEN") return false
      if (!["PROVIDER_LISTED", "VERIFIED_CALLABLE", "VERIFIED_STALE"].includes(route.availability)) return false
      return route.providerId !== current.providerID || route.modelId !== current.modelID || route.variant !== (current.variant ?? "")
    })
    .sort((a, b) => b.health - a.health || (b.reasoning ? 1 : 0) - (a.reasoning ? 1 : 0))[0]
}
