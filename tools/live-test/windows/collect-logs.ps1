param([Parameter(Mandatory=$true)][string]$OutDir)
. "$PSScriptRoot\common.ps1"
Assert-NotOfficialPath $OutDir
$dest = Join-Path $OutDir "logs"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$src = Join-Path $script:UserData "logs"
if (Test-Path -LiteralPath $src) {
  $latest = Get-ChildItem -LiteralPath $src -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($latest) {
    Copy-Item -LiteralPath $latest.FullName -Destination (Join-Path $dest $latest.Name) -Recurse -Force
    Get-ChildItem -LiteralPath (Join-Path $dest $latest.Name) -Recurse -File | ForEach-Object {
      if ($_.Extension -in ".log",".txt",".json") {
        $t = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
        if ($t) { Set-Content -LiteralPath $_.FullName -Value (Redact-Secrets $t) -NoNewline }
      }
    }
  }
}
Write-Output $dest
