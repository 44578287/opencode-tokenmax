. "$PSScriptRoot\common.ps1"

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

function Get-SutMessages($Auth, [string]$SessionId) {
  return Invoke-Sut -Method GET -Path "/session/$SessionId/message" -Auth $Auth
}

function Get-SutChildren($Auth, [string]$SessionId) {
  return Invoke-Sut -Method GET -Path "/session/$SessionId/children" -Auth $Auth
}

function Get-SutWorkers($Auth) {
  try { return Invoke-Sut -Method GET -Path "/tokenmax/workers" -Auth $Auth } catch { return @{ workers = @() } }
}

function Get-SutStatus($Auth) {
  try { return Invoke-Sut -Method GET -Path "/tokenmax/status" -Auth $Auth } catch { return $null }
}
