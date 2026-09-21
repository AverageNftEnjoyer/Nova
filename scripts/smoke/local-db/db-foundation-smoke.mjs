/**
 * Local DB foundation smoke (W1): src/db migrations, pragmas, tx, kv_state, data-dir resolution,
 * singleton, and multi-process safety. Everything runs against temp directories, never the real .user.
 */
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..", "..", "..")
const workerPath = path.join(here, "db-worker.mjs")
const db = await import(pathToFileURL(path.join(repoRoot, "src", "db", "index.js")).href)

const originalCwd = process.cwd()
const originalEnv = { ...process.env }
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-db-foundation-smoke-"))
let counter = 0
const scratch = (label) => path.join(tempRoot, `${label}-${(counter += 1)}`)

const results = []
async function run(name, fn) {
  try {
    await fn()
    results.push({ status: "PASS", name })
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.stack || error.message : String(error) })
  } finally {
    db.closeDb()
    process.chdir(originalCwd)
    for (const key of ["NOVA_DATA_DIR", "NOVA_PACKAGED", "APPDATA"]) {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    }
  }
}

const tableNames = (conn) =>
  conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name)
const userVersion = (conn) => conn.pragma("user_version", { simple: true })

function spawnWorker(mode, argObject, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [workerPath, mode, JSON.stringify(argObject)], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

// ---------------------------------------------------------------------------
// Schema + migrations
// ---------------------------------------------------------------------------

await run("fresh DB migrates to latest and creates core tables", () => {
  const conn = db.openDbAt(path.join(scratch("fresh"), "nova.db"))
  assert.equal(userVersion(conn), db.LATEST_VERSION)
  assert.ok(db.LATEST_VERSION >= 5)
  assert.deepEqual(tableNames(conn).filter((name) => ["meta", "kv_state"].includes(name)), ["kv_state", "meta"])
  assert.equal(conn.prepare("SELECT value FROM meta WHERE key = 'migration:1'").get().value, "core")
  conn.close()
})

await run("re-running migrations is a no-op", () => {
  const conn = db.openDbAt(path.join(scratch("rerun"), "nova.db"))
  const before = conn.prepare("SELECT key, updated_at FROM meta ORDER BY key").all()
  assert.deepEqual(db.runMigrations(conn), { from: db.LATEST_VERSION, to: db.LATEST_VERSION })
  assert.deepEqual(conn.prepare("SELECT key, updated_at FROM meta ORDER BY key").all(), before)
  conn.close()
})

await run("pragmas are applied on every connection", () => {
  const file = path.join(scratch("pragmas"), "nova.db")
  for (let i = 0; i < 2; i += 1) {
    const conn = db.openDbAt(file)
    assert.equal(conn.pragma("journal_mode", { simple: true }), "wal")
    assert.equal(conn.pragma("busy_timeout", { simple: true }), 5000)
    assert.equal(conn.pragma("foreign_keys", { simple: true }), 1)
    assert.equal(conn.pragma("synchronous", { simple: true }), 1)
    assert.equal(conn.pragma("trusted_schema", { simple: true }), 0)
    conn.close()
  }
})

await run("migrations apply in order from any older version", () => {
  const m1 = { version: 1, name: "one", sql: "CREATE TABLE order_log (id INTEGER PRIMARY KEY AUTOINCREMENT, v INTEGER); INSERT INTO order_log (v) VALUES (1);" }
  const m2 = { version: 2, name: "two", sql: "CREATE TABLE two (x); INSERT INTO order_log (v) VALUES (2);" }
  const m3 = { version: 3, name: "three", sql: "CREATE TABLE three (x); INSERT INTO order_log (v) VALUES (3);" }
  const conn = db.openDbAt(path.join(scratch("older"), "nova.db"), { skipMigrations: true })
  assert.deepEqual(db.runMigrations(conn, [m1]), { from: 0, to: 1 })
  // Passed out of order on purpose: the runner must sort.
  assert.deepEqual(db.runMigrations(conn, [m3, m2, m1]), { from: 1, to: 3 })
  assert.deepEqual(conn.prepare("SELECT v FROM order_log ORDER BY id").all().map((row) => row.v), [1, 2, 3])
  assert.ok(tableNames(conn).includes("three"))
  conn.close()
})

await run("failed migration rolls back and leaves user_version unchanged", () => {
  const good = { version: 1, name: "good", sql: "CREATE TABLE good (x);" }
  const bad = { version: 2, name: "bad", sql: "CREATE TABLE half_done (x); INSERT INTO table_that_does_not_exist VALUES (1);" }
  const conn = db.openDbAt(path.join(scratch("failed"), "nova.db"), { skipMigrations: true })
  assert.throws(() => db.runMigrations(conn, [good, bad]), /Migration 2 \(bad\) failed/)
  assert.equal(userVersion(conn), 1)
  assert.ok(!tableNames(conn).includes("half_done"), "partial DDL must be rolled back")
  assert.equal(conn.prepare("SELECT 1 FROM meta WHERE key = 'migration:2'").get(), undefined)
  assert.equal(conn.inTransaction, false)
  // Fixing the migration and retrying applies it.
  db.runMigrations(conn, [good, { version: 2, name: "bad", sql: "CREATE TABLE half_done (x);" }])
  assert.equal(userVersion(conn), 2)
  assert.ok(tableNames(conn).includes("half_done"))
  conn.close()
})

await run("a stub filled in later is still applied (workstreams land in any order)", () => {
  const m1 = { version: 1, name: "core", sql: "CREATE TABLE core_t (x);" }
  const stub2 = { version: 2, name: "later", sql: "" }
  const m3 = { version: 3, name: "three", sql: "CREATE TABLE three_t (x);" }
  const conn = db.openDbAt(path.join(scratch("stub"), "nova.db"), { skipMigrations: true })
  assert.deepEqual(db.runMigrations(conn, [m1, stub2, m3]), { from: 0, to: 3 })
  assert.ok(!tableNames(conn).includes("later_t"))
  const filled2 = { version: 2, name: "later", sql: "CREATE TABLE later_t (x);" }
  assert.deepEqual(db.runMigrations(conn, [m1, filled2, m3]), { from: 3, to: 3 })
  assert.ok(tableNames(conn).includes("later_t"), "filled stub must be applied on a DB that recorded it as a no-op")
  assert.deepEqual(
    conn.prepare("SELECT key FROM meta WHERE key LIKE 'migration:%' ORDER BY key").all().map((row) => row.key),
    ["migration:1", "migration:2", "migration:3"],
  )
  // ...and only once.
  assert.deepEqual(db.runMigrations(conn, [m1, filled2, m3]), { from: 3, to: 3 })
  conn.close()
})

await run("readonly and :memory: connections", () => {
  const missing = path.join(scratch("ro-missing"), "nova.db")
  assert.throws(() => db.openDbAt(missing, { readonly: true }))
  const file = path.join(scratch("ro"), "nova.db")
  db.openDbAt(file).close()
  const ro = db.openDbAt(file, { readonly: true })
  assert.equal(userVersion(ro), db.LATEST_VERSION)
  assert.throws(() => ro.exec("CREATE TABLE nope (x)"), /readonly/i)
  ro.close()
  const mem = db.openDbAt(":memory:")
  assert.equal(userVersion(mem), db.LATEST_VERSION)
  mem.close()
})

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

function txDb(label) {
  const conn = db.openDbAt(path.join(scratch(label), "nova.db"))
  conn.exec("CREATE TABLE t (x INTEGER)")
  return conn
}
const rows = (conn) => conn.prepare("SELECT x FROM t ORDER BY x").all().map((row) => row.x)

await run("txOn commits, rolls back on throw, and returns the callback value", () => {
  const conn = txDb("tx-basic")
  const value = db.txOn(conn, () => {
    conn.prepare("INSERT INTO t VALUES (1)").run()
    assert.equal(conn.inTransaction, true)
    return "done"
  })
  assert.equal(value, "done")
  assert.equal(conn.inTransaction, false)
  assert.throws(
    () =>
      db.txOn(conn, () => {
        conn.prepare("INSERT INTO t VALUES (2)").run()
        throw new Error("boom")
      }),
    /boom/,
  )
  assert.deepEqual(rows(conn), [1])
  assert.equal(conn.inTransaction, false)
  conn.close()
})

await run("nested tx joins the outer transaction via savepoints", () => {
  const conn = txDb("tx-nested")
  db.txOn(conn, () => {
    conn.prepare("INSERT INTO t VALUES (1)").run()
    assert.throws(
      () =>
        db.txOn(conn, () => {
          conn.prepare("INSERT INTO t VALUES (99)").run()
          throw new Error("inner")
        }),
      /inner/,
    )
    db.txOn(conn, () => {
      conn.prepare("INSERT INTO t VALUES (2)").run()
      db.txOn(conn, () => conn.prepare("INSERT INTO t VALUES (3)").run())
    })
  })
  assert.deepEqual(rows(conn), [1, 2, 3], "inner failure rolls back only its own work")

  assert.throws(() =>
    db.txOn(conn, () => {
      db.txOn(conn, () => conn.prepare("INSERT INTO t VALUES (10)").run())
      throw new Error("outer")
    }),
  )
  assert.deepEqual(rows(conn), [1, 2, 3], "outer failure rolls back joined inner work")
  assert.equal(conn.inTransaction, false)
  conn.close()
})

await run("tx rejects async callbacks and unknown modes", () => {
  const conn = txDb("tx-async")
  assert.throws(
    () =>
      db.txOn(conn, async () => {
        conn.prepare("INSERT INTO t VALUES (1)").run()
      }),
    /synchronous/,
  )
  assert.deepEqual(rows(conn), [], "async callback's writes must be rolled back")
  assert.throws(() => db.txOn(conn, () => {}, "sideways"), /Unknown transaction mode/)
  for (const mode of ["deferred", "immediate", "exclusive"]) {
    db.txOn(conn, () => conn.prepare("INSERT INTO t VALUES (?)").run(mode.length), mode)
  }
  assert.equal(rows(conn).length, 3)
  conn.close()
})

await run("tx() uses the singleton and defaults to an immediate write lock", () => {
  process.env.NOVA_DATA_DIR = scratch("tx-singleton")
  const holder = db.getDb()
  holder.exec("CREATE TABLE t (x INTEGER)")
  db.tx((conn) => {
    assert.equal(conn, holder)
    conn.prepare("INSERT INTO t VALUES (1)").run()
    // An IMMEDIATE transaction already holds the write lock: a second connection cannot write.
    const other = db.openDbAt(path.join(process.env.NOVA_DATA_DIR, db.DB_FILENAME), { skipMigrations: true })
    other.pragma("busy_timeout = 0")
    assert.throws(() => other.exec("INSERT INTO t VALUES (2)"), /SQLITE_BUSY|database is locked/i)
    other.close()
  })
  assert.deepEqual(rows(holder), [1])
})

// ---------------------------------------------------------------------------
// kv_state
// ---------------------------------------------------------------------------

await run("kv round-trips JSON, overwrites, deletes, lists sorted", async () => {
  process.env.NOVA_DATA_DIR = scratch("kv")
  const value = { a: [1, 2, { b: null }], text: "héllo — 日本語 🙂", n: 1.5, t: true }
  db.kvSet("u1", "ns", "k1", value)
  assert.deepEqual(db.kvGet("u1", "ns", "k1"), value)
  assert.equal(db.kvGet("u1", "ns", "absent"), null)

  const first = db.kvList("u1", "ns")[0].updatedAt
  await new Promise((resolve) => setTimeout(resolve, 5))
  db.kvSet("u1", "ns", "k1", { replaced: true })
  assert.deepEqual(db.kvGet("u1", "ns", "k1"), { replaced: true })
  assert.ok(db.kvList("u1", "ns")[0].updatedAt > first, "updatedAt advances on overwrite")

  db.kvSet("u1", "ns", "b", 2)
  db.kvSet("u1", "ns", "a", 1)
  assert.deepEqual(db.kvList("u1", "ns").map((entry) => entry.key), ["a", "b", "k1"])
  assert.equal(db.kvDelete("u1", "ns", "a"), true)
  assert.equal(db.kvDelete("u1", "ns", "a"), false)
  assert.deepEqual(db.kvList("u1", "ns").map((entry) => entry.key), ["b", "k1"])
})

await run("kv is scoped per user and per namespace; userId is mandatory", () => {
  process.env.NOVA_DATA_DIR = scratch("kv-iso")
  db.kvSet("alice", "prefs", "theme", "dark")
  db.kvSet("bob", "prefs", "theme", "light")
  db.kvSet("alice", "other", "theme", "neon")
  assert.equal(db.kvGet("alice", "prefs", "theme"), "dark")
  assert.equal(db.kvGet("bob", "prefs", "theme"), "light")
  assert.equal(db.kvGet("alice", "other", "theme"), "neon")
  assert.equal(db.kvGet("carol", "prefs", "theme"), null)
  assert.equal(db.kvDelete("bob", "prefs", "theme"), true)
  assert.equal(db.kvGet("alice", "prefs", "theme"), "dark")
  assert.deepEqual(db.kvList("bob", "prefs"), [])
  for (const bad of ["", "   ", undefined, null, 5]) {
    assert.throws(() => db.kvGet(bad, "ns", "k"), /userId/)
    assert.throws(() => db.kvSet(bad, "ns", "k", 1), /userId/)
    assert.throws(() => db.kvDelete(bad, "ns", "k"), /userId/)
    assert.throws(() => db.kvList(bad, "ns"), /userId/)
  }
  assert.throws(() => db.kvSet("alice", "ns", "k", undefined), /JSON-serializable/)
})

// ---------------------------------------------------------------------------
// Data dir + singleton
// ---------------------------------------------------------------------------

await run("NOVA_DATA_DIR override is honored and created", () => {
  const dir = path.join(scratch("dd"), "nested", "data")
  process.env.NOVA_DATA_DIR = dir
  assert.equal(db.resolveDataDir(), dir)
  assert.ok(fs.existsSync(dir))
  db.getDb()
  assert.ok(fs.existsSync(path.join(dir, db.DB_FILENAME)))
  // Relative override resolves against cwd.
  const base = scratch("dd-rel")
  fs.mkdirSync(base, { recursive: true })
  process.chdir(base)
  process.env.NOVA_DATA_DIR = "relative-data"
  assert.equal(fs.realpathSync(db.resolveDataDir()), fs.realpathSync(path.join(base, "relative-data")))
})

await run("packaged and dev defaults resolve to %APPDATA%/Nova and <workspace>/.user", () => {
  delete process.env.NOVA_DATA_DIR
  process.env.NOVA_PACKAGED = "1"
  const appData = scratch("appdata")
  process.env.APPDATA = appData
  assert.equal(db.resolveDataDir(), path.join(appData, "Nova"))

  delete process.env.NOVA_PACKAGED
  const workspace = scratch("workspace")
  fs.mkdirSync(path.join(workspace, "hud"), { recursive: true })
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true })
  process.chdir(path.join(workspace, "hud"))
  assert.equal(fs.realpathSync(db.resolveDataDir()), fs.realpathSync(path.join(workspace, ".user")))
})

