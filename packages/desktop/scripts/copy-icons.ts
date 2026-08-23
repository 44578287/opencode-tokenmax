import { $ } from "bun"
import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" || arg === "tokenmax-dev" ? arg : resolveChannel()

// TokenMax Dev has no distinct icon artwork yet (R0 is identity/packaging
// only, no branding work) -- reuse the upstream "dev" icon set rather than
// duplicating binary assets in git under a fourth directory.
const iconChannel = channel === "tokenmax-dev" ? "dev" : channel
const src = `./icons/${iconChannel}`
const dest = "resources/icons"

await $`rm -rf ${dest}`
await $`cp -R ${src} ${dest}`
console.log(`Copied ${channel} icons from ${src} to ${dest}`)
