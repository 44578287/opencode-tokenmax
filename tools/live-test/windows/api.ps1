. "$PSScriptRoot\common.ps1"

# Unified curl.exe-based HTTP client for the live test harness.
# Uses the REAL curl.exe binary (C:\Windows\System32\curl.exe) to bypass
# PowerShell's curl alias (Invoke-WebRequest -> WinINet) and .NET Framework's
# WinINet/ServicePointManager cache that persists system-wide across all
# PowerShell processes. This was empirically the ONLY way to get reliable
# fresh responses from the OpenCode server in a tight polling loop.
#
# All JSON request bodies are written to a temp file with UTF8NoBOM encoding
# (via .NET's UTF8Encoding(false)) to avoid BOM corruption that breaks
# the server's JSON parser.

function Get-CurlBasicAuth($Auth) {
  $pair = "$($Auth.username):$($Auth.password)"
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
}

function Get-CurlHeaders($Auth) {
  $basic = Get-CurlBasicAuth $Auth
  return @(
    "Authorization: Basic $basic",
    "Connection: close",
    "Cache-Control: no-cache, no-store, must-revalidate",
    "Pragma: no-cache",
    "Accept: application/json"
  )
}

function Write-JsonTempFile($Object) {
  $json = $Object | ConvertTo-Json -Depth 8 -Compress
  $tempFile = [IO.Path]::GetTempFileName()
  # Write without UTF-8 BOM to avoid corrupting server's JSON parser
  [IO.File]::WriteAllText($tempFile, $json, (New-Object System.Text.UTF8Encoding($false)))
  return $tempFile
}

