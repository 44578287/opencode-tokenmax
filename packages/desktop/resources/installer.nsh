# Force TokenMax Dev's per-user NSIS install directory to be
# product-name-specific -- wired in ONLY for the tokenmax-dev channel (see
# its case in electron-builder.config.ts), not merged into every channel's
# shared base config. R0 must isolate TokenMax's own install; it must not
# alter dev/beta/prod's installer behavior, even to fix a real bug in it.
#
# Without this, TokenMax Dev collides with whatever official channel is
# already installed. electron-builder's default install-dir name (its
# "APP_FILENAME" define) only tries the per-channel productName when
# `!oneClick || isPerMachine` is true (app-builder-lib's
# getWindowsInstallationDirName, targets/targetUtil.js) -- but every
# channel of this app builds with oneClick:true, perMachine:false, so that
# condition is never true. Left alone, electron-builder falls back to
# AppInfo.sanitizedName, which comes from this package's single,
# channel-independent package.json "name" ("@opencode-ai/desktop" ->
# sanitized to "@opencode-aidesktop") -- the same for every channel. This
# is TokenMax regression 3.5 (docs/TOKENMAX-RELIABILITY.md): a real
# collision discovered via actual Windows CI runs of
# scripts/e2e/windows-e2e.ps1, not a theoretical concern -- installing the
# official channel and then "tokenmax-dev" produced one shared directory
# still containing the official app's .exe instead of the TokenMax Dev
# binary. The same electron-builder default affects dev/beta/prod's
# mutual side-by-side installs too, but fixing that generally is not an
# R0 responsibility -- see docs/TOKENMAX-DECISIONS.md D-005.
#
# customInit runs after initMultiUser has already computed the (wrong,
# shared) default $INSTDIR, so overwrite it here with a directory derived
# from PRODUCT_FILENAME, which electron-builder already resolves correctly
# per channel (it drives the Add/Remove Programs DisplayName and the
# installed .exe name, both already verified correct in CI).
!macro customInit
  StrCpy $INSTDIR "$LocalAppData\Programs\${PRODUCT_FILENAME}"
!macroend
