import { Config } from "@/config/config"
import { isEnabled } from "@/tokenmax/config"
import { listRoutes, statsSummary } from "@/tokenmax/persist"
import { status } from "@/tokenmax/snapshot"
import { store } from "@/tokenmax"
import { listOperations, operationTelemetrySummary } from "@/tokenmax/operation"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const tokenmaxHandlers = HttpApiBuilder.group(InstanceHttpApi, "tokenmax", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service

    const getStatus = Effect.fn("TokenMaxHttpApi.status")(function* () {
      const cfg = yield* config.get()
      const s = store()
      return { ...status(s, isEnabled(cfg), cfg), llmRequests: 0 as const }
    })

    const getModels = Effect.fn("TokenMaxHttpApi.models")(function* () {
      const rows = listRoutes(store())
      return {
        count: rows.length,
        routes: rows.map((row) => ({
          providerId: String(row.provider_id),
          modelId: String(row.model_id),
          variant: String(row.variant ?? ""),
          billing: String(row.billing_type ?? "UNKNOWN"),
          availability: String(row.availability ?? "UNKNOWN"),
        })),
        llmRequests: 0 as const,
      }
    })

    const getStats = Effect.fn("TokenMaxHttpApi.stats")(function* () {
      const s = store()
      const operations = operationTelemetrySummary(s)
      return {
        ...statsSummary(s),
        operations: operations.operations,
        waitingOperations: operations.waiting,
        operationTypes: operations.byType,
        operationEvents: operations.events,
        llmRequests: 0 as const,
      }
    })

    const getWorkers = Effect.fn("TokenMaxHttpApi.workers")(function* () {
      const cfg = yield* config.get()
      return { workers: status(store(), isEnabled(cfg)).workers, llmRequests: 0 as const }
    })

    const getOperations = Effect.fn("TokenMaxHttpApi.operations")(function* () {
      return { operations: listOperations(store()), llmRequests: 0 as const }
    })

    return handlers
      .handle("status", getStatus)
      .handle("models", getModels)
      .handle("stats", getStats)
       .handle("workers", getWorkers)
       .handle("operations", getOperations)
  }),
)
