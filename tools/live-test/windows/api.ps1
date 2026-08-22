. "$PSScriptRoot\common.ps1"
if (-not ("System.Net.Http.HttpClient" -as [type])) { Add-Type -AssemblyName System.Net.Http }

function Invoke-Sut([string]$Method, [string]$Path, $Body = $null, $Auth) {
  $headers = Get-BasicAuthHeader $Auth.username $Auth.password
  $uri = "$($Auth.url)$Path"
  if ($Path -notmatch "directory=") {
    $sep = if ($Path.Contains("?")) { "&" } else { "?" }
    $uri = "$uri${sep}directory=$([uri]::EscapeDataString($script:Workspace))"
  }
  $timeout = 120
  if ($Method -eq "POST" -and $Path -match "/message$") { $timeout = 600 }
  $params = @{ Uri = $uri; Method = $Method; Headers = $headers; TimeoutSec = $timeout }
  if ($null -ne $Body) {
    $params.ContentType = "application/json; charset=utf-8"
    $params.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 8 -Compress))
  }
  return Invoke-RestMethod @params
}

function New-SutSession($Auth, [string]$Title = "live-test") {
  return Invoke-Sut -Method POST -Path "/session" -Body @{ title = $Title } -Auth $Auth
}

function Send-SutCommand($Auth, [string]$SessionId, [string]$Command, [string]$Arguments = "") {
  return Invoke-Sut -Method POST -Path "/session/$SessionId/command" -Body @{ command = $Command; arguments = $Arguments } -Auth $Auth
}

function Send-SutPrompt($Auth, [string]$SessionId, [string]$Text) {
  return Invoke-Sut -Method POST -Path "/session/$SessionId/message" -Body @{ parts = @(@{ type = "text"; text = $Text }) } -Auth $Auth
}

$script:SutPromptTasks = @()

function Test-SutReady($Auth) {
  try { $null = Invoke-Sut -Method GET -Path "/session" -Auth $Auth; return $true } catch { return $false }
}

function Wait-SutReady($Auth, [int]$TimeoutSec = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-SutReady -Auth $Auth) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Send-SutPromptAsync($Auth, [string]$SessionId, [string]$Text) {
  $pair = "$($Auth.username):$($Auth.password)"
  $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
  $client = New-Object System.Net.Http.HttpClient
  $client.Timeout = [TimeSpan]::FromSeconds(600)
  $client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Basic", $basic)
  $uri = "$($Auth.url)/session/$SessionId/message?directory=$([uri]::EscapeDataString($script:Workspace))"
  $json = @{ parts = @(@{ type = "text"; text = $Text }) } | ConvertTo-Json -Depth 8 -Compress
  $content = New-Object System.Net.Http.StringContent($json, [Text.Encoding]::UTF8, "application/json")
  $task = $client.PostAsync($uri, $content)
  $handle = @{ Client = $client; Task = $task; SessionId = $SessionId }
  $script:SutPromptTasks += ,$handle
  return $handle
}

function Clear-SutPromptTasks {
  foreach ($h in $script:SutPromptTasks) {
    try { if (-not $h.Task.IsCompleted) { $h.Client.CancelPendingRequests() } } catch {}
    try { $h.Client.Dispose() } catch {}
  }
  $script:SutPromptTasks = @()
}

function Get-SutMessages($Auth, [string]$SessionId) {
  return Invoke-Sut -Method GET -Path "/session/$SessionId/message" -Auth $Auth
}

function Get-SutChildren($Auth, [string]$SessionId) {
  $raw = Invoke-Sut -Method GET -Path "/session/$SessionId/children" -Auth $Auth
  if ($null -eq $raw) { return ,@() }
  return ,@($raw)
}

function Get-SutWorkers($Auth) {
  try { return Invoke-Sut -Method GET -Path "/tokenmax/workers" -Auth $Auth } catch { return @{ workers = @() } }
}

function Get-SutStatus($Auth) {
  try { return Invoke-Sut -Method GET -Path "/tokenmax/status" -Auth $Auth } catch { return $null }
}
