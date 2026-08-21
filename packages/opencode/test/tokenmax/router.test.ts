import { describe, expect, test } from "bun:test"
import { decide } from "../../src/tokenmax/router"
import { expandRoutes } from "../../src/tokenmax/registry"
import { AUTH_MODE } from "../../src/tokenmax/billing"
import { isEnabled } from "../../src/tokenmax/config"
import type { Route } from "../../src/tokenmax/types"
import { observeQuota, getQuota } from "../../src/tokenmax/quota"
import { openStore } from "../../src/tokenmax/persist"
import { isDeterministic, render, wantsLlm } from "../../src/tokenmax/commands"
import fs from "fs"
import os from "os"
import path from "path"

const route = (partial: Partial<Route> & Pick<Route, "providerId" | "modelId">): Route => ({
  variant: "",
  billing: "FREE",
  availability: "VERIFIED_CALLABLE",
  costKnown: true,
  monetaryFree: true,
  inputPerMtok: 0,
  outputPerMtok: 0,
  reasoning: false,
  tools: true,
  vision: false,
  contextLimit: 128000,
  health: 1,
  quotaPressure: null,
  ...partial,
})

describe("tokenmax router", () => {
  test("disabled flag returns null (upstream behavior)", () => {
    expect(isEnabled({})).toBe(false)
    expect(isEnabled({ experimental: { tokenmax: { enabled: false } } })).toBe(false)
    expect(
      decide(
        { taskClass: "search" },
        { enabled: false, routes: [route({ providerId: "opencode", modelId: "hy3-free" })] },
      ),
    ).toBeNull()
  })

  test("model#variant are distinct routes", () => {
    const routes = expandRoutes({
      providers: [
        {
          id: "anthropic",
          models: {
            "claude-sonnet-5": {
              id: "claude-sonnet-5",
              cost: { input: 3, output: 15 },
              reasoning: true,
              variants: ["low", "high"],
            },
          },
        },
      ],
      authModeOf: () => AUTH_MODE.OAUTH,
    })
    const keys = routes.map((r) => `${r.modelId}#${r.variant}`)
    expect(keys).toContain("claude-sonnet-5#")
    expect(keys).toContain("claude-sonnet-5#low")
    expect(keys).toContain("claude-sonnet-5#high")
    expect(new Set(keys).size).toBe(3)
  })

  test("decide is deterministic for the same inputs", () => {
    const routes = [
      route({ providerId: "opencode", modelId: "hy3-free", health: 0.9 }),
      route({ providerId: "xai", modelId: "grok-4.6", billing: "SUBSCRIPTION_QUOTA", monetaryFree: false, health: 0.4 }),
    ]
    const a = decide({ taskClass: "search" }, { enabled: true, routes })
    const b = decide({ taskClass: "search" }, { enabled: true, routes })
    expect(a?.key).toBe(b?.key)
    expect(a?.provider).toBe("opencode")
  })
})

describe("tokenmax quota", () => {
  test("UNKNOWN remaining is not fabricated", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenmax-"))
    const store = openStore({ dataDir: dir })
    const q = observeQuota(store, { providerId: "anthropic", remaining: null, source: "UNKNOWN" })
    expect(q.remaining).toBeNull()
    expect(q.remainingConfidence).toBe(0)
    expect(getQuota(store, "missing").remaining).toBeNull()
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe("tokenmax commands 0-LLM", () => {
  test("status/stats/route/models are deterministic", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenmax-"))
    const store = openStore({ dataDir: dir })
    for (const name of ["tokenmax-status", "tokenmax-stats", "tokenmax-route", "tokenmax-models"]) {
      expect(isDeterministic(name)).toBe(true)
      const result = render(name, { store, enabled: false })
      expect(result.llmRequests).toBe(0)
      expect(result.modelTokens).toBe(0)
      expect(result.text.includes("llmRequests: 0")).toBe(true)
    }
    expect(wantsLlm("tokenmax-stats", "--analyze")).toBe(true)
    expect(isDeterministic("tokenmax-stats", "--analyze")).toBe(false)
    expect(wantsLlm("tokenmax-route", "--explain")).toBe(true)
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
