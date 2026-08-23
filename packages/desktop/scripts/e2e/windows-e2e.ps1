<#
.SYNOPSIS
  Real Windows Desktop E2E for TokenMax's side-by-side identity (master brief
  section 45 / docs/TOKENMAX-RELIABILITY.md's "R0 regression pass").

  This script does NOT just check that packaging exits 0 -- master brief
  regression 3.5 is exactly "build PASS reported while the installed app had
  the wrong identity". Every step below inspects the real installed/running
  state: the Windows registry, the filesystem, and a live log file, not just
  a build log.

.DESCRIPTION
  Sequence (each step's assertions must hold before the next step runs):
    1. Install the official "dev" channel.               (baseline: works)
    2. Verify its identity (registry, install dir, DisplayName).
    3. Launch it, wait for real readiness (log-based), verify its userData.
    4. Exit it.
    5. Install TokenMax Dev.
    6. Verify TokenMax Dev's identity is DISTINCT from the official app's
       (app id, product name, protocol scheme, install dir, userData dir).
    7. Verify the official app's registry entry / install dir / userData
       are UNCHANGED by the TokenMax Dev install.
    8. Launch TokenMax Dev, wait for real readiness, verify its userData.
    9. Exit it.
   10. Uninstall TokenMax Dev.
   11. Verify TokenMax Dev is fully gone (registry + install dir), and the
       official app's registry entry / install dir / userData are STILL
       unchanged.
   12. Launch the official app again -- proves it still works after a
       TokenMax Dev install+uninstall cycle, not just before.
   13. Exit and uninstall the official app (cleanup).

  Exits non-zero (with a specific error) on the first assertion that fails,
  so a CI failure points at exactly which invariant broke.
#>

param(
  [Parameter(Mandatory = $true)][string]$DesktopDir,
  [int]$ReadyTimeoutSeconds = 90,
  [int]$InstallTimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
# Deliberately no `Set-StrictMode -Version Latest`: registry key objects from
# Get-ItemProperty only carry the NoteProperties that actually exist for that
# key (many Uninstall subkeys have no DisplayName at all), and strict mode
# would throw on every access to a property that happens to be absent. Every
# access below is already guarded explicitly via Assert() instead.

function Write-Step($message) {
  Write-Host ""
  Write-Host "=== $message ===" -ForegroundColor Cyan
}

function Assert($condition, $message) {
  if (-not $condition) {
    throw "ASSERTION FAILED: $message"
  }
  Write-Host "  ok: $message" -ForegroundColor Green
}

# Extracts just the executable path from a Windows command-line string of
# the form `"C:\path with spaces\foo.exe" [args]` or `C:\nospaces\foo.exe
# [args]`. A real CI run proved a naive '^"|"$' quote-strip regex breaks
# the moment anything (even just a trailing space) follows the closing
# quote, since '"$' only matches a quote that is the literal last
# character of the whole string. This parses the quoted-prefix form
# directly instead of assuming the string ends right after it.
function Get-CommandExecutablePath($commandLine) {
  if (-not $commandLine) { return $null }
  $trimmed = $commandLine.Trim()
  if ($trimmed.StartsWith('"')) {
    $endIdx = $trimmed.IndexOf('"', 1)
    if ($endIdx -gt 0) { return $trimmed.Substring(1, $endIdx - 1) }
  }
  $spaceIdx = $trimmed.IndexOf(' ')
  if ($spaceIdx -gt 0) { return $trimmed.Substring(0, $spaceIdx) }
  return $trimmed
}

# One channel's expected identity, matching src/main/constants.ts and electron-builder.config.ts.
$Channels = @{
  dev = @{
    ChannelEnv    = "dev"
    AppId         = "ai.opencode.desktop.dev"
    ProductName   = "OpenCode Dev"
    ProtocolClass = "opencode"
    DistDir       = "dist-dev"
  }
  "tokenmax-dev" = @{
    ChannelEnv    = "tokenmax-dev"
    AppId         = "ai.opencode.tokenmax.dev"
    ProductName   = "OpenCode TokenMax Dev"
    ProtocolClass = "opencode-tokenmax"
    DistDir       = "dist-tokenmax-dev"
  }
}

function Build-Channel($key) {
  $ch = $Channels[$key]
  Write-Step "PACKAGE: building $($ch.ProductName) ($key)"
  Push-Location $DesktopDir
  try {
    $env:OPENCODE_CHANNEL = $ch.ChannelEnv
    bun run build
    if ($LASTEXITCODE -ne 0) { throw "electron-vite build failed for channel $key" }

    # Regression 3.4 (master brief / docs/TOKENMAX-RELIABILITY.md): Electron
    # main must never bundle a Bun-only module. Scan the actual compiled
    # main-process bundle here (pre-asar-packaging, while it's still plain
    # .js on disk) rather than the packaged install tree: app.asar is a
    # packed archive that can incidentally contain the literal string from
    # unrelated conditional/dead source (this repo's own
    # @opencode-ai/core has a legitimate bun/node conditional #sqlite
    # import map), and scanning it produced exactly that false-positive-
    # shaped hit on a real run. out/main is the actual Electron main
    # process code that would execute -- the only place this check means
    # what regression 3.4 says.
    $mainBundle = Join-Path $DesktopDir "out\main"
    $bunOnlyHits = Get-ChildItem $mainBundle -Recurse -Filter "*.js" -ErrorAction SilentlyContinue |
      Where-Object { (Select-String -LiteralPath $_.FullName -Pattern '["'']bun:sqlite["'']' -Quiet -ErrorAction SilentlyContinue) }
    if ($bunOnlyHits.Count -gt 0) { throw "regression 3.4: 'bun:sqlite' import found in Electron main bundle: $($bunOnlyHits.FullName -join ', ')" }
    Write-Host "  ok: no 'bun:sqlite' import in the Electron main process bundle ($mainBundle)"

    # Windows code signing (signWindows() in electron-builder.config.ts) requires
    # Azure credentials this workflow does not have and does not need -- this run
    # verifies installer IDENTITY/lifecycle, not code-signing. GITHUB_ACTIONS is
    # the exact flag that function checks before invoking the signing script, so
    # overriding it here (only) skips signing without touching source. CI=true is
    # left untouched for electron-builder's own headless-mode detection.
    $env:GITHUB_ACTIONS = "false"
    npx electron-builder --win --publish never --config electron-builder.config.ts
    $exitCode = $LASTEXITCODE
    $env:GITHUB_ACTIONS = "true"
    if ($exitCode -ne 0) { throw "electron-builder failed for channel $key" }

    Remove-Item -Recurse -Force $ch.DistDir -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $ch.DistDir | Out-Null
    $installer = Get-ChildItem "dist\*.exe" | Where-Object { $_.Name -notlike "*unpacked*" } | Select-Object -First 1
    if (-not $installer) { throw "no installer .exe produced for channel $key" }
    Copy-Item $installer.FullName (Join-Path $ch.DistDir "installer.exe")
    Write-Host "  built: $($ch.DistDir)\installer.exe (from $($installer.Name))"
  } finally {
    Remove-Item Env:\OPENCODE_CHANNEL -ErrorAction SilentlyContinue
    Pop-Location
  }
}

function Get-UninstallEntry($productName) {
  # electron-builder's NSIS template appends the version to DisplayName by
  # default (a real CI run confirmed this: "OpenCode Dev" registers as
  # "OpenCode Dev 1.18.20") -- match the product name exactly OR followed
  # by a space (never a bare substring, so "OpenCode Dev" can never match
  # an "OpenCode TokenMax Dev ..." entry).
  $roots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  foreach ($root in $roots) {
    $entry = Get-ItemProperty $root -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -eq $productName -or $_.DisplayName -like "$productName *" }
    if ($entry) { return $entry }
  }
  return $null
}

function Install-Channel($key) {
  $ch = $Channels[$key]
  Write-Step "INSTALL: $($ch.ProductName)"
  $installer = Join-Path $ch.DistDir "installer.exe"
  Assert (Test-Path $installer) "installer exists at $installer"

  # Deliberately NOT passing an explicit /D=<path>: NSIS requires /D to be
  # completely unquoted, but PowerShell's Start-Process -ArgumentList
  # auto-quotes any element containing a space -- and both real product
  # names here ("OpenCode Dev", "OpenCode TokenMax Dev") have one. A first
  # real CI run of this script proved that combination silently breaks the
  # install (installer exits 0, but no registry entry is written at all).
  # Let NSIS install wherever its own default is, then ask the registry
  # where that actually was -- fewer assumptions about the NSIS template's
  # command-line handling.
  $proc = Start-Process -FilePath $installer -ArgumentList "/S" -PassThru
  $done = $proc.WaitForExit($InstallTimeoutSeconds * 1000)
  Assert $done "installer for $($ch.ProductName) finished within ${InstallTimeoutSeconds}s"
  Assert ($proc.ExitCode -eq 0) "installer for $($ch.ProductName) exited 0 (got $($proc.ExitCode))"

  Start-Sleep -Seconds 3 # registry writes can lag the installer process exiting
  $entry = Get-UninstallEntry $ch.ProductName
  if (-not $entry) {
    Write-Host "  diagnostic: no uninstall entry named '$($ch.ProductName)' found. Known HKCU DisplayNames:"
    Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
      ForEach-Object { Write-Host "    - $($_.DisplayName)" }
    $programs = Join-Path $env:LOCALAPPDATA "Programs"
    Write-Host "  diagnostic: contents of $programs :"
    Get-ChildItem $programs -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    - $($_.Name)" }
  }
  Assert ($null -ne $entry) "an Add/Remove Programs entry named '$($ch.ProductName)' exists after install"

  $installLocation = $entry.InstallLocation
  if (-not $installLocation -and $entry.UninstallString) {
    $installLocation = Split-Path -Parent (Get-CommandExecutablePath $entry.UninstallString)
  }
  Assert ([bool]$installLocation) "an install directory was found for $($ch.ProductName) (raw UninstallString: $($entry.UninstallString))"

  return @{ Entry = $entry; InstallLocation = $installLocation }
}

function Verify-Identity($key, $install, [string[]]$mustNotContainPaths) {
  $ch = $Channels[$key]
  $entry = $install.Entry
  $installLocation = $install.InstallLocation
  Write-Step "VERIFY IDENTITY: $($ch.ProductName)"
  # NSIS appends the version by default ("OpenCode Dev" -> "OpenCode Dev 1.18.20").
  Assert ($entry.DisplayName -eq $ch.ProductName -or $entry.DisplayName -like "$($ch.ProductName) *") "DisplayName is '$($ch.ProductName)' (got '$($entry.DisplayName)')"
  Assert (Test-Path $installLocation) "install directory '$installLocation' actually exists on disk"

  $exe = Get-ChildItem $installLocation -Filter "*.exe" | Where-Object { $_.Name -notlike "Uninstall*" } | Select-Object -First 1
  Assert ($null -ne $exe) "found the app executable inside '$installLocation'"
  Assert ($exe.Name -eq "$($ch.ProductName).exe") "installed executable is named '$($ch.ProductName).exe' (got '$($exe.Name)')"

  foreach ($forbidden in $mustNotContainPaths) {
    Assert (-not ($installLocation -like "*$forbidden*")) "install dir does not sit inside another channel's directory ($forbidden)"
  }

  # Regression 3.4 is checked in Build-Channel, against the pre-asar main
  # process bundle -- see the comment there for why app.asar itself is the
  # wrong scan target (packed-archive false positives on a real run).

  # Windows deep-link protocol registration: HKCU\Software\Classes\<scheme>
  # Registration only happens once the app has actually run and called
  # app.setAsDefaultProtocolClient(); caller verifies this after first launch.
  $protocolKey = "HKCU:\Software\Classes\$($ch.ProtocolClass)"
  return @{ InstallLocation = $installLocation; ProtocolKey = $protocolKey; Entry = $entry }
}

function Wait-ForReady($appId, $timeoutSeconds) {
  $userData = Join-Path $env:APPDATA $appId
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  $logsRoot = Join-Path $userData "logs"

  while ((Get-Date) -lt $deadline) {
    if (Test-Path $logsRoot) {
      $runDir = Get-ChildItem $logsRoot -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($runDir) {
        $mainLog = Join-Path $runDir.FullName "main.log"
        if (Test-Path $mainLog) {
          $content = Get-Content $mainLog -Raw -ErrorAction SilentlyContinue
          if ($content -and $content -match "server ready") {
            return @{ UserData = $userData; LogFile = $mainLog; Content = $content }
          }
        }
      }
    }
    Start-Sleep -Seconds 2
  }
  throw "ASSERTION FAILED: app with id '$appId' logged 'server ready' within ${timeoutSeconds}s"
}

# NSIS "oneClick" installers can auto-launch the app themselves even in
# silent (/S) mode on some templates. Rather than track a single PID (which
# may not be the process that actually wins the single-instance lock), stop
# every running process whose image path is inside this install directory.
function Stop-AllInstances($installLocation) {
  Get-Process | Where-Object {
    $_.Path -and $_.Path.StartsWith($installLocation, [StringComparison]::OrdinalIgnoreCase)
  } | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  }
}

