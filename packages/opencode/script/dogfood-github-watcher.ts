import fs from "fs"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppProcess } from "@opencode-ai/core/process"
import { OperationManager, runGitHubActionsOperation, startGitHubActionsOperation } from "../src/tokenmax/operation"
import { openStore } from "../src/tokenmax/persist"

const runID = process.argv[2]
if (!runID) throw new Error("Usage: bun script/dogfood-github-watcher.ts <run-id>")
const repo = process.env.GH_REPO
if (!repo) throw new Error("Set GH_REPO=owner/repo for GitHub Actions watching")

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenmax-gh-watch-"))
const store = openStore({ dataDir })
const manager = new OperationManager(store)
const operation = startGitHubActionsOperation(manager, {
  runID,
  ownerSessionID: "dogfood-github-actions",
  ownerRunID: runID,
  ownerWorkerID: null,
  ownerDagNode: "github-ci",
  deadlineAt: null,
})

try {
  const result = await Effect.runPromise(
    Effect.scoped(runGitHubActionsOperation({ manager, operation, runID, repo })).pipe(
      Effect.provide(AppNodeBuilder.build(LayerNode.group([AppProcess.node]))),
    ),
  )
  process.stdout.write(JSON.stringify({ operation: result.id, state: result.state, result: result.result, error: result.error }) + "\n")
  if (result.state !== "COMPLETED") process.exitCode = 1
} finally {
  store.close()
  try {
    fs.rmSync(dataDir, { recursive: true, force: true })
  } catch {}
}
