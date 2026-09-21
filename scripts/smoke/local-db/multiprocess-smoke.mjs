/**
 * Multi-process smoke (W1): 4 child processes run a mixed kv + immediate-tx + deferred-read workload against
 * ONE nova.db through the singleton API, exactly as the agent runtime and the Next server will.
 * Expectation: zero SQLITE_BUSY escapes and zero lost writes.
 * Later workstreams may add table-specific workloads (notes, job_runs) to db-worker.mjs "mixed" mode.
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

const WORKERS = 4
const OPS = 200
// Each worker deletes one previously written key every 25 ops (n = 0, 25, ..., 175 => 8 deletes).
const DELETES_PER_WORKER = Math.ceil(OPS / 25)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-db-multiprocess-smoke-"))
let exitCode = 0

try {
  const file = path.join(dir, db.DB_FILENAME)
  const setup = db.openDbAt(file)
  setup.exec(`
    CREATE TABLE smoke_rows (worker INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (worker, n));
    CREATE TABLE smoke_counter (id INTEGER PRIMARY KEY, total INTEGER NOT NULL);
    INSERT INTO smoke_counter (id, total) VALUES (1, 0);
  `)
  setup.close()

  const goFile = path.join(dir, "go")
  const run = (worker) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [workerPath, "mixed", JSON.stringify({ worker, count: OPS, goFile })], {
        env: { ...process.env, NOVA_DATA_DIR: dir },
        stdio: ["ignore", "pipe", "pipe"],
      })
      let stderr = ""
      child.stderr.on("data", (chunk) => (stderr += chunk))
      child.on("close", (code) => resolve({ code, stderr }))
    })

  const pending = Array.from({ length: WORKERS }, (_, worker) => run(worker))
  await new Promise((resolve) => setTimeout(resolve, 500))
  fs.writeFileSync(goFile, "go")
  const outcomes = await Promise.all(pending)

  for (const outcome of outcomes) {
    assert.equal(outcome.code, 0, `worker failed: ${outcome.stderr}`)
    assert.ok(!/SQLITE_BUSY|database is locked/i.test(outcome.stderr), "SQLITE_BUSY escaped")
  }

  const verify = db.openDbAt(file, { readonly: true })
  const total = WORKERS * OPS
  assert.equal(verify.prepare("SELECT COUNT(*) AS c FROM smoke_rows").get().c, total, "lost or duplicated inserts")
  assert.equal(verify.prepare("SELECT total FROM smoke_counter WHERE id = 1").get().total, total, "lost counter updates")
  const keptPerWorker = OPS - DELETES_PER_WORKER
  for (const user of ["user-0", "user-1"]) {
    const count = verify
      .prepare("SELECT COUNT(*) AS c FROM kv_state WHERE user_id = ? AND namespace = 'mixed'")
      .get(user).c
    assert.equal(count, (WORKERS / 2) * keptPerWorker, `kv rows for ${user}`)
  }
  verify.close()

  console.log(`PASS mixed workload: ${WORKERS} processes x ${OPS} ops, no lost writes, no SQLITE_BUSY`)
  console.log("\n1/1 checks passed")
} catch (error) {
  exitCode = 1
  console.log("FAIL mixed workload")
  console.log(error instanceof Error ? error.stack || error.message : String(error))
  console.log("\n0/1 checks passed")
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
process.exit(exitCode)
