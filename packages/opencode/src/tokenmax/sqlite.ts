import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

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
  try {
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => NodeSqlite }
    return wrapNode(new DatabaseSync(file))
  } catch {
    const spec = ["bun", "sqlite"].join(":")
    const { Database } = require(spec) as { Database: new (path: string) => BunSqlite }
    return wrapBun(new Database(file))
  }
}

interface NodeStmt {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

interface NodeSqlite {
  exec(sql: string): void
  prepare(sql: string): NodeStmt
  close(): void
}

interface BunSqlite {
  exec(sql: string): void
  run(sql: string, params?: unknown[]): unknown
  query(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] }
  close(): void
}

function wrapNode(db: NodeSqlite): SqliteDb {
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
      return {
        get: (...params: unknown[]) => db.prepare(sql).get(...params),
        all: (...params: unknown[]) => db.prepare(sql).all(...params),
      }
    },
    close() {
      db.close()
    },
  }
}

function wrapBun(db: BunSqlite): SqliteDb {
  return {
    exec(sql) {
      db.exec(sql)
    },
    run(sql, params = []) {
      if (params.length === 0) db.run(sql)
      else db.run(sql, params)
    },
    query(sql) {
      return db.query(sql)
    },
    close() {
      db.close()
    },
  }
}
