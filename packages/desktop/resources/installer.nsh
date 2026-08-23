# Force the per-user NSIS install directory to be product-name-specific.
#
# Without this, every channel of this app collides into the exact same
# install directory. electron-builder's default install-dir name (its
# "APP_FILENAME" define) only tries the per-channel productName when
# `!oneClick || isPerMachine` is true (app-builder-lib's
# getWindowsInstallationDirName, targets/targetUtil.js) -- but this app
# builds every channel with oneClick:true, perMachine:false (see
# electron-builder.config.ts), so that condition is never true for any
# channel. electron-builder then always falls back to
# AppInfo.sanitizedName, which comes from this package's single,
# channel-independent package.json "name" ("@opencode-ai/desktop" ->
# sanitized to "@opencode-aidesktop"). Every channel -- dev, beta, prod,
# and TokenMax Dev -- would silently install into
# "%LocalAppData%\Programs\@opencode-aidesktop", overwriting each other.
#
# This is TokenMax regression 3.5 (docs/TOKENMAX-RELIABILITY.md): a real
# collision discovered via actual Windows CI runs of
# scripts/e2e/windows-e2e.ps1, not a theoretical concern -- installing the
# "dev" channel and then "tokenmax-dev" produced one shared directory
# still containing "OpenCode Dev.exe" instead of the TokenMax Dev binary.
#
# customInit runs after initMultiUser has already computed the (wrong,
# shared) default $INSTDIR, so overwrite it here with a directory derived
# from PRODUCT_FILENAME, which electron-builder already resolves correctly
# per channel (it drives the Add/Remove Programs DisplayName and the
# installed .exe name, both already verified correct in CI).
!macro customInit
  StrCpy $INSTDIR "$LocalAppData\Programs\${PRODUCT_FILENAME}"
!macroend
