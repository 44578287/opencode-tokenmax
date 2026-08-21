import type { Store } from "./persist"
import type { TokenMaxQuotaState } from "./types"

export function getQuota(store: Store, providerId: string): TokenMaxQuotaState {
  const row = store.db.query("SELECT * FROM quota_resources WHERE provider_id=?").get(providerId) as
    | {
        provider_id: string
        remaining: number | null
        remaining_confidence: number
        reset_at: string | null
        source: TokenMaxQuotaState["source"]
      }
    | undefined
  if (!row) {
    return {
      providerId,
      remaining: null,
      remainingConfidence: 0,
      resetAt: null,
      source: "UNKNOWN",
    }
  }
  return {
    providerId: row.provider_id,
    remaining: row.remaining,
    remainingConfidence: row.remaining_confidence ?? 0,
    resetAt: row.reset_at,
    source: row.source || "UNKNOWN",
  }
}

export function observeQuota(
  store: Store,
  input: {
    providerId: string
    remaining?: number | null
    remainingConfidence?: number
    resetAt?: string | null
    source: TokenMaxQuotaState["source"]
  },
): TokenMaxQuotaState {
  const remaining = input.remaining === undefined ? null : input.remaining
  const confidence = remaining == null ? 0 : (input.remainingConfidence ?? 0)
  store.db.run(
    `INSERT INTO quota_resources(provider_id, remaining, remaining_confidence, reset_at, source)
     VALUES(?,?,?,?,?)
     ON CONFLICT(provider_id) DO UPDATE SET
       remaining=excluded.remaining,
       remaining_confidence=excluded.remaining_confidence,
       reset_at=excluded.reset_at,
       source=excluded.source`,
    [input.providerId, remaining, confidence, input.resetAt ?? null, input.source],
  )
  return getQuota(store, input.providerId)
}
