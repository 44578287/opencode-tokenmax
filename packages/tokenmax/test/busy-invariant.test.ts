import { describe, expect, it } from "bun:test"
import { checkOrphanBusy, enforceBusyInvariant } from "../src/busy-invariant"
import { OperationManager } from "../src/operation-manager"
import { FakeClock } from "./support/fake-clock"

function fakeOwner(initiallyBusy: boolean, initialProcessorCount = 0) {
  let busy = initiallyBusy
  let processorCount = initialProcessorCount
  const idleReasons: string[] = []
  return {
    owner: {
      id: "s1",
      isBusy: () => busy,
      activeProcessorCount: () => processorCount,
      markIdle: (reason: string) => {
        busy = false
        idleReasons.push(reason)
      },
    },
    idleReasons,
    setProcessorCount: (count: number) => {
      processorCount = count
    },
  }
}

describe("busy invariant", () => {
  it("regression 3.6: BUSY with zero processors AND zero operations is ORPHAN_BUSY", () => {
    const manager = new OperationManager(new FakeClock())
    const { owner } = fakeOwner(true)
    const result = checkOrphanBusy(owner, manager, { session: "s1" })
    expect(result).toEqual({ orphan: true, activeOperationCount: 0, activeProcessorCount: 0 })
  })

  it("BUSY with an active operation for the same owner is not orphaned", () => {
    const manager = new OperationManager(new FakeClock())
    manager.start({ id: "op1", type: "test", owner: { session: "s1" } })
    const { owner } = fakeOwner(true)
    expect(checkOrphanBusy(owner, manager, { session: "s1" })).toEqual({
      orphan: false,
      activeOperationCount: 1,
      activeProcessorCount: 0,
    })
  })

  it("a live SessionProcessor with zero Operations must NOT be misjudged as orphaned", () => {
    // This is exactly the case the old (Operation-only) check got wrong: a normal in-flight
    // turn whose work isn't Operation-tracked yet (e.g. still streaming) is healthy BUSY.
    const manager = new OperationManager(new FakeClock())
    const { owner } = fakeOwner(true, 1)
    expect(checkOrphanBusy(owner, manager, { session: "s1" })).toEqual({
      orphan: false,
      activeOperationCount: 0,
      activeProcessorCount: 1,
    })
  })

  it("either a processor or an Operation alone is enough to rescue BUSY from orphan status", () => {
    const manager = new OperationManager(new FakeClock())
    manager.start({ id: "op1", type: "test", owner: { session: "s1" } })
    const { owner } = fakeOwner(true, 0)
    expect(checkOrphanBusy(owner, manager, { session: "s1" }).orphan).toBe(false)
  })

  it("only BOTH zero processors and zero operations is ORPHAN_BUSY", () => {
    const manager = new OperationManager(new FakeClock())
    const { owner, setProcessorCount } = fakeOwner(true, 2)
    expect(checkOrphanBusy(owner, manager, { session: "s1" }).orphan).toBe(false)
    setProcessorCount(0)
    expect(checkOrphanBusy(owner, manager, { session: "s1" }).orphan).toBe(true)
  })

  it("an active operation belonging to a different session does not rescue this owner", () => {
    const manager = new OperationManager(new FakeClock())
    manager.start({ id: "op1", type: "test", owner: { session: "other" } })
    const { owner } = fakeOwner(true)
    expect(checkOrphanBusy(owner, manager, { session: "s1" }).orphan).toBe(true)
  })

  it("IDLE owners are never flagged, processors/operations or not", () => {
    const manager = new OperationManager(new FakeClock())
    const { owner } = fakeOwner(false, 3)
    expect(checkOrphanBusy(owner, manager, { session: "s1" }).orphan).toBe(false)
  })

  it("enforceBusyInvariant actually corrects ORPHAN_BUSY back to idle", () => {
    const manager = new OperationManager(new FakeClock())
    const { owner, idleReasons } = fakeOwner(true)
    const result = enforceBusyInvariant(owner, manager, { session: "s1" })
    expect(result.orphan).toBe(true)
    expect(owner.isBusy()).toBe(false)
    expect(idleReasons).toHaveLength(1)
    expect(idleReasons[0]).toContain("ORPHAN_BUSY")
  })

  it("enforceBusyInvariant leaves a healthy BUSY owner (via Operation) untouched", () => {
    const manager = new OperationManager(new FakeClock())
    manager.start({ id: "op1", type: "test", owner: { session: "s1" } })
    const { owner, idleReasons } = fakeOwner(true)
    enforceBusyInvariant(owner, manager, { session: "s1" })
    expect(owner.isBusy()).toBe(true)
    expect(idleReasons).toHaveLength(0)
  })

  it("enforceBusyInvariant leaves a healthy BUSY owner (via processor only) untouched", () => {
    const manager = new OperationManager(new FakeClock())
    const { owner, idleReasons } = fakeOwner(true, 1)
    enforceBusyInvariant(owner, manager, { session: "s1" })
    expect(owner.isBusy()).toBe(true)
    expect(idleReasons).toHaveLength(0)
  })
})
