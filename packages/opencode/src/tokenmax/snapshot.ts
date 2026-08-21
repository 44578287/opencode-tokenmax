import { VERSION } from "./version"
import { countRoutes, type Store } from "./persist"
import type { TokenMaxStatus, TokenMaxWorker } from "./types"

export function status(store: Store, enabled: boolean): TokenMaxStatus {
  const workers = store.db.query("SELECT * FROM workers").all() as Array<Record<string, string | null>>
  return {
    enabled,
    version: VERSION,
    dbPath: store.dbPath,
    routeCount: countRoutes(store),
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
