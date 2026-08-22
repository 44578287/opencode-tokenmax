import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"
import { Effect, Layer, Context } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"

export const Info = SessionStatusEvent.Info
export type Info = SessionStatusEvent.Info

export const Event = SessionStatusEvent

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Map<SessionID, Info>>
  readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
  /**
   * Records that forward progress happened on a session (a stream event, a
   * status transition, etc) without changing its status. Used by the
   * SessionRunState watchdog to distinguish "still working" from "stuck
   * forever" - see run-state.ts.
   */
  readonly touch: (sessionID: SessionID) => Effect.Effect<void>
  /** Milliseconds since the session last made forward progress, or undefined if unknown/idle. */
  readonly idleFor: (sessionID: SessionID) => Effect.Effect<number | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionStatus.state")(() =>
        Effect.succeed({
          info: new Map<SessionID, Info>(),
          lastActivity: new Map<SessionID, number>(),
        }),
      ),
    )

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      return data.info.get(sessionID) ?? { type: "idle" as const }
    })

    const list = Effect.fn("SessionStatus.list")(function* () {
      const data = yield* InstanceState.get(state)
      return new Map(data.info)
    })

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      const data = yield* InstanceState.get(state)
      data.lastActivity.set(sessionID, Date.now())
      yield* events.publish(Event.Status, { sessionID, status })
      if (status.type === "idle") {
        yield* events.publish(Event.Idle, { sessionID })
        data.info.delete(sessionID)
        data.lastActivity.delete(sessionID)
        return
      }
      data.info.set(sessionID, status)
    })

    const touch = Effect.fn("SessionStatus.touch")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      if (!data.info.has(sessionID)) return
      data.lastActivity.set(sessionID, Date.now())
    })

    const idleFor = Effect.fn("SessionStatus.idleFor")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const last = data.lastActivity.get(sessionID)
      if (last === undefined) return undefined
      return Date.now() - last
    })

    return Service.of({ get, list, set, touch, idleFor })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node] })

export * as SessionStatus from "./status"
