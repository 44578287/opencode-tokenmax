import { describe, expect, test } from "bun:test"
import path from "node:path"
import { APP_IDS, PROTOCOL_SCHEMES, tokenmaxXdgDirs } from "./channel"

// Guards docs/TOKENMAX-RELIABILITY.md's anti-pattern list: "a shared
// writable database between the official app and a TokenMax dev build".
// tokenmaxXdgDirs() is the pure core of the isolation main/index.ts wires
// up at Electron bootstrap (see its own comment there) -- previously only
// covered by the Windows Desktop E2E confidence gate ("official OpenCode,
// after TokenMax Dev install/uninstall: works, untouched"), which is real
// but slow and not part of tokenmax-native-tests.yml's fast CI pass. This
// gives the actual directory-derivation logic its own fast, deterministic
// coverage.

describe("tokenmaxXdgDirs", () => {
  const appDataPath = "/home/user/.config"
  const appId = APP_IDS["tokenmax-dev"]
  const dirs = tokenmaxXdgDirs(appDataPath, appId)

  test("every XDG dir is rooted under the tokenmax-dev app id, not the bare appData path", () => {
    for (const value of Object.values(dirs)) {
      expect(value.startsWith(path.join(appDataPath, appId))).toBe(true)
    }
  })

  test("all four dirs are distinct from each other", () => {
    const values = Object.values(dirs)
    expect(new Set(values).size).toBe(values.length)
  })

  test("none of the four dirs equal the bare appData path or the app id root alone", () => {
    const values = Object.values(dirs)
    expect(values).not.toContain(appDataPath)
    expect(values).not.toContain(path.join(appDataPath, appId))
  })

  test("is a pure function of its inputs -- same inputs always produce the same paths", () => {
    expect(tokenmaxXdgDirs(appDataPath, appId)).toEqual(dirs)
  })

  test("a different appId (e.g. the official prod app's) produces entirely disjoint paths", () => {
    const officialDirs = tokenmaxXdgDirs(appDataPath, APP_IDS.prod)
    const keys = ["XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"] as const
    for (const key of keys) {
      expect(officialDirs[key]).not.toBe(dirs[key])
    }
  })

  test("uses the platform path separator, not a hardcoded one (Windows correctness)", () => {
    for (const value of Object.values(dirs)) {
      expect(value).toBe(path.normalize(value))
    }
  })
})

// Not this file's main subject, but cheap to assert alongside: tokenmax-dev's
// protocol scheme must never collide with the shared "opencode" scheme
// dev/beta/prod intentionally still use (see constants.ts's own comment).
test("tokenmax-dev's protocol scheme is distinct from every official channel's", () => {
  expect(PROTOCOL_SCHEMES["tokenmax-dev"]).not.toBe(PROTOCOL_SCHEMES.dev)
  expect(PROTOCOL_SCHEMES["tokenmax-dev"]).not.toBe(PROTOCOL_SCHEMES.beta)
  expect(PROTOCOL_SCHEMES["tokenmax-dev"]).not.toBe(PROTOCOL_SCHEMES.prod)
})
