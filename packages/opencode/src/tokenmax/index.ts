export { VERSION } from "./version"
export * from "./types"
export * from "./error"
export * from "./billing"
export * from "./persist"
export * from "./capability"
export * from "./quota"
export * from "./router"
export * from "./scheduler"
export * from "./registry"
export * from "./history"
export * from "./telemetry"
export * from "./config"
export { status } from "./snapshot"
export * as Commands from "./commands"

import { Global } from "@opencode-ai/core/global"
import { openStore, type Store } from "./persist"

let singleton: Store | undefined

export function store(): Store {
  if (!singleton) {
    singleton = openStore({ dataDir: Global.Path.data, configDir: Global.Path.config })
  }
  return singleton
}

export function resetStore() {
  singleton?.close()
  singleton = undefined
}
