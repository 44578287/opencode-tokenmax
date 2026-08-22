import type { AuthMode } from "./billing"
import { AUTH_MODE } from "./billing"
import { expandRoutes, syncRoutes, type CatalogProvider } from "./registry"
import type { Store } from "./persist"

export function authModeOf(entry: { type?: string } | undefined, providerId: string): AuthMode {
  if (!entry?.type) return AUTH_MODE.NONE
  if (entry.type === "oauth") return providerId === "github-copilot" ? AUTH_MODE.DEVICE_OAUTH : AUTH_MODE.OAUTH
  if (entry.type === "api" || entry.type === "wellknown") return AUTH_MODE.API_KEY
  return AUTH_MODE.UNKNOWN
}

export function mapProvider(input: {
  id: string
  models: Record<
    string,
    {
      id?: string
      cost?: { input?: number; output?: number }
      capabilities?: { reasoning?: boolean; toolcall?: boolean; input?: { image?: boolean } }
      limit?: { context?: number }
      variants?: Record<string, unknown>
    }
  >
}): CatalogProvider {
  const models: CatalogProvider["models"] = {}
  for (const [id, model] of Object.entries(input.models ?? {})) {
    models[id] = {
      id: model.id ?? id,
      cost: model.cost,
      reasoning: model.capabilities?.reasoning,
      tool_call: model.capabilities?.toolcall,
      modalities: { input: model.capabilities?.input?.image ? ["image"] : [] },
      limit: { context: model.limit?.context },
      variants: model.variants ? Object.keys(model.variants) : undefined,
    }
  }
  return { id: input.id, models }
}

type ProviderLike = {
  id: string
  models: Record<
    string,
    {
      id?: string
      cost?: { input?: number; output?: number }
      capabilities?: { reasoning?: boolean; toolcall?: boolean; input?: { image?: boolean } }
      limit?: { context?: number }
      variants?: Record<string, unknown>
    }
  >
}

export function syncCatalog(
  store: Store,
  providers: ProviderLike[],
  auths: Record<string, { type?: string }>,
  cfg?: { provider?: Record<string, { baseURL?: string; baseUrl?: string }> },
) {
  const catalog = providers.map((provider) => mapProvider(provider))
  const routes = expandRoutes({
    providers: catalog,
    authModeOf: (providerId) => authModeOf(auths[providerId], providerId),
    cfg,
  })
  syncRoutes(store, routes)
  return routes.length
}