await run("src/.user is a forbidden data location", () => {
  const workspace = scratch("forbidden")
  fs.mkdirSync(path.join(workspace, "hud"), { recursive: true })
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true })
  process.chdir(workspace)
  process.env.NOVA_DATA_DIR = path.join(workspace, "src", ".user", "db")
  assert.throws(() => db.resolveDataDir(), /may not resolve under/)
})

await run("getDb is a singleton, re-opens when the data dir changes, and closeDb clears it", () => {
  const dirA = scratch("single-a")
  const dirB = scratch("single-b")
  process.env.NOVA_DATA_DIR = dirA
  const first = db.getDb()
  assert.equal(db.getDb(), first)
  assert.equal(globalThis.__novaDb.db, first)

  process.env.NOVA_DATA_DIR = dirB
  const second = db.getDb()
  assert.notEqual(second, first)
  assert.equal(first.open, false, "previous connection is closed")
  assert.ok(fs.existsSync(path.join(dirB, db.DB_FILENAME)))

  db.closeDb()
  assert.equal(second.open, false)
  assert.equal(globalThis.__novaDb, undefined)
  const third = db.getDb()
  assert.equal(third.open, true)
  assert.notEqual(third, second)
})

// ---------------------------------------------------------------------------
// Multi-process
// ---------------------------------------------------------------------------

