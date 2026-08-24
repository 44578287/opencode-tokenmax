import { afterEach, describe, expect } from "bun:test"
import { Server } from "../../src/server/server"
import { Effect } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"

// R1 gap closed (docs/TOKENMAX-ROADMAP.md): HTTP equivalent of
// `opencode tokenmax`. GET /tokenmax/status through the real server app,
// not a unit test against the handler function in isolation -- proves the
// group is actually reachable end to end (routing, middleware, service
// wiring in server.ts's `app` LayerNode.group all included).

function app() {
  return Server.Default().app
}

const tmpdirEffect = (options: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("tokenmax HttpApi", () => {
  it.live(
    "serves an empty, deterministic status when no providers are enabled",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        config: {
          formatter: false,
          lsp: false,
          // Ambient env credentials in some environments can auto-connect
          // real providers -- pin to none so this assertion is deterministic.
          enabled_providers: [],
        },
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/tokenmax/status", {
            headers: { "x-opencode-directory": tmp.path },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toEqual({
        resources: [],
        policyActive: false,
        telemetry: [],
      })
    }),
  )

  it.live(
    "catalog=true surfaces not-yet-connected resources as catalog_only, even with no providers enabled",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false, enabled_providers: [] } })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/tokenmax/status?catalog=true", {
            headers: { "x-opencode-directory": tmp.path },
          }),
        ),
      )

      expect(response.status).toBe(200)
      const body = yield* Effect.promise(() => response.json())
      // The bundled models.dev catalog is large -- with no providers
      // connected, everything returned must be a catalog_only suggestion.
      expect(body.resources.length).toBeGreaterThan(0)
      for (const r of body.resources) {
        expect(r.connected).toBe(false)
        expect(r.availability).toBe("catalog_only")
      }
    }),
  )

  it.live(
    "reflects tokenmax.json policy overrides in policyActive",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        config: { formatter: false, lsp: false, enabled_providers: [] },
      })
      yield* Effect.promise(() =>
        Bun.write(`${tmp.path}/tokenmax.json`, JSON.stringify({ billing: { economyMaxPerMTok: 2 } })),
      )

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/tokenmax/status", {
            headers: { "x-opencode-directory": tmp.path },
          }),
        ),
      )

      expect(response.status).toBe(200)
      const body = yield* Effect.promise(() => response.json())
      expect(body.policyActive).toBe(true)
    }),
  )
})
