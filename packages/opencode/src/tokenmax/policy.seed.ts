export const POLICY_SEED: TokenMaxPolicy = {
  version: 1,
  scoring: {
    missPenalty: 2,
    moneyWeight: 0.01,
    requiredSuccess: 0.5,
  },
  classify: {
    simpleMaxChars: 280,
    complexSignals: [
      "debug",
      "race",
      "architecture",
      "refactor",
      "implement",
      "fix",
      "multi",
      "across",
      "verify",
      "test",
    ],
    searchSignals: ["search", "find", "where", "grep", "look up", "locate"],
    verifySignals: ["verify", "test", "lint", "typecheck", "review"],
  },
  concurrency: {
    search: 4,
    writer: 1,
    verify: 2,
  },
  budget: {
    paygEnabled: false,
    dailyPaygUsd: 0,
  },
  fallback: {
    maxAttempts: 3,
    skipBilling: ["PAYG_TOKEN"],
  },
  context: {
    maxChars: 6000,
    maxHistoryMessages: 8,
  },
  workers: {
    search: {
      agent: "tokenmax-search",
      prompt:
        "You are tokenmax-search. Search and map the workspace. Do not edit files. Return paths, symbols, and line references.",
    },
    exec: {
      agent: "tokenmax-exec",
      prompt: "You are tokenmax-exec. Apply mechanical edits from the plan. Stay in the listed files. Run tests if asked.",
    },
    debug: {
      agent: "tokenmax-debug",
      prompt: "You are tokenmax-debug. Diagnose root cause. Propose a minimal fix. Do not rewrite unrelated files.",
    },
    verify: {
      agent: "tokenmax-verify",
      prompt: "You are tokenmax-verify. Check the claimed work against files and tests. Report pass/fail with evidence.",
    },
  },
}

export type TokenMaxPolicy = {
  version: number
  scoring: { missPenalty: number; moneyWeight: number; requiredSuccess: number }
  classify: {
    simpleMaxChars: number
    complexSignals: string[]
    searchSignals: string[]
    verifySignals: string[]
  }
  concurrency: { search: number; writer: number; verify: number }
  budget: { paygEnabled: boolean; dailyPaygUsd: number }
  fallback: { maxAttempts: number; skipBilling: string[] }
  context: { maxChars: number; maxHistoryMessages: number }
  workers: Record<string, { agent: string; prompt: string }>
}
