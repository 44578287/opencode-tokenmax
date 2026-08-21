import { describe, expect, test, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import fs from "fs"
import os from "os"
import path from "path"
import { countRoutes, openStore, pluginDbPath } from "../../src/tokenmax/persist"

const dirs: string[] = []
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenmax-"))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
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
})
