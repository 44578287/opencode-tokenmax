import { VERSION } from "./version"
import type { Store } from "./persist"
import { countRoutes, listRoutes, statsSummary } from "./persist"
import { decide, type DecideContext } from "./router"
import type { Route, Task } from "./types"

export const NATIVE_COMMANDS = ["tokenmax-status", "tokenmax-stats", "tokenmax-route", "tokenmax-models"] as const
export type NativeCommand = (typeof NATIVE_COMMANDS)[number]

export function isNativeCommand(name: string): name is NativeCommand {
  return (NATIVE_COMMANDS as readonly string[]).includes(name)
}

export function wantsLlm(name: string, args = ""): boolean {
  const a = args.trim()
  if (name === "tokenmax-stats" && /(^|\s)--analyze(\s|$)/.test(a)) return true
  if (name === "tokenmax-route" && /(^|\s)--explain(\s|$)/.test(a)) return true
  return false
}

export function isDeterministic(name: string, args = ""): boolean {
  return isNativeCommand(name) && !wantsLlm(name, args)
}

export interface CommandResult {
  command: string
  text: string
  llmRequests: 0
  modelTokens: 0
}

export function render(
  name: string,
  opts: { store: Store; enabled: boolean; routes?: Route[]; task?: Task; dbPath?: string },
): CommandResult {
  const text =
    name === "tokenmax-status"
      ? renderStatus(opts)
      : name === "tokenmax-stats"
        ? renderStats(opts)
        : name === "tokenmax-route"
          ? renderRoute(opts)
          : renderModels(opts)
  return { command: name, text, llmRequests: 0, modelTokens: 0 }
}

function renderStatus(opts: { store: Store; enabled: boolean; dbPath?: string }): string {
  const n = countRoutes(opts.store)
  return [
    "TokenMax Status",
    `enabled: ${opts.enabled}`,
    `mode: ${opts.enabled ? "NATIVE" : "OFF"}`,
    `version: ${VERSION}`,
    `db: ${opts.dbPath ?? opts.store.dbPath}`,
    `routes: ${n}`,
    "llmRequests: 0",
  ].join("\n")
}

function renderStats(opts: { store: Store }): string {
  const s = statsSummary(opts.store)
  const lines = ["TokenMax Stats", `attempts: ${s.attempts}`]
  for (const row of s.byBilling) lines.push(`${row.billing}: ${row.n}`)
  lines.push("llmRequests: 0")
  return lines.join("\n")
}

function renderRoute(opts: { store: Store; enabled: boolean; routes?: Route[]; task?: Task }): string {
  const ctx: DecideContext = { enabled: opts.enabled, routes: opts.routes ?? [] }
  const d = decide(opts.task ?? {}, ctx)
  if (!d) return ["TokenMax Route", "enabled: false or no routes", "llmRequests: 0"].join("\n")
  return [
    "TokenMax Route",
    `${d.provider}/${d.model}${d.variant ? "#" + d.variant : ""}`,
    `billing: ${d.billing}`,
    `reason: ${d.reason}`,
    "llmRequests: 0",
  ].join("\n")
}

function renderModels(opts: { store: Store }): string {
  const rows = listRoutes(opts.store)
  const lines = ["TokenMax Models", `count: ${rows.length}`]
  for (const row of rows.slice(0, 50)) {
    const variant = row.variant ? `#${row.variant}` : ""
    lines.push(`${row.provider_id}/${row.model_id}${variant} ${row.billing_type} ${row.availability}`)
  }
  lines.push("llmRequests: 0")
  return lines.join("\n")
}

export function analyzePrompt(snapshot: string): string {
  return `Analyze this TokenMax snapshot. Do not invent numbers.\n\n${snapshot}`
}
