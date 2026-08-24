import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { TokenMaxRegistry } from "@/tokenmax/registry"
import { TokenMaxPolicy } from "@/tokenmax/policy"
import { TokenMaxTelemetry } from "@/tokenmax/telemetry"
import { InstanceHttpApi } from "../api"
import type { StatusQuery } from "../groups/tokenmax"

export const tokenmaxHandlers = HttpApiBuilder.group(InstanceHttpApi, "tokenmax", (handlers) =>
  Effect.gen(function* () {
    const registry = yield* TokenMaxRegistry.Service
    const policy = yield* TokenMaxPolicy.Service
    const telemetry = yield* TokenMaxTelemetry.Service

    const status = Effect.fn("TokenMaxHttpApi.status")(function* (ctx: { query: typeof StatusQuery.Type }) {
      const [resources, policyInfo, telemetryEvents] = yield* Effect.all([
        registry.list({ includeCatalog: ctx.query.catalog === "true" }),
        policy.get(),
        telemetry.list(),
      ])
      const policyActive = Boolean(
        (policyInfo.providers && Object.keys(policyInfo.providers).length) ||
          (policyInfo.billing && Object.keys(policyInfo.billing).length),
      )
      return { resources, policyActive, telemetry: telemetryEvents }
    })

    return handlers.handle("status", status)
  }),
)
