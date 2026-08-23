#!/usr/bin/env bun
import { copyFileSync, mkdirSync, readdirSync, statSync, cpSync } from "node:fs"
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

// Copy required node_modules for sidecar chunks (node-pty native module)
const nodeModulesSrc = resolve(import.meta.dirname, "../node_modules/@lydell/node-pty-win32-x64")
const nodeModulesDest = resolve(destDir, "node_modules/@lydell/node-pty-win32-x64")
if (statSync(nodeModulesSrc, { throwIfNoEntry: false })?.isDirectory()) {
  cpSync(nodeModulesSrc, nodeModulesDest, { recursive: true, dereference: true })
  console.log("Copied node-pty-win32-x64 to resources/main/node_modules/")
} else {
  console.log("node-pty-win32-x64 not found in workspace node_modules at " + nodeModulesSrc)
}