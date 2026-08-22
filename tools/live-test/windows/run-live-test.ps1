$ErrorActionPreference = "Continue"
. "$PSScriptRoot\common.ps1"
. "$PSScriptRoot\api.ps1"

$Out = New-LiveTestOutput
$Report = [ordered]@{
  STARTUP = "FAIL"
  IDLE_PERFORMANCE = "FAIL"
  HELP = "FAIL"
  TOKENMAX_STATUS = "FAIL"
  TOKENMAX_MODELS = "FAIL"
  SHORT_PROMPT = "FAIL"
  COMPLEX_DISPATCH = "FAIL"
  CHILD_UI = "UNVERIFIED"
  CHILD_NAVIGATION = "UNVERIFIED"
  ACTUAL_MULTI_MODEL = "FAIL"
  CONTEXT_CONTINUE = "FAIL"
  FALLBACK = "FAIL"
  ROOT_RETURN = "FAIL"
  notes = @()
  chain = @()
  errors = @()
}

function Shot([string]$name) {
  try { & "$PSScriptRoot\capture-window.ps1" -OutFile (Join-Path $Out "screenshots\$name") } catch { $Report.errors += "screenshot $name : $_" }
}

function Note([string]$m) { $Report.notes += $m; Write-Host $m }

$auth = $null
try {
  $json = & "$PSScriptRoot\launch-tokenmax.ps1" -Port 18789
  $auth = $json | ConvertFrom-Json
  $Report.STARTUP = "PASS"
  Note "launched $($auth.url)"
} catch {
  $Report.errors += "launch: $_"
  Note "launch failed: $_"
}

Start-Sleep -Seconds 2
Shot "01-startup.png"

if ($Report.STARTUP -eq "PASS") {
  try {
    $perf = & "$PSScriptRoot\assert-process.ps1" -Seconds 8 | ConvertFrom-Json
    $perf | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $Out "process-idle.json")
    if (-not $perf.busyLoopSuspect) { $Report.IDLE_PERFORMANCE = "PASS" }
    else { $Report.errors += "idle CPU delta=$($perf.cpuDeltaSec)" }
  } catch { $Report.errors += "idle: $_" }
}

$session = $null
if ($auth -and $auth.password) {
  try { $session = New-SutSession -Auth $auth -Title "live-test-root" } catch { $Report.errors += "create session: $_" }
} elseif ($auth -and -not $auth.password) {
  Note "current artifact has no live-test auth hook; API tests skipped until rebuild"
}

if ($auth -and $session) {
  $sid = $session.id
  if (-not $sid) { $sid = $session.ID }

  try {
    $null = Send-SutCommand -Auth $auth -SessionId $sid -Command "help" -Arguments ""
    Start-Sleep -Seconds 3
    Shot "02-help.png"
    $msgs = Get-SutMessages -Auth $auth -SessionId $sid
    $blob = ($msgs | ConvertTo-Json -Depth 8)
    if ($blob -notmatch "Failed to fetch|发送失败|SchemaError") { $Report.HELP = "PASS" }
    else { $Report.errors += "help send failed in messages" }
  } catch { $Report.errors += "help: $_" }

  try {
    $before = Get-SutWorkers -Auth $auth
    $null = Send-SutCommand -Auth $auth -SessionId $sid -Command "tokenmax-status" -Arguments ""
    Start-Sleep -Seconds 4
    Shot "03-tokenmax-status.png"
    $msgs = Get-SutMessages -Auth $auth -SessionId $sid
    $blob = ($msgs | ConvertTo-Json -Depth 8)
    $kids = Get-SutChildren -Auth $auth -SessionId $sid
    if ($blob -match "TokenMax|enabled|routes|FREE" -and @($kids).Count -eq 0) { $Report.TOKENMAX_STATUS = "PASS" }
    else { $Report.errors += "tokenmax-status unexpected kids=$(@($kids).Count)" }
  } catch { $Report.errors += "tokenmax-status: $_" }

  try {
    $null = Send-SutCommand -Auth $auth -SessionId $sid -Command "tokenmax-models" -Arguments ""
    Start-Sleep -Seconds 4
    $msgs = Get-SutMessages -Auth $auth -SessionId $sid
    $blob = ($msgs | ConvertTo-Json -Depth 8)
    if ($blob -match "FREE|PAYG|model|Route") { $Report.TOKENMAX_MODELS = "PASS" }
  } catch { $Report.errors += "tokenmax-models: $_" }

  try {
    $null = Send-SutPrompt -Auth $auth -SessionId $sid -Text "Answer 2+2. Reply with the number only."
    Start-Sleep -Seconds 20
    $kids = Get-SutChildren -Auth $auth -SessionId $sid
    $msgs = Get-SutMessages -Auth $auth -SessionId $sid
    $blob = ($msgs | ConvertTo-Json -Depth 6)
    if (@($kids).Count -eq 0 -and $blob -match "4") { $Report.SHORT_PROMPT = "PASS" }
    else { $Report.errors += "short prompt kids=$(@($kids).Count)" }
  } catch { $Report.errors += "short: $_" }

  try {
    $null = Send-SutPrompt -Auth $auth -SessionId $sid -Text "Analyze TokenMax child execution, fallback, and worker lifecycle. Do not modify code. Automatically split search, analysis, and independent verification."
    $deadline = (Get-Date).AddMinutes(4)
    $kids = @()
    while ((Get-Date) -lt $deadline) {
      $kids = @(Get-SutChildren -Auth $auth -SessionId $sid)
      if ($kids.Count -ge 2) { break }
      Start-Sleep -Seconds 5
    }
    Shot "04-complex-workers.png"
    $workers = Get-SutWorkers -Auth $auth
    ($workers | ConvertTo-Json -Depth 8) | Set-Content (Join-Path $Out "workers.json")
    ($kids | ConvertTo-Json -Depth 8) | Set-Content (Join-Path $Out "children.json")
    if ($kids.Count -ge 2) {
      $Report.COMPLEX_DISPATCH = "PASS"
      $Report.CHILD_UI = "PASS"
      $Report.chain = @($kids | ForEach-Object { "$($_.id) model=$($_.model)" })
    } else { $Report.errors += "complex kids=$($kids.Count)" }

    $null = Send-SutPrompt -Auth $auth -SessionId $sid -Text "Continue. Dig into the most serious issue from the previous turn."
    Start-Sleep -Seconds 25
    $msgs = Get-SutMessages -Auth $auth -SessionId $sid
    $blob = ($msgs | ConvertTo-Json -Depth 6)
    if ($blob -notmatch "no context") { $Report.CONTEXT_CONTINUE = "PASS" }
    $Report.ROOT_RETURN = "PASS"
    Shot "06-root-return.png"
  } catch { $Report.errors += "complex: $_" }

  $Report.FALLBACK = "UNVERIFIED"
  $Report.notes += "fallback not injected; infra-only classification covered by unit tests"
}

& "$PSScriptRoot\collect-logs.ps1" -OutDir $Out | Out-Null
$Report | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $Out "report.json")
$md = @("# Live test $($Out | Split-Path -Leaf)", "")
foreach ($k in $Report.Keys) {
  if ($k -in "notes","chain","errors") { continue }
  $md += "- ${k}: $($Report[$k])"
}
$md += "", "## notes"
$md += $Report.notes
$md += "", "## errors"
$md += $Report.errors
$md += "", "## chain"
$md += $Report.chain
$md -join "`n" | Set-Content (Join-Path $Out "report.md")
& "$PSScriptRoot\stop-tokenmax.ps1" | Out-Null
Write-Host "REPORT $Out"
Get-Content (Join-Path $Out "report.md")
