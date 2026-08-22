const DELAY_COMMAND = /(?:^|[;&|]\s*)(?:sleep|start-sleep|timeout|ping)\b/i
const OBSERVABLE_OPERATION = /\b(?:bun|npm|pnpm|yarn|cargo|dotnet|cmake|make|gradle|msbuild|gh\s+run|git\s+push|curl|wget|invoke-webrequest|test-path|findstr)\b/i

export function observableOperationType(command: string): "GITHUB_ACTIONS" | "PROCESS" | undefined {
  if (/\bgh\s+run\s+(?:watch|view)\b/i.test(command)) return "GITHUB_ACTIONS"
  if (/\b(?:bun|npm|pnpm|yarn|cargo|dotnet|cmake|make|gradle|msbuild)\s+(?:run\s+)?(?:build|test|check|compile)\b/i.test(command)) {
    return "PROCESS"
  }
  if (/\b(?:git\s+push|curl|wget|invoke-webrequest)\b/i.test(command)) return "PROCESS"
}

/**
 * Detects an LLM-authored delay loop around an observable operation. A bare
 * delay remains available for legitimate work such as a debounce test; only a
 * delay combined with a build/CI/file/transfer observation strategy is
 * rejected. Runtime operations must subscribe to events instead.
 */
export function eventWaitViolation(command: string): string | undefined {
  if (!DELAY_COMMAND.test(command) || !OBSERVABLE_OPERATION.test(command)) return
  return "USE_EVENT_WAIT: do not use sleep/Start-Sleep/timeout/ping to wait for build, CI, file, or transfer state. Register an event-driven operation instead."
}
