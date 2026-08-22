import { describe, expect, test, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import fs from "fs"
import os from "os"
import path from "path"
import {
  countRoutes,
  openStore,
  pluginDbPath,
  recordProviderFailure,
  isProviderQuarantined,
  clearProviderQuarantine,
  listQuarantinedProviders,
} from "../../src/tokenmax/persist"

const dirs: string[] = []
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenmax-"))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
})

describe("tokenmax persist migration", () => {
  test("imports plugin sqlite without wiping old file", () => {
    const configDir = tmp()
    const dataDir = tmp()
    const oldPath = pluginDbPath(configDir)
    fs.mkdirSync(path.dirname(oldPath), { recursive: true })
    const old = new Database(oldPath)
    old.exec(`
      CREATE TABLE routes (
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        variant TEXT NOT NULL DEFAULT '',
        billing_type TEXT,
        availability TEXT,
        monetary_free INTEGER,
        cost_known INTEGER,
        cost_input REAL,
        cost_output REAL,
        reasoning INTEGER,
        tools INTEGER,
        vision INTEGER,
        context_limit INTEGER,
        PRIMARY KEY (provider_id, model_id, variant)
      );
    `)
    old.run("INSERT INTO routes(provider_id, model_id, variant, billing_type) VALUES(?,?,?,?)", [
      "opencode",
      "hy3-free",
      "",
      "FREE",
    ])
    old.run("INSERT INTO routes(provider_id, model_id, variant, billing_type) VALUES(?,?,?,?)", [
      "anthropic",
      "claude-sonnet-5",
      "high",
      "SUBSCRIPTION_QUOTA",
    ])
    old.close()

    const first = openStore({ dataDir, configDir })
    expect(countRoutes(first)).toBe(2)
    expect(fs.existsSync(oldPath)).toBe(true)
    first.close()

    const second = openStore({ dataDir, configDir })
    expect(countRoutes(second)).toBe(2)
    second.close()
  })

  test("openStore survives a legacy plugin db with a column-mismatched table", () => {
    // Regression: a real legacy plugin.sqlite had a provider_health table
    // predating its `health` column. importPluginDb's INSERT...SELECT
    // referenced old.provider_health.health, which doesn't exist in that
    // schema, throwing "no such column: health". Because openStore()'s
    // caller (the store() singleton) only assigns on success, an uncaught
    // throw here meant EVERY subsequent request re-attempted the same
    // failing import forever - every /tokenmax/* API call and every
    // /tokenmax-* command failed with "Unexpected server error".
    const configDir = tmp()
    const dataDir = tmp()
    const oldPath = pluginDbPath(configDir)
    fs.mkdirSync(path.dirname(oldPath), { recursive: true })
    const old = new Database(oldPath)
    old.exec(`
      CREATE TABLE routes (
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        variant TEXT NOT NULL DEFAULT '',
        billing_type TEXT,
        PRIMARY KEY (provider_id, model_id, variant)
      );
      -- Older schema: provider_health existed before a "health" column was added.
      CREATE TABLE provider_health (
        provider_id TEXT PRIMARY KEY,
        last_error TEXT,
        last_error_at TEXT
      );
    `)
    old.run("INSERT INTO routes(provider_id, model_id, variant, billing_type) VALUES(?,?,?,?)", [
      "opencode",
      "hy3-free",
      "",
      "FREE",
    ])
    old.run("INSERT INTO provider_health(provider_id, last_error, last_error_at) VALUES(?,?,?)", [
      "opencode",
      null,
      null,
    ])
    old.close()

    // Must not throw - the store must open successfully even though one
    // legacy table's schema can't be migrated as-is.
    const store = openStore({ dataDir, configDir })
    expect(countRoutes(store)).toBe(1)
    store.close()

    // Must also not retry the failing import on every subsequent open -
    // the fingerprint should be recorded so re-opening is a no-op.
    const reopened = openStore({ dataDir, configDir })
    expect(countRoutes(reopened)).toBe(1)
    reopened.close()
  })
})

describe("tokenmax provider quarantine", () => {
  test("AUTH_401 quarantines on the very first failure (dead credential is unambiguous)", () => {
    const store = openStore({ dataDir: tmp() })
    expect(isProviderQuarantined(store, "anthropic")).toBe(false)
    const state = recordProviderFailure(store, "anthropic", "AUTH_401", "claude-opus-4-7")
    expect(state).toBeDefined()
    expect(isProviderQuarantined(store, "anthropic")).toBe(true)
    store.close()
  })

  test("transient errors (429/5xx/quota) get one free pass before quarantining", () => {
    const store = openStore({ dataDir: tmp() })
    const first = recordProviderFailure(store, "openai", "RATE_LIMIT_429", "gpt-5-nano")
    expect(first).toBeUndefined()
    expect(isProviderQuarantined(store, "openai")).toBe(false)
    const second = recordProviderFailure(store, "openai", "RATE_LIMIT_429", "gpt-5-nano")
    expect(second).toBeDefined()
    expect(isProviderQuarantined(store, "openai")).toBe(true)
    store.close()
  })

  test("CAPABILITY_FAILURE never quarantines a provider from a single model's repeated failures", () => {
    const store = openStore({ dataDir: tmp() })
    for (let i = 0; i < 10; i++) recordProviderFailure(store, "github-copilot", "CAPABILITY_FAILURE", "kimi-k2.7-code")
    expect(isProviderQuarantined(store, "github-copilot")).toBe(false)
    store.close()
  })

  test("CAPABILITY_FAILURE quarantines once >=2 different models under the same provider fail repeatedly", () => {
    const store = openStore({ dataDir: tmp() })
    recordProviderFailure(store, "github-copilot", "CAPABILITY_FAILURE", "kimi-k2.7-code")
    recordProviderFailure(store, "github-copilot", "CAPABILITY_FAILURE", "claude-opus-4.8")
    expect(isProviderQuarantined(store, "github-copilot")).toBe(false)
    const state = recordProviderFailure(store, "github-copilot", "CAPABILITY_FAILURE", "kimi-k2.7-code")
    expect(state).toBeDefined()
    expect(isProviderQuarantined(store, "github-copilot")).toBe(true)
    store.close()
  })

  test("a successful call clears the quarantine immediately", () => {
    const store = openStore({ dataDir: tmp() })
    recordProviderFailure(store, "anthropic", "AUTH_401", "claude-opus-4-7")
    expect(isProviderQuarantined(store, "anthropic")).toBe(true)
    clearProviderQuarantine(store, "anthropic")
    expect(isProviderQuarantined(store, "anthropic")).toBe(false)
    store.close()
  })

  test("listQuarantinedProviders only returns currently-active quarantines", () => {
    const store = openStore({ dataDir: tmp() })
    recordProviderFailure(store, "anthropic", "AUTH_401", "claude-opus-4-7")
    recordProviderFailure(store, "openai", "RATE_LIMIT_429", "gpt-5-nano")
    const active = listQuarantinedProviders(store)
    expect(active.map((s) => s.providerId).sort()).toEqual(["anthropic"])
    store.close()
  })

  test("an unrelated provider is never quarantined by another provider's failures", () => {
    const store = openStore({ dataDir: tmp() })
    recordProviderFailure(store, "anthropic", "AUTH_401", "claude-opus-4-7")
    expect(isProviderQuarantined(store, "opencode")).toBe(false)
    expect(isProviderQuarantined(store, "openai")).toBe(false)
    store.close()
  })
})
