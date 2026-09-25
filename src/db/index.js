import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { LATEST_VERSION, MIGRATIONS } from "./migrations/index.js";
import { DB_FILENAME, resolveDataDir, resolveWorkspaceRoot } from "./paths.js";

export { DB_FILENAME, LATEST_VERSION, resolveDataDir, resolveWorkspaceRoot };

const SINGLETON_KEY = "__novaDb";
const EXIT_HOOK_KEY = "__novaDbExitHook";
const TX_MODES = new Set(["deferred", "immediate", "exclusive"]);
const NATIVE_HINT =
  "better-sqlite3's native binding is missing or built for a different Node version. Run `npm run db:fix-native` from the repo root.";

/** UTC ISO-8601 timestamp; lexicographically comparable. */
export function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

function enableWal(db) {
  // Switching a fresh file to WAL needs an exclusive lock; racing first-run processes can still see BUSY
  // even with a busy handler, so retry briefly. Once the file is WAL the pragma is a cheap no-op.
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      db.pragma("journal_mode = WAL");
      return;
    } catch (error) {
      if (!/SQLITE_BUSY|database is locked/i.test(String(error?.code ?? error?.message)) || Date.now() > deadline) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}

function applyPragmas(db, { readonly, memory }) {
  // busy_timeout must come first so every later statement (including the WAL switch) waits instead of failing.
  db.pragma("busy_timeout = 5000");
  if (!readonly && !memory) enableWal(db);
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("trusted_schema = OFF");
}

/**
 * Open a connection at an explicit path (tests, importer, tooling). Applies pragmas and,
 * unless `skipMigrations`/`readonly`, migrates to the latest schema. Caller owns close().
 */
export function openDbAt(filePath, opts = {}) {
  const readonly = opts.readonly === true;
  const memory = filePath === ":memory:";
  if (!readonly && !memory) fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });

  let db;
  try {
    db = new Database(filePath, { readonly, fileMustExist: readonly });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/bindings file|NODE_MODULE_VERSION|invalid ELF|not a valid Win32/i.test(message)) {
      throw new Error(`${NATIVE_HINT} (${message.split("\n")[0]})`, { cause: error });
    }
    throw error;
  }

  try {
    applyPragmas(db, { readonly, memory });
    if (!readonly && opts.skipMigrations !== true) runMigrations(db);
  } catch (error) {
    try {
      db.close();
    } catch {
      // ignore close failure while surfacing the original error
    }
    throw error;
  }
  return db;
}

function envSignature() {
  return [
    process.env.NOVA_DATA_DIR || "",
    process.env.NOVA_PACKAGED || "",
    process.env.APPDATA || "",
    process.cwd(),
  ].join("|");
}

/**
 * Process-wide singleton on globalThis (safe across Next HMR and duplicated module instances).
 * Re-opens automatically if the resolved data dir changes (tests).
 */
export function getDb() {
  const current = globalThis[SINGLETON_KEY];
  const signature = envSignature();
  if (current && current.db.open && current.signature === signature) return current.db;

  const file = path.join(resolveDataDir(), DB_FILENAME);
  if (current && current.db.open && current.file === file) {
    current.signature = signature;
    return current.db;
  }
  if (current) closeDb();

  const db = openDbAt(file);
  globalThis[SINGLETON_KEY] = { db, file, signature };
  if (!globalThis[EXIT_HOOK_KEY]) {
    globalThis[EXIT_HOOK_KEY] = true;
    process.once("exit", () => closeDb());
  }
  return db;
}

/** Close and clear the singleton (tests/shutdown). */
export function closeDb() {
  const current = globalThis[SINGLETON_KEY];
  globalThis[SINGLETON_KEY] = undefined;
  if (current && current.db.open) {
    try {
      current.db.close();
    } catch {
      // best effort on shutdown
    }
  }
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

const migrationMarkerKey = (version) => `migration:${version}`;

function readUserVersion(db) {
  return Number(db.pragma("user_version", { simple: true })) || 0;
}

function hasMetaTable(db) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get());
}

/** SQL and/or a `run(db)` data step. A migration with neither is a no-op stub. */
function hasMigrationContent(migration) {
  return Boolean(String(migration.sql || "").trim()) || typeof migration.run === "function";
}

/**
 * A migration with content (SQL and/or `run`) is applied iff its `meta` marker exists. An empty stub (no SQL, no
 * run) is "applied" iff user_version already reached it. Marker-based tracking means a stub that is filled in later
 * is still applied on databases that recorded it as a no-op, whatever order workstreams landed in.
 */
function isApplied(db, migration, userVersion) {
  if (!hasMigrationContent(migration)) return userVersion >= migration.version;
  if (!hasMetaTable(db)) return false;
  return Boolean(db.prepare("SELECT 1 FROM meta WHERE key = ?").get(migrationMarkerKey(migration.version)));
}

