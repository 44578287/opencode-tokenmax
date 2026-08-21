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

export function isProviderOrAuthFailure(error: string | undefined | null): boolean {
  if (!error) return false
  return PROVIDER_OR_AUTH.has(error)
}

export function affectsCapability(error: string | undefined | null, ok: boolean): boolean {
  if (ok) return true
  if (isProviderOrAuthFailure(error)) return false
  return error === ErrorClass.CAPABILITY_FAILURE || error === ErrorClass.TOOL_ERROR || !error
}
