#!/usr/bin/env bun
import { copyFileSync, mkdirSync, readdirSync, statSync, cpSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"

// Copy sidecar.js from build output to resources/main/ for utilityProcess.fork to find
const src = resolve(import.meta.dirname, "../out/main/sidecar.js")
const destDir = resolve(import.meta.dirname, "../resources/main")
mkdirSync(destDir, { recursive: true })
copyFileSync(src, resolve(destDir, "sidecar.js"))
console.log("Copied sidecar.js to resources/main/")

// Copy chunks folder (sidecar.js dependencies split into chunks by Rollup)
const chunksSrc = resolve(import.meta.dirname, "../out/main/chunks")
const chunksDest = resolve(destDir, "chunks")
if (statSync(chunksSrc, { throwIfNoEntry: false })?.isDirectory()) {
  mkdirSync(chunksDest, { recursive: true })
  for (const file of readdirSync(chunksSrc)) {
    copyFileSync(resolve(chunksSrc, file), resolve(chunksDest, file))
  }
  console.log("Copied chunks/ to resources/main/chunks/")
} else {
  console.log("No chunks/ directory found in out/main/")
}

// Copy required native modules for sidecar chunks. Bun hoisting layouts vary
// (package-level vs workspace-root node_modules), so resolve the real path
// instead of assuming one.
function findPkg(name: string): string | null {
  const req = createRequire(resolve(import.meta.dirname, "../package.json"))
  try {
    return req.resolve(name + "/package.json").replace(/[/\\]package\.json$/, "")
  } catch {
    return null
  }
}
for (const pkg of ["@lydell/node-pty-win32-x64", "@parcel/watcher-win32-x64"]) {
  if (process.platform !== "win32") break
  const src = findPkg(pkg)
  const dest = resolve(destDir, "node_modules", pkg)
  if (src && statSync(src, { throwIfNoEntry: false })?.isDirectory()) {
    cpSync(src, dest, { recursive: true, dereference: true })
    console.log(`Copied ${pkg} to resources/main/node_modules/`)
  } else {
    console.log(`${pkg} not resolvable from packages/desktop; skipping (afterPack fallback covers it)`)
  }
}