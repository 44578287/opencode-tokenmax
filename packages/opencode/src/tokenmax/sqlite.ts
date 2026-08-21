import { DatabaseSync } from "node:sqlite"

type SqlValue = null | number | bigint | string | Uint8Array

export interface SqliteDb {
  exec(sql: string): void
  run(sql: string, params?: unknown[]): void
  query(sql: string): {
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
  close(): void
}

function values(params: unknown[]): SqlValue[] {
  return params.map((value) => {
    if (value === undefined) return null
    if (value === null || typeof value === "number" || typeof value === "bigint" || typeof value === "string") return value
    if (value instanceof Uint8Array) return value
    if (typeof value === "boolean") return value ? 1 : 0
    return String(value)
  })
}

export function openSqlite(file: string): SqliteDb {
  const db = new DatabaseSync(file)
  return {
    exec(sql) {
      db.exec(sql)
    },
    run(sql, params = []) {
      const bound = values(params)
      if (bound.length === 0) {
        db.exec(sql)
        return
      }
      db.prepare(sql).run(...bound)
    },
    query(sql) {
      return {
        get: (...params: unknown[]) => db.prepare(sql).get(...values(params)),
        all: (...params: unknown[]) => db.prepare(sql).all(...values(params)) as unknown[],
      }
    },
    close() {
      db.close()
    },
  }
}
