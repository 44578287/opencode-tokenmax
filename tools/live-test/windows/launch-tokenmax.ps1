param(
  [string]$Password = "live-test-local-password",
  [int]$Port = 18789,
  [string]$Workspace = (Join-Path $env:TEMP "tokenmax-e2e-workspace")
)
. "$PSScriptRoot\common.ps1"
$script:Workspace = $Workspace
$script:Port = $Port
Initialize-LiveTestWorkspace
$exe = Get-TokenMaxExe
Assert-NotOfficialPath $script:UserData

Get-TokenMaxProcesses | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

$env:OPENCODE_PORT = "$Port"
$env:OPENCODE_SERVER_PASSWORD = $Password
$env:OPENCODE_LIVE_TEST = "1"
$env:OPENCODE_TOKENMAX_SKIP_AUTH_IMPORT = "1"

$proc = Start-Process -FilePath $exe -PassThru -WorkingDirectory $Workspace
$deadline = (Get-Date).AddSeconds(45)
$auth = $null
$portUp = $false
while ((Get-Date) -lt $deadline) {
  if ($proc.HasExited) { throw "TokenMax Dev exited at launch code=$($proc.ExitCode)" }
  $disk = Get-LiveTestAuth
  if ($disk) { $auth = $disk; break }
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/global/health" -Headers (Get-BasicAuthHeader "opencode" $Password) -TimeoutSec 2 -UseBasicParsing
    if ($r.StatusCode -eq 200) {
      $auth = [pscustomobject]@{ url = "http://127.0.0.1:$Port"; username = "opencode"; password = $Password; authenticated = $true }
      break
    }
  } catch {
    try {
      $tcp = New-Object System.Net.Sockets.TcpClient
      $iar = $tcp.BeginConnect("127.0.0.1", $Port, $null, $null)
      $ok = $iar.AsyncWaitHandle.WaitOne(400)
      if ($ok -and $tcp.Connected) { $portUp = $true }
      $tcp.Close()
    } catch {}
  }
  $win = Get-TokenMaxProcesses | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
  if ($portUp -and $win) { break }
  Start-Sleep -Seconds 1
}
if (-not $auth) {
  if (-not (Get-TokenMaxProcesses)) { throw "TokenMax Dev process missing after launch" }
  $auth = [pscustomobject]@{ url = "http://127.0.0.1:$Port"; username = "opencode"; password = $null; authenticated = $false }
}
Write-Output ($auth | ConvertTo-Json -Compress)