function Invoke-Curl($Auth, [string]$Method, [string]$Path, $Body = $null) {
  $uri = "$($Auth.url)$Path"
  if ($Path -notmatch "directory=" -and $Path -notmatch "tokenmax/") {
    $sep = if ($Path.Contains("?")) { "&" } else { "?" }
    $uri = "$uri${sep}directory=$([uri]::EscapeDataString($script:Workspace))"
  }
  if ($Method -eq "GET") {
    $sep2 = if ($uri.Contains("?")) { "&" } else { "?" }
    $uri = "$uri${sep2}_ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  }

  $headers = Get-CurlHeaders $Auth
  $headerArgs = @()
  foreach ($h in $headers) { $headerArgs += "-H"; $headerArgs += $h }

  $tempFile = $null
  $bodyArgs = @()
  if ($null -ne $Body) {
    $tempFile = Write-JsonTempFile $Body
    $bodyArgs = "-d", "@$tempFile", "-H", "Content-Type: application/json"
  }

  try {
    $curlArgs = @($Method) + $headerArgs + $bodyArgs + ,$uri
    $result = & "C:\Windows\System32\curl.exe" -s @curlArgs
    if ($LASTEXITCODE -ne 0) { throw "curl $Method $Path failed (exit $LASTEXITCODE): $result" }
    if ([string]::IsNullOrWhiteSpace($result)) { return $null }
    $parsed = $result | ConvertFrom-Json
    # PS 5.1 wraps deserialized JSON arrays in a collection-proxy object shaped
    # like { value = [...], Count = n }. Flatten it so every caller's @(...)
    # wrapping and .Count math see a normal flat array.
    if ($parsed -is [System.Management.Automation.PSCustomObject]) {
      $propNames = @($parsed.PSObject.Properties.Name)
      if ($propNames -contains "value" -and $propNames -contains "Count") {
        foreach ($item in @($parsed.value)) { $item }
        return
      }
    }
    return $parsed
  } finally {
    if ($tempFile -and (Test-Path -LiteralPath $tempFile)) { Remove-Item -LiteralPath $tempFile -Force }
  }
}

function New-SutSession($Auth, [string]$Title = "live-test") {
  return Invoke-Curl -Auth $Auth -Method POST -Path "/session" -Body @{ title = $Title }
}

function Send-SutCommand($Auth, [string]$SessionId, [string]$Command, [string]$Arguments = "") {
  return Invoke-Curl -Auth $Auth -Method POST -Path "/session/$SessionId/command" -Body @{ command = $Command; arguments = $Arguments }
}

function Send-SutPrompt($Auth, [string]$SessionId, [string]$Text) {
  # Synchronous prompt: POST /session/{id}/message (correct endpoint)
  return Invoke-Curl -Auth $Auth -Method POST -Path "/session/$SessionId/message" -Body @{ parts = @(@{ type = "text"; text = $Text }) }
}

# Fire-and-forget async prompt for complex multi-worker tasks.
# Uses the correct endpoint /session/{id}/prompt_async
$script:SutPromptTasks = @()

function Send-SutPromptAsync($Auth, [string]$SessionId, [string]$Text) {
  $body = @{ parts = @(@{ type = "text"; text = $Text }) }
  $tempFile = Write-JsonTempFile $body
  $basic = Get-CurlBasicAuth $Auth
  $uri = "$($Auth.url)/session/$SessionId/prompt_async?directory=$([uri]::EscapeDataString($script:Workspace))"
  $headers = Get-CurlHeaders $Auth
  $headerArgs = @()
  foreach ($h in $headers) { $headerArgs += "-H"; $headerArgs += $h }

  $curlArgs = @("POST") + $headerArgs + "-H", "Content-Type: application/json" + "-d" + "@$tempFile" + ,$uri
  $client = New-Object System.Diagnostics.Process
  $client.StartInfo.FileName = "C:\Windows\System32\curl.exe"
  $client.StartInfo.Arguments = ($curlArgs -join " ")
  $client.StartInfo.UseShellExecute = $false
  $client.StartInfo.RedirectStandardOutput = $true
  $client.StartInfo.RedirectStandardError = $true
  $client.StartInfo.CreateNoWindow = $true
  $started = $client.Start()
  if (-not $started) {
    Remove-Item -LiteralPath $tempFile -Force
    throw "Failed to start curl.exe for async prompt"
  }
  $handle = @{ Process = $client; TempFile = $tempFile; SessionId = $SessionId }
  $script:SutPromptTasks += ,$handle
  return $handle
}

function Wait-SutPromptAsync($Handle) {
  $proc = $Handle.Process
  if (-not $proc.HasExited) {
    $proc.WaitForExit(300000) # 5 min timeout for async prompt
  }
  $exitCode = $proc.ExitCode
  $output = $proc.StandardOutput.ReadToEnd()
  $proc.Dispose()
  Remove-Item -LiteralPath $Handle.TempFile -Force -ErrorAction SilentlyContinue
  $script:SutPromptTasks = @($script:SutPromptTasks | Where-Object { $_ -ne $Handle })
  if ($exitCode -ne 0) { throw "curl async prompt failed (exit $exitCode): $output" }
  if ([string]::IsNullOrWhiteSpace($output)) { return $null }
  return $output | ConvertFrom-Json
}

function Clear-SutPromptTasks {
  foreach ($h in $script:SutPromptTasks) {
    try { if (-not $h.Process.HasExited) { $h.Process.Kill() } } catch {}
    try { $h.Process.Dispose() } catch {}
    try { Remove-Item -LiteralPath $h.TempFile -Force -ErrorAction SilentlyContinue } catch {}
  }
  $script:SutPromptTasks = @()
}

function Get-SutMessages($Auth, [string]$SessionId) {
  return Invoke-Curl -Auth $Auth -Method GET -Path "/session/$SessionId/message"
}

function Get-SutChildren($Auth, [string]$SessionId) {
  return Invoke-Curl -Auth $Auth -Method GET -Path "/session/$SessionId/children"
}

function Get-SutWorkers($Auth) {
  return Invoke-Curl -Auth $Auth -Method GET -Path "/tokenmax/workers"
}

function Get-SutStatus($Auth) {
  try { return Invoke-Curl -Auth $Auth -Method GET -Path "/tokenmax/status" } catch { return $null }
}

function Test-SutReady($Auth) {
  try { $null = Invoke-Curl -Auth $Auth -Method GET -Path "/session"; return $true } catch { return $false }
}

function Wait-SutReady($Auth, [int]$TimeoutSec = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-SutReady -Auth $Auth) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}