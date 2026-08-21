import { describe, expect, test, afterEach } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { openStore } from "../../src/tokenmax/persist"
import { getCapability, recordCapability } from "../../src/tokenmax/capability"
import { ErrorClass } from "../../src/tokenmax/error"
import { routeKey } from "../../src/tokenmax/types"

const dirs: string[] = []

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenmax-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("tokenmax capability", () => {
  test("provider failure does not change ema", () => {
    const store = openStore({ dataDir: tmp() })
    const key = routeKey("anthropic", "claude-sonnet-5")
    const first = recordCapability(store, {
      providerId: "anthropic",
      modelId: "claude-sonnet-5",
      taskClass: "coding",
      ok: true,
    })
    expect(first.updated).toBe(true)
    expect(first.ema).toBe(1)
    const blocked = recordCapability(store, {
      providerId: "anthropic",
      modelId: "claude-sonnet-5",
      taskClass: "coding",
      ok: false,
      errorCategory: ErrorClass.RATE_LIMIT_429,
    })
    expect(blocked.updated).toBe(false)
    expect(blocked.ema).toBe(1)
    expect(getCapability(store, key, "coding").samples).toBe(1)
    for (const kind of [
      ErrorClass.AUTH_401,
      ErrorClass.QUOTA_EXHAUSTED,
      ErrorClass.PROVIDER_5XX,
      ErrorClass.TIMEOUT,
      ErrorClass.PERMISSION_DENIED,
    ]) {
      expect(
        recordCapability(store, {
          providerId: "anthropic",
          modelId: "claude-sonnet-5",
          taskClass: "coding",
          ok: false,
          errorCategory: kind,
        }).updated,
      ).toBe(false)
    }
    store.close()
  })

  test("capability failure lowers ema", () => {
    const store = openStore({ dataDir: tmp() })
    recordCapability(store, { providerId: "opencode", modelId: "hy3-free", taskClass: "coding", ok: true })
    const fail = recordCapability(store, {
      providerId: "opencode",
      modelId: "hy3-free",
      taskClass: "coding",
      ok: false,
      errorCategory: ErrorClass.CAPABILITY_FAILURE,
    })
    expect(fail.updated).toBe(true)
    expect(fail.ema).toBeLessThan(1)
    store.close()
  })
})
