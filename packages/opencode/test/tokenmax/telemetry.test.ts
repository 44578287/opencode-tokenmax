import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { TokenMaxTelemetry } from "@/tokenmax/telemetry"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([TokenMaxTelemetry.node])))

it.instance("record() then list() round-trips an event, with a timestamp filled in", () =>
  Effect.gen(function* () {
    const telemetry = yield* TokenMaxTelemetry.Service
    yield* telemetry.record({
      sessionID: "ses_child_1",
      parentSessionID: "ses_parent_1",
      providerID: "cheap",
      modelID: "cheap-model",
      modelSource: "router",
      subagentType: "general",
      description: "inspect bug",
      outcome: "success",
    })

    const events = yield* telemetry.list()
    const found = events.find((e) => e.sessionID === "ses_child_1")
    if (!found) throw new Error("expected the recorded event to be listed")
    if (found.providerID !== "cheap" || found.modelID !== "cheap-model")
      throw new Error("expected the recorded provider/model to round-trip")
    if (found.modelSource !== "router") throw new Error("expected modelSource to round-trip")
    if (found.outcome !== "success") throw new Error("expected outcome to round-trip")
    if (typeof found.timestamp !== "number" || found.timestamp <= 0)
      throw new Error("expected record() to fill in a real timestamp")
  }),
)

it.instance("list() returns events sorted oldest first", () =>
  Effect.gen(function* () {
    const telemetry = yield* TokenMaxTelemetry.Service
    yield* telemetry.record({
      sessionID: "ses_child_a",
      parentSessionID: "ses_parent_1",
      providerID: "p",
      modelID: "m",
      modelSource: "explicit",
      subagentType: "general",
      outcome: "success",
    })
    yield* telemetry.record({
      sessionID: "ses_child_b",
      parentSessionID: "ses_parent_1",
      providerID: "p",
      modelID: "m",
      modelSource: "explicit",
      subagentType: "general",
      outcome: "error",
    })

    const events = yield* telemetry.list()
    const ids = events.map((e) => e.sessionID)
    const indexA = ids.indexOf("ses_child_a")
    const indexB = ids.indexOf("ses_child_b")
    if (indexA === -1 || indexB === -1) throw new Error("expected both recorded events to be present")
    if (indexA > indexB) throw new Error("expected ses_child_a (recorded first) to sort before ses_child_b")
  }),
)

// Storage.Service's directory is process-wide, not per-test-instance (see
// telemetry.ts's own comment on this), so these tests deliberately never
// assert an exact list() length or "nothing recorded yet" -- other tests
// in the same run share that storage. Assertions instead key off specific
// sessionIDs or relative ordering, which hold regardless of what else is
// present.
it.instance("recording twice for the same sessionID updates the record instead of duplicating it", () =>
  Effect.gen(function* () {
    const telemetry = yield* TokenMaxTelemetry.Service
    const sessionID = "ses_child_resumed"
    yield* telemetry.record({
      sessionID,
      parentSessionID: "ses_parent_1",
      providerID: "p",
      modelID: "m",
      modelSource: "explicit",
      subagentType: "general",
      outcome: "error",
    })
    yield* telemetry.record({
      sessionID,
      parentSessionID: "ses_parent_1",
      providerID: "p",
      modelID: "m",
      modelSource: "explicit",
      subagentType: "general",
      outcome: "success",
    })

    const events = yield* telemetry.list()
    const matches = events.filter((e) => e.sessionID === sessionID)
    if (matches.length !== 1) throw new Error(`expected exactly one record for a resumed session, got ${matches.length}`)
    if (matches[0]?.outcome !== "success") throw new Error("expected the second record() call to overwrite the first")
  }),
)
