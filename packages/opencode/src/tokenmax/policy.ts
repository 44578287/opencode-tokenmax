export * as TokenMaxPolicy from "./policy"

// R1 — Native Resource Core (docs/TOKENMAX-ROADMAP.md, "hot policy
// loading"). TokenMax's own policy file -- deliberately NOT an extension of
// OpenCode's own config schema (`@opencode-ai/core/v1/config/config`):
// that schema is shared, versioned surface used by every channel, and
// TokenMax's R0 isolation principle (don't alter official behavior to add
// TokenMax features -- see TOKENMAX-DECISIONS.md D-005) extends naturally
// here: TokenMax policy lives in its own file (`tokenmax.json[c]`), reusing
// only the project/global directory *discovery* OpenCode's own config
// loader already provides (ConfigPaths), not its schema.
//
// "Hot" means: `get()` re-reads and re-merges the file(s) from disk on
// every call rather than caching a snapshot from service-construction
// time, so an edit to tokenmax.json takes effect on the next call, no
// restart required. Directory discovery does still need InstanceState's
// per-project directory/worktree context (multiple project instances can
// run in one process), but that context itself is fixed for an instance's
// lifetime, so only it -- not the parsed policy -- is worth caching, and
// this module keeps its own read-fresh guarantee by not caching at all
// yet. If reads become hot enough to matter, cache with mtime
// invalidation, not a fixed TTL.

import { Context, Effect, Layer, Schema } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { ConfigPaths } from "@/config/paths"
import { ConfigParse } from "@/config/parse"
import { mergeDeep } from "remeda"

export const ProviderOverride = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  models: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        enabled: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
})
export type ProviderOverride = Schema.Schema.Type<typeof ProviderOverride>

export const BillingThresholds = Schema.Struct({
  economyMaxPerMTok: Schema.optional(Schema.Finite),
  standardMaxPerMTok: Schema.optional(Schema.Finite),
})
export type BillingThresholds = Schema.Schema.Type<typeof BillingThresholds>

export const Info = Schema.Struct({
  providers: Schema.optional(Schema.Record(Schema.String, ProviderOverride)),
  billing: Schema.optional(BillingThresholds),
})
export type Info = Schema.Schema.Type<typeof Info>

export const empty: Info = {}

function mergePolicy(target: Info, source: Info): Info {
  return mergeDeep(target, source) as Info
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
}

export class Service extends Context.Service<Service, Interface>()("@tokenmax/Policy") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    // ConfigPaths.files does its own `yield* FSUtil.Service` internally, so
    // that requirement is part of THIS closure's real effect graph, resolved
    // wherever `get()` actually runs -- not "already satisfied" just because
    // `fs` was captured above at layer-construction time. Re-providing the
    // already-resolved `fs` here (matching config.ts's own
    // `Effect.provideService(FSUtil.Service, fs)`) means callers of `get()`
    // never need to supply FSUtil.Service themselves.
    const get = Effect.fn("TokenMaxPolicy.get")(function* () {
      const ctx = yield* InstanceState.context
      const files = yield* ConfigPaths.files("tokenmax", ctx.directory, ctx.worktree).pipe(Effect.orDie)

      let result = empty
      for (const file of files) {
        const text = yield* fs.readFileStringSafe(file).pipe(Effect.orDie)
        if (text === undefined) continue
        const parsed = ConfigParse.jsonc(text, file)
        const decoded = ConfigParse.schema(Info, parsed, file)
        result = mergePolicy(result, decoded)
      }
      return result
    }, Effect.provideService(FSUtil.Service, fs))

    return Service.of({ get })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node] })
