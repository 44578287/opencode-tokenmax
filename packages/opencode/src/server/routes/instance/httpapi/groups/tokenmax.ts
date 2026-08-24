import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Provider } from "@/provider/provider"
import { TokenMaxTelemetry } from "@/tokenmax/telemetry"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

// R1 gap closed -- the HTTP equivalent of `opencode tokenmax`
// (docs/TOKENMAX-ROADMAP.md's R1 "Not yet done" list). Reuses the same
// schemas the CLI/router/telemetry already declare (Provider.Model's
// capabilities/cost fields, TokenMaxTelemetry.Event) rather than
// redeclaring parallel shapes.

const root = "/tokenmax"

const Resource = Schema.Struct({
  providerID: Provider.Model.fields.providerID,
  modelID: Provider.Model.fields.id,
  providerName: Schema.String,
  modelName: Schema.String,
  capabilities: Provider.Model.fields.capabilities,
  cost: Provider.Model.fields.cost,
  billingClass: Schema.Literals(["free", "economy", "standard", "premium"]),
  connected: Schema.Boolean,
  enabled: Schema.Boolean,
})

export const StatusResult = Schema.Struct({
  resources: Schema.Array(Resource),
  policyActive: Schema.Boolean,
  telemetry: Schema.Array(TokenMaxTelemetry.Event),
})

export const TokenMaxApi = HttpApi.make("tokenmax")
  .add(
    HttpApiGroup.make("tokenmax")
      .add(
        HttpApiEndpoint.get("status", `${root}/status`, {
          query: WorkspaceRoutingQuery,
          success: described(StatusResult, "TokenMax resource registry, policy, and telemetry status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tokenmax.status",
            summary: "Get TokenMax status",
            description:
              "Connected resources with billing class and policy-enabled state, whether policy overrides are active, and recent subagent telemetry -- the HTTP equivalent of `opencode tokenmax`.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "tokenmax",
          description: "TokenMax native resource registry / routing status.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode tokenmax HttpApi",
      version: "0.0.1",
      description: "TokenMax status HttpApi surface.",
    }),
  )