await run("4 processes x 200 immediate inserts: exact row count, no SQLITE_BUSY escapes", async () => {
  const dir = scratch("mp-insert")
  const file = path.join(dir, "nova.db")
  const setup = db.openDbAt(file)
  setup.exec("CREATE TABLE smoke_rows (worker INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (worker, n))")
  setup.close()

  const goFile = path.join(dir, "go")
  const pending = [0, 1, 2, 3].map((worker) => spawnWorker("insert", { file, worker, count: 200, goFile }))
  await new Promise((resolve) => setTimeout(resolve, 400))
  fs.writeFileSync(goFile, "go")
  const outcomes = await Promise.all(pending)
  for (const outcome of outcomes) {
    assert.equal(outcome.code, 0, `worker failed: ${outcome.stderr}`)
    assert.ok(!/SQLITE_BUSY|database is locked/i.test(outcome.stderr))
  }
  const verify = db.openDbAt(file, { readonly: true })
  assert.equal(verify.prepare("SELECT COUNT(*) AS c FROM smoke_rows").get().c, 800)
  for (const worker of [0, 1, 2, 3]) {
    assert.equal(verify.prepare("SELECT COUNT(*) AS c FROM smoke_rows WHERE worker = ?").get(worker).c, 200)
  }
  verify.close()
})

