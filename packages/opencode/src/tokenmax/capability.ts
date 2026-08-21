import type { Store } from "./persist"
import { affectsCapability } from "./error"
import { routeKey } from "./types"

const EMA_ALPHA = 0.3

export function getCapability(store: Store, key: string, taskClass: string): { samples: number; ema: number; success: number } {
  const row = store.db
    .query("SELECT samples, ema, success FROM route_capabilities WHERE route_key=? AND task_class=?")
    .get(key, taskClass) as { samples: number; ema: number; success: number } | undefined
  return row ?? { samples: 0, ema: 0.5, success: 0 }
}

export function recordCapability(
  store: Store,
  input: { providerId: string; modelId: string; variant?: string; taskClass: string; ok: boolean; errorCategory?: string | null },
): { updated: boolean; ema: number; samples: number } {
  const key = routeKey(input.providerId, input.modelId, input.variant)
  if (!affectsCapability(input.errorCategory, input.ok)) {
    return { updated: false, ...getCapability(store, key, input.taskClass) }
  }
  const prev = getCapability(store, key, input.taskClass)
  const samples = prev.samples + 1
  const success = prev.success + (input.ok ? 1 : 0)
  const ema = prev.samples === 0 ? (input.ok ? 1 : 0) : prev.ema * (1 - EMA_ALPHA) + (input.ok ? 1 : 0) * EMA_ALPHA
  store.db.run(
    `INSERT INTO route_capabilities(route_key, task_class, samples, success, ema, last_updated)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(route_key, task_class) DO UPDATE SET
       samples=excluded.samples, success=excluded.success, ema=excluded.ema, last_updated=excluded.last_updated`,
    [key, input.taskClass, samples, success, ema, new Date().toISOString()],
  )
  return { updated: true, ema, samples }
}
