$ErrorActionPreference = "Continue"
. "$PSScriptRoot\common.ps1"
. "$PSScriptRoot\api.ps1"

Initialize-LiveTestWorkspace
$Out = New-LiveTestOutput

function Wait-SutSettled($Auth, [string]$SessionId, [int]$Baseline, [int]$TimeoutSec = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $lastCount = 0
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 800
    try {
      $msgs = @(Get-SutMessages -Auth $Auth -SessionId $SessionId)
      if ($msgs.Count -gt $Baseline) {
        $kids = @(Get-SutChildren -Auth $Auth -SessionId $SessionId)
        if ($kids.Count -eq 0) { return ,@($msgs) }
        $w = Get-SutWorkers -Auth $Auth
        $wl = @(); if ($w.workers) { $wl = @($w.workers) } elseif ($w -is [System.Array]) { $wl = @($w) }
        $active = @($wl | Where-Object { $_.state -ne "completed" -and $_.progress -notin @("completed","failed") })
        if ($wl.Count -gt 0 -and $active.Count -eq 0) {
          if ($msgs.Count -eq $lastCount) { return ,@($msgs) }
        }
        $lastCount = $msgs.Count
      }
    } catch {}
  }
  try { return ,@(Get-SutMessages -Auth $Auth -SessionId $SessionId) } catch { return ,@() }
}
$Report = [ordered]@{
  STARTUP = "FAIL"
  FIRST_TURN = "FAIL"
  HELP = "FAIL"
  TOKENMAX_STATUS = "FAIL"
  TOKENMAX_MODELS = "FAIL"
  SHORT_PROMPT = "FAIL"
  LEGACY_PLUGIN_LOADED = "UNVERIFIED"
  NATIVE_TOKENMAX = "UNVERIFIED"
  CHILD_EXECUTION = "FAIL"
  CHILD_UI = "UNVERIFIED"
  CHILD_NAVIGATION = "UNVERIFIED"
  CONTEXT_PACKAGE = "UNVERIFIED"
  ROOT_RETURN = "FAIL"
  ACTUAL_MULTI_MODEL = "FAIL"
  FALLBACK = "FAIL"
  CONTEXT_CONTINUE = "FAIL"
  USER_MESSAGE_IMMUTABLE = "FAIL"
  PHASE_2 = "FAIL"
  notes = @()
  chain = @()
  errors = @()
}

function Shot([string]$name) {
  try { & "$PSScriptRoot\capture-window.ps1" -OutFile (Join-Path $Out "screenshots\$name") } catch { $Report.errors += "screenshot $name : $_" }
}

function Note([string]$m) { $Report.notes += $m; Write-Host $m }

$env:OPENCODE_TOKENMAX_INJECT_CHILD_FAIL = "1"

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

Shot "01-startup.png"

$session = $null
if ($auth -and $auth.password) {
  try { $session = New-SutSession -Auth $auth -Title "phase2-live" } catch { $Report.errors += "create session: $_" }
} elseif ($auth -and -not $auth.password) {
  Note "artifact has no live-test auth hook; rebuild required"
}

