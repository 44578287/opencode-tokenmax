#!/usr/bin/env bun
/**
 * Convert Codex Dream Skin packs <-> OpenCode theme.json
 *
 *   bun packages/desktop-dream-skin/src/cli.ts convert ./gothic-void.zip --install
 *   bun packages/desktop-dream-skin/src/cli.ts convert ./theme.json --out ./themes
 *   bun packages/desktop-dream-skin/src/cli.ts presets --out ./themes --install
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { adaptDreamSkin, isDreamSkinPack, toCatalogEntry, type DreamSkinPack } from "./lib/theme/dream-skin"
import { DREAM_SKIN_CATALOG } from "./lib/theme/dream-packs"
import { unzipBytes } from "./lib/theme/unzip"
import { OC_THEME_SCHEMA, type OpenCodeThemeFile } from "./lib/theme/schema"

function configThemesDir() {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(xdg, "opencode", "themes")
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const cmd = args[0]
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 1; i < args.length; i++) {
    const a = args[i]
    if (a === "--install") flags.install = true
    else if (a === "--out") flags.out = args[++i]
    else if (a.startsWith("--")) flags[a.slice(2)] = true
    else positional.push(a)
  }
  return { cmd, positional, flags }
}

function writeTheme(id: string, file: OpenCodeThemeFile, outDir: string) {
  mkdirSync(outDir, { recursive: true })
  const dest = join(outDir, `${id}.json`)
  writeFileSync(dest, `${JSON.stringify(file, null, 2)}\n`)
  return dest
}

async function convertFile(input: string, outDir: string) {
  const abs = resolve(input)
  const raw = readFileSync(abs)
  const name = basename(abs).toLowerCase()

  let pack: DreamSkinPack | null = null
  let oc: OpenCodeThemeFile | null = null

  if (name.endsWith(".zip")) {
    const entries = await unzipBytes(new Uint8Array(raw))
    const jsonFile = entries.find((e) => e.name.endsWith("theme.json") || e.name.endsWith(".json"))
    if (!jsonFile) throw new Error(`${input}: zip 里没有 theme.json`)
    const parsed = JSON.parse(new TextDecoder().decode(jsonFile.bytes)) as unknown
    if (isDreamSkinPack(parsed)) pack = parsed
    else if (parsed && typeof parsed === "object" && "theme" in (parsed as object)) oc = parsed as OpenCodeThemeFile
  } else {
    const parsed = JSON.parse(raw.toString("utf8")) as unknown
    if (isDreamSkinPack(parsed)) pack = parsed
    else if (parsed && typeof parsed === "object" && "theme" in (parsed as object)) oc = parsed as OpenCodeThemeFile
    else throw new Error(`${input}: 既不是 Dream Skin 也不是 OpenCode theme.json`)
  }

  if (pack) {
    const file = adaptDreamSkin(pack)
    file.$schema = OC_THEME_SCHEMA
    const dest = writeTheme(pack.id, file, outDir)
    console.log(`Dream Skin → OpenCode  ${pack.id}  →  ${dest}`)
    return dest
  }

  if (oc) {
    const id = basename(abs, ".json")
    const dest = writeTheme(id, { $schema: OC_THEME_SCHEMA, ...oc }, outDir)
    console.log(`OpenCode theme  ${id}  →  ${dest}`)
    return dest
  }

  throw new Error(`${input}: 无法识别`)
}

function exportPresets(outDir: string) {
  mkdirSync(outDir, { recursive: true })
  for (const entry of DREAM_SKIN_CATALOG) {
    const dest = writeTheme(entry.id, { $schema: OC_THEME_SCHEMA, ...entry.file }, outDir)
    console.log(`preset  ${entry.id}  →  ${dest}`)
  }
}

async function main() {
  const { cmd, positional, flags } = parseArgs(process.argv)
  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
    console.log(`opencode-dream-skin\n\nCommands:\n  convert <file.zip|theme.json> [--install] [--out DIR]\n      Dream Skin ZIP / JSON → OpenCode theme.json\n  presets [--install] [--out DIR]\n      导出内置五套 Dream Skin 为官方 theme.json\n`)
    process.exit(0)
  }

  const install = Boolean(flags.install)
  const outDir = String(flags.out || (install ? configThemesDir() : join(process.cwd(), "themes")))

  if (cmd === "convert") {
    const input = positional[0]
    if (!input || !existsSync(input)) {
      console.error("usage: convert <file.zip|theme.json> [--install] [--out DIR]")
      process.exit(1)
    }
    await convertFile(input, outDir)
    if (install) console.log(`已写入 ${outDir}，在 OpenCode 里 /theme 选对应 id`)
    return
  }

  if (cmd === "presets") {
    exportPresets(outDir)
    if (install) console.log(`已安装到 ${outDir}`)
    return
  }

  console.error(`unknown command: ${cmd}`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
