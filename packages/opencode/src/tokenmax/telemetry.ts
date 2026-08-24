export * as TokenMaxTelemetry from "./telemetry"

// R2 -- Native Child Routing / groundwork for R3 -- Intelligent Resource
// Scheduling (docs/TOKENMAX-ROADMAP.md). Records which resource actually
// handled each subagent run and how it went. Nothing reads this yet --
// R3's "historical success weighting" is the first real consumer -- but
// recording starts now rather than being retrofitted later, so R3 doesn't
// start from zero history. See docs/TOKENMAX-DECISIONS.md D-009.
//
// Reuses Storage.Service (packages/opencode/src/storage/storage.ts) rather
// than building new persistence -- same reuse discipline as the rest of
// R1/R2. Storage's own directory is process-wide, not per-project, so
// (matching the existing session_diff/session_message convention) records
// are keyed by the subagent's own session ID, which is already globally
// unique -- no separate project-scoping needed.
//
// Recording is fire-and-forget: a storage hiccup must never fail or slow
// down subagent dispatch, so record() swallows its own errors (matching
// session/revert.ts's identical `.pipe(Effect.ignore)` choice for
// non-critical writes).

import { Context, Effect, Layer, Schema } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Storage } from "@/storage/storage"

export const ModelSource = Schema.Literals(["explicit", "router", "inherited"])
export type ModelSource = Schema.Schema.Type<typeof ModelSource>

export const Outcome = Schema.Literals(["success", "error"])
export type Outcome = Schema.Schema.Type<typeof Outcome>

export const Event = Schema.Struct({
  sessionID: Schema.String,
  parentSessionID: Schema.String,
  providerID: Schema.String,
  modelID: Schema.String,
  billingClass: Schema.optional(Schema.String),
  modelSource: ModelSource,
  subagentType: Schema.String,
  description: Schema.optional(Schema.String),
  outcome: Outcome,
  timestamp: Schema.Number,
})
export type Event = Schema.Schema.Type<typeof Event>

const KEY_PREFIX = ["tokenmax", "telemetry"]

export interface Interface {
  readonly record: (event: Omit<Event, "timestamp">) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Event[]>
}

export class Service extends Context.Service<Service, Interface>()("@tokenmax/Telemetry") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* Storage.Service

    // Both storage.write and storage.list/read carry a real FSUtil.Error --
    // caught here rather than left in the public Interface's error channel,
    // since a storage hiccup must never fail or slow down subagent dispatch
    // (record) or degrade a caller like `opencode tokenmax` that just wants
    // whatever history exists (list).
    const record = Effect.fn("TokenMaxTelemetry.record")(function* (event: Omit<Event, "timestamp">) {
      yield* storage.write([...KEY_PREFIX, event.sessionID], { ...event, timestamp: Date.now() } satisfies Event)
    })

    const list = Effect.fn("TokenMaxTelemetry.list")(function* () {
      const keys = yield* storage.list(KEY_PREFIX)
      const events: Event[] = []
      for (const key of keys) {
        const event = yield* storage.read<Event>(key).pipe(Effect.option)
        if (event._tag === "Some") events.push(event.value)
      }
      return events.sort((a, b) => a.timestamp - b.timestamp)
    })

    return Service.of({
      record: (event) => record(event).pipe(Effect.ignore),
      list: () => list().pipe(Effect.catch(() => Effect.succeed([]))),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Storage.node] })
