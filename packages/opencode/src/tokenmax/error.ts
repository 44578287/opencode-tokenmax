export const ErrorClass = {
  AUTH_401: "AUTH_401",
  RATE_LIMIT_429: "RATE_LIMIT_429",
  QUOTA_EXHAUSTED: "QUOTA_EXHAUSTED",
  PROVIDER_5XX: "PROVIDER_5XX",
  TIMEOUT: "TIMEOUT",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  TOOL_ERROR: "TOOL_ERROR",
  CAPABILITY_FAILURE: "CAPABILITY_FAILURE",
} as const

export type ErrorClass = (typeof ErrorClass)[keyof typeof ErrorClass]

const PROVIDER_OR_AUTH: ReadonlySet<string> = new Set([
  ErrorClass.AUTH_401,
  ErrorClass.RATE_LIMIT_429,
  ErrorClass.QUOTA_EXHAUSTED,
  ErrorClass.PROVIDER_5XX,
  ErrorClass.TIMEOUT,
  ErrorClass.PERMISSION_DENIED,
])

export function classifyError(text: string | undefined | null): ErrorClass {
  const t = (text ?? "").toLowerCase()
  if (t.includes("invalid_grant") || t.includes("token refresh") || t.includes("refresh token")) return ErrorClass.AUTH_401
  if (t.includes("401") || t.includes("unauthorized") || t.includes("auth")) return ErrorClass.AUTH_401
  if (t.includes("429") || t.includes("rate limit") || t.includes("usage limit")) return ErrorClass.RATE_LIMIT_429
  if (t.includes("quota")) return ErrorClass.QUOTA_EXHAUSTED
  if (t.includes("timeout") || t.includes("timed out")) return ErrorClass.TIMEOUT
  if (t.includes("permission") || t.includes("denied")) return ErrorClass.PERMISSION_DENIED
  if (/\b5\d\d\b/.test(t) || t.includes("provider")) return ErrorClass.PROVIDER_5XX
  if (t.includes("tool")) return ErrorClass.TOOL_ERROR
  return ErrorClass.CAPABILITY_FAILURE
}

export const PROVIDER_WIDE_ERRORS: ReadonlySet<string> = new Set([
  ErrorClass.AUTH_401,
  ErrorClass.RATE_LIMIT_429,
  ErrorClass.QUOTA_EXHAUSTED,
  ErrorClass.PROVIDER_5XX,
])

export function isProviderOrAuthFailure(error: string | undefined | null): boolean {
  if (!error) return false
  return PROVIDER_OR_AUTH.has(error)
}

export function affectsCapability(error: string | undefined | null, ok: boolean): boolean {
  if (ok) return true
  if (isProviderOrAuthFailure(error)) return false
  return error === ErrorClass.CAPABILITY_FAILURE || error === ErrorClass.TOOL_ERROR || !error
}
