. "$PSScriptRoot\common.ps1"
Get-TokenMaxProcesses | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
$auth = Join-Path $script:UserData "live-test-auth.json"
if (Test-Path -LiteralPath $auth) { Remove-Item -LiteralPath $auth -Force }
Write-Output "stopped"
