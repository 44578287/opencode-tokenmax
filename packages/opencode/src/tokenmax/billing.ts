import type { BillingType } from "./types"

export const BILLING_TYPE = {
  FREE: "FREE",
  PAYG_TOKEN: "PAYG_TOKEN",
  SUBSCRIPTION_QUOTA: "SUBSCRIPTION_QUOTA",
  LOCAL: "LOCAL",
  PROMOTIONAL_CREDIT: "PROMOTIONAL_CREDIT",
  UNKNOWN: "UNKNOWN",
} as const satisfies Record<string, BillingType>

export const AUTH_MODE = {
  OAUTH: "oauth",
  DEVICE_OAUTH: "device_oauth",
  API_KEY: "api-key",
  NONE: "none",
  UNKNOWN: "unknown",
} as const

export type AuthMode = (typeof AUTH_MODE)[keyof typeof AUTH_MODE]

const AUTH_BILLING_ADAPTER: Record<string, Partial<Record<string, BillingType>>> = {
  anthropic: {
    [AUTH_MODE.OAUTH]: BILLING_TYPE.SUBSCRIPTION_QUOTA,
    [AUTH_MODE.API_KEY]: BILLING_TYPE.PAYG_TOKEN,
  },
  "github-copilot": {
    [AUTH_MODE.OAUTH]: BILLING_TYPE.SUBSCRIPTION_QUOTA,
    [AUTH_MODE.DEVICE_OAUTH]: BILLING_TYPE.SUBSCRIPTION_QUOTA,
    [AUTH_MODE.API_KEY]: BILLING_TYPE.SUBSCRIPTION_QUOTA,
  },
  xai: {
    [AUTH_MODE.OAUTH]: BILLING_TYPE.SUBSCRIPTION_QUOTA,
    [AUTH_MODE.API_KEY]: BILLING_TYPE.PAYG_TOKEN,
  },
  openai: {
    [AUTH_MODE.OAUTH]: BILLING_TYPE.SUBSCRIPTION_QUOTA,
    [AUTH_MODE.API_KEY]: BILLING_TYPE.PAYG_TOKEN,
  },
}

export function isMonetaryFree(cost: { input?: number | null; output?: number | null } | null | undefined): boolean {
  if (!cost) return false
  if (cost.input == null || cost.output == null) return false
  return cost.input === 0 && cost.output === 0
}

export function isLocalEndpoint(providerId: string, cfg: { provider?: Record<string, { baseURL?: string; baseUrl?: string }> } = {}) {
  if (providerId === "local") return true
  const base = cfg.provider?.[providerId]?.baseURL || cfg.provider?.[providerId]?.baseUrl || ""
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(String(base))
}

export interface ClassifyCostInput {
  providerId: string
  cost?: { input?: number | null; output?: number | null; cacheRead?: number | null } | null
  authMode?: AuthMode
  overrides?: { disabled?: boolean; treat_as_free?: boolean; promotional_credit?: boolean; authMode?: AuthMode }
  cfg?: { provider?: Record<string, { baseURL?: string; baseUrl?: string }> }
}

export interface ClassifyCostResult {
  billingType: BillingType | "DISABLED"
  monetaryFree: boolean
  quotaBased: boolean
  authMode: AuthMode
  billingEvidence: string
  local: boolean
  costKnown: boolean
  inputPerMtok: number | null
  outputPerMtok: number | null
}

export function classifyCost(input: ClassifyCostInput): ClassifyCostResult {
  const cost = input.cost
  const overrides = input.overrides ?? {}
  const cfg = input.cfg ?? {}
  const costKnown = !!(cost && cost.input != null && cost.output != null)
  const zeroPriced = isMonetaryFree(cost)
  const local = isLocalEndpoint(input.providerId, cfg)
  const authMode = overrides.authMode ?? input.authMode ?? AUTH_MODE.NONE
  const adapter = AUTH_BILLING_ADAPTER[input.providerId]
  const subscription = !!(
    adapter &&
    (adapter[authMode] === BILLING_TYPE.SUBSCRIPTION_QUOTA ||
      (!adapter[authMode] && adapter[AUTH_MODE.API_KEY] === BILLING_TYPE.SUBSCRIPTION_QUOTA))
  )

  let billingType: BillingType | "DISABLED"
  if (overrides.disabled) billingType = "DISABLED"
  else if (local) billingType = BILLING_TYPE.LOCAL
  else if (subscription) billingType = BILLING_TYPE.SUBSCRIPTION_QUOTA
  else if (overrides.treat_as_free === true) billingType = BILLING_TYPE.FREE
  else if (overrides.promotional_credit === true) billingType = BILLING_TYPE.PROMOTIONAL_CREDIT
  else if (costKnown && zeroPriced) billingType = BILLING_TYPE.FREE
  else if (costKnown) billingType = BILLING_TYPE.PAYG_TOKEN
  else billingType = BILLING_TYPE.UNKNOWN

  return {
    billingType,
    monetaryFree: billingType === BILLING_TYPE.FREE || billingType === BILLING_TYPE.PROMOTIONAL_CREDIT,
    quotaBased: billingType === BILLING_TYPE.SUBSCRIPTION_QUOTA,
    authMode,
    billingEvidence: billingEvidenceOf(input.providerId, authMode, billingType),
    local,
    costKnown,
    inputPerMtok: costKnown ? (cost!.input ?? null) : null,
    outputPerMtok: costKnown ? (cost!.output ?? null) : null,
  }
}

export function billingEvidenceOf(providerId: string, authMode: string, billingType: string): string {
  if (billingType === BILLING_TYPE.FREE) return "catalog cost.input=0 AND cost.output=0"
  if (billingType === BILLING_TYPE.PROMOTIONAL_CREDIT) return "override promotional_credit"
  if (billingType === BILLING_TYPE.LOCAL) return "local endpoint baseURL"
  if (billingType === BILLING_TYPE.SUBSCRIPTION_QUOTA) {
    return `auth.json type=${authMode}; adapter ${providerId}/${authMode}→SUBSCRIPTION_QUOTA`
  }
  if (billingType === BILLING_TYPE.PAYG_TOKEN) {
    return `auth.json type=${authMode}; catalog nonzero token price`
  }
  return `auth.json type=${authMode || "unknown"}`
}
