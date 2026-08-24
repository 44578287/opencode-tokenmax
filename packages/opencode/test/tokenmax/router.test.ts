import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Provider } from "@/provider/provider"
import { Env } from "../../src/env"
import { Plugin } from "../../src/plugin/index"
import { TokenMaxRouter } from "@/tokenmax/router"
import { TokenMaxTelemetry } from "@/tokenmax/telemetry"
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

// R3 -- Intelligent Resource Scheduling (docs/TOKENMAX-ROADMAP.md):
// dedicated config + provider names, distinct from routerConfig's
// "free"/"premium" above and from every other test file's own provider
// names -- TokenMaxTelemetry's storage is process-wide, not per-test (see
// telemetry.test.ts's own comment on this). It also accumulates PER
// RESOURCE KEY (providerID/modelID), not per session ID -- a unique
// session ID prefix per test is not enough on its own if two tests write
// telemetry against the same provider/model, since those records add up
// rather than overwrite. So each reliability test below gets its own,
// entirely distinct "flaky" provider/model pair (via
// makeReliabilityConfig), sharing only the always-clean "pricier-reliable"
// comparison target (nothing ever records telemetry against it, so its
// history -- and cold-start trust -- stays empty across the whole run).
function makeReliabilityConfig(flakyProviderID: string, flakyModelID: string) {
  return {
    formatter: false,
    lsp: false,
    enabled_providers: [flakyProviderID, "pricier-reliable"],
    provider: {
      [flakyProviderID]: {
        name: "Flaky Co",
        id: flakyProviderID,
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          [flakyModelID]: {
            id: flakyModelID,
            name: "Flaky Model",
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
      "pricier-reliable": {
        name: "Pricier Reliable Co",
        id: "pricier-reliable",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          "reliable-model": {
            id: "reliable-model",
            name: "Reliable Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
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
}

const it = testEffect(
  LayerNode.compile(LayerNode.group([TokenMaxRouter.node, TokenMaxTelemetry.node, Provider.node, Env.node, Plugin.node])),
)

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

const recordFailures = (
  telemetry: TokenMaxTelemetry.Interface,
  count: number,
  providerID: string,
  modelID: string,
) =>
  Effect.all(
    Array.from({ length: count }, (_, i) =>
      telemetry.record({
        sessionID: `ses_${providerID}_${i}`,
        parentSessionID: "ses_reliability_parent",
        providerID,
        modelID,
        modelSource: "router",
        subagentType: "general",
        outcome: "error",
      }),
    ),
  )

it.instance(
  "select() excludes a resource with enough recent failures, picking the next-cheapest reliable one instead",
  () =>
    Effect.gen(function* () {
      const router = yield* TokenMaxRouter.Service
      const telemetry = yield* TokenMaxTelemetry.Service
      yield* recordFailures(telemetry, 3, "flaky-excluded", "flaky-model")

      const selection = yield* router.select({ requireToolCall: true, fallback })
      if (selection.providerID !== "pricier-reliable" || selection.modelID !== "reliable-model")
        throw new Error(
          `expected the flaky (but cheaper) resource to be excluded, got ${selection.providerID}/${selection.modelID}`,
        )
      if (!selection.reason.includes("excluded"))
        throw new Error(`expected the reason to mention the exclusion, got: ${selection.reason}`)
    }),
  { config: makeReliabilityConfig("flaky-excluded", "flaky-model") },
)

it.instance(
  "select() does not exclude a resource on a single failure -- not enough samples to be a real signal",
  () =>
    Effect.gen(function* () {
      const router = yield* TokenMaxRouter.Service
      const telemetry = yield* TokenMaxTelemetry.Service
      yield* recordFailures(telemetry, 1, "flaky-single-failure", "flaky-model")

      const selection = yield* router.select({ requireToolCall: true, fallback })
      if (selection.providerID !== "flaky-single-failure" || selection.modelID !== "flaky-model")
        throw new Error(
          `expected a single failure to not exclude the cheapest resource, got ${selection.providerID}/${selection.modelID}`,
        )
    }),
  { config: makeReliabilityConfig("flaky-single-failure", "flaky-model") },
)

it.instance(
  "select() never excludes every candidate -- an unreliable resource still beats no dispatch",
  () =>
    Effect.gen(function* () {
      const router = yield* TokenMaxRouter.Service
      const telemetry = yield* TokenMaxTelemetry.Service
      // Only flaky-only-candidate is enabled here (see the tokenmax.json
      // override below), so it's the only candidate -- reliability
      // filtering must not remove it even though its history is entirely
      // failures.
      yield* recordFailures(telemetry, 5, "flaky-only-candidate", "flaky-model")

      const selection = yield* router.select({ requireToolCall: true, fallback })
      if (selection.providerID !== "flaky-only-candidate" || selection.modelID !== "flaky-model")
        throw new Error(
          `expected the only eligible (if unreliable) resource to still be selected, got ${selection.providerID}/${selection.modelID}`,
        )
    }),
  {
    config: makeReliabilityConfig("flaky-only-candidate", "flaky-model"),
    init: (directory) =>
      Effect.tryPromise(() =>
        Bun.write(
          `${directory}/tokenmax.json`,
          JSON.stringify({ providers: { "pricier-reliable": { enabled: false } } }),
        ),
      ).pipe(Effect.orDie),
  },
)
