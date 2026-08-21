import type { Store } from "./persist"

export function recordEvent(store: Store, kind: string, routeKey?: string, payload?: Record<string, unknown>) {
  store.db.run("INSERT INTO usage_events(ts, kind, route_key, payload) VALUES(?,?,?,?)", [
    new Date().toISOString(),
    kind,
    routeKey ?? null,
    payload ? JSON.stringify(payload) : null,
  ])
}
