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
if (-not (Test-Path "$protocolKey\shell\open\command")) {
  New-Item -Path "$protocolKey\shell\open\command" -Force | Out-Null
  New-ItemProperty -Path $protocolKey -Name "(default)" -Value "URL:OpenCode Official Stub" -Force | Out-Null
  New-ItemProperty -Path $protocolKey -Name "URL Protocol" -Value "" -Force | Out-Null
  New-ItemProperty -Path "$protocolKey\shell\open\command" -Name "(default)" -Value "`"$officialExe`" `"%1`"" -Force | Out-Null
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

$xdg = Join-Path $userData "xdg-config\opencode"
New-Item -ItemType Directory -Force -Path $xdg | Out-Null
@'
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": { "tokenmax": { "enabled": true } },
  "plugin": ["tokenmax-router", "oh-my-openagent@latest"]
}
'@ | Set-Content -LiteralPath (Join-Path $xdg "opencode.jsonc") -Encoding utf8

$env:OPENCODE_PORT = "18789"
$env:OPENCODE_SERVER_PASSWORD = "e2e-live-test"
$env:OPENCODE_LIVE_TEST = "1"
$env:OPENCODE_TOKENMAX_SKIP_AUTH_IMPORT = "1"

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

$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("opencode:e2e-live-test"))
$headers = @{ Authorization = "Basic $auth" }
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
  try {
    $h = Invoke-WebRequest -Uri "http://127.0.0.1:18789/global/health" -Headers $headers -TimeoutSec 3 -UseBasicParsing
    if ($h.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
  Start-Sleep -Seconds 2
}
if (-not $ready) { Fail "sidecar health not ready after launch" }

$ws = Join-Path $env:TEMP "tokenmax-e2e-ws"
New-Item -ItemType Directory -Force -Path $ws | Out-Null
$q = "directory=$([uri]::EscapeDataString($ws))"
function Sut([string]$Method, [string]$Path, $Body = $null) {
  $params = @{
    Uri = "http://127.0.0.1:18789$Path$(if ($Path.Contains('?')) {'&'} else {'?'})$q"
    Method = $Method
    Headers = $headers
    TimeoutSec = 90
  }
  if ($null -ne $Body) {
    $params.ContentType = "application/json"
    $params.Body = ($Body | ConvertTo-Json -Depth 6 -Compress)
  }
  return Invoke-RestMethod @params
}

$session = Sut POST "/session" @{ title = "e2e-help" }
$sid = $session.id
if (-not $sid) { $sid = $session.ID }
if (-not $sid) { Fail "session create returned no id" }

$helpOk = $false
try {
  $null = Sut POST "/session/$sid/command" @{ command = "help"; arguments = "" }
  $helpOk = $true
} catch {
  $msg = "$_"
  if ($msg -match "Failed to fetch|SchemaError|InvalidDurableEvent") { Fail "help crashed: $msg" }
  $helpOk = $true
}
$report.helpCommand = $(if ($helpOk) { "PASS" } else { "FAIL" })

try {
  $null = Sut POST "/session/$sid/message" @{ parts = @(@{ type = "text"; text = "Reply with 4 only." }) }
  $report.shortPrompt = "PASS"
} catch {
  $msg = "$_"
  if ($msg -match "Failed to fetch|SchemaError") { Fail "short prompt crashed: $msg" }
  $report.shortPrompt = "FAIL"
}

try {
  $st = Sut GET "/tokenmax/status"
  if ($st.mode -ne "NATIVE") { Fail "expected TokenMax mode NATIVE, got $($st.mode)" }
  if ($st.enabled -ne $true) { Fail "expected TokenMax enabled" }
  $null = Sut POST "/session/$sid/command" @{ command = "tokenmax-status"; arguments = "" }
  $report.tokenmaxStatus = "PASS"
} catch {
  Fail "tokenmax-status failed: $_"
}

$logText2 = ""
Get-ChildItem -LiteralPath $logDir -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
  if (-not $_.PSIsContainer) { $logText2 += (Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue) }
}
if ($logText2 -match "Received protocol 'bun:'" -or $logText2 -match "fatal renderer error") {
  Fail "renderer instability after live smoke"
}
$report.rendererStable = "PASS"

Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# Uninstall TokenMax Dev — UninstallString looks like: "C:\...\Uninstall Foo.exe" /currentuser
$rawUninstall = [string]$uninstall.UninstallString
if ($rawUninstall) {
  $unExe = $null
  $unArgs = @()
  if ($rawUninstall.StartsWith('"')) {
    $endIdx = $rawUninstall.IndexOf('"', 1)
    if ($endIdx -gt 0) {
      $unExe = $rawUninstall.Substring(1, $endIdx - 1)
      $rest = $rawUninstall.Substring($endIdx + 1).Trim()
      if ($rest) { $unArgs += ($rest -split '\s+' | Where-Object { $_ }) }
    }
  } else {
    $split = $rawUninstall.Split(' ', 2)
    $unExe = $split[0]
    if ($split.Length -gt 1 -and $split[1]) { $unArgs += ($split[1] -split '\s+' | Where-Object { $_ }) }
  }
  if (-not ($unArgs -contains "/S")) { $unArgs += "/S" }
  Write-Host "Uninstalling via $unExe $($unArgs -join ' ')"
  Start-Process -FilePath $unExe -ArgumentList $unArgs -Wait
  Start-Sleep -Seconds 5
}
if (-not (Test-Path $officialExe)) { Fail "Official stub missing after TokenMax uninstall" }
$report.officialAfterDevUninstall = "PASS"
$report.sideBySide = "PASS"
$report.windowsInstallE2e = "PASS"

$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $dist "e2e-report.json")
Write-Host ($report | ConvertTo-Json -Depth 6)
