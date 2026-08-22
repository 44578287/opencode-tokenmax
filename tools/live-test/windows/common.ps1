$script:InstallDirCandidates = @(
  (Join-Path $env:LOCALAPPDATA "Programs\OpenCode TokenMax Dev"),
  (Join-Path $env:LOCALAPPDATA "Programs\opencode-tokenmax-dev")
)
$script:UserData = Join-Path $env:APPDATA "ai.opencode.tokenmax.dev"
$script:OfficialUserData = Join-Path $env:APPDATA "ai.opencode.desktop"
$script:OfficialConfig = Join-Path $env:USERPROFILE ".config\opencode"
$script:Workspace = Join-Path $env:TEMP "tokenmax-e2e-workspace"
$script:OutputRoot = "C:\Users\g9964\Documents\opencode-tokenmax\output\live-test"
$script:Port = 18789
$script:ExeName = "OpenCode TokenMax Dev"

function Get-TokenMaxProcesses {
  Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and (
      $_.Path -like "*\opencode-tokenmax-dev\*" -or
      $_.Path -like "*\OpenCode TokenMax Dev\*" -or
      $_.Path -like "*OpenCode TokenMax Dev.exe"
    )
  }
}

function Get-TokenMaxExe {
  foreach ($dir in $script:InstallDirCandidates) {
    $exe = Join-Path $dir "OpenCode TokenMax Dev.exe"
    if (Test-Path -LiteralPath $exe) { return $exe }
  }
  throw "TokenMax Dev exe not found. Install the opencode-tokenmax-dev-windows artifact first."
}

function Assert-NotOfficialPath([string]$path) {
  $full = [IO.Path]::GetFullPath($path)
  foreach ($bad in @($script:OfficialUserData, $script:OfficialConfig, (Join-Path $env:LOCALAPPDATA "Programs\@opencode-aidesktop"))) {
    if ($full.StartsWith([IO.Path]::GetFullPath($bad), [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to touch official OpenCode path: $full"
    }
  }
}

function New-LiveTestOutput {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $dir = Join-Path $script:OutputRoot "$stamp"
  New-Item -ItemType Directory -Force -Path (Join-Path $dir "screenshots") | Out-Null
  return $dir
}

function Initialize-LiveTestWorkspace {
  $ws = $script:Workspace
  New-Item -ItemType Directory -Force -Path (Join-Path $ws "src") | Out-Null
  Set-Content -LiteralPath (Join-Path $ws "README.md") -Value "# Sample Task Manager`n`nA small in-memory task manager used as a neutral E2E workspace.`n" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $ws "src\tasks.ts") -Value @'
export interface Task { id: number; title: string; done: boolean }
const nextId = (() => { let i = 0; return () => ++i })()
export function createTask(title: string): Task { return { id: nextId(), title, done: false } }
'@ -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $ws "src\store.ts") -Value @'
import { Task, createTask } from "./tasks"
const tasks: Task[] = []
export function add(title: string): Task { const t = createTask(title); tasks.push(t); return t }
export function all(): Task[] { return [...tasks] }
'@ -Encoding UTF8
}

function Get-LiveTestAuth {
  $file = Join-Path $script:UserData "live-test-auth.json"
  if (Test-Path -LiteralPath $file) {
    return Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
  }
  return $null
}

function Get-BasicAuthHeader([string]$user, [string]$pass) {
  $raw = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${user}:${pass}"))
  return @{ Authorization = "Basic $raw" }
}

function Redact-Secrets([string]$text) {
  if (-not $text) { return $text }
  $text = [regex]::Replace($text, "(?i)(sk-|rk-|ghp_|gho_|xox[baprs]-)[A-Za-z0-9_\-]{8,}", "`$1[REDACTED]")
  $text = [regex]::Replace($text, "(?i)(bearer\s+)[A-Za-z0-9._\-]{12,}", "`$1[REDACTED]")
  $text = [regex]::Replace($text, "(?i)(""(?:refresh|access|api)?_?token""\s*:\s*"")[^""]+", "`$1[REDACTED]")
  return $text
}
