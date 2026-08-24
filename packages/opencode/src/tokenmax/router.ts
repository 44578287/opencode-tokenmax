export * as TokenMaxRouter from "./router"

// R2 -- Native Child Routing (docs/TOKENMAX-ROADMAP.md). Automatic model
// selection for subagents (packages/opencode/src/tool/task.ts): given the
// requirements a subagent task actually needs, pick the cheapest connected,
// enabled, capable, RELIABLE resource from TokenMaxRegistry -- replacing
// (only when the caller opts in, see policy.ts's `router.enabled`) the
// naive "copy whatever model the parent conversation happens to be using"
// fallback that runs today.
//
// R3 addition -- Intelligent Resource Scheduling (docs/TOKENMAX-ROADMAP.md):
// candidates with enough recent history (TokenMaxTelemetry) AND a poor
// success rate are excluded before the cost-based sort runs. This was
// explicitly out of scope for R2 ("building that here would be getting
// ahead of the roadmap's own ordering") -- now that real history exists to
// learn from, it's R3's turn. See reliability.ts for the scoring rules
// (cold start = fully trusted, a single bad run is never enough signal).
// Deliberately still rule-based, not a learned model.
//
// select() ALWAYS returns a usable selection, never a "no resource" error:
// if nothing eligible is connected, it returns the caller-supplied
// fallback with a reason saying so, rather than failing subagent dispatch
// outright. If reliability filtering would exclude every candidate, it's
// skipped rather than applied -- an unreliable resource is still strictly
// better than no dispatch at all. The router degrading gracefully to
// today's behavior is a stronger guarantee than the router being smart.

import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { TokenMaxRegistry } from "./registry"
import { TokenMaxBilling } from "./billing"
import { TokenMaxTelemetry } from "./telemetry"
import { TokenMaxReliability } from "./reliability"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"

export interface ModelRef {
  readonly providerID: ProviderV2.ID
  readonly modelID: ModelV2.ID
}

export interface SelectInput {
  readonly requireToolCall?: boolean
  readonly requireReasoning?: boolean
  readonly requireTemperature?: boolean
  readonly fallback: ModelRef
}

export interface Selection extends ModelRef {
  readonly reason: string
}

export interface Interface {
  readonly select: (input: SelectInput) => Effect.Effect<Selection>
}

export class Service extends Context.Service<Service, Interface>()("@tokenmax/Router") {}

// free < economy < standard < premium -- automatic selection prefers the
// cheapest tier that's actually eligible, not the fanciest.
const billingOrder: Record<TokenMaxBilling.Class, number> = { free: 0, economy: 1, standard: 2, premium: 3 }

function resourceKey(ref: { providerID: string; modelID: string }) {
  return `${ref.providerID}/${ref.modelID}`
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* TokenMaxRegistry.Service
    const telemetry = yield* TokenMaxTelemetry.Service

    const select = Effect.fn("TokenMaxRouter.select")(function* (input: SelectInput) {
      const resources = yield* registry.list()
      const candidates = resources.filter((r) => {
        if (!r.connected || !r.enabled) return false
        if (input.requireToolCall && !r.capabilities.toolcall) return false
        if (input.requireReasoning && !r.capabilities.reasoning) return false
        if (input.requireTemperature && !r.capabilities.temperature) return false
        return true
      })

      if (candidates.length === 0) {
        return { ...input.fallback, reason: "no eligible connected resource -- kept the fallback model" }
      }

      // R3: exclude candidates with enough recent history to be a real
      // signal AND a poor success rate. Never applied if it would remove
      // every candidate -- see this file's own header comment.
      const events = yield* telemetry.list()
      const samplesByResource = new Map<string, TokenMaxReliability.OutcomeSample[]>()
      for (const event of events) {
        const key = resourceKey(event)
        const list = samplesByResource.get(key) ?? []
        list.push({ outcome: event.outcome })
        samplesByResource.set(key, list)
      }
      const reliable = candidates.filter((c) => {
        const samples = samplesByResource.get(resourceKey(c)) ?? []
        return !TokenMaxReliability.isUnreliable(TokenMaxReliability.score(samples))
      })
      const eligible = reliable.length > 0 ? reliable : candidates
      const excludedForReliability = candidates.length - eligible.length

      eligible.sort(
        (a, b) =>
          billingOrder[a.billingClass] - billingOrder[b.billingClass] ||
          TokenMaxBilling.blendedPerMTok(a.cost) - TokenMaxBilling.blendedPerMTok(b.cost),
      )
      const picked = eligible[0]
      const reliabilityNote =
        excludedForReliability > 0
          ? `, excluded ${excludedForReliability} unreliable resource(s)`
          : ""
      return {
        providerID: picked.providerID,
        modelID: picked.modelID,
        reason: `cheapest eligible resource (billingClass=${picked.billingClass})${reliabilityNote}`,
      }
    })

    return Service.of({ select })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [TokenMaxRegistry.node, TokenMaxTelemetry.node] })
