import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"

// R1 -- Native Resource Core (docs/TOKENMAX-ROADMAP.md). First user-visible
// surface for the resource registry: `opencode tokenmax` prints every
// connected model, its billing class, and whether policy has it enabled.
// Kept as a single command (no subcommands yet) -- add real effectCmd
// registrations for e.g. `tokenmax policy` later rather than nesting under
// this one, since effectCmd wraps exactly one handler per command.

const billingColor: Record<string, string> = {
  free: UI.Style.TEXT_SUCCESS,
  economy: UI.Style.TEXT_SUCCESS,
  standard: UI.Style.TEXT_INFO,
  premium: UI.Style.TEXT_WARNING,
}

const outcomeColor: Record<string, string> = {
  success: UI.Style.TEXT_SUCCESS,
  error: UI.Style.TEXT_DANGER,
}

const sourceLabel: Record<string, string> = {
  explicit: "agent-pinned",
  router: "auto-selected",
  inherited: "inherited from parent",
}

function timeAgo(ms: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export const TokenMaxCommand = effectCmd({
  command: "tokenmax",
  describe: "show the TokenMax resource registry: connected models, billing class, policy state",
  builder: (yargs) =>
    yargs.option("catalog", {
      describe: "also list resources you could configure but haven't connected yet (from models.dev)",
      type: "boolean",
    }),
  handler: Effect.fn("Cli.tokenmax")(function* (args) {
    const { TokenMaxRegistry } = yield* Effect.promise(() => import("@/tokenmax/registry"))
    const { TokenMaxPolicy } = yield* Effect.promise(() => import("@/tokenmax/policy"))
    const { TokenMaxTelemetry } = yield* Effect.promise(() => import("@/tokenmax/telemetry"))

    const registry = yield* TokenMaxRegistry.Service
    const policy = yield* TokenMaxPolicy.Service
    const telemetry = yield* TokenMaxTelemetry.Service

    const [resources, policyInfo, telemetryEvents] = yield* Effect.all([
      registry.list({ includeCatalog: Boolean(args.catalog) }),
      policy.get(),
      telemetry.list(),
    ])

    const connectedResources = resources.filter((r) => r.connected)
    const catalogResources = resources.filter((r) => !r.connected)
    const connectedProviderCount = new Set(connectedResources.map((r) => r.providerID)).size
    const catalogSuffix = catalogResources.length > 0 ? `, +${catalogResources.length} available to configure` : ""
    UI.println(
      UI.Style.TEXT_NORMAL_BOLD +
        `TokenMax Resource Registry` +
        UI.Style.TEXT_NORMAL +
        UI.Style.TEXT_DIM +
        ` -- ${connectedResources.length} model(s) across ${connectedProviderCount} connected provider(s)${catalogSuffix}` +
        UI.Style.TEXT_NORMAL,
    )
    const hasOverrides = Boolean(
      (policyInfo.providers && Object.keys(policyInfo.providers).length) ||
        (policyInfo.billing && Object.keys(policyInfo.billing).length),
    )
    UI.println(
      UI.Style.TEXT_DIM +
        (hasOverrides ? "policy: tokenmax.json overrides active" : "policy: none found -- using defaults") +
        UI.Style.TEXT_NORMAL,
    )
    process.stdout.write(EOL)

    const byProvider = new Map<string, typeof resources>()
    for (const r of resources) {
      const list = byProvider.get(r.providerID) ?? []
      list.push(r)
      byProvider.set(r.providerID, list)
    }

    for (const [providerID, models] of [...byProvider.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      UI.println(UI.Style.TEXT_NORMAL_BOLD + providerID + UI.Style.TEXT_NORMAL)
      for (const model of [...models].sort((a, b) => a.modelID.localeCompare(b.modelID))) {
        const color = billingColor[model.billingClass] ?? UI.Style.TEXT_NORMAL
        const state = !model.connected
          ? UI.Style.TEXT_DIM + "catalog only (not configured)" + UI.Style.TEXT_NORMAL
          : model.enabled
            ? UI.Style.TEXT_SUCCESS + "enabled" + UI.Style.TEXT_NORMAL
            : UI.Style.TEXT_DANGER + "disabled (policy)" + UI.Style.TEXT_NORMAL
        process.stdout.write(`  ${model.modelID}  ${color}${model.billingClass}${UI.Style.TEXT_NORMAL}  ${state}` + EOL)
      }
    }

    if (connectedResources.length === 0) {
      UI.println(
        UI.Style.TEXT_DIM +
          "  no connected providers -- run `opencode models` or configure a provider first" +
          (catalogResources.length > 0 ? " (catalog shown above)" : ", or pass --catalog to see what's available") +
          UI.Style.TEXT_NORMAL,
      )
    }

    if (telemetryEvents.length > 0) {
      process.stdout.write(EOL)
      UI.println(
        UI.Style.TEXT_NORMAL_BOLD +
          "Recent subagent runs" +
          UI.Style.TEXT_NORMAL +
          UI.Style.TEXT_DIM +
          ` -- last ${Math.min(10, telemetryEvents.length)} of ${telemetryEvents.length}` +
          UI.Style.TEXT_NORMAL,
      )
      for (const event of telemetryEvents.slice(-10).reverse()) {
        const color = outcomeColor[event.outcome] ?? UI.Style.TEXT_NORMAL
        const source = sourceLabel[event.modelSource] ?? event.modelSource
        process.stdout.write(
          `  ${timeAgo(event.timestamp)}  ${event.subagentType}  ${event.providerID}/${event.modelID}  ${UI.Style.TEXT_DIM}(${source})${UI.Style.TEXT_NORMAL}  ${color}${event.outcome}${UI.Style.TEXT_NORMAL}` +
            EOL,
        )
      }
    }
  }),
})
