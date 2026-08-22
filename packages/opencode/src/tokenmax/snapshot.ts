import { VERSION } from "./version"
import { countRoutes, type Store } from "./persist"
import type { TokenMaxStatus, TokenMaxWorker } from "./types"
import { inspectTokenMax, type TokenMaxConfigSlice } from "./legacy"
import { listOperations } from "./operation"

export function status(store: Store, enabled: boolean, cfg?: TokenMaxConfigSlice | null): TokenMaxStatus {
  const diag = inspectTokenMax(cfg ?? { experimental: { tokenmax: { enabled } } })
  const workers = store.db.query("SELECT * FROM workers").all() as Array<Record<string, string | null>>
  return {
    enabled,
    mode: diag.mode,
    leftoverPlugins: diag.leftoverPlugins,
    leftoverAgents: diag.leftoverAgents,
    leftoverCommands: diag.leftoverCommands,
    strippedPlugins: diag.strippedPlugins,
    version: VERSION,
    dbPath: store.dbPath,
    routeCount: countRoutes(store),
    operations: listOperations(store),
    workers: workers.map(
      (row): TokenMaxWorker => ({
        id: String(row.id),
        parentSessionID: String(row.parent_session_id ?? ""),
        childSessionID: String(row.child_session_id ?? ""),
        role: String(row.role ?? ""),
        provider: String(row.provider ?? ""),
        model: String(row.model ?? ""),
        variant: String(row.variant ?? ""),
        state: (row.state as TokenMaxWorker["state"]) ?? "queued",
        startedAt: row.started_at,
        completedAt: row.completed_at,
        billing: row.billing ? String(row.billing) : undefined,
        progress: row.progress ? String(row.progress) : undefined,
        fallbackFrom: row.fallback_from,
        errorCategory: row.error_category,
      }),
    ),
  }
}
