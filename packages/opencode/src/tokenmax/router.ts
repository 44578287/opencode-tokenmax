export * as TokenMaxRouter from "./router"

// R2 -- Native Child Routing (docs/TOKENMAX-ROADMAP.md). Automatic model
// selection for subagents (packages/opencode/src/tool/task.ts): given the
// requirements a subagent task actually needs, pick the cheapest connected,
// enabled, capable resource from TokenMaxRegistry -- replacing (only when
// the caller opts in, see policy.ts's `router.enabled`) the naive "copy
// whatever model the parent conversation happens to be using" fallback
// that runs today.
//
// Deliberately rule-based, not learned: capability filtering + cheapest-
// first is honest R2 scope. Historical-outcome-weighted selection is R3
// ("Intelligent Resource Scheduling") -- building that here would be
// getting ahead of the roadmap's own ordering.
//
// select() ALWAYS returns a usable selection, never a "no resource" error:
// if nothing eligible is connected, it returns the caller-supplied
// fallback with a reason saying so, rather than failing subagent dispatch
// outright. The router degrading gracefully to today's behavior is a
// stronger guarantee than the router being smart.

import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { TokenMaxRegistry } from "./registry"
import { TokenMaxBilling } from "./billing"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"

export interface ModelRef {
  readonly providerID: ProviderV2.ID
  readonly modelID: ModelV2.ID
}

export interface SelectInput {
  readonly requireToolCall?: boolean
  readonly requireReasoning?: boolean
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

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* TokenMaxRegistry.Service

    const select = Effect.fn("TokenMaxRouter.select")(function* (input: SelectInput) {
      const resources = yield* registry.list()
      const candidates = resources.filter((r) => {
        if (!r.connected || !r.enabled) return false
        if (input.requireToolCall && !r.capabilities.toolcall) return false
        if (input.requireReasoning && !r.capabilities.reasoning) return false
        return true
      })

      if (candidates.length === 0) {
        return { ...input.fallback, reason: "no eligible connected resource -- kept the fallback model" }
      }

      candidates.sort(
        (a, b) =>
          billingOrder[a.billingClass] - billingOrder[b.billingClass] ||
          TokenMaxBilling.blendedPerMTok(a.cost) - TokenMaxBilling.blendedPerMTok(b.cost),
      )
      const picked = candidates[0]
      return {
        providerID: picked.providerID,
        modelID: picked.modelID,
        reason: `cheapest eligible resource (billingClass=${picked.billingClass})`,
      }
    })

    return Service.of({ select })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [TokenMaxRegistry.node] })
