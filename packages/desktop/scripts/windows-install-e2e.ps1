$ErrorActionPreference = "Stop"
$dist = Join-Path $PSScriptRoot "..\dist"
$installer = Get-ChildItem -LiteralPath $dist -Filter "opencode-tokenmax-dev-*.exe" | Select-Object -First 1
if (-not $installer) { throw "TokenMax Dev installer not found in $dist" }

$report = [ordered]@{
  installer = $installer.FullName
  bunRuntimeCrash = "UNVERIFIED"
  packagedAppLaunch = "UNVERIFIED"
  actualInstalledName = $null
  actualInstallPath = $null
  actualUserDataPath = $null
  actualUninstallEntry = $null
  actualProtocol = $null
  sideBySide = "UNVERIFIED"
  officialAfterDevInstall = "UNVERIFIED"
  officialAfterDevUninstall = "UNVERIFIED"
  tokenmaxDevLaunch = "UNVERIFIED"
  windowsInstallE2e = "FAIL"
}

function Fail([string]$msg) {
  Write-Host $msg
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $dist "e2e-report.json")
  throw $msg
}

# Simulate Official OpenCode without downloading their installer.
$officialDir = Join-Path $env:LOCALAPPDATA "Programs\OpenCode"
New-Item -ItemType Directory -Force -Path $officialDir | Out-Null
$officialExe = Join-Path $officialDir "OpenCode.exe"
Set-Content -LiteralPath $officialExe -Value "official-stub" -NoNewline
$officialUninstall = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenCodeOfficialStub"
New-Item -Path $officialUninstall -Force | Out-Null
New-ItemProperty -Path $officialUninstall -Name "DisplayName" -Value "OpenCode" -Force | Out-Null
$protocolKey = "HKCU:\Software\Classes\opencode"
if (-not (Test-Path $protocolKey)) {
  New-Item -Path $protocolKey -Force | Out-Null
  New-ItemProperty -Path $protocolKey -Name "(default)" -Value "URL:OpenCode Official Stub" -Force | Out-Null
}

Write-Host "Installing TokenMax Dev silently..."
$installPath = Join-Path $env:LOCALAPPDATA "Programs\OpenCode TokenMax Dev"
New-Item -ItemType Directory -Force -Path $installPath | Out-Null
$p = Start-Process -FilePath $installer.FullName -ArgumentList "/S","/D=$installPath" -PassThru -Wait
if ($p.ExitCode -ne 0) { Fail "Installer exit $($p.ExitCode)" }
Start-Sleep -Seconds 5

$programs = Join-Path $env:LOCALAPPDATA "Programs"
Write-Host "Programs:"
Get-ChildItem -LiteralPath $programs -ErrorAction SilentlyContinue | ForEach-Object { Write-Host " - $($_.Name)" }

$exe = $null
$candidates = @(
  $installPath,
  (Join-Path $programs "opencode-tokenmax-dev"),
  (Join-Path $programs "OpenCode TokenMax Dev"),
  (Join-Path $programs "@opencode-ai desktop"),
  (Join-Path $programs "OpenCode Dev")
)
foreach ($dir in $candidates) {
  if (-not (Test-Path $dir)) { continue }
  $found = Get-ChildItem -LiteralPath $dir -Filter "*.exe" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch "Uninstall" } | Select-Object -First 1
  if ($found) { $exe = $found; $installPath = $dir; break }
}
if (-not $exe) {
  $found = Get-ChildItem -LiteralPath $programs -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "TokenMax|opencode-tokenmax" } | Select-Object -First 1
  if ($found) { $exe = $found; $installPath = $found.DirectoryName }
}
if (-not $exe) { Fail "Installed exe not found under $programs" }
$report.actualInstallPath = $installPath
$report.actualInstalledName = $exe.Name

if ($exe.Name -match "@opencode-ai" -or $exe.Name -eq "OpenCode.exe") {
  Fail "Installed exe name is $($exe.Name)"
}

$uninstall = Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall | ForEach-Object {
  Get-ItemProperty $_.PSPath
} | Where-Object { $_.DisplayName -eq "OpenCode TokenMax Dev" } | Select-Object -First 1
if (-not $uninstall) { Fail "Uninstall DisplayName OpenCode TokenMax Dev not found" }
$report.actualUninstallEntry = $uninstall.DisplayName
if ($uninstall.DisplayName -match "@opencode-ai") { Fail "Uninstall name is $($uninstall.DisplayName)" }

