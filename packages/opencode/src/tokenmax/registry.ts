import { classifyCost } from "./billing"
import type { AuthMode } from "./billing"
import type { Availability, BillingType, Route } from "./types"
import { upsertRoute, type Store } from "./persist"

export interface CatalogModel {
  id: string
  cost?: { input?: number | null; output?: number | null }
  reasoning?: boolean
  tool_call?: boolean
  modalities?: { input?: string[] }
  limit?: { context?: number }
  variants?: string[]
}

export interface CatalogProvider {
  id: string
  models: Record<string, CatalogModel>
}

export function expandRoutes(input: {
  providers: CatalogProvider[]
  authModeOf?: (providerId: string) => AuthMode
  cfg?: { provider?: Record<string, { baseURL?: string; baseUrl?: string }> }
}): Route[] {
  const routes: Route[] = []
  for (const provider of input.providers) {
    for (const model of Object.values(provider.models)) {
      const variants = model.reasoning && model.variants?.length ? ["", ...model.variants] : [""]
      const pricing = classifyCost({
        providerId: provider.id,
        cost: model.cost,
        authMode: input.authModeOf?.(provider.id),
        cfg: input.cfg,
      })
      for (const variant of variants) {
        routes.push({
          providerId: provider.id,
          modelId: model.id,
          variant,
          billing: pricing.billingType === "DISABLED" ? "UNKNOWN" : (pricing.billingType as BillingType),
          availability: "UNKNOWN",
          costKnown: pricing.costKnown,
          monetaryFree: pricing.monetaryFree,
          inputPerMtok: pricing.inputPerMtok,
          outputPerMtok: pricing.outputPerMtok,
          reasoning: !!model.reasoning,
          tools: model.tool_call !== false,
          vision: !!model.modalities?.input?.includes("image"),
          contextLimit: model.limit?.context ?? null,
          health: 1,
          quotaPressure: null,
        })
      }
    }
  }
  return routes
}

export function syncRoutes(store: Store, routes: Route[]) {
  for (const route of routes) {
    upsertRoute(store, {
      providerId: route.providerId,
      modelId: route.modelId,
      variant: route.variant,
      billingType: route.billing,
      availability: route.availability,
      monetaryFree: route.monetaryFree,
      costKnown: route.costKnown,
      costInput: route.inputPerMtok,
      costOutput: route.outputPerMtok,
      reasoning: route.reasoning,
      tools: route.tools,
      vision: route.vision,
      contextLimit: route.contextLimit,
    })
  }
}

export function setAvailability(store: Store, providerId: string, modelId: string, variant: string, availability: Availability) {
  store.db.run("UPDATE routes SET availability=? WHERE provider_id=? AND model_id=? AND variant=?", [
    availability,
    providerId,
    modelId,
    variant,
  ])
}
