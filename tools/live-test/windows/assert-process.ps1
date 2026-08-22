param([int]$Seconds = 5)
. "$PSScriptRoot\common.ps1"
$samples = @()
for ($i = 0; $i -lt $Seconds; $i++) {
  $p = Get-TokenMaxProcesses
  if (-not $p) { throw "TokenMax Dev process missing" }
  $cpu = ($p | Measure-Object CPU -Sum).Sum
  $ram = ($p | Measure-Object WorkingSet64 -Sum).Sum
  $samples += [pscustomobject]@{ t = Get-Date -Format o; cpu = $cpu; ram = $ram; procs = @($p).Count }
  Start-Sleep -Seconds 1
}
$delta = $samples[-1].cpu - $samples[0].cpu
[pscustomobject]@{
  samples = $samples
  cpuDeltaSec = [math]::Round($delta, 2)
  ramMB = [math]::Round($samples[-1].ram / 1MB, 1)
  busyLoopSuspect = ($delta -gt ($Seconds * 4))
} | ConvertTo-Json -Depth 5
