import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

const legacyDesktopEntry = "resources/linux/opencode-desktop.desktop"

const channels = [
  { channel: "dev", appId: "ai.opencode.desktop.dev" },
  { channel: "beta", appId: "ai.opencode.desktop.beta" },
  { channel: "prod", appId: "ai.opencode.desktop" },
  { channel: "tokenmax-dev", appId: "ai.opencode.tokenmax.dev" },
] as const

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel.channel

    const module = await import(`./electron-builder.config.ts?channel=${channel.channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous

    expect(config.appId).toBe(channel.appId)
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
    expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    expect(config.rpm?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
  })
}

test("keeps a hidden prod launcher for old Linux pins", async () => {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = "prod"

  const module = await import("./electron-builder.config.ts?compat=prod")
  const config = module.default as Configuration

  if (previous === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previous

  expect(
    config.deb?.fpm?.some((entry) =>
      entry.endsWith("opencode-desktop.desktop=/usr/share/applications/opencode-desktop.desktop"),
    ),
  ).toBe(true)
  expect(
    config.rpm?.fpm?.some((entry) =>
      entry.endsWith("opencode-desktop.desktop=/usr/share/applications/opencode-desktop.desktop"),
    ),
  ).toBe(true)

  const desktop = await Bun.file(legacyDesktopEntry).text()
  expect(desktop).toContain("Exec=/opt/OpenCode/ai.opencode.desktop %U")
  expect(desktop).toContain("Icon=ai.opencode.desktop")
  expect(desktop).toContain("StartupWMClass=ai.opencode.desktop")
  expect(desktop).toContain("NoDisplay=true")
})

for (const channel of ["dev", "tokenmax-dev"] as const) {
  test(`bundles the CLI outside the ${channel} app archive`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel
    const module = await import(`./electron-builder.config.ts?cli-resource=${channel}`)
    const config = module.default as Configuration
    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous

    expect(config.files).toContain("!resources/opencode-cli*")
    expect(config.extraResources).toContainEqual({
      from: "resources/",
      to: "",
      filter: ["opencode-cli*"],
    })
  })
}

test("TokenMax Dev uses a distinct protocol scheme and product name from every official channel", async () => {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = "tokenmax-dev"
  const module = await import("./electron-builder.config.ts?protocol=tokenmax-dev")
  const config = module.default as Configuration
  if (previous === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previous

  expect(config.appId).toBe("ai.opencode.tokenmax.dev")
  expect(config.productName).toBe("OpenCode TokenMax Dev")
  expect(config.protocols).toEqual({ name: "OpenCode TokenMax Dev", schemes: ["opencode-tokenmax"] })
  // Every official channel (dev/beta/prod) registers the plain "opencode" scheme -- TokenMax Dev must not.
  const schemes = Array.isArray(config.protocols) ? config.protocols.flatMap((p) => p.schemes) : config.protocols?.schemes
  expect(schemes).not.toContain("opencode")
})

test("TokenMax Dev has no auto-updater publish config, same as dev", async () => {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = "tokenmax-dev"
  const module = await import("./electron-builder.config.ts?publish=tokenmax-dev")
  const config = module.default as Configuration
  if (previous === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previous

  expect(config.publish).toBeUndefined()
})

test("only tokenmax-dev overrides the NSIS install directory (regression 3.5 fix is isolated)", async () => {
  const previous = process.env.OPENCODE_CHANNEL

  process.env.OPENCODE_CHANNEL = "tokenmax-dev"
  const tokenmaxModule = await import("./electron-builder.config.ts?nsis-scope=tokenmax-dev")
  const tokenmaxConfig = tokenmaxModule.default as Configuration
  expect(tokenmaxConfig.nsis?.include).toBe("resources/installer.nsh")

  for (const channel of ["dev", "beta", "prod"] as const) {
    process.env.OPENCODE_CHANNEL = channel
    const module = await import(`./electron-builder.config.ts?nsis-scope=${channel}`)
    const config = module.default as Configuration
    // Official channels must keep upstream's default NSIS behavior --
    // R0 isolates TokenMax's own install, it does not alter dev/beta/prod's.
    expect(config.nsis?.include).toBeUndefined()
    // Every other nsis field stays identical to the shared base for an
    // official channel (only `include` differs for tokenmax-dev).
    expect(config.nsis).toEqual({
      oneClick: true,
      perMachine: false,
      installerIcon: "resources/icons/icon.ico",
      installerHeaderIcon: "resources/icons/icon.ico",
    })
  }

  if (previous === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previous
})

for (const channel of ["beta", "prod"] as const) {
  test(`does not bundle the CLI in ${channel} builds`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel
    const module = await import(`./electron-builder.config.ts?no-cli-resource=${channel}`)
    const config = module.default as Configuration
    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous

    expect(config.extraResources).not.toContainEqual({
      from: "resources/",
      to: "",
      filter: ["opencode-cli*"],
    })
  })
}
