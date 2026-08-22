export type BillingType =
  | "FREE"
  | "SUBSCRIPTION_QUOTA"
  | "PROMOTIONAL_CREDIT"
  | "LOCAL"
  | "PAYG_TOKEN"
  | "UNKNOWN"

export type Availability =
  | "CATALOG_ONLY"
  | "PROVIDER_LISTED"
  | "VERIFIED_CALLABLE"
  | "VERIFIED_STALE"
  | "TEMP_UNAVAILABLE"
  | "MODEL_NOT_FOUND"
  | "STALE"
  | "UNKNOWN"

export type RouteKey = string

export interface Route {
  providerId: string
  modelId: string
  variant: string
  billing: BillingType
  availability: Availability
  costKnown: boolean
  monetaryFree: boolean
  inputPerMtok: number | null
  outputPerMtok: number | null
  reasoning: boolean
  tools: boolean
  vision: boolean
  contextLimit: number | null
  health: number
  quotaPressure: number | null
}

export interface Task {
  text?: string
  taskClass?: string
  complexity?: "low" | "medium" | "high"
  requiredSuccess?: number
}

export interface RouteDecision {
  provider: string
  model: string
  variant: string
  billing: BillingType
  capabilityFit: number
  historicalConfidence: number
  providerHealth: number
  quotaPressure: number | null
  estimatedMarginalCost: number | null
  reason: string
  key: RouteKey
}

export interface TokenMaxWorker {
  id: string
  parentSessionID: string
  childSessionID: string
  role: string
  provider: string
  model: string
  variant: string
  billing?: string
  progress?: string
  state: "queued" | "running" | "waiting_event" | "completed" | "failed" | "cancelled"
  startedAt: string | null
  completedAt: string | null
  fallbackFrom: string | null
  errorCategory: string | null
}

export type OperationType = "PROCESS" | "GITHUB_ACTIONS" | "FILE" | "TRANSFER" | "PROVIDER" | "CHILD_WORKER"

export type OperationState =
  | "CREATED"
  | "RUNNING"
  | "WAITING_EVENT"
  | "COMPLETED"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLED"

export interface TokenMaxOperation {
  id: string
  type: OperationType
  ownerSessionID: string | null
  ownerRunID: string | null
  ownerWorkerID: string | null
  ownerDagNode: string | null
  state: OperationState
  startedAt: string
  lastProgressAt: string
  deadlineAt: string | null
  activeHandle: string | null
  result: Record<string, unknown> | null
  error: Record<string, unknown> | null
  completedAt: string | null
}

export interface TokenMaxQuotaState {
  providerId: string
  remaining: number | null
  remainingConfidence: number
  resetAt: string | null
  source: "api" | "runtime" | "headers" | "error" | "observed" | "override" | "UNKNOWN"
}

export interface TokenMaxProviderState {
  providerId: string
  health: number
  authMode: string
  billing: BillingType
}

export interface TokenMaxStatus {
  enabled: boolean
  mode: "NATIVE" | "LEGACY_PLUGIN" | "OFF"
  version: string
  dbPath: string
  routeCount: number
  leftoverPlugins: string[]
  leftoverAgents: string[]
  leftoverCommands: string[]
  strippedPlugins: string[]
  workers: TokenMaxWorker[]
  operations: TokenMaxOperation[]
}

export function routeKey(providerId: string, modelId: string, variant = ""): RouteKey {
  return variant ? `${providerId}/${modelId}#${variant}` : `${providerId}/${modelId}`
}

export function parseRouteKey(key: RouteKey): { providerId: string; modelId: string; variant: string } {
  const hash = key.indexOf("#")
  const base = hash >= 0 ? key.slice(0, hash) : key
  const variant = hash >= 0 ? key.slice(hash + 1) : ""
  const slash = base.indexOf("/")
  if (slash < 0) return { providerId: "", modelId: base, variant }
  return { providerId: base.slice(0, slash), modelId: base.slice(slash + 1), variant }
}
