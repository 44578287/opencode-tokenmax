import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppProcess } from "@opencode-ai/core/process"
import { ChildProcess } from "effect/unstable/process"
import { Effect } from "effect"
import {
  OperationManager,
  activeOperations,
  getOperation,
  githubWatchCommand,
  recoverOrphanOperations,
  runProcessOperation,
  startFileOperation,
} from "../../src/tokenmax/operation"
import { openStore } from "../../src/tokenmax/persist"

const dirs: string[] = []
function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenmax-operation-"))
  dirs.push(dir)
  return openStore({ dataDir: dir })
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    // node:sqlite can release Windows file handles just after close(). Other
    // TokenMax persistence tests use the same best-effort cleanup pattern.
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
})

describe("TokenMax OperationManager", () => {
  test("GitHub Actions watcher is one long-lived event process, not an LLM poll loop", () => {
    const command = githubWatchCommand("32500407070", "C:/work", "44578287/opencode-tokenmax")
    expect(command).toMatchObject({
      command: "gh",
      args: ["run", "watch", "32500407070", "--exit-status", "--repo", "44578287/opencode-tokenmax"],
    })
  })

  test("direct process exit settles immediately even while output collection is independent", async () => {
    const db = store()
    const manager = new OperationManager(db)
    const operation = manager.start({
      type: "PROCESS",
      ownerSessionID: "ses_build",
      ownerRunID: "run_build",
      ownerWorkerID: null,
      ownerDagNode: "build",
      deadlineAt: null,
      activeHandle: null,
    })
    const program = Effect.scoped(
      runProcessOperation({
        manager,
        operation,
        command: ChildProcess.make(process.execPath, ["-e", "console.error('error TS9999'); process.exit(1)"], {
          stdin: "ignore",
        }),
        likelyFailure: /error TS\d+/i,
      }),
    ).pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([AppProcess.node]))))
    const result = await Effect.runPromise(program)
    expect(result.state).toBe("FAILED")
    expect(result.error?.exitCode).toBe(1)
    const events = db.db.query("SELECT kind FROM operation_events WHERE operation_id=?").all(operation.id) as Array<{ kind: string }>
    expect(events.map((event) => event.kind)).toContain("PROCESS_EXIT")
    expect(events.map((event) => event.kind)).toContain("PROCESS_PROBABLE_FAILURE")
    db.close()
  })

  test("file creation wakes a waiting operation through a filesystem event", async () => {
    const db = store()
    const manager = new OperationManager(db)
    const dir = path.join(path.dirname(db.dbPath), "watch")
    fs.mkdirSync(dir, { recursive: true })
    const registered = startFileOperation(manager, {
      ownerSessionID: "ses_file",
      ownerRunID: null,
      ownerWorkerID: null,
      ownerDagNode: "artifact",
      deadlineAt: null,
      directory: dir,
      target: "app.exe",
    })
    const waiting = manager.await(registered.operation.id)
    fs.writeFileSync(path.join(dir, "app.exe"), "artifact")
    const completed = await waiting
    expect(completed.state).toBe("COMPLETED")
    expect(completed.result?.event).toBe("FILE_CREATED")
    registered.close()
    db.close()
  })

  test("process failure transitions immediately and wakes awaiters", async () => {
    const db = store()
    const manager = new OperationManager(db)
    const operation = manager.start({
      type: "PROCESS",
      ownerSessionID: "ses_root",
      ownerRunID: "run_1",
      ownerWorkerID: null,
      ownerDagNode: "build",
      deadlineAt: null,
      activeHandle: null,
    })
    const waiting = manager.await(operation.id)
    manager.progress(operation.id, "PROCESS_STDERR", { line: "error TS1234" })
    const failed = manager.fail(operation.id, { exitCode: 1, category: "PROCESS_EXIT" })
    expect(failed?.state).toBe("FAILED")
    expect((await waiting).error?.category).toBe("PROCESS_EXIT")
    expect(activeOperations(db, "ses_root")).toEqual([])
    db.close()
  })

  test("waiting file operation resumes only from an observed event", async () => {
    const db = store()
    const manager = new OperationManager(db)
    const operation = manager.start({
      type: "FILE",
      ownerSessionID: "ses_root",
      ownerRunID: null,
      ownerWorkerID: null,
      ownerDagNode: "artifact",
      deadlineAt: null,
      activeHandle: "dist/app.exe",
    })
    manager.resume(operation.id)
    expect(getOperation(db, operation.id)?.state).toBe("RUNNING")
    const waiting = manager.await(operation.id)
    manager.complete(operation.id, { event: "FILE_CREATED", path: "dist/app.exe" })
    expect((await waiting).result?.event).toBe("FILE_CREATED")
    db.close()
  })

  test("deadline inspection never leaves an operation permanently pending", () => {
    const db = store()
    const manager = new OperationManager(db)
    const operation = manager.start({
      type: "PROCESS",
      ownerSessionID: "ses_root",
      ownerRunID: null,
      ownerWorkerID: null,
      ownerDagNode: "stalled",
      deadlineAt: new Date(Date.now() - 1).toISOString(),
      activeHandle: "123",
    })
    expect(manager.inspect()).toHaveLength(1)
    expect(getOperation(db, operation.id)?.state).toBe("TIMED_OUT")
    db.close()
  })

  test("orphan active operation is cancelled when owner is no longer BUSY", () => {
    const db = store()
    const manager = new OperationManager(db)
    const operation = manager.start({
      type: "CHILD_WORKER",
      ownerSessionID: "ses_orphan",
      ownerRunID: null,
      ownerWorkerID: "worker_1",
      ownerDagNode: "verify",
      deadlineAt: null,
      activeHandle: null,
    })
    manager.resume(operation.id)
    expect(recoverOrphanOperations(db, [])).toEqual([operation.id])
    expect(getOperation(db, operation.id)?.state).toBe("CANCELLED")
    db.close()
  })
})
