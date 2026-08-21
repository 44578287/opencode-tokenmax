export const APP_IDS = {
  dev: "ai.opencode.tokenmax.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
} as const

export const APP_NAMES = {
  dev: "OpenCode TokenMax Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
} as const

export const PROTOCOL_SCHEMES = {
  dev: "opencode-tokenmax",
  beta: "opencode",
  prod: "opencode",
} as const

export const TOKENMAX_DEV_PROFILE = "tokenmax-dev"

export const OFFICIAL_DESKTOP_APP_IDS = [
  "ai.opencode.desktop",
  "ai.opencode.desktop.dev",
  "ai.opencode.desktop.beta",
] as const
