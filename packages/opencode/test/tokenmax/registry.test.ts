import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Provider } from "@/provider/provider"
import { Env } from "../../src/env"
import { Plugin } from "../../src/plugin/index"
import { TokenMaxPolicy } from "@/tokenmax/policy"
import { TokenMaxRegistry } from "@/tokenmax/registry"
import { testEffect } from "../lib/effect"

const registryConfig = {
  formatter: false,
  lsp: false,
  // Ambient env credentials (e.g. a GitHub token) in some environments can
  // auto-connect real providers like github-models -- restrict explicitly
  // so registry contents are deterministic and only reflect these test doubles.
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
        "premium-model": {
          id: "premium-model",
          name: "Premium Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100_000, output: 10_000 },
          // blended = (0.00003 + 0.00003) / 2 * 1e6 = 30 $/1M -> premium under defaults
          cost: { input: 0.00003, output: 0.00003 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: "http://127.0.0.1:0" },
    },
  },
}

const it = testEffect(LayerNode.compile(LayerNode.group([TokenMaxRegistry.node, Provider.node, Env.node, Plugin.node])))

it.instance(
  "list() classifies free and premium models correctly and reflects no policy overrides",
  () =>
    Effect.gen(function* () {
      const registry = yield* TokenMaxRegistry.Service
      const resources = yield* registry.list()

      const free = resources.find((r) => r.providerID === "free" && r.modelID === "free-model")
      const premium = resources.find((r) => r.providerID === "premium" && r.modelID === "premium-model")

      if (!free) throw new Error("expected 'free' provider's model to be in the registry")
      if (!premium) throw new Error("expected 'premium' provider's model to be in the registry")

      if (free.billingClass !== "free") throw new Error(`expected free model billingClass 'free', got '${free.billingClass}'`)
      if (premium.billingClass !== "premium")
        throw new Error(`expected premium model billingClass 'premium', got '${premium.billingClass}'`)

      if (!free.connected) throw new Error("expected free model to be connected")
      if (!free.enabled) throw new Error("expected free model to be enabled with no policy present")
      if (!premium.enabled) throw new Error("expected premium model to be enabled with no policy present")
    }),
  { config: registryConfig },
)

it.instance(
  "list() respects a policy override that disables an entire provider",
  () =>
    Effect.gen(function* () {
      const registry = yield* TokenMaxRegistry.Service
      const resources = yield* registry.list()
      const premium = resources.find((r) => r.providerID === "premium" && r.modelID === "premium-model")
      if (!premium) throw new Error("expected 'premium' provider's model to be in the registry")
      if (premium.enabled) throw new Error("expected premium provider to be disabled by policy")

      const free = resources.find((r) => r.providerID === "free" && r.modelID === "free-model")
      if (!free) throw new Error("expected 'free' provider's model to still be in the registry")
      if (!free.enabled) throw new Error("expected free provider to remain enabled (policy only targets 'premium')")
    }),
  {
    config: registryConfig,
    init: (directory) =>
      Effect.tryPromise(() =>
        Bun.write(
          `${directory}/tokenmax.json`,
          JSON.stringify({ providers: { premium: { enabled: false } } }),
        ),
      ).pipe(Effect.orDie),
  },
)

it.instance(
  "list() respects a policy override that disables a single model, not its whole provider",
  () =>
    Effect.gen(function* () {
      const registry = yield* TokenMaxRegistry.Service
      const resources = yield* registry.list()
      const premium = resources.find((r) => r.providerID === "premium" && r.modelID === "premium-model")
      if (!premium) throw new Error("expected 'premium' provider's model to be in the registry")
      if (premium.enabled) throw new Error("expected premium-model to be disabled by its model-level policy override")
    }),
  {
    config: registryConfig,
    init: (directory) =>
      Effect.tryPromise(() =>
        Bun.write(
          `${directory}/tokenmax.json`,
          JSON.stringify({ providers: { premium: { models: { "premium-model": { enabled: false } } } } }),
        ),
      ).pipe(Effect.orDie),
  },
)

