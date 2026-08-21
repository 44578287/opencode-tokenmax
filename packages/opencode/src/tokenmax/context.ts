import type { TokenMaxPolicy } from "./policy.seed"
import type { PlannedJob } from "./plan"

export interface HistoryTurn {
  role: string
  text: string
}

export function buildContextPackage(opts: {
  objective: string
  currentTask: string
  workspace?: string
  history: HistoryTurn[]
  previousResults: string[]
  constraints?: string[]
  policy: TokenMaxPolicy
}): string {
  const hist = opts.history
    .slice(-opts.policy.context.maxHistoryMessages)
    .map((h) => `${h.role}: ${h.text}`)
    .join("\n")
    .slice(0, Math.floor(opts.policy.context.maxChars * 0.5))
  const prev = opts.previousResults.join("\n---\n").slice(0, Math.floor(opts.policy.context.maxChars * 0.3))
  const body = [
    "TOKENMAX CONTEXT PACKAGE",
    `objective: ${opts.objective}`,
    `current_task: ${opts.currentTask}`,
    opts.workspace ? `workspace: ${opts.workspace}` : "",
    "completed_work:",
    prev || "(none)",
    "pending_work: follow current_task",
    "relevant_files: use search results; do not assume",
    "relevant_errors: see history",
    "previous_worker_results:",
    prev || "(none)",
    "constraints:",
    ...(opts.constraints ?? ["do not modify the user's original message", "do not spend PAYG unless policy allows"]),
    "PARENT HISTORY (truncated):",
    hist || "(none)",
  ]
    .filter(Boolean)
    .join("\n")
  return body.slice(0, opts.policy.context.maxChars)
}

export function childPrompt(job: PlannedJob, pkg: string, workerPrompt: string): string {
  return `${workerPrompt}\n\n${pkg}\n\nYOUR ROLE: ${job.role}\nDo the ${job.role} work only.`
}
