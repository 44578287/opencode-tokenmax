import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { classifyText, planJobs, fallbackJob, groupPhases } from "../../src/tokenmax/plan"
import { loadPolicy, policyPath, resetPolicyCache } from "../../src/tokenmax/policy"
import { POLICY_SEED } from "../../src/tokenmax/policy.seed"
import { buildContextPackage } from "../../src/tokenmax/context"
import { upsertWorker, listWorkers, cancelRunning } from "../../src/tokenmax/workers"
import { openStore } from "../../src/tokenmax/persist"
import { classifyError, ErrorClass, affectsCapability } from "../../src/tokenmax/error"
import type { Route } from "../../src/tokenmax/types"

const route = (partial: Partial<Route> & Pick<Route, "providerId" | "modelId">): Route => ({
  variant: "",
  billing: "FREE",
  availability: "VERIFIED_CALLABLE",
  costKnown: true,
  monetaryFree: true,
  inputPerMtok: 0,
  outputPerMtok: 0,
  reasoning: false,
  tools: true,
  vision: false,
  contextLimit: 128000,
  health: 1,
  quotaPressure: null,
  ...partial,
})

const routes: Route[] = [
  route({ providerId: "opencode", modelId: "hy3-free", health: 0.8 }),
  route({
    providerId: "xai",
    modelId: "grok-build-0.1",
    billing: "SUBSCRIPTION_QUOTA",
    monetaryFree: false,
    health: 0.9,
  }),
  route({
    providerId: "openai",
    modelId: "gpt-5.3-codex-spark",
    billing: "SUBSCRIPTION_QUOTA",
    monetaryFree: false,
    health: 0.85,
  }),
  route({
    providerId: "anthropic",
    modelId: "claude-sonnet-5",
    billing: "PAYG_TOKEN",
    monetaryFree: false,
    inputPerMtok: 3,
    health: 0.99,
  }),
]

describe("tokenmax phase2 plan", () => {
  test("simple task does not spawn workers", () => {
    const policy = POLICY_SEED
    const c = classifyText("hi", policy)
    expect(c.spawn).toBe(false)
    expect(
      planJobs({
        text: "hi",
        routes,
        policy,
        enabled: true,
        hasExistingSubtasks: false,
        isChildSession: false,
      }),
    ).toEqual([])
  })

  test("complex task plans search/exec/verify with real model keys", () => {
    const jobs = planJobs({
      text: "Implement and debug this architecture refactor across modules then verify tests",
      routes,
      policy: POLICY_SEED,
      enabled: true,
      hasExistingSubtasks: false,
      isChildSession: false,
    })
    expect(jobs.length).toBeGreaterThan(0)
    expect(jobs.some((j) => j.role === "search")).toBe(true)
    expect(jobs.some((j) => j.role === "exec" || j.role === "debug")).toBe(true)
    for (const job of jobs) {
      expect(job.decision.provider.length).toBeGreaterThan(0)
      expect(job.decision.model.length).toBeGreaterThan(0)
      expect(job.decision.billing).not.toBe("PAYG_TOKEN")
      expect(job.agent.startsWith("tokenmax-")).toBe(true)
    }
    const phases = groupPhases(jobs, POLICY_SEED)
    const writers = phases.flat().filter((j) => j.role === "exec" || j.role === "debug")
    expect(writers.length).toBeLessThanOrEqual(1)
  })

  test("existing subtasks / child session skip dispatch (OmO)", () => {
    expect(
      planJobs({
        text: "Implement and debug this architecture refactor across modules then verify tests",
        routes,
        policy: POLICY_SEED,
        enabled: true,
        hasExistingSubtasks: true,
        isChildSession: false,
      }),
    ).toEqual([])
    expect(
      planJobs({
        text: "Implement and debug this architecture refactor across modules then verify tests",
        routes,
        policy: POLICY_SEED,
        enabled: true,
        hasExistingSubtasks: false,
        isChildSession: true,
      }),
    ).toEqual([])
  })

  test("user text snapshot is not used as child-only payload", () => {
    const original = "继续"
    const pkg = buildContextPackage({
      objective: "finish the refactor",
      currentTask: original,
      history: [
        { role: "user", text: "Implement the auth router" },
        { role: "assistant", text: "I started on src/auth.ts" },
      ],
      previousResults: ["search: src/auth.ts:12"],
      policy: POLICY_SEED,
    })
    expect(pkg.includes("finish the refactor")).toBe(true)
    expect(pkg.includes("src/auth.ts")).toBe(true)
    expect(pkg.includes("TOKENMAX CONTEXT PACKAGE")).toBe(true)
    expect(original).toBe("继续")
  })

  test("provider failure fallback skips failed key and PAYG", () => {
    const planned = planJobs({
      text: "Implement and debug this architecture refactor across modules then verify tests",
      routes,
      policy: POLICY_SEED,
      enabled: true,
      hasExistingSubtasks: false,
      isChildSession: false,
    })
    const job = planned[0]
    expect(job).toBeTruthy()
    if (!job) throw new Error("expected job")
    const next = fallbackJob(job, { routes, policy: POLICY_SEED, skipKeys: [job.decision.key] })
    expect(next).toBeTruthy()
    expect(next!.decision.key).not.toBe(job.decision.key)
    expect(next!.decision.billing).not.toBe("PAYG_TOKEN")
  })
})

describe("tokenmax phase2 workers lifecycle", () => {
  test("no zombie running after cancel", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenmax-"))
    const store = openStore({ dataDir: dir })
    upsertWorker(store.db, {
      id: "w1",
      parentSessionID: "ses_root",
      childSessionID: "ses_child",
      role: "search",
      provider: "opencode",
      model: "hy3-free",
      variant: "",
      billing: "FREE",
      state: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      fallbackFrom: null,
      errorCategory: null,
    })
    cancelRunning(store.db, "ses_root")
    const list = listWorkers(store.db, "ses_root")
    expect(list[0].state).toBe("cancelled")
    expect(list[0].childSessionID).toBe("ses_child")
    expect(list[0].parentSessionID).toBe("ses_root")
    store.close()
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  })
})

describe("tokenmax phase2 policy hot reload", () => {
  test("invalid policy keeps previous", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenmax-"))
    resetPolicyCache()
    const first = loadPolicy(dir)
    expect(first.scoring.missPenalty).toBe(2)
    fs.writeFileSync(policyPath(dir), "{not json")
    const second = loadPolicy(dir)
    expect(second.scoring.missPenalty).toBe(first.scoring.missPenalty)
    fs.writeFileSync(
      policyPath(dir),
      JSON.stringify({ ...first, scoring: { ...first.scoring, missPenalty: 9 } }, null, 2),
    )
    const third = loadPolicy(dir)
    expect(third.scoring.missPenalty).toBe(9)
    resetPolicyCache()
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  })
})

describe("tokenmax phase2 errors", () => {
  test("429 does not affect capability", () => {
    expect(classifyError("429 rate limit")).toBe(ErrorClass.RATE_LIMIT_429)
    expect(affectsCapability(ErrorClass.RATE_LIMIT_429, false)).toBe(false)
    expect(classifyError("permission denied")).toBe(ErrorClass.PERMISSION_DENIED)
  })
})
