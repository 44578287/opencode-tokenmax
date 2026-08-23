import { app } from "electron"

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

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev" && CHANNEL !== "tokenmax-dev"

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