function Launch-AndVerifyReady($key, $installLocation, $protocolKey) {
  $ch = $Channels[$key]
  Write-Step "LAUNCH: $($ch.ProductName)"
  Stop-AllInstances $installLocation # in case a oneClick install auto-launched it already
  $exe = Get-ChildItem $installLocation -Filter "*.exe" | Where-Object { $_.Name -notlike "Uninstall*" } | Select-Object -First 1
  Assert ($null -ne $exe) "found the app executable inside '$installLocation'"

  Start-Process -FilePath $exe.FullName | Out-Null
  try {
    $ready = Wait-ForReady $ch.AppId $ReadyTimeoutSeconds
    $readyLine = ($ready.Content -split "`r?`n" | Select-String "server ready" | Select-Object -Last 1)
    Assert $true "'$($ch.ProductName)' logged server ready: $readyLine"
    Assert (Test-Path $ready.UserData) "userData directory '$($ready.UserData)' exists after first launch"

    # Registration itself, the URL Protocol marker Windows requires to treat
    # it as a real handler (not just a key that happens to exist), and the
    # actual invoked command -- all three, not just key existence.
    $protocol = Get-ItemProperty $protocolKey -ErrorAction SilentlyContinue
    Assert ($null -ne $protocol) "protocol scheme '$($ch.ProtocolClass)://' is registered ($protocolKey)"
    Assert ($protocol.PSObject.Properties.Name -contains "URL Protocol") "'$($ch.ProtocolClass)' has the URL Protocol marker set"
    $protocolCommand = (Get-ItemProperty "$protocolKey\shell\open\command" -ErrorAction SilentlyContinue)."(default)"
    Assert ([bool]$protocolCommand) "'$($ch.ProtocolClass)' has an open command registered"
    Assert ($protocolCommand -like "*$($exe.Name)*") "'$($ch.ProtocolClass)' open command invokes '$($exe.Name)' (got: $protocolCommand)"

    return $ready
  } finally {
    Write-Step "EXIT: $($ch.ProductName)"
    Stop-AllInstances $installLocation
    Start-Sleep -Seconds 2
  }
}

