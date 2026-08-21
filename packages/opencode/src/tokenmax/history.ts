import type { Store } from "./persist"
import { recordEvent } from "./telemetry"

export function recordAttempt(
  store: Store,
  input: {
    sessionId?: string
    routeKey: string
    taskClass?: string
    status: string
    errorCategory?: string | null
    tokensIn?: number
    tokensOut?: number
    latencyMs?: number
  },
) {
  store.db.run(
    `INSERT INTO task_attempts(session_id, route_key, task_class, status, error_category, tokens_in, tokens_out, latency_ms, started_at, finished_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [
      input.sessionId ?? null,
      input.routeKey,
      input.taskClass ?? null,
      input.status,
      input.errorCategory ?? null,
      input.tokensIn ?? 0,
      input.tokensOut ?? 0,
      input.latencyMs ?? 0,
      new Date().toISOString(),
      new Date().toISOString(),
    ],
  )
  recordEvent(store, input.status, input.routeKey, { errorCategory: input.errorCategory })
}
