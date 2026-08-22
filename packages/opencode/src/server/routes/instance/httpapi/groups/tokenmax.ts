import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const Worker = Schema.Struct({
  id: Schema.String,
  parentSessionID: Schema.String,
  childSessionID: Schema.String,
  role: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  variant: Schema.String,
  billing: Schema.optional(Schema.String),
  progress: Schema.optional(Schema.String),
  state: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  fallbackFrom: Schema.NullOr(Schema.String),
  errorCategory: Schema.NullOr(Schema.String),
}).annotate({ identifier: "TokenMaxWorker" })

const Operation = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  ownerSessionID: Schema.NullOr(Schema.String),
  ownerRunID: Schema.NullOr(Schema.String),
  ownerWorkerID: Schema.NullOr(Schema.String),
  ownerDagNode: Schema.NullOr(Schema.String),
  state: Schema.String,
  startedAt: Schema.String,
  lastProgressAt: Schema.String,
  deadlineAt: Schema.NullOr(Schema.String),
  activeHandle: Schema.NullOr(Schema.String),
  result: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  error: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  completedAt: Schema.NullOr(Schema.String),
}).annotate({ identifier: "TokenMaxOperation" })

const Status = Schema.Struct({
  enabled: Schema.Boolean,
  mode: Schema.Literals(["NATIVE", "LEGACY_PLUGIN", "OFF"]),
  version: Schema.String,
  dbPath: Schema.String,
  routeCount: Schema.Number,
  leftoverPlugins: Schema.Array(Schema.String),
  leftoverAgents: Schema.Array(Schema.String),
  leftoverCommands: Schema.Array(Schema.String),
  strippedPlugins: Schema.Array(Schema.String),
  workers: Schema.Array(Worker),
  operations: Schema.Array(Operation),
  llmRequests: Schema.Literal(0),
}).annotate({ identifier: "TokenMaxStatus" })

const Models = Schema.Struct({
  count: Schema.Number,
  routes: Schema.Array(
    Schema.Struct({
      providerId: Schema.String,
      modelId: Schema.String,
      variant: Schema.String,
      billing: Schema.String,
      availability: Schema.String,
    }),
  ),
  llmRequests: Schema.Literal(0),
}).annotate({ identifier: "TokenMaxModels" })

const Stats = Schema.Struct({
  attempts: Schema.Number,
  byBilling: Schema.Array(Schema.Struct({ billing: Schema.String, n: Schema.Number })),
  operations: Schema.Number,
  waitingOperations: Schema.Number,
  operationTypes: Schema.Array(Schema.Struct({ type: Schema.String, n: Schema.Number })),
  operationEvents: Schema.Array(Schema.Struct({ kind: Schema.String, n: Schema.Number })),
  llmRequests: Schema.Literal(0),
}).annotate({ identifier: "TokenMaxStats" })

const Workers = Schema.Struct({
  workers: Schema.Array(Worker),
  llmRequests: Schema.Literal(0),
}).annotate({ identifier: "TokenMaxWorkers" })

const Operations = Schema.Struct({
  operations: Schema.Array(Operation),
  llmRequests: Schema.Literal(0),
}).annotate({ identifier: "TokenMaxOperations" })

export const TokenMaxPaths = {
  status: "/tokenmax/status",
  models: "/tokenmax/models",
  stats: "/tokenmax/stats",
  workers: "/tokenmax/workers",
  operations: "/tokenmax/operations",
} as const

export const TokenMaxApi = HttpApi.make("tokenmax")
  .add(
    HttpApiGroup.make("tokenmax")
      .add(
        HttpApiEndpoint.get("status", TokenMaxPaths.status, {
          query: WorkspaceRoutingQuery,
          success: described(Status, "TokenMax status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tokenmax.status.get",
            summary: "TokenMax status",
            description: "Native TokenMax status. No LLM.",
          }),
        ),
        HttpApiEndpoint.get("models", TokenMaxPaths.models, {
          query: WorkspaceRoutingQuery,
          success: described(Models, "TokenMax models"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tokenmax.models.get",
            summary: "TokenMax models",
            description: "Registered TokenMax routes. No LLM.",
          }),
        ),
        HttpApiEndpoint.get("stats", TokenMaxPaths.stats, {
          query: WorkspaceRoutingQuery,
          success: described(Stats, "TokenMax stats"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tokenmax.stats.get",
            summary: "TokenMax stats",
            description: "TokenMax usage stats. No LLM.",
          }),
        ),
        HttpApiEndpoint.get("workers", TokenMaxPaths.workers, {
          query: WorkspaceRoutingQuery,
          success: described(Workers, "TokenMax workers"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tokenmax.workers.get",
            summary: "TokenMax workers",
            description: "Structured TokenMax worker state. No LLM.",
          }),
        ),
        HttpApiEndpoint.get("operations", TokenMaxPaths.operations, {
          query: WorkspaceRoutingQuery,
          success: described(Operations, "TokenMax operations"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tokenmax.operations.get",
            summary: "TokenMax event-driven operations",
            description: "Structured waiting/completed operations. No LLM.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "tokenmax",
          description: "TokenMax native HttpApi",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode tokenmax HttpApi",
      version: "0.1.0",
      description: "TokenMax Core status for Desktop, Web, and Mobile.",
    }),
  )
