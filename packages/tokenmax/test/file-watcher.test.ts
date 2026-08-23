import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  diffDirectorySnapshot,
  TransferWatcher,
  watchDirectory,
  type FileEvent,
  type TransferListenerFailure,
} from "../src/file-watcher"
import { FakeClock } from "./support/fake-clock"

describe("diffDirectorySnapshot (pure classification, no real filesystem timing)", () => {
  const dir = "/repo"

  it("a name present only in the new snapshot is FILE_CREATED", () => {
    const events = diffDirectorySnapshot(dir, new Map(), new Map([["a.txt", 1]]), 100)
    expect(events).toEqual([{ kind: "FILE_CREATED", path: "/repo/a.txt", at: 100 }])
  })

  it("a name present only in the old snapshot is FILE_DELETED", () => {
    const events = diffDirectorySnapshot(dir, new Map([["a.txt", 1]]), new Map(), 100)
    expect(events).toEqual([{ kind: "FILE_DELETED", path: "/repo/a.txt", at: 100 }])
  })

  it("a changed mtime on the same name is FILE_CHANGED", () => {
    const events = diffDirectorySnapshot(dir, new Map([["a.txt", 1]]), new Map([["a.txt", 2]]), 100)
    expect(events).toEqual([{ kind: "FILE_CHANGED", path: "/repo/a.txt", at: 100 }])
  })

  it("one name disappearing and exactly one appearing in the same tick is FILE_RENAMED, not delete+create", () => {
    const events = diffDirectorySnapshot(dir, new Map([["old.txt", 1]]), new Map([["new.txt", 1]]), 100)
    expect(events).toEqual([{ kind: "FILE_RENAMED", path: "/repo/new.txt", previousPath: "/repo/old.txt", at: 100 }])
  })

  it("two simultaneous adds and one removal is not misclassified as a rename", () => {
    const events = diffDirectorySnapshot(
      dir,
      new Map([["old.txt", 1]]),
      new Map([
        ["a.txt", 1],
        ["b.txt", 1],
      ]),
      100,
    )
    const kinds = events.map((event) => event.kind).sort()
    expect(kinds).toEqual(["FILE_CREATED", "FILE_CREATED", "FILE_DELETED"])
  })

  it("no difference produces no events", () => {
    expect(diffDirectorySnapshot(dir, new Map([["a.txt", 1]]), new Map([["a.txt", 1]]), 100)).toEqual([])
  })
})

describe("watchDirectory (real fs.watch wiring smoke test)", () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it("delivers a FILE_CREATED event when a file is actually written to the watched directory", async () => {
    dir = mkdtempSync(join(tmpdir(), "tokenmax-filewatch-"))
    const events: FileEvent[] = []
    const stop = watchDirectory(dir, (event) => events.push(event))
    try {
      writeFileSync(join(dir, "new-file.txt"), "hello")
      await waitFor(() => events.length > 0, 2000)
      expect(events.some((event) => event.kind === "FILE_CREATED" && event.path.endsWith("new-file.txt"))).toBe(true)
    } finally {
      stop()
    }
  })
})

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  if (predicate()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() > deadline) {
        reject(new Error("timed out waiting for filesystem event"))
        return
      }
      setTimeout(check, 20)
    }
    check()
  })
}

describe("TransferWatcher", () => {
  it("§24: STARTED -> PROGRESS -> COMPLETED, with byte counts along the way", () => {
    const clock = new FakeClock()
    const watcher = new TransferWatcher(clock)
    const started = watcher.start("t1", 100)
    expect(started).toMatchObject({ state: "STARTED", bytesTransferred: 0, totalBytes: 100 })

    clock.advance(10)
    expect(watcher.progress("t1", 40)).toMatchObject({ state: "PROGRESS", bytesTransferred: 40 })
    clock.advance(10)
    expect(watcher.progress("t1", 100)).toMatchObject({ state: "PROGRESS", bytesTransferred: 100 })

    const completed = watcher.complete("t1")
    expect(completed?.state).toBe("COMPLETED")
  })

  it("FAILED carries the error and is terminal", () => {
    const watcher = new TransferWatcher()
    watcher.start("t1")
    const failed = watcher.fail("t1", new Error("connection reset"))
    expect(failed?.state).toBe("FAILED")
    expect((failed!.error as Error).message).toBe("connection reset")
  })

  it("never resurrects a terminal transfer (no orphaned STARTED with a later contradictory update)", () => {
    const watcher = new TransferWatcher()
    watcher.start("t1")
    watcher.complete("t1")
    const afterProgress = watcher.progress("t1", 999)
    const afterFail = watcher.fail("t1", "too late")
    expect(afterProgress?.state).toBe("COMPLETED")
    expect(afterFail?.state).toBe("COMPLETED")
  })

  it("notifies subscribers on every transition and isolates a throwing listener", () => {
    const watcher = new TransferWatcher()
    watcher.start("t1")
    const seen: string[] = []
    watcher.subscribe("t1", () => {
      throw new Error("bad listener")
    })
    watcher.subscribe("t1", (snapshot) => seen.push(snapshot.state))
    expect(() => watcher.progress("t1", 5)).not.toThrow()
    watcher.complete("t1")
    expect(seen).toEqual(["PROGRESS", "COMPLETED"])
  })

  it("isolation is not silence: a throwing listener is reported to the optional error sink", () => {
    const failures: TransferListenerFailure[] = []
    const watcher = new TransferWatcher(new FakeClock(), (failure) => failures.push(failure))
    watcher.start("t1")
    watcher.subscribe("t1", () => {
      throw new Error("bad listener")
    })
    watcher.progress("t1", 5)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.transferId).toBe("t1")
    expect((failures[0]!.error as Error).message).toBe("bad listener")
  })

  it("starting a duplicate id throws", () => {
    const watcher = new TransferWatcher()
    watcher.start("t1")
    expect(() => watcher.start("t1")).toThrow()
  })
})
