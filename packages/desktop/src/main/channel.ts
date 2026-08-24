import path from "node:path"

// Pure, Electron-free home for TokenMax's per-channel identity constants and
// derivations. Split out of constants.ts specifically so this stays
// unit-testable with `bun test` without an actual `app` instance --
// constants.ts itself imports "electron" at module scope (for
// `app.isPackaged` in UPDATER_ENABLED), which throws outside a real
// Electron process. constants.ts re-exports everything here for backward
// compatibility; nothing outside this file and constants.ts should need to
// know the split exists.

/**
 * "tokenmax-dev" is TokenMax's side-by-side development identity. It is
 * NOT an OpenCode release channel -- it never ships an updater, it has no
 * legacy Tauri app id (TokenMax never existed as a Tauri app, see
 * migrate.ts), and it exists purely so a TokenMax development build can be
 * installed, run, and uninstalled without ever touching the official
 * app's identity, user data, or protocol registration. See
 * docs/TOKENMAX-ARCHITECTURE.md ("Desktop side-by-side identity").
 */
export type Channel = "dev" | "beta" | "prod" | "tokenmax-dev"

const CHANNELS: readonly Channel[] = ["dev", "beta", "prod", "tokenmax-dev"]

const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = (CHANNELS as readonly string[]).includes(raw) ? (raw as Channel) : "dev"

/** Per-channel Electron app id (`app.setAsDefaultProtocolClient`, userData directory, Windows AppUserModelId). */
export const APP_IDS: Record<Channel, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
  "tokenmax-dev": "ai.opencode.tokenmax.dev",
}

/** Per-channel display/product name (`app.setName`, installer product name). */
export const APP_NAMES: Record<Channel, string> = {
  dev: "OpenCode Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
  "tokenmax-dev": "OpenCode TokenMax Dev",
}

/**
 * Per-channel custom URL scheme for OS-level deep links (`opencode://...`).
 * dev/beta/prod intentionally still share the plain "opencode" scheme --
 * that's existing upstream behavior and out of TokenMax's scope to change.
 * "tokenmax-dev" uses a distinct scheme so its deep-link registration can
 * never collide with (or silently steal deep links from) the official app.
 */
export const PROTOCOL_SCHEMES: Record<Channel, string> = {
  dev: "opencode",
  beta: "opencode",
  prod: "opencode",
  "tokenmax-dev": "opencode-tokenmax",
}

/** The four XDG env vars the embedded OpenCode server (packages/core/src/global.ts)
 * reads to locate its data/config/cache/state directories. */
export type XdgEnv = Record<"XDG_DATA_HOME" | "XDG_CONFIG_HOME" | "XDG_CACHE_HOME" | "XDG_STATE_HOME", string>

/**
 * Pure computation of TokenMax Dev's fully-isolated XDG roots, called from
 * main/index.ts's Electron bootstrap. See
 * docs/TOKENMAX-RELIABILITY.md's anti-pattern list ("a shared writable
 * database between the official app and a TokenMax dev build") -- this is
 * the mechanism that makes that impossible: every one of the embedded
 * server's four XDG directories (not just Electron's own `userData`) is
 * rooted under a tokenmax-dev-only path, so it can never resolve to the
 * plain OS-default XDG dirs official OpenCode (or a real terminal
 * `opencode`) reads and writes.
 *
 * `appDataPath` is Electron's `app.getPath("appData")`; `appId` should
 * always be `APP_IDS["tokenmax-dev"]` in real use -- accepted as a
 * parameter (rather than hardcoded) purely so this stays a pure function.
 */
export function tokenmaxXdgDirs(appDataPath: string, appId: string): XdgEnv {
  const root = path.join(appDataPath, appId, "xdg")
  return {
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_STATE_HOME: path.join(root, "state"),
  }
}
