import type { SyncBundle } from "./types"
import { getHost, putHost, HOST_VERSION } from "./mock"

export async function hostHealth() {
  return { ok: true as const, version: HOST_VERSION, label: "演示主机" }
}

export async function hostPull() {
  return getHost()
}

export async function hostPush(bundle: SyncBundle) {
  return putHost(bundle)
}