$protocol = Get-ItemProperty "HKCU:\Software\Classes\opencode-tokenmax" -ErrorAction SilentlyContinue
$report.actualProtocol = if ($protocol) { "opencode-tokenmax" } else { "MISSING" }
if ($report.actualProtocol -ne "opencode-tokenmax") { Fail "opencode-tokenmax protocol not registered" }
if (-not ($protocol.PSObject.Properties.Name -contains "URL Protocol")) { Fail "opencode-tokenmax URL Protocol flag missing" }
$protoCmd = (Get-ItemProperty "HKCU:\Software\Classes\opencode-tokenmax\shell\open\command" -ErrorAction SilentlyContinue)."(default)"
if (-not $protoCmd -or $protoCmd -notmatch "OpenCode TokenMax Dev") { Fail "opencode-tokenmax handler command invalid: $protoCmd" }

# Hijack checks: official opencode:// must still point at official, not TokenMax
$officialProtoCmd = (Get-ItemProperty "HKCU:\Software\Classes\opencode\shell\open\command" -ErrorAction SilentlyContinue)."(default)"
if (-not $officialProtoCmd) { Fail "official opencode:// protocol missing after TokenMax install" }
if ($officialProtoCmd -match "TokenMax") { Fail "TokenMax hijacked official opencode:// handler: $officialProtoCmd" }

if ($exe.Name -ne "OpenCode TokenMax Dev.exe") { Fail "Installed exe name is $($exe.Name), expected 'OpenCode TokenMax Dev.exe'" }
if ((Split-Path $installPath -Leaf) -ne "OpenCode TokenMax Dev") { Fail "Install dir is $installPath" }

if (-not (Test-Path $officialExe)) { Fail "Official stub removed during TokenMax install" }
$report.officialAfterDevInstall = "PASS"

$userData = Join-Path $env:APPDATA "ai.opencode.tokenmax.dev"
$report.actualUserDataPath = $userData
if ($userData -eq (Join-Path $env:APPDATA "ai.opencode.desktop")) { Fail "userData collides with official" }

# Bundle scan
$bunHits = @()
Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "..\out\main") -Recurse -Include *.js -ErrorAction SilentlyContinue | ForEach-Object {
  if (Select-String -LiteralPath $_.FullName -Pattern "bun:sqlite" -SimpleMatch -Quiet) { $bunHits += $_.FullName }
}
Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "..\..\opencode\dist\node") -Filter *.js -ErrorAction SilentlyContinue | ForEach-Object {
  if (Select-String -LiteralPath $_.FullName -Pattern "bun:sqlite" -SimpleMatch -Quiet) { $bunHits += $_.FullName }
}
if ($bunHits.Count -gt 0) {
  $report.bunRuntimeCrash = "FAIL"
  Fail "bun:sqlite found in $($bunHits -join ', ')"
}
$report.bunRuntimeCrash = "FIXED"

Write-Host "Launching $($exe.FullName)"
$logDir = Join-Path $userData "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$proc = Start-Process -FilePath $exe.FullName -PassThru
Start-Sleep -Seconds 25
$alive = -not $proc.HasExited
$logText = ""
Get-ChildItem -LiteralPath $logDir -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
  if (-not $_.PSIsContainer) { $logText += (Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue) }
}
if ($logText -match "Only URLs with a scheme in: file, data, node, and electron" -or $logText -match "Received protocol 'bun:'") {
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  $report.tokenmaxDevLaunch = "FAIL"
  $report.packagedAppLaunch = "FAIL"
  Fail "bun: protocol crash in logs"
}
if (-not $alive) {
  $report.tokenmaxDevLaunch = "FAIL"
  $report.packagedAppLaunch = "FAIL"
  Fail "TokenMax Dev exited during startup code=$($proc.ExitCode)"
}
$report.tokenmaxDevLaunch = "PASS"
$report.packagedAppLaunch = "PASS"
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# Uninstall TokenMax Dev
$uninstaller = $uninstall.UninstallString
if ($uninstaller) {
  $uninstaller = $uninstaller.Trim('"')
  Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -ErrorAction SilentlyContinue
}
if (-not (Test-Path $officialExe)) { Fail "Official stub missing after TokenMax uninstall" }
$report.officialAfterDevUninstall = "PASS"
$report.sideBySide = "PASS"
$report.windowsInstallE2e = "PASS"

$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $dist "e2e-report.json")
Write-Host ($report | ConvertTo-Json -Depth 6)
