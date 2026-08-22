import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { authModeOf, mapProvider, syncCatalog } from "../../src/tokenmax/catalog-sync"
import { AUTH_MODE } from "../../src/tokenmax/billing"
import { openStore } from "../../src/tokenmax/persist"
import { listRoutes } from "../../src/tokenmax/persist"

describe("tokenmax catalog sync", () => {
  test("maps oauth and api auth modes", () => {
    expect(authModeOf({ type: "oauth" }, "anthropic")).toBe(AUTH_MODE.OAUTH)
    expect(authModeOf({ type: "oauth" }, "github-copilot")).toBe(AUTH_MODE.DEVICE_OAUTH)
    expect(authModeOf({ type: "api" }, "openai")).toBe(AUTH_MODE.API_KEY)
    expect(authModeOf(undefined, "x")).toBe(AUTH_MODE.NONE)
  })

  test("syncs provider catalog into sqlite routes", () => {
    const dir = path.join(os.tmpdir(), `tmx-sync-${Date.now()}`)
    const store = openStore({ dataDir: dir, configDir: dir })
    const n = syncCatalog(
      store,
      [
        {
          id: "opencode",
          models: {
            "hy3-free": {
              id: "hy3-free",
              cost: { input: 0, output: 0 },
              capabilities: { reasoning: false, toolcall: true, input: { image: false } },
              limit: { context: 128000 },
            },
          },
        },
      ],
      {},
    )
    expect(n).toBeGreaterThan(0)
    const rows = listRoutes(store)
    expect(rows.some((row) => String(row.model_id) === "hy3-free")).toBe(true)
    store.close()
  })

  test("mapProvider copies variant keys", () => {
    const catalog = mapProvider({
      id: "xai",
      models: {
        "grok-4.6": {
          id: "grok-4.6",
          capabilities: { reasoning: true, toolcall: true },
          variants: { high: {}, low: {} },
        },
      },
    })
    expect(catalog.models["grok-4.6"]?.variants).toEqual(["high", "low"])
  })
})
