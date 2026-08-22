import fs from "fs"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppProcess } from "@opencode-ai/core/process"
import { OperationManager, runProcessOperation } from "../src/tokenmax/operation"
import { openStore } from "../src/tokenmax/persist"

const workdir = path.resolve(import.meta.dir, "..")
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenmax-dogfood-"))
const store = openStore({ dataDir })
const manager = new OperationManager(store)
const operation = manager.start({
  type: "PROCESS",
  ownerSessionID: "dogfood-event-runtime",
  ownerRunID: null,
  ownerWorkerID: null,
  ownerDagNode: "opencode-typecheck",
  deadlineAt: null,
  activeHandle: null,
})

try {
  const result = await Effect.runPromise(
    Effect.scoped(
      runProcessOperation({
        manager,
        operation,
        command: ChildProcess.make(process.execPath, ["run", "typecheck"], { cwd: workdir, stdin: "ignore" }),
        likelyFailure: /(?:error TS\d+|fatal error|BUILD FAILED|Compilation failed)/i,
      }),
    ).pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([AppProcess.node])))),
  )
  process.stdout.write(JSON.stringify({ operation: result.id, state: result.state, result: result.result }) + "\n")
  if (result.state !== "COMPLETED") process.exitCode = 1
} finally {
  store.close()
  try {
    fs.rmSync(dataDir, { recursive: true, force: true })
  } catch {}
}