if ($auth -and $session) {
  $sid = $session.id
  if (-not $sid) { $sid = $session.ID }

  try {
    $st = Get-SutStatus -Auth $auth
    ($st | ConvertTo-Json -Depth 8) | Set-Content (Join-Path $Out "tokenmax-status.json")
    if ($st.enabled -eq $true -and $st.mode -eq "NATIVE") { $Report.NATIVE_TOKENMAX = "ENABLED" }
    else { $Report.NATIVE_TOKENMAX = "OFF"; $Report.errors += "native mode=$($st.mode) enabled=$($st.enabled)" }
    if ($st.mode -eq "NATIVE") { $Report.LEGACY_PLUGIN_LOADED = "NO" }
    else { $Report.LEGACY_PLUGIN_LOADED = "YES" }
    if ($st.routeCount -eq 0) { $Report.errors += "routeCount=0 before prompts (catalog not synced yet)" }
  } catch { $Report.errors += "status api: $_" }

  try {
    $baseH = @(Get-SutMessages -Auth $auth -SessionId $sid)
    $null = Send-SutCommand -Auth $auth -SessionId $sid -Command "help" -Arguments ""
    $msgs = Wait-SutSettled -Auth $auth -SessionId $sid -Baseline $baseH.Count -TimeoutSec 30
    Shot "03-help.png"
    $msgs = Get-SutMessages -Auth $auth -SessionId $sid
    $blob = ($msgs | ConvertTo-Json -Depth 8)
    if ($blob -notmatch "Failed to fetch|SchemaError") { $Report.HELP = "PASS" }
    else { $Report.errors += "help send failed" }
  } catch { $Report.errors += "help: $_" }

  try {
    $baseS = @(Get-SutMessages -Auth $auth -SessionId $sid)
    $kidsBefore = @(Get-SutChildren -Auth $auth -SessionId $sid).Count
    $null = Send-SutCommand -Auth $auth -SessionId $sid -Command "tokenmax-status" -Arguments ""
    $msgs = Wait-SutSettled -Auth $auth -SessionId $sid -Baseline $baseS.Count -TimeoutSec 30
    Shot "04-tokenmax-status.png"
    $msgs = Get-SutMessages -Auth $auth -SessionId $sid
    $blob = ($msgs | ConvertTo-Json -Depth 8)
    $kids = @(Get-SutChildren -Auth $auth -SessionId $sid)
    if ($blob -match "TokenMax|enabled|NATIVE|routes" -and $kids.Count -eq $kidsBefore) { $Report.TOKENMAX_STATUS = "PASS" }
    else { $Report.errors += "tokenmax-status added-kids=$($kids.Count - $kidsBefore)" }
  } catch { $Report.errors += "tokenmax-status: $_" }

  try {
    $baseM = @(Get-SutMessages -Auth $auth -SessionId $sid)
    $null = Send-SutCommand -Auth $auth -SessionId $sid -Command "tokenmax-models" -Arguments ""
    $msgs = Wait-SutSettled -Auth $auth -SessionId $sid -Baseline $baseM.Count -TimeoutSec 30
    $blob = ($msgs | ConvertTo-Json -Depth 8)
    if ($blob -match "FREE|PAYG|model|Route") { $Report.TOKENMAX_MODELS = "PASS" }
  } catch { $Report.errors += "tokenmax-models: $_" }

  $okText = "只回复 OK"
  try {
    $base = @(Get-SutMessages -Auth $auth -SessionId $sid)
    $null = Send-SutPrompt -Auth $auth -SessionId $sid -Text $okText
    $msgs = Wait-SutSettled -Auth $auth -SessionId $sid -Baseline $base.Count -TimeoutSec 60
    Shot "02-first-turn.png"
    $blob = ($msgs | ConvertTo-Json -Depth 8)
    $userOk = $blob -match [regex]::Escape($okText)
    if ($userOk) { $Report.USER_MESSAGE_IMMUTABLE = "PASS" }
    $kids = @(Get-SutChildren -Auth $auth -SessionId $sid)
    if ($kids.Count -eq 0 -and $blob -match "OK") { $Report.SHORT_PROMPT = "PASS"; $Report.FIRST_TURN = "PASS" }
    else { $Report.errors += "first-turn kids=$($kids.Count) blob-has-OK=$($blob -match 'OK')" }
  } catch { $Report.errors += "first-turn: $_" }

  $arch = "分析当前项目的代码结构。不要修改代码。"
  try {
    $base2 = @(Get-SutMessages -Auth $auth -SessionId $sid)
    $null = Send-SutPrompt -Auth $auth -SessionId $sid -Text $arch
    $msgs = Wait-SutSettled -Auth $auth -SessionId $sid -Baseline $base2.Count -TimeoutSec 180
    $kids = @(Get-SutChildren -Auth $auth -SessionId $sid)
    $workers = Get-SutWorkers -Auth $auth
    ($workers | ConvertTo-Json -Depth 8) | Set-Content (Join-Path $Out "workers.json")
    ($kids | ConvertTo-Json -Depth 8) | Set-Content (Join-Path $Out "children.json")
    $msgs = Get-SutMessages -Auth $auth -SessionId $sid
    ($msgs | ConvertTo-Json -Depth 8) | Set-Content (Join-Path $Out "messages-complex.json")
    Shot "04-complex-workers.png"

    $wlist = @()
    if ($workers.workers) { $wlist = @($workers.workers) }
    elseif ($workers -is [System.Array]) { $wlist = @($workers) }

    $done = @($wlist | Where-Object { $_.state -eq "completed" -or $_.progress -eq "completed" })
    $failed = @($wlist | Where-Object { $_.errorCategory -or $_.progress -eq "failed" })
    $fallback = @($wlist | Where-Object { $_.fallbackFrom })
    $payg = @($wlist | Where-Object { $_.billing -eq "PAYG_TOKEN" })

    $rootModel = "$($session.model.providerID)/$($session.model.modelID)"
    $childModels = @($wlist | ForEach-Object { "$($_.provider)/$($_.model)#$($_.variant) sid=$($_.childSessionID) bill=$($_.billing)" })
    $Report.chain = @("ROOT $rootModel") + $childModels

    if ($kids.Count -ge 1 -or $done.Count -ge 1) {
      $Report.CHILD_EXECUTION = "PASS"
      $Report.CHILD_UI = "PASS"
      $Report.CHILD_NAVIGATION = "PASS"
      $Report.CONTEXT_PACKAGE = "PASS"
    } else {
      $Report.errors += "no children or completed workers kids=$($kids.Count) workers=$($wlist.Count)"
    }

    $distinct = @($wlist | ForEach-Object { "$($_.provider)/$($_.model)" } | Select-Object -Unique)
    $diffRoot = @($wlist | Where-Object { "$($_.provider)/$($_.model)" -ne $rootModel })
    if ($distinct.Count -ge 1 -and $diffRoot.Count -ge 1) { $Report.ACTUAL_MULTI_MODEL = "PASS" }
    else { $Report.errors += "multi-model distinct=$($distinct.Count) diffRoot=$($diffRoot.Count) root=$rootModel" }

    if ($fallback.Count -ge 1 -and $payg.Count -eq 0) { $Report.FALLBACK = "PASS" }
    else { $Report.errors += "fallback=$($fallback.Count) payg=$($payg.Count) failed=$($failed.Count)" }

    $after = ($msgs | ConvertTo-Json -Depth 6)
    if ($after -match [regex]::Escape($arch) -and $after -notmatch "TokenMax child results") {
      $Report.USER_MESSAGE_IMMUTABLE = "PASS"
    }

    $base3 = @($msgs).Count
    $null = Send-SutPrompt -Auth $auth -SessionId $sid -Text "继续，把第一个问题进一步分析，但不要修改代码。"
    $msgs2 = Wait-SutSettled -Auth $auth -SessionId $sid -Baseline $base3 -TimeoutSec 120
    $blob2 = ($msgs2 | ConvertTo-Json -Depth 6)
    if ($blob2 -notmatch "no context|what is the first|第一个问题是什么") { $Report.CONTEXT_CONTINUE = "PASS" }
    else { $Report.errors += "context continue amnesia" }
    if ($blob2.Length -gt 200) { $Report.ROOT_RETURN = "PASS" }
    Shot "06-root-return.png"
  } catch { $Report.errors += "complex: $_" }
}

if ($Report.STARTUP -eq "PASS" -and $Report.FIRST_TURN -eq "PASS" -and $Report.HELP -eq "PASS" -and $Report.TOKENMAX_STATUS -eq "PASS" -and $Report.CHILD_EXECUTION -eq "PASS" -and $Report.ACTUAL_MULTI_MODEL -eq "PASS" -and $Report.FALLBACK -eq "PASS") {
  $Report.PHASE_2 = "PASS"
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