function applyMigration(db, migration) {
  db.exec("BEGIN IMMEDIATE");
  try {
    // Re-check under the write lock: a concurrent process may have applied it while we waited.
    const userVersion = readUserVersion(db);
    if (!isApplied(db, migration, userVersion)) {
      const hasSql = Boolean(String(migration.sql || "").trim());
      if (hasSql) db.exec(migration.sql);
      // Data step: same connection, inside this BEGIN IMMEDIATE transaction (a throw rolls back the SQL too).
      if (typeof migration.run === "function") {
        const result = migration.run(db);
        if (isThenable(result)) throw new Error("run(db) must be synchronous (better-sqlite3 transactions cannot span an await).");
      }
      if (hasMigrationContent(migration)) {
        db.exec(
          "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
        );
        db.prepare(
          "INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        ).run(migrationMarkerKey(migration.version), migration.name, nowIso());
      }
      if (migration.version > userVersion) db.pragma(`user_version = ${Number(migration.version)}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // the failed statement may already have aborted the transaction
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${reason}`, { cause: error });
  }
}

/**
 * Bring `db` up to the latest schema. Each migration (its SQL, then its optional synchronous `run(db)` data step)
 * runs in its own BEGIN IMMEDIATE transaction with the marker and user_version bump inside, so a failure rolls back
 * cleanly and concurrent processes racing to migrate are safe.
 * `migrations` is injectable for tests.
 */
export function runMigrations(db, migrations = MIGRATIONS) {
  const from = readUserVersion(db);
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  for (const migration of ordered) {
    if (isApplied(db, migration, readUserVersion(db))) continue;
    applyMigration(db, migration);
  }
  return { from, to: readUserVersion(db) };
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

const txDepths = new WeakMap();

function isThenable(value) {
  return value !== null && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
}

/**
 * Run `fn(db)` in a transaction on an explicit connection. Nested calls join the outer transaction via
 * savepoints (an inner throw rolls back only the inner work). `fn` must be synchronous.
 */
export function txOn(db, fn, mode = "immediate") {
  if (!TX_MODES.has(mode)) throw new TypeError(`Unknown transaction mode: ${String(mode)}`);
  const depth = txDepths.get(db) ?? 0;

  if (depth === 0) {
    db.exec(`BEGIN ${mode.toUpperCase()}`);
    txDepths.set(db, 1);
    try {
      const result = fn(db);
      if (isThenable(result)) throw new TypeError("tx callback must be synchronous; it returned a Promise.");
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // already rolled back by SQLite (e.g. SQLITE_FULL)
      }
      throw error;
    } finally {
      txDepths.set(db, 0);
    }
  }

  const savepoint = `nova_sp_${depth}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  txDepths.set(db, depth + 1);
  try {
    const result = fn(db);
    if (isThenable(result)) throw new TypeError("tx callback must be synchronous; it returned a Promise.");
    db.exec(`RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    try {
      db.exec(`ROLLBACK TO ${savepoint}`);
      db.exec(`RELEASE ${savepoint}`);
    } catch {
      // outer transaction already gone
    }
    throw error;
  } finally {
    txDepths.set(db, depth);
  }
}

/** Run `fn(db)` in a transaction on the singleton connection. Default mode is "immediate". */
export function tx(fn, mode = "immediate") {
  return txOn(getDb(), fn, mode);
}

// ---------------------------------------------------------------------------
// kv_state — escape hatch for small JSON stores. Values must never hold plaintext secrets (nv1: ciphertext only).
// ---------------------------------------------------------------------------

const kvStatements = new WeakMap();

function requireText(name, value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} is required and must be a non-empty string.`);
  }
  return value;
}

function kvFor(db) {
  let statements = kvStatements.get(db);
  if (!statements) {
    statements = {
      get: db.prepare("SELECT value_json FROM kv_state WHERE user_id = ? AND namespace = ? AND key = ?"),
      set: db.prepare(
        "INSERT INTO kv_state (user_id, namespace, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(user_id, namespace, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
      ),
      del: db.prepare("DELETE FROM kv_state WHERE user_id = ? AND namespace = ? AND key = ?"),
      list: db.prepare(
        "SELECT key, value_json, updated_at FROM kv_state WHERE user_id = ? AND namespace = ? ORDER BY key",
      ),
    };
    kvStatements.set(db, statements);
  }
  return statements;
}

/** Returns the stored JSON value, or null when absent (a stored JSON null is indistinguishable). */
export function kvGet(userId, namespace, key) {
  requireText("userId", userId);
  requireText("namespace", namespace);
  requireText("key", key);
  const row = kvFor(getDb()).get.get(userId, namespace, key);
  return row ? JSON.parse(row.value_json) : null;
}

export function kvSet(userId, namespace, key, value) {
  requireText("userId", userId);
  requireText("namespace", namespace);
  requireText("key", key);
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("kvSet value must be JSON-serializable (got undefined/function/symbol).");
  kvFor(getDb()).set.run(userId, namespace, key, json, nowIso());
}

/** Returns true when a row was removed. */
export function kvDelete(userId, namespace, key) {
  requireText("userId", userId);
  requireText("namespace", namespace);
  requireText("key", key);
  return kvFor(getDb()).del.run(userId, namespace, key).changes > 0;
}

export function kvList(userId, namespace) {
  requireText("userId", userId);
  requireText("namespace", namespace);
  return kvFor(getDb())
    .list.all(userId, namespace)
    .map((row) => ({ key: row.key, value: JSON.parse(row.value_json), updatedAt: row.updated_at }));
}

/**
 * Permanently remove every row owned by one local user from nova.db.
 * Tables without a user scope (meta, scheduler_leases) are intentionally retained.
 */
export function purgeLocalUserData(userId) {
  const uid = requireText("userId", userId).trim();
  const tables = [
    "job_audit_events",
    "job_runs",
    "mission_artifacts",
    "dead_letters",
    "mission_journal",
    "mission_run_logs",
    "mission_telemetry",
    "mission_versions",
    "missions",
    "messages",
    "thread_summaries",
    "tool_runs",
    "llm_usage",
    "agent_task_budget_events",
    "threads",
    "session_turns",
    "sessions",
    "calendar_overrides",
    "task_contexts",
    "agent_tasks",
    "notes",
    "integration_state",
    "integration_configs",
    "kv_state",
  ];
  return tx((db) => {
    const deleted = {};
    for (const table of tables) {
      deleted[table] = db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(uid).changes;
    }
    return deleted;
  });
}
