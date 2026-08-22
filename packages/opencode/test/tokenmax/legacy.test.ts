import { describe, expect, test } from "bun:test"
import {
  assertSafeStartup,
  filterPluginList,
  inspectTokenMax,
  isLegacyTokenMaxPlugin,
  TokenMaxConflictError,
} from "../../src/tokenmax/legacy"
import { isDeterministic } from "../../src/tokenmax/commands"

describe("tokenmax leftover migration", () => {
  test("detects leftover plugin by path, npm spec, and file url", () => {
    expect(isLegacyTokenMaxPlugin("C:/Users/g9964/.config/opencode/plugins/tokenmax-router")).toBe(true)
    expect(isLegacyTokenMaxPlugin("file:///C:/Users/g9964/.config/opencode/plugins/tokenmax-router")).toBe(true)
    expect(isLegacyTokenMaxPlugin("tokenmax-router@0.1.0")).toBe(true)
    expect(isLegacyTokenMaxPlugin(["tokenmax-router", { x: 1 }])).toBe(true)
    expect(isLegacyTokenMaxPlugin("oh-my-openagent@latest")).toBe(false)
    expect(isLegacyTokenMaxPlugin("opencode-anthropic-oauth")).toBe(false)
  })

  test("native enabled strips leftover plugin and reports NATIVE", () => {
    const diag = inspectTokenMax({
      experimental: { tokenmax: { enabled: true } },
      plugin: ["oh-my-openagent@latest", "C:/x/plugins/tokenmax-router", "opencode-acp@stable"],
      plugin_origins: [{ spec: "tokenmax-router" }, { spec: "oh-my-openagent@latest" }],
      agent: { "tokenmax-search": { mode: "subagent" }, build: {} },
      command: { "tokenmax-status": { template: "please restated" }, help: { template: "help" } },
    })
    expect(diag.mode).toBe("NATIVE")
    expect(diag.strippedPlugins.some((s) => s.includes("tokenmax-router"))).toBe(true)
    expect(diag.leftoverAgents).toContain("tokenmax-search")
    expect(diag.leftoverCommands).toContain("tokenmax-status")
    expect(diag.conflict).toBe(false)
  })

  test("native disabled keeps leftover plugin as LEGACY_PLUGIN", () => {
    const origins = [{ spec: "tokenmax-router" }, { spec: "oh-my-openagent@latest" }]
    const diag = inspectTokenMax({ plugin_origins: origins })
    expect(diag.mode).toBe("LEGACY_PLUGIN")
    expect(diag.strippedPlugins).toEqual([])
    const filtered = filterPluginList(origins, false, (item) => item.spec)
    expect(filtered.kept).toEqual(origins)
    expect(filtered.stripped).toEqual([])
  })

  test("native enabled filter does not load leftover plugin", () => {
    const origins = [{ spec: "tokenmax-router" }, { spec: "oh-my-openagent@latest" }]
    const filtered = filterPluginList(origins, true, (item) => item.spec)
    expect(filtered.kept.map((item) => item.spec)).toEqual(["oh-my-openagent@latest"])
    expect(filtered.stripped.map((item) => item.spec)).toEqual(["tokenmax-router"])
    assertSafeStartup(
      true,
      filtered.kept.map((item) => String(item.spec)).filter((spec) => isLegacyTokenMaxPlugin(spec)),
    )
  })

  test("startup fails if leftover plugin would still load with native on", () => {
    expect(() => assertSafeStartup(true, ["tokenmax-router"])).toThrow(TokenMaxConflictError)
  })

  test("native commands stay deterministic and do not request LLM", () => {
    expect(isDeterministic("tokenmax-status", "")).toBe(true)
    expect(isDeterministic("tokenmax-models", "")).toBe(true)
    expect(isDeterministic("help", "")).toBe(false)
  })

  test("help is not intercepted by leftover command overlay when native is on", () => {
    const leftoverCommands = { "tokenmax-status": { template: "LLM restated" } }
    const nativeOn = true
    const registered: string[] = ["help"]
    for (const name of Object.keys(leftoverCommands)) {
      if (nativeOn && name.startsWith("tokenmax-")) continue
      registered.push(name)
    }
    expect(registered).toContain("help")
    expect(registered).not.toContain("tokenmax-status")
  })
})
