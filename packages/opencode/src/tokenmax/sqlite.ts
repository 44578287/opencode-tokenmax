import { DatabaseSync } from "node:sqlite"

export interface SqliteDb {
  exec(sql: string): void
  run(sql: string, params?: unknown[]): void
  query(sql: string): {
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
  close(): void
}

export function openSqlite(file: string): SqliteDb {
  const db = new DatabaseSync(file)
  return {
    exec(sql) {
      db.exec(sql)
    },
    run(sql, params = []) {
      if (params.length === 0) {
        db.exec(sql)
        return
      }
      db.prepare(sql).run(...params)
    },
    query(sql) {
      const stmt = db.prepare(sql)
      return {
        get: (...params: unknown[]) => stmt.get(...params),
        all: (...params: unknown[]) => stmt.all(...params) as unknown[],
      }
    },
    close() {
      db.close()
    },
  }
}
