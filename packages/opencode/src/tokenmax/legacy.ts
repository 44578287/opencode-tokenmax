export type TokenMaxMode = "NATIVE" | "LEGACY_PLUGIN" | "OFF"

export function pluginSpecString(spec: unknown): string {
  if (typeof spec === "string") return spec
  if (Array.isArray(spec) && typeof spec[0] === "string") return spec[0]
  return ""
}

export function isLegacyTokenMaxPlugin(spec: unknown): boolean {
  const raw = pluginSpecString(spec).replace(/\\/g, "/").toLowerCase()
  if (!raw) return false
  if (raw.includes("tokenmax-router")) return true
  const file = raw.split("/").pop() ?? raw
  const pkg = file.replace(/\.js$|\.ts$|\.mjs$/, "").split("@")[0]
  return pkg === "tokenmax-router" || pkg === "tokenmax-plugin"
}

export function isLegacyTokenMaxAgentName(name: string): boolean {
  return name.startsWith("tokenmax-")
}

export function isLegacyTokenMaxCommandName(name: string): boolean {
  return name.startsWith("tokenmax-")
}

export type TokenMaxDiagnostic = {
  mode: TokenMaxMode
  nativeEnabled: boolean
  leftoverPlugins: string[]
  leftoverAgents: string[]
  leftoverCommands: string[]
  strippedPlugins: string[]
  conflict: boolean
  error?: string
}

export type TokenMaxConfigSlice = {
  experimental?: { tokenmax?: { enabled?: boolean } }
  plugin?: unknown[]
  plugin_origins?: Array<{ spec: unknown }>
  agent?: Record<string, unknown>
  command?: Record<string, unknown>
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))]
}

export function inspectTokenMax(cfg: TokenMaxConfigSlice | undefined | null): TokenMaxDiagnostic {
  const nativeEnabled = cfg?.experimental?.tokenmax?.enabled === true
  const leftoverPlugins = unique([
    ...(cfg?.plugin ?? []).map(pluginSpecString).filter((s) => isLegacyTokenMaxPlugin(s)),
    ...(cfg?.plugin_origins ?? []).map((o) => pluginSpecString(o.spec)).filter((s) => isLegacyTokenMaxPlugin(s)),
  ])
  const leftoverAgents = Object.keys(cfg?.agent ?? {}).filter(isLegacyTokenMaxAgentName)
  const leftoverCommands = Object.keys(cfg?.command ?? {}).filter(isLegacyTokenMaxCommandName)

  if (nativeEnabled) {
    return {
      mode: "NATIVE",
      nativeEnabled,
      leftoverPlugins,
      leftoverAgents,
      leftoverCommands,
      strippedPlugins: leftoverPlugins,
      conflict: false,
    }
  }
  if (leftoverPlugins.length > 0) {
    return {
      mode: "LEGACY_PLUGIN",
      nativeEnabled,
      leftoverPlugins,
      leftoverAgents,
      leftoverCommands,
      strippedPlugins: [],
      conflict: false,
    }
  }
  return {
    mode: "OFF",
    nativeEnabled,
    leftoverPlugins,
    leftoverAgents,
    leftoverCommands,
    strippedPlugins: [],
    conflict: false,
  }
}

export function filterPluginList<T>(items: T[], nativeEnabled: boolean, specOf: (item: T) => unknown): { kept: T[]; stripped: T[] } {
  if (!nativeEnabled) return { kept: items, stripped: [] }
  const kept: T[] = []
  const stripped: T[] = []
  for (const item of items) {
    if (isLegacyTokenMaxPlugin(specOf(item))) stripped.push(item)
    else kept.push(item)
  }
  return { kept, stripped }
}

export class TokenMaxConflictError extends Error {
  readonly code = "TOKENMAX_CONFLICT"
  constructor(message: string) {
    super(message)
    this.name = "TokenMaxConflictError"
  }
}

export function assertSafeStartup(nativeEnabled: boolean, stillLoading: string[]): void {
  if (!nativeEnabled) return
  if (stillLoading.length === 0) return
  throw new TokenMaxConflictError(
    `TokenMax conflict: native mode is enabled but leftover plugin would still load: ${stillLoading.join(", ")}. Native and legacy TokenMax cannot run together.`,
  )
}

export function formatModeLog(diag: TokenMaxDiagnostic): string {
  const lines = [`TokenMax mode: ${diag.mode}`]
  if (diag.strippedPlugins.length) {
    lines.push(`TokenMax migration: disabled leftover plugin loading: ${diag.strippedPlugins.join(", ")}`)
  }
  return lines.join("\n")
}
