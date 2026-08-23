import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Provider } from "@/provider/provider"
import { Env } from "../../src/env"
import { Plugin } from "../../src/plugin/index"
import { TokenMaxRouter } from "@/tokenmax/router"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const routerConfig = {
  formatter: false,
  lsp: false,
  // Ambient env credentials (e.g. a GitHub token) in some environments can
  // auto-connect real providers like github-models -- restrict explicitly
  // so router selection is deterministic and only sees these test doubles.
  enabled_providers: ["free", "premium"],
  provider: {
    free: {
      name: "Free Co",
      id: "free",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "free-model": {
          id: "free-model",
          name: "Free Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100_000, output: 10_000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: "http://127.0.0.1:0" },
    },
    premium: {
      name: "Premium Co",
      id: "premium",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "premium-reasoning-model": {
          id: "premium-reasoning-model",
          name: "Premium Reasoning Model",
          attachment: false,
          reasoning: true,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100_000, output: 10_000 },
          cost: { input: 0.00003, output: 0.00003 },
          options: {},
        },
        "premium-no-tools-model": {
          id: "premium-no-tools-model",
          name: "Premium No-Tools Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: false,
          release_date: "2025-01-01",
          limit: { context: 100_000, output: 10_000 },
          cost: { input: 0.00001, output: 0.00001 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: "http://127.0.0.1:0" },
    },
  },
}

const it = testEffect(LayerNode.compile(LayerNode.group([TokenMaxRouter.node, Provider.node, Env.node, Plugin.node])))

const fallback = { providerID: ProviderV2.ID.make("free"), modelID: ModelV2.ID.make("free-model") }

it.instance(
  "select() picks the cheapest eligible resource over a pricier one with the same capabilities",
  () =>
    Effect.gen(function* () {
      const router = yield* TokenMaxRouter.Service
      const selection = yield* router.select({ requireToolCall: true, fallback })
      // free-model is $0 and has toolcall -- must win over both premium models.
      if (selection.providerID !== "free" || selection.modelID !== "free-model")
        throw new Error(`expected free/free-model, got ${selection.providerID}/${selection.modelID}`)
    }),
  { config: routerConfig },
)

it.instance(
  "select() respects a capability requirement the cheapest resource doesn't meet",
  () =>
    Effect.gen(function* () {
      const router = yield* TokenMaxRouter.Service
      // free-model has reasoning:false, premium-no-tools-model has
      // reasoning:false too -- only premium-reasoning-model qualifies.
      const selection = yield* router.select({ requireReasoning: true, fallback })
      if (selection.providerID !== "premium" || selection.modelID !== "premium-reasoning-model")
        throw new Error(`expected premium/premium-reasoning-model, got ${selection.providerID}/${selection.modelID}`)
    }),
  { config: routerConfig },
)

it.instance(
  "select() excludes a resource that fails the tool-call requirement even if it's cheaper",
  () =>
    Effect.gen(function* () {
      const router = yield* TokenMaxRouter.Service
      // free-model has toolcall but not reasoning; premium-no-tools-model has
      // neither; only premium-reasoning-model satisfies both requirements.
      const selection = yield* router.select({ requireToolCall: true, requireReasoning: true, fallback })
      if (selection.providerID !== "premium" || selection.modelID !== "premium-reasoning-model")
        throw new Error(`expected premium/premium-reasoning-model, got ${selection.providerID}/${selection.modelID}`)
    }),
  { config: routerConfig },
)

it.instance(
  "select() falls back to the caller-supplied model when nothing is enabled",
  () =>
    Effect.gen(function* () {
      const router = yield* TokenMaxRouter.Service
      const selection = yield* router.select({
        fallback: { providerID: ProviderV2.ID.make("some-provider"), modelID: ModelV2.ID.make("some-model") },
      })
      if (selection.providerID !== "some-provider" || selection.modelID !== "some-model")
        throw new Error("expected the fallback model when policy disables everything")
      if (!selection.reason.includes("fallback")) throw new Error("expected the reason to mention the fallback")
    }),
  {
    config: routerConfig,
    init: (directory) =>
      Effect.tryPromise(() =>
        Bun.write(
          `${directory}/tokenmax.json`,
          JSON.stringify({
            providers: { free: { enabled: false }, premium: { enabled: false } },
          }),
        ),
      ).pipe(Effect.orDie),
  },
)
