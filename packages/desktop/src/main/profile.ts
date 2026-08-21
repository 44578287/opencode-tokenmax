import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { TOKENMAX_DEV_PROFILE } from "../../identity"

const AUTH_FILES = ["auth.json"] as const
const CONFIG_FILES = ["opencode.json", "opencode.jsonc"] as const

export function tokenmaxXdgDirs(userDataPath: string) {
  return {
    data: join(userDataPath, "xdg-data"),
    config: join(userDataPath, "xdg-config"),
    cache: join(userDataPath, "xdg-cache"),
    state: join(userDataPath, "xdg-state"),
    tmp: join(userDataPath, "tmp"),
  }
}

export function applyTokenMaxDevProfile(userDataPath: string) {
  const dirs = tokenmaxXdgDirs(userDataPath)
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true })
  Object.assign(process.env, {
    XDG_DATA_HOME: dirs.data,
    XDG_CONFIG_HOME: dirs.config,
    XDG_CACHE_HOME: dirs.cache,
    XDG_STATE_HOME: dirs.state,
    TMPDIR: dirs.tmp,
    TEMP: dirs.tmp,
    TMP: dirs.tmp,
  })
  return dirs
}

export function officialOpencodeHome(home = homedir()) {
  return {
    config: join(home, ".config", "opencode"),
    data: join(home, ".local", "share", "opencode"),
    cache: join(home, ".cache", "opencode"),
  }
}

export function importOfficialAuthOnce(opts: {
  userDataPath: string
  home?: string
  skip?: boolean
}): { imported: string[]; skipped: string[]; destConfig: string; destData: string } {
  const dirs = tokenmaxXdgDirs(opts.userDataPath)
  const destConfig = join(dirs.config, "opencode")
  const destData = join(dirs.data, "opencode")
  mkdirSync(destConfig, { recursive: true })
  mkdirSync(destData, { recursive: true })
  const marker = join(opts.userDataPath, "tokenmax-profile.json")
  if (opts.skip || existsSync(marker)) {
    return { imported: [], skipped: ["already-imported"], destConfig, destData }
  }
  const official = officialOpencodeHome(opts.home)
  const imported: string[] = []
  const skipped: string[] = []
  const copy = (from: string, to: string, label: string) => {
    if (!existsSync(from)) {
      skipped.push(label)
      return
    }
    if (existsSync(to)) {
      skipped.push(`${label}:exists`)
      return
    }
    copyFileSync(from, to)
    imported.push(label)
  }
  for (const file of AUTH_FILES) {
    copy(join(official.data, file), join(destData, file), file)
  }
  for (const file of CONFIG_FILES) {
    copy(join(official.config, file), join(destConfig, file), file)
  }
  writeFileSync(
    marker,
    JSON.stringify(
      {
        profile: TOKENMAX_DEV_PROFILE,
        importedAt: new Date().toISOString(),
        imported,
        skipped,
        officialUntouched: true,
      },
      null,
      2,
    ),
  )
  return { imported, skipped, destConfig, destData }
}
