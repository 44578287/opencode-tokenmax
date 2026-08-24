import { app } from "electron"
import { APP_IDS, APP_NAMES, CHANNEL, PROTOCOL_SCHEMES, tokenmaxXdgDirs, type Channel, type XdgEnv } from "./channel"

// Everything except UPDATER_ENABLED below is pure and lives in channel.ts,
// specifically so it stays unit-testable with `bun test` without an actual
// `app` instance (this file imports "electron" at module scope, which
// throws outside a real Electron process). Re-exported here so existing
// imports of `./constants` elsewhere in this package don't need to change.
export { APP_IDS, APP_NAMES, CHANNEL, PROTOCOL_SCHEMES, tokenmaxXdgDirs }
export type { Channel, XdgEnv }

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev" && CHANNEL !== "tokenmax-dev"
