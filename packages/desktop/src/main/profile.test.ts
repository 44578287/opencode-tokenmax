import { describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { APP_IDS, APP_NAMES, PROTOCOL_SCHEMES } from "../../identity"
import { applyTokenMaxDevProfile, importOfficialAuthOnce, officialOpencodeHome, tokenmaxXdgDirs } from "./profile"

describe("tokenmax dev identity", () => {
  test("dev app id and protocol do not collide with official OpenCode", () => {
    expect(APP_IDS.dev).toBe("ai.opencode.tokenmax.dev")
    expect(APP_NAMES.dev).toBe("OpenCode TokenMax Dev")
    expect(PROTOCOL_SCHEMES.dev).toBe("opencode-tokenmax")
    expect(APP_IDS.dev).not.toBe(APP_IDS.prod)
    expect(PROTOCOL_SCHEMES.dev).not.toBe(PROTOCOL_SCHEMES.prod)
  })
})

describe("tokenmax dev profile isolation", () => {
  test("import copies auth/config once and never writes official files", () => {
    const root = mkdtempSync(join(tmpdir(), "tokenmax-profile-"))
    const home = join(root, "home")
    const userData = join(root, "userdata")
    const official = officialOpencodeHome(home)
    mkdirSync(official.config, { recursive: true })
    mkdirSync(official.data, { recursive: true })
    writeFileSync(join(official.data, "auth.json"), JSON.stringify({ xai: { type: "oauth" } }))
    writeFileSync(join(official.config, "opencode.jsonc"), "{}\n")
    writeFileSync(join(official.data, "opencode.db"), "official-db")

    const first = importOfficialAuthOnce({ userDataPath: userData, home })
    expect(first.imported).toContain("auth.json")
    expect(first.imported).toContain("opencode.jsonc")
    const destAuth = join(first.destData, "auth.json")
    expect(readFileSync(destAuth, "utf8")).toContain("oauth")
    expect(readFileSync(join(official.data, "opencode.db"), "utf8")).toBe("official-db")

    writeFileSync(destAuth, JSON.stringify({ xai: { type: "oauth", mutated: true } }))
    const second = importOfficialAuthOnce({ userDataPath: userData, home })
    expect(second.imported).toEqual([])
    expect(readFileSync(join(official.data, "auth.json"), "utf8")).not.toContain("mutated")

    const xdg = tokenmaxXdgDirs(userData)
    expect(xdg.data.startsWith(userData)).toBe(true)
    expect(xdg.config).not.toBe(official.config)

    rmSync(root, { recursive: true, force: true })
  })

  test("applyTokenMaxDevProfile sets XDG dirs under userData", () => {
    const root = mkdtempSync(join(tmpdir(), "tokenmax-xdg-"))
    const keys = ["XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "TMPDIR", "TEMP", "TMP"] as const
    const prev = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
    const dirs = applyTokenMaxDevProfile(root)
    expect(process.env.XDG_DATA_HOME).toBe(dirs.data)
    expect(process.env.XDG_CONFIG_HOME).toBe(dirs.config)
    for (const key of keys) {
      if (prev[key] === undefined) delete process.env[key]
      else process.env[key] = prev[key]
    }
    rmSync(root, { recursive: true, force: true })
  })
})
