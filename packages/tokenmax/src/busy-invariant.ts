/**
 * BUSY invariant — §25 of the master brief.
 *
 *     Session.state === BUSY  =>  at least one active processor OR active Operation
 *
 * If a session (or any other owner scope) claims BUSY while the Operation
 * Manager tracks zero active Operations for it, that is an ORPHAN_BUSY:
 * nothing is actually going to make progress, and "Continue" from the user
 * would do nothing either. This is regression 3.6 (mid-run permanent BUSY)
 * turned into an enforceable, testable invariant.
 */

import type { OperationManager } from "./operation-manager"
import type { OperationOwner } from "./types"

export interface BusyOwner {
  readonly id: string
  isBusy(): boolean
  /** Called when this module detects ORPHAN_BUSY. Must actually flip the owner out of BUSY. */
  markIdle(reason: string): void
}

export interface OrphanBusyResult {
  readonly orphan: boolean
  readonly activeOperationCount: number
}

/** Pure check — does not mutate anything. */
export function checkOrphanBusy(owner: BusyOwner, manager: OperationManager, scope: OperationOwner): OrphanBusyResult {
  const activeOperationCount = manager.listActive(scope).length
  return { orphan: owner.isBusy() && activeOperationCount === 0, activeOperationCount }
}

/** Checks and, if ORPHAN_BUSY is found, immediately corrects it via `owner.markIdle()`. Returns what it found. */
export function enforceBusyInvariant(
  owner: BusyOwner,
  manager: OperationManager,
  scope: OperationOwner,
): OrphanBusyResult {
  const result = checkOrphanBusy(owner, manager, scope)
  if (result.orphan) {
    owner.markIdle("ORPHAN_BUSY: session reported BUSY with zero active operations")
  }
  return result
}
