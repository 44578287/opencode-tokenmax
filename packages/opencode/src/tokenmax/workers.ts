import type { Database } from "bun:sqlite"
import type { TokenMaxWorker } from "./types"

export function upsertWorker(db: Database, worker: TokenMaxWorker) {
  db.run(
    `INSERT INTO workers(id,parent_session_id,child_session_id,role,provider,model,variant,state,started_at,completed_at,fallback_from,error_category,billing,progress)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       child_session_id=excluded.child_session_id,
       provider=excluded.provider,
       model=excluded.model,
       variant=excluded.variant,
       state=excluded.state,
       started_at=excluded.started_at,
       completed_at=excluded.completed_at,
       fallback_from=excluded.fallback_from,
       error_category=excluded.error_category,
       billing=excluded.billing,
       progress=excluded.progress`,
    [
      worker.id,
      worker.parentSessionID,
      worker.childSessionID,
      worker.role,
      worker.provider,
      worker.model,
      worker.variant,
      worker.state,
      worker.startedAt,
      worker.completedAt,
      worker.fallbackFrom,
      worker.errorCategory,
      worker.billing ?? null,
      worker.progress ?? null,
    ],
  )
}

export function listWorkers(db: Database, parentSessionID?: string): TokenMaxWorker[] {
  const rows = parentSessionID
    ? (db.query("SELECT * FROM workers WHERE parent_session_id = ? ORDER BY started_at").all(parentSessionID) as any[])
    : (db.query("SELECT * FROM workers ORDER BY started_at DESC LIMIT 50").all() as any[])
  return rows.map(rowToWorker)
}

export function cancelRunning(db: Database, parentSessionID: string) {
  db.run(
    `UPDATE workers SET state='cancelled', completed_at=? WHERE parent_session_id=? AND state IN ('queued','running')`,
    [new Date().toISOString(), parentSessionID],
  )
}

function rowToWorker(row: any): TokenMaxWorker {
  return {
    id: row.id,
    parentSessionID: row.parent_session_id,
    childSessionID: row.child_session_id,
    role: row.role,
    provider: row.provider,
    model: row.model,
    variant: row.variant ?? "",
    billing: row.billing ?? undefined,
    progress: row.progress ?? undefined,
    state: row.state,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    fallbackFrom: row.fallback_from,
    errorCategory: row.error_category,
  }
}