await run("concurrent migrate race on a fresh DB converges (3 rounds x 4 processes)", async () => {
  for (let round = 0; round < 3; round += 1) {
    const dir = scratch(`mp-migrate-${round}`)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, "nova.db")
    const goFile = path.join(dir, "go")
    const pending = [0, 1, 2, 3].map(() => spawnWorker("migrate", { file, goFile }))
    await new Promise((resolve) => setTimeout(resolve, 400))
    fs.writeFileSync(goFile, "go")
    const outcomes = await Promise.all(pending)
    for (const outcome of outcomes) {
      assert.equal(outcome.code, 0, `migrate worker failed: ${outcome.stderr}`)
      assert.equal(JSON.parse(outcome.stdout.trim()).version, db.LATEST_VERSION)
    }
    const verify = db.openDbAt(file, { readonly: true })
    assert.equal(verify.prepare("SELECT COUNT(*) AS c FROM meta WHERE key = 'migration:1'").get().c, 1)
    assert.equal(userVersion(verify), db.LATEST_VERSION)
    verify.close()
  }
})

// ---------------------------------------------------------------------------

process.chdir(originalCwd)
db.closeDb()
fs.rmSync(tempRoot, { recursive: true, force: true })

let failed = 0
for (const result of results) {
  console.log(`${result.status} ${result.name}`)
  if (result.status === "FAIL") {
    failed += 1
    console.log(result.detail)
  }
}
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
