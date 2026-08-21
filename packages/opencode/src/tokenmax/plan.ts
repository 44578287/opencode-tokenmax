import type { Route, RouteDecision, Task } from "./types"
import { routeKey } from "./types"
import { decide } from "./router"
import type { TokenMaxPolicy } from "./policy.seed"

export type WorkerRole = "search" | "exec" | "debug" | "verify"

export interface PlannedJob {
  role: WorkerRole
  agent: string
  decision: RouteDecision
  description: string
}

export function classifyText(text: string, policy: TokenMaxPolicy): Task & { spawn: boolean; roles: WorkerRole[] } {
  const t = text.trim()
  const lower = t.toLowerCase()
  const hit = (xs: string[]) => xs.some((s) => lower.includes(s))
  const complex = t.length > policy.classify.simpleMaxChars || hit(policy.classify.complexSignals)
  const roles: WorkerRole[] = []
  if (!complex) {
    return { text: t, complexity: "low", spawn: false, roles, requiredSuccess: policy.scoring.requiredSuccess }
  }
  if (hit(policy.classify.searchSignals) || complex) roles.push("search")
  if (hit(policy.classify.complexSignals.filter((s) => s === "debug" || s === "race"))) roles.push("debug")
  else roles.push("exec")
  if (hit(policy.classify.verifySignals) || complex) roles.push("verify")
  const uniq = [...new Set(roles)]
  return {
    text: t,
    complexity: "high",
    spawn: uniq.length > 0,
    roles: uniq,
    requiredSuccess: policy.scoring.requiredSuccess,
  }
}

export function planJobs(opts: {
  text: string
  routes: Route[]
  policy: TokenMaxPolicy
  enabled: boolean
  hasExistingSubtasks: boolean
  isChildSession: boolean
  skipKeys?: string[]
}): PlannedJob[] {
  if (!opts.enabled || opts.hasExistingSubtasks || opts.isChildSession) return []
  const classified = classifyText(opts.text, opts.policy)
  if (!classified.spawn) return []
  const skip = new Set(opts.skipKeys ?? [])
  const skipBilling = new Set(opts.policy.fallback.skipBilling)
  if (!opts.policy.budget.paygEnabled) skipBilling.add("PAYG_TOKEN")
  const available = opts.routes.filter((r) => !skip.has(routeKey(r.providerId, r.modelId, r.variant)) && !skipBilling.has(r.billing))
  const jobs: PlannedJob[] = []
  for (const role of classified.roles) {
    const task: Task = { ...classified, taskClass: role }
    const decision = decide(task, { enabled: true, routes: available, policy: opts.policy })
    if (!decision) continue
    const spec = opts.policy.workers[role]
    jobs.push({
      role,
      agent: spec?.agent ?? `tokenmax-${role}`,
      decision,
      description: role,
    })
  }
  return jobs
}

export function fallbackJob(
  job: PlannedJob,
  opts: { routes: Route[]; policy: TokenMaxPolicy; skipKeys: string[] },
): PlannedJob | null {
  const skip = new Set([...opts.skipKeys, job.decision.key])
  const skipBilling = new Set(opts.policy.fallback.skipBilling)
  if (!opts.policy.budget.paygEnabled) skipBilling.add("PAYG_TOKEN")
  const available = opts.routes.filter(
    (r) => !skip.has(routeKey(r.providerId, r.modelId, r.variant)) && !skipBilling.has(r.billing),
  )
  const decision = decide({ text: job.role, taskClass: job.role, complexity: "high" }, { enabled: true, routes: available, policy: opts.policy })
  if (!decision) return null
  return {
    ...job,
    decision: { ...decision, reason: `fallback from ${job.decision.key}` },
  }
}

export function groupPhases(jobs: PlannedJob[], policy: TokenMaxPolicy): PlannedJob[][] {
  const search = jobs.filter((j) => j.role === "search")
  const writer = jobs.filter((j) => j.role === "exec" || j.role === "debug").slice(0, policy.concurrency.writer)
  const verify = jobs.filter((j) => j.role === "verify")
  return [search, writer, verify].filter((p) => p.length > 0)
}
