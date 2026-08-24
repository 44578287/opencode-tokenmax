export * as TokenMaxRequirements from "./requirements"

// R2 -- Native Child Routing (docs/TOKENMAX-ROADMAP.md). Derive a
// subagent's ACTUAL capability requirements from what the specific agent
// declares, instead of the single hardcoded `requireToolCall: true`
// tool/task.ts used for every subagent (roadmap R2 "not yet done"). A
// tool-less agent (one whose permission ruleset disables every tool -- a
// pure summarizer, say) must not be forced onto a tool-capable model,
// which needlessly excludes cheaper non-tool models; an agent that pins a
// temperature must not be routed to a model that doesn't support it.
//
// Pure and non-circular on purpose: it takes already-resolved facts
// (whether the agent has any tool enabled, and its declared temperature),
// not the agent object or the tool registry, so it never needs a model to
// decide requirements -- which matters because these requirements are the
// INPUT to model selection.
//
// Deliberately conservative about what it derives. `requireReasoning` is
// NOT derived here: the only agent-level signal for it is `variant`, whose
// "is this a reasoning variant" meaning is per-model (circular) and easy to
// get wrong in a way that needlessly excludes good models. Leaving it
// un-required is the honest, safe default until a reliable signal exists
// (tracked in docs/TOKENMAX-ROADMAP.md).

export interface DeriveInput {
  /** Whether the agent has at least one tool enabled by its permission ruleset. */
  readonly hasEnabledTools: boolean
  /** The agent's declared sampling temperature, if it pins one. */
  readonly temperature?: number
}

export interface Requirements {
  readonly requireToolCall: boolean
  readonly requireTemperature: boolean
}

export function derive(input: DeriveInput): Requirements {
  return {
    requireToolCall: input.hasEnabledTools,
    requireTemperature: input.temperature !== undefined,
  }
}
