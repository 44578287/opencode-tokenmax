/**
 * BUSY invariant — §25 of the master brief.
 *
 *     Session.state === BUSY  =>  at least one active processor OR active Operation
 *
 * Both halves of that OR matter and must be checked independently:
 *
 *  - "active Operation" is whatever `OperationManager.listActive(scope)`
 *    tracks (a tool call, a child session turn, a build, ...).
 *  - "active processor" is whatever the caller's own runtime considers a
 *    live worker attached to this owner (e.g. a SessionProcessor actively
 *    streaming a provider response) — this module has no visibility into
 *    that on its own, so the caller reports it via `BusyOwner.activeProcessorCount()`.
 *
 * ORPHAN_BUSY is only real when BOTH counts are zero. A session mid-stream
 * with a live processor but no Operation registered yet (or a processor
 * whose work isn't Operation-tracked at all) is healthy BUSY, not orphaned
 * — flagging it would incorrectly kill a normal in-flight turn. This is
 * regression 3.6 (mid-run permanent BUSY) turned into an enforceable,
 * testable invariant.
 */

import type { OperationManager } from "./operation-manager"
import type { OperationOwner } from "./types"

export interface BusyOwner {
  readonly id: string
  isBusy(): boolean
  /** Live processors (e.g. SessionProcessor instances) attached to this owner right now, independent of any Operation. */
  activeProcessorCount(): number
  /** Called when this module detects ORPHAN_BUSY. Must actually flip the owner out of BUSY. */
  markIdle(reason: string): void
}

export interface OrphanBusyResult {
  readonly orphan: boolean
  readonly activeOperationCount: number
  readonly activeProcessorCount: number
}

/** Pure check — does not mutate anything. ORPHAN_BUSY requires BUSY with zero processors AND zero Operations. */
export function checkOrphanBusy(owner: BusyOwner, manager: OperationManager, scope: OperationOwner): OrphanBusyResult {
  const activeOperationCount = manager.listActive(scope).length
  const activeProcessorCount = owner.activeProcessorCount()
  const orphan = owner.isBusy() && activeOperationCount === 0 && activeProcessorCount === 0
  return { orphan, activeOperationCount, activeProcessorCount }
}

/** Checks and, if ORPHAN_BUSY is found, immediately corrects it via `owner.markIdle()`. Returns what it found. */
export function enforceBusyInvariant(
  owner: BusyOwner,
  manager: OperationManager,
  scope: OperationOwner,
): OrphanBusyResult {
  const result = checkOrphanBusy(owner, manager, scope)
  if (result.orphan) {
    owner.markIdle("ORPHAN_BUSY: session reported BUSY with zero active processors and zero active operations")
  }
  return result
}
