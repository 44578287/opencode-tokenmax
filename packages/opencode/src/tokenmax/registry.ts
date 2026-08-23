export * as TokenMaxRegistry from "./registry"

// R1 — Native Resource Core (docs/TOKENMAX-ROADMAP.md). This is
// deliberately a thin composition layer over Provider.Service, not a
// reimplementation of provider/model listing -- Provider.Service already
// owns discovery, auth, and capability/cost metadata (see
// packages/opencode/src/provider/provider.ts); duplicating that here would
// violate the reuse criteria in docs/TOKENMAX-DECISIONS.md ("Is there
// already an upstream primitive that does this?"). What TokenMax actually
// adds: billing classification (billing.ts), policy-driven enable/disable
// overrides (policy.ts), and a stable boundary R2's router can depend on
// without reaching into Provider internals directly.
//
// Scope note: list() currently returns only *connected* resources (mirrors
// Provider.Service.list(), which itself only returns providers it could
// successfully initialize -- see
// server/routes/instance/httpapi/handlers/provider.ts for the same
// connected-vs-catalog distinction against ModelsDev's full provider
// catalog). Surfacing the full not-yet-connected catalog (so
// /tokenmax-status can show "available to configure") is real, useful,
// explicitly out of scope for this slice, and not yet done -- `connected`
// is kept on Resource now (always true today) so the API shape doesn't
// need to change when that's added.
//
// No automatic dispatch here or anywhere in R1 -- this only reports what
// exists and its state.

import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Provider } from "@/provider/provider"
import { TokenMaxPolicy } from "./policy"
import { TokenMaxBilling } from "./billing"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"

export interface Resource {
  readonly providerID: ProviderV2.ID
  readonly modelID: ModelV2.ID
  readonly providerName: string
  readonly modelName: string
  readonly capabilities: Provider.Model["capabilities"]
  readonly cost: Provider.Model["cost"]
  readonly billingClass: TokenMaxBilling.Class
  readonly connected: boolean
  readonly enabled: boolean
}

export interface Interface {
  readonly list: () => Effect.Effect<Resource[]>
}

export class Service extends Context.Service<Service, Interface>()("@tokenmax/ResourceRegistry") {}

function billingThresholds(policy: TokenMaxPolicy.Info): TokenMaxBilling.Thresholds {
  return {
    economyMaxPerMTok: policy.billing?.economyMaxPerMTok ?? TokenMaxBilling.defaultThresholds.economyMaxPerMTok,
    standardMaxPerMTok: policy.billing?.standardMaxPerMTok ?? TokenMaxBilling.defaultThresholds.standardMaxPerMTok,
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const policy = yield* TokenMaxPolicy.Service

    const list = Effect.fn("TokenMaxRegistry.list")(function* () {
      const providers = yield* provider.list()
      const p = yield* policy.get()
      const thresholds = billingThresholds(p)

      const resources: Resource[] = []
      for (const info of Object.values(providers)) {
        const providerOverride = p.providers?.[info.id]
        const providerEnabled = providerOverride?.enabled ?? true
        for (const model of Object.values(info.models)) {
          const modelEnabled = providerOverride?.models?.[model.id]?.enabled ?? true
          resources.push({
            providerID: model.providerID,
            modelID: model.id,
            providerName: info.name,
            modelName: model.name,
            capabilities: model.capabilities,
            cost: model.cost,
            billingClass: TokenMaxBilling.classify(model.cost, thresholds),
            connected: true,
            enabled: providerEnabled && modelEnabled,
          })
        }
      }
      return resources
    })

    return Service.of({ list })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Provider.node, TokenMaxPolicy.node] })
