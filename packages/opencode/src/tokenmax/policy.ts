import fs from "fs"
import path from "path"
import { POLICY_SEED, type TokenMaxPolicy } from "./policy.seed"

let cached: { policy: TokenMaxPolicy; mtime: number; file: string } | undefined

export function policyPath(configDir: string) {
  return path.join(configDir, "tokenmax", "policy.json")
}

function validate(raw: unknown): TokenMaxPolicy {
  const p = raw as TokenMaxPolicy
  if (!p || typeof p !== "object") throw new Error("policy not object")
  if (!p.scoring || typeof p.scoring.missPenalty !== "number") throw new Error("policy.scoring")
  if (!p.classify || typeof p.classify.simpleMaxChars !== "number") throw new Error("policy.classify")
  if (!p.concurrency || typeof p.concurrency.writer !== "number") throw new Error("policy.concurrency")
  if (!p.budget) throw new Error("policy.budget")
  if (!p.fallback || typeof p.fallback.maxAttempts !== "number") throw new Error("policy.fallback")
  if (!p.context || typeof p.context.maxChars !== "number") throw new Error("policy.context")
  if (!p.workers || !p.workers.search) throw new Error("policy.workers")
  return p
}

export function loadPolicy(configDir: string): TokenMaxPolicy {
  const file = policyPath(configDir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(POLICY_SEED, null, 2))
  }
  const st = fs.statSync(file)
  if (cached && cached.file === file && cached.mtime === st.mtimeMs) return cached.policy
  try {
    const parsed = validate(JSON.parse(fs.readFileSync(file, "utf8")))
    cached = { policy: parsed, mtime: st.mtimeMs, file }
    return parsed
  } catch {
    if (cached && cached.file === file) return cached.policy
    const seed = validate(JSON.parse(JSON.stringify(POLICY_SEED)))
    cached = { policy: seed, mtime: st.mtimeMs, file }
    return seed
  }
}

export function resetPolicyCache() {
  cached = undefined
}