it.instance(
  "list() uses policy-supplied billing thresholds instead of the defaults",
  () =>
    Effect.gen(function* () {
      const registry = yield* TokenMaxRegistry.Service
      const resources = yield* registry.list()
      // premium-model's blended cost is 30 $/1M -- with a raised standard
      // threshold it should now classify as "standard", not "premium".
      const premium = resources.find((r) => r.providerID === "premium" && r.modelID === "premium-model")
      if (!premium) throw new Error("expected 'premium' provider's model to be in the registry")
      if (premium.billingClass !== "standard")
        throw new Error(`expected billingClass 'standard' under the raised threshold, got '${premium.billingClass}'`)
    }),
  {
    config: registryConfig,
    init: (directory) =>
      Effect.tryPromise(() =>
        Bun.write(`${directory}/tokenmax.json`, JSON.stringify({ billing: { standardMaxPerMTok: 40 } })),
      ).pipe(Effect.orDie),
  },
)

it.instance(
  "list() marks every connected resource provider_listed and connected, by default no catalog entries",
  () =>
    Effect.gen(function* () {
      const registry = yield* TokenMaxRegistry.Service
      const resources = yield* registry.list()
      // Default list() is connected-only, so every entry must be connected
      // and availability=provider_listed -- byte-identical to R1's behavior
      // plus the new availability field.
      for (const r of resources) {
        if (!r.connected) throw new Error(`default list() must be connected-only, saw connected=false for ${r.providerID}`)
        if (r.availability !== "provider_listed")
          throw new Error(`expected connected resource availability 'provider_listed', got '${r.availability}'`)
      }
      const free = resources.find((r) => r.providerID === "free" && r.modelID === "free-model")
      if (!free) throw new Error("expected 'free' model in the default (connected) list")
    }),
  { config: registryConfig },
)

it.instance(
  "list({ includeCatalog: true }) adds not-yet-connected resources as catalog_only, without dropping connected ones",
  () =>
    Effect.gen(function* () {
      const registry = yield* TokenMaxRegistry.Service
      const connectedOnly = yield* registry.list()
      const withCatalog = yield* registry.list({ includeCatalog: true })

      // Catalog is strictly additive: every connected resource is still present.
      for (const r of connectedOnly) {
        const stillThere = withCatalog.find((c) => c.providerID === r.providerID && c.modelID === r.modelID)
        if (!stillThere) throw new Error(`includeCatalog dropped a connected resource: ${r.providerID}/${r.modelID}`)
        if (!stillThere.connected || stillThere.availability !== "provider_listed")
          throw new Error("a connected resource must stay connected/provider_listed even with the catalog included")
      }

      // The bundled ModelsDev catalog is large, so there must be catalog-only
      // entries, and each must be honestly marked (connected=false + catalog_only).
      const catalogOnly = withCatalog.filter((r) => !r.connected)
      if (catalogOnly.length === 0) throw new Error("expected some catalog-only resources from the ModelsDev catalog")
      for (const r of catalogOnly) {
        if (r.availability !== "catalog_only")
          throw new Error(`a not-connected resource must be availability 'catalog_only', got '${r.availability}'`)
      }

      // A provider is never both connected and catalog-only.
      const connectedProviders = new Set(connectedOnly.map((r) => r.providerID))
      for (const r of catalogOnly) {
        if (connectedProviders.has(r.providerID))
          throw new Error(`provider ${r.providerID} appeared as both connected and catalog-only`)
      }
    }),
  { config: registryConfig },
)

const policyOnly = testEffect(LayerNode.compile(LayerNode.group([TokenMaxPolicy.node])))

policyOnly.instance("TokenMaxPolicy.get() returns an empty policy when no tokenmax.json exists", () =>
  Effect.gen(function* () {
    const policy = yield* TokenMaxPolicy.Service
    const info = yield* policy.get()
    if (info.providers && Object.keys(info.providers).length > 0)
      throw new Error("expected no provider overrides with no tokenmax.json present")
    if (info.billing && Object.keys(info.billing).length > 0)
      throw new Error("expected no billing overrides with no tokenmax.json present")
  }),
)
