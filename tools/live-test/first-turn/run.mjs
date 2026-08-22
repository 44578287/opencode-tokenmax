import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const oc = process.env.OPENCODE_BIN || "opencode"
const root = process.env.FIRST_TURN_DIR || join(process.env.TEMP || "/tmp", "opencode-first-turn")
mkdirSync(root, { recursive: true })

const cases = [
  ...Array.from({ length: 20 }, (_, i) => ({
    name: `first-${i + 1}`,
    prompt: "只回复 OK",
    expect: /OK/i,
    pure: true,
  })),
  ...Array.from({ length: 20 }, (_, i) => ({
    name: `short-${i + 1}`,
    prompt: ["hi", "ok", "谢谢", "只回复 1"][i % 4],
    expect: /.+/,
    pure: true,
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    name: `code-${i + 1}`,
    prompt: "Do not edit files. Reply with exactly READONLY.",
    expect: /READONLY/i,
    pure: true,
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    name: `legacy-${i + 1}`,
    prompt: "只回复 OK",
    expect: /OK/i,
    pure: false,
  })),
]

function runOne(item) {
  const args = ["run", "--format", "default"]
  if (item.pure) args.push("--pure")
  if (process.env.FIRST_TURN_MODEL) args.push("--model", process.env.FIRST_TURN_MODEL)
  args.push("--title", item.name, item.prompt)
  const started = Date.now()
  const r = spawnSync(oc, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, OPENCODE_PURE: item.pure ? "1" : "0" },
    shell: process.platform === "win32",
  })
  const out = `${r.stdout || ""}\n${r.stderr || ""}`
  const ms = Date.now() - started
  const bad =
    /InvalidDurableEvent|prompt_async failed|Failed to fetch|Continue the current task\. Do not ask the user to switch models\./.test(
      out,
    )
  const ok = r.status === 0 && item.expect.test(out) && !bad && ms < 90_000
  return { name: item.name, ok, ms, status: r.status, snippet: out.slice(0, 240).replace(/\s+/g, " ") }
}

const results = []
for (const item of cases) results.push(runOne(item))

const groups = {
  first: results.filter((r) => r.name.startsWith("first-")),
  short: results.filter((r) => r.name.startsWith("short-")),
  code: results.filter((r) => r.name.startsWith("code-")),
  legacy: results.filter((r) => r.name.startsWith("legacy-")),
}
const summary = {
  first: `${groups.first.filter((r) => r.ok).length}/${groups.first.length}`,
  short: `${groups.short.filter((r) => r.ok).length}/${groups.short.length}`,
  code: `${groups.code.filter((r) => r.ok).length}/${groups.code.length}`,
  legacy: `${groups.legacy.filter((r) => r.ok).length}/${groups.legacy.length}`,
  failed: results.filter((r) => !r.ok),
}
const report = join(root, "first-turn-report.json")
writeFileSync(report, JSON.stringify({ summary, results }, null, 2))
console.log(JSON.stringify({ summary, report }, null, 2))
if (results.some((r) => !r.ok)) process.exit(1)