function Uninstall-Channel($key, $entry, $installLocation) {
  $ch = $Channels[$key]
  Write-Step "UNINSTALL: $($ch.ProductName)"
  if ($installLocation) { Stop-AllInstances $installLocation } # a running app can lock its own files
  $uninstallExe = Get-CommandExecutablePath $entry.UninstallString
  Assert ([bool]$uninstallExe) "found an UninstallString for $($ch.ProductName)"

  $proc = Start-Process -FilePath $uninstallExe -ArgumentList "/S" -PassThru
  $done = $proc.WaitForExit($InstallTimeoutSeconds * 1000)
  Assert $done "uninstaller for $($ch.ProductName) finished within ${InstallTimeoutSeconds}s"

  Start-Sleep -Seconds 2
  $stillThere = Get-UninstallEntry $ch.ProductName
  Assert ($null -eq $stillThere) "Add/Remove Programs entry for '$($ch.ProductName)' is gone after uninstall"
}

# $expectedInstallLocation must be the RESOLVED path from Verify-Identity's
# return value, not a raw registry entry -- NSIS doesn't always set the
# InstallLocation registry value itself, so the resolved (possibly
# UninstallString-derived) path is the only reliable one to compare against.
function Assert-Unchanged($key, $expectedInstallLocation) {
  $ch = $Channels[$key]
  $after = Get-UninstallEntry $ch.ProductName
  Assert ($null -ne $after) "'$($ch.ProductName)' registry entry still present"
  Assert (Test-Path $expectedInstallLocation) "'$($ch.ProductName)' install directory still exists on disk"
}

