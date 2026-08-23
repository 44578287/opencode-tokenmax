import { describe, expect, it } from "bun:test"
import { checkOrphanBusy, enforceBusyInvariant } from "../src/busy-invariant"
import { OperationManager } from "../src/operation-manager"
import { FakeClock } from "./support/fake-clock"

function fakeOwner(initiallyBusy: boolean) {
  let busy = initiallyBusy
  const idleReasons: string[] = []
  return {
    owner: {
      id: "s1",
      isBusy: () => busy,
      markIdle: (reason: string) => {
        busy = false
        idleReasons.push(reason)
      },
    },
    idleReasons,
  }
}

describe("busy invariant", () => {
  it("regression 3.6: BUSY with zero active operations is ORPHAN_BUSY", () => {
    const manager = new OperationManager(new FakeClock())
    const { owner } = fakeOwner(true)
    const result = checkOrphanBusy(owner, manager, { session: "s1" })
    expect(result).toEqual({ orphan: true, activeOperationCount: 0 })
  })

  it("BUSY with an active operation for the same owner is not orphaned", () => {
    const manager = new OperationManager(new FakeClock())
    manager.start({ id: "op1", type: "test", owner: { session: "s1" } })
    const { owner } = fakeOwner(true)
    expect(checkOrphanBusy(owner, manager, { session: "s1" })).toEqual({ orphan: false, activeOperationCount: 1 })
  })

  it("an active operation belonging to a different session does not rescue this owner", () => {
    const manager = new OperationManager(new FakeClock())
    manager.start({ id: "op1", type: "test", owner: { session: "other" } })
    const { owner } = fakeOwner(true)
    expect(checkOrphanBusy(owner, manager, { session: "s1" }).orphan).toBe(true)
  })

  it("IDLE owners are never flagged, active operations or not", () => {
    const manager = new OperationManager(new FakeClock())
    const { owner } = fakeOwner(false)
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

  it("enforceBusyInvariant leaves a healthy BUSY owner untouched", () => {
    const manager = new OperationManager(new FakeClock())
    manager.start({ id: "op1", type: "test", owner: { session: "s1" } })
    const { owner, idleReasons } = fakeOwner(true)
    enforceBusyInvariant(owner, manager, { session: "s1" })
    expect(owner.isBusy()).toBe(true)
    expect(idleReasons).toHaveLength(0)
  })
})
