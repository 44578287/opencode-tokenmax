import { Database } from "bun:sqlite"
import fs from "fs"
import path from "path"
import { createHash } from "crypto"

export const NATIVE_SCHEMA_VERSION = 1

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS routes (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  billing_type TEXT DEFAULT 'UNKNOWN',
  availability TEXT DEFAULT 'UNKNOWN',
  monetary_free INTEGER DEFAULT 0,
  cost_known INTEGER DEFAULT 0,
  cost_input REAL,
  cost_output REAL,
  reasoning INTEGER DEFAULT 0,
  tools INTEGER DEFAULT 0,
  vision INTEGER DEFAULT 0,
  context_limit INTEGER,
  health REAL DEFAULT 1,
  PRIMARY KEY (provider_id, model_id, variant)
);
CREATE TABLE IF NOT EXISTS route_capabilities (
  route_key TEXT NOT NULL,
  task_class TEXT NOT NULL,
  samples INTEGER DEFAULT 0,
  success INTEGER DEFAULT 0,
  ema REAL DEFAULT 0.5,
  last_updated TEXT,
  PRIMARY KEY (route_key, task_class)
);
CREATE TABLE IF NOT EXISTS benchmark_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_key TEXT NOT NULL,
  suite TEXT,
  status TEXT,
  cases_total INTEGER DEFAULT 0,
  cases_passed INTEGER DEFAULT 0,
  results TEXT
);
CREATE TABLE IF NOT EXISTS task_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  route_key TEXT NOT NULL,
  task_class TEXT,
  status TEXT,
  error_category TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT,
  kind TEXT,
  route_key TEXT,
  payload TEXT
);
CREATE TABLE IF NOT EXISTS quota_resources (
  provider_id TEXT PRIMARY KEY,
  remaining REAL,
  remaining_confidence REAL DEFAULT 0,
  reset_at TEXT,
  source TEXT DEFAULT 'UNKNOWN'
);
CREATE TABLE IF NOT EXISTS provider_health (
  provider_id TEXT PRIMARY KEY,
  health REAL DEFAULT 1,
  last_error TEXT,
  last_error_at TEXT
);
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  parent_session_id TEXT,
  child_session_id TEXT,
  role TEXT,
  provider TEXT,
  model TEXT,
  variant TEXT,
  state TEXT,
  started_at TEXT,
  completed_at TEXT,
  fallback_from TEXT,
  error_category TEXT
);
`

export interface Store {
  db: Database
  dbPath: string
  close(): void
}

function fingerprint(file: string): string {
  const st = fs.statSync(file)
  const hash = createHash("sha256")
  hash.update(String(st.size))
  hash.update(String(st.mtimeMs))
  hash.update(file)
  return hash.digest("hex")
}

function getMeta(db: Database, key: string): string | undefined {
  const row = db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined
  return row?.value
}

function setMeta(db: Database, key: string, value: string) {
  db.run("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value])
}

export function nativeDbPath(dataDir: string): string {
  return path.join(dataDir, "tokenmax", "tokenmax.sqlite")
}

export function pluginDbPath(configDir: string): string {
  return path.join(configDir, "tokenmax", "tokenmax.sqlite")
}

export function backupDir(dataDir: string): string {
  return path.join(dataDir, "tokenmax", "backups")
}

export function openStore(opts: { dataDir: string; configDir?: string }): Store {
  const dbPath = nativeDbPath(opts.dataDir)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.run("PRAGMA journal_mode=WAL")
  db.run("PRAGMA busy_timeout=5000")
  db.run("PRAGMA foreign_keys=ON")
  db.exec(SCHEMA)
  const ver = db.query("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null }
  if (!ver?.v) {
    db.run("INSERT INTO schema_version(version, applied_at) VALUES(?, ?)", [NATIVE_SCHEMA_VERSION, new Date().toISOString()])
  }
  if (opts.configDir) {
    const oldPath = pluginDbPath(opts.configDir)
    if (fs.existsSync(oldPath)) importPluginDb(db, opts.dataDir, oldPath)
  }
  return {
    db,
    dbPath,
    close() {
      db.close()
    },
  }
}

export function importPluginDb(db: Database, dataDir: string, oldPath: string): { imported: boolean; oldRecords: number; migrated: number } {
  if (!fs.existsSync(oldPath)) return { imported: false, oldRecords: 0, migrated: 0 }
  const fp = fingerprint(oldPath)
  if (getMeta(db, "imported_plugin_fingerprint") === fp) {
    const n = (db.query("SELECT COUNT(*) AS n FROM routes").get() as { n: number }).n
    return { imported: false, oldRecords: n, migrated: n }
  }
  const backups = backupDir(dataDir)
  fs.mkdirSync(backups, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  fs.copyFileSync(oldPath, path.join(backups, `plugin-${stamp}.sqlite`))

  const escaped = oldPath.replace(/'/g, "''")
  db.exec(`ATTACH DATABASE '${escaped}' AS old`)
  try {
    const hasRoutes = db.query("SELECT name FROM old.sqlite_master WHERE type='table' AND name='routes'").get()
    let oldRecords = 0
    if (hasRoutes) {
      oldRecords = (db.query("SELECT COUNT(*) AS n FROM old.routes").get() as { n: number }).n
      try {
        db.exec(`
          INSERT OR IGNORE INTO routes (provider_id, model_id, variant, billing_type, availability, monetary_free, cost_known, cost_input, cost_output, reasoning, tools, vision, context_limit)
          SELECT provider_id, model_id, variant,
            COALESCE(billing_type, 'UNKNOWN'),
            COALESCE(availability, 'UNKNOWN'),
            COALESCE(monetary_free, 0),
            COALESCE(cost_known, 0),
            cost_input, cost_output,
            COALESCE(reasoning, 0), COALESCE(tools, 0), COALESCE(vision, 0), context_limit
          FROM old.routes
        `)
      } catch {
        db.exec(`
          INSERT OR IGNORE INTO routes (provider_id, model_id, variant)
          SELECT provider_id, model_id, COALESCE(variant, '') FROM old.routes
        `)
      }
    }
    const copyIf = (table: string, sql: string) => {
      const exists = db.query("SELECT name FROM old.sqlite_master WHERE type='table' AND name=?").get(table)
      if (exists) db.exec(sql)
    }
    copyIf(
      "route_capabilities",
      `INSERT OR IGNORE INTO route_capabilities (route_key, task_class, samples, success, ema, last_updated)
       SELECT route_key, task_class, COALESCE(samples,0), COALESCE(success,0), COALESCE(ema,0.5), last_updated FROM old.route_capabilities`,
    )
    copyIf(
      "benchmark_runs",
      `INSERT OR IGNORE INTO benchmark_runs (id, route_key, suite, status, cases_total, cases_passed, results)
       SELECT id, route_key, suite, status, COALESCE(cases_total,0), COALESCE(cases_passed,0), results FROM old.benchmark_runs`,
    )
    copyIf(
      "task_attempts",
      `INSERT OR IGNORE INTO task_attempts (id, session_id, route_key, task_class, status, error_category, tokens_in, tokens_out, latency_ms, started_at, finished_at)
       SELECT id, session_id, route_key, task_class, status, error_category, COALESCE(tokens_in,0), COALESCE(tokens_out,0), COALESCE(latency_ms,0), started_at, finished_at FROM old.task_attempts`,
    )
    copyIf(
      "usage_events",
      `INSERT OR IGNORE INTO usage_events (id, ts, kind, route_key, payload)
       SELECT id, ts, kind, route_key, payload FROM old.usage_events`,
    )
    copyIf(
      "quota_resources",
      `INSERT OR IGNORE INTO quota_resources (provider_id, remaining, remaining_confidence, reset_at, source)
       SELECT provider_id, remaining, COALESCE(remaining_confidence,0), reset_at, COALESCE(source,'UNKNOWN') FROM old.quota_resources`,
    )
    copyIf(
      "provider_health",
      `INSERT OR IGNORE INTO provider_health (provider_id, health, last_error, last_error_at)
       SELECT provider_id, COALESCE(health,1), last_error, last_error_at FROM old.provider_health`,
    )
    const migrated = (db.query("SELECT COUNT(*) AS n FROM routes").get() as { n: number }).n
    setMeta(db, "imported_plugin_fingerprint", fp)
    setMeta(db, "imported_plugin_at", new Date().toISOString())
    return { imported: true, oldRecords, migrated }
  } finally {
    db.exec("DETACH DATABASE old")
  }
}

export function countRoutes(store: Store): number {
  return (store.db.query("SELECT COUNT(*) AS n FROM routes").get() as { n: number }).n
}

export function listRoutes(store: Store) {
  return store.db.query("SELECT * FROM routes").all() as Array<Record<string, unknown>>
}

export function upsertRoute(
  store: Store,
  row: {
    providerId: string
    modelId: string
    variant?: string
    billingType?: string
    availability?: string
    monetaryFree?: boolean
    costKnown?: boolean
    costInput?: number | null
    costOutput?: number | null
    reasoning?: boolean
    tools?: boolean
    vision?: boolean
    contextLimit?: number | null
  },
) {
  store.db.run(
    `INSERT INTO routes (provider_id, model_id, variant, billing_type, availability, monetary_free, cost_known, cost_input, cost_output, reasoning, tools, vision, context_limit)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(provider_id, model_id, variant) DO UPDATE SET
       billing_type=excluded.billing_type,
       availability=excluded.availability,
       monetary_free=excluded.monetary_free,
       cost_known=excluded.cost_known,
       cost_input=excluded.cost_input,
       cost_output=excluded.cost_output,
       reasoning=excluded.reasoning,
       tools=excluded.tools,
       vision=excluded.vision,
       context_limit=excluded.context_limit`,
    [
      row.providerId,
      row.modelId,
      row.variant ?? "",
      row.billingType ?? "UNKNOWN",
      row.availability ?? "UNKNOWN",
      row.monetaryFree ? 1 : 0,
      row.costKnown ? 1 : 0,
      row.costInput ?? null,
      row.costOutput ?? null,
      row.reasoning ? 1 : 0,
      row.tools ? 1 : 0,
      row.vision ? 1 : 0,
      row.contextLimit ?? null,
    ],
  )
}

export function statsSummary(store: Store) {
  const attempts = store.db.query("SELECT COUNT(*) AS n FROM task_attempts").get() as { n: number }
  const byBilling = store.db
    .query("SELECT billing_type AS billing, COUNT(*) AS n FROM routes GROUP BY billing_type")
    .all() as Array<{ billing: string; n: number }>
  return { attempts: attempts.n, byBilling }
}