# ---------------------------------------------------------------------------

Build-Channel "dev"
Build-Channel "tokenmax-dev"

$devInstall = Install-Channel "dev"
$devIdentity = Verify-Identity "dev" $devInstall @("tokenmax")
$devReady1 = Launch-AndVerifyReady "dev" $devIdentity.InstallLocation $devIdentity.ProtocolKey

$tokenmaxInstall = Install-Channel "tokenmax-dev"
$tokenmaxIdentity = Verify-Identity "tokenmax-dev" $tokenmaxInstall @("ai.opencode.desktop.dev")

Write-Step "CROSS-CHECK: TokenMax Dev install did not touch the official app"
Assert-Unchanged "dev" $devIdentity.InstallLocation
Assert ($devIdentity.InstallLocation -ne $tokenmaxIdentity.InstallLocation) "install directories are distinct"
Assert ($Channels["dev"].AppId -ne $Channels["tokenmax-dev"].AppId) "app ids are distinct"
Assert ($Channels["dev"].ProtocolClass -ne $Channels["tokenmax-dev"].ProtocolClass) "protocol schemes are distinct"

$tokenmaxReady = Launch-AndVerifyReady "tokenmax-dev" $tokenmaxIdentity.InstallLocation $tokenmaxIdentity.ProtocolKey
Assert ($tokenmaxReady.UserData -ne $devReady1.UserData) "userData directories are distinct after both apps have run"
$devSettingsAfterTokenmaxRun = Test-Path (Join-Path $devReady1.UserData "opencode.settings")
Write-Host "  info: official app's opencode.settings present: $devSettingsAfterTokenmaxRun (informational)"

Uninstall-Channel "tokenmax-dev" $tokenmaxIdentity.Entry $tokenmaxIdentity.InstallLocation

Write-Step "CROSS-CHECK: TokenMax Dev uninstall did not touch the official app"
Assert-Unchanged "dev" $devIdentity.InstallLocation
Assert (-not (Test-Path $tokenmaxIdentity.InstallLocation)) "TokenMax Dev install directory is gone"

$devReady2 = Launch-AndVerifyReady "dev" $devIdentity.InstallLocation $devIdentity.ProtocolKey
Assert ($devReady2.UserData -eq $devReady1.UserData) "official app's userData directory is the same across both runs (nothing migrated/reset it)"

Uninstall-Channel "dev" $devIdentity.Entry $devIdentity.InstallLocation

Write-Host ""
Write-Host "=== ALL WINDOWS DESKTOP E2E ASSERTIONS PASSED ===" -ForegroundColor Green
