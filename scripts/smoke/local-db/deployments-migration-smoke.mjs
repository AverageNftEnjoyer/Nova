import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import Database from "better-sqlite3"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "../../..")
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-deployments-migration-"))
process.env.NOVA_DATA_DIR = tempRoot
process.env.NOVA_ALLOW_TEST_KEY = "1"
process.env.NOVA_TEST_MASTER_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

const dbModule = await import(pathToFileURL(path.join(repoRoot, "src/db/index.js")).href)
const effects = await import(pathToFileURL(path.join(repoRoot, "src/db/deployment-effects.js")).href)
const migrations = await import(pathToFileURL(path.join(repoRoot, "src/db/migrations/index.js")).href)

// Build a populated V18 database first so this exercises the real upgrade path, not only a fresh install.
const dbPath = path.join(tempRoot, "nova.db")
const legacyDb = new Database(dbPath)
dbModule.runMigrations(legacyDb, migrations.MIGRATIONS.filter((migration) => migration.version <= 18))
const legacyNow = new Date().toISOString()
legacyDb.prepare(
  `INSERT INTO missions (user_id, id, data_json, label, enabled, created_at, updated_at)
   VALUES ('smoke-user', 'legacy-mission', '{"name":"Preserved mission"}', 'Preserved mission', 1, ?, ?)`,
).run(legacyNow, legacyNow)
legacyDb.close()

const db = dbModule.getDb()

assert.equal(migrations.LATEST_VERSION, 20)
assert.equal(db.pragma("user_version", { simple: true }), 20)
assert.equal(
  db.prepare("SELECT label FROM missions WHERE user_id = 'smoke-user' AND id = 'legacy-mission'").get()?.label,
  "Preserved mission",
)
for (const table of [
  "deployments",
  "deployment_runs",
  "deployment_steps",
  "deployment_events",
  "deployment_attachments",
  "deployment_effects",
  "deployment_legacy_links",
]) {
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), `missing ${table}`)
}

const runColumns = db.prepare("PRAGMA table_info(deployment_runs)").all().map((row) => row.name)
assert.ok(runColumns.includes("idempotency_key"))

const now = new Date().toISOString()
db.prepare(
  `INSERT INTO deployments
     (user_id, id, kind, status, title, outcome, acceptance_json, config_json, revision, created_at, updated_at)
   VALUES ('smoke-user', 'dep-1', 'automation', 'ready', 'Smoke', 'Verify effects', '[]', '{}', 1, ?, ?)`,
).run(now, now)
db.prepare(
  `INSERT INTO deployment_runs
     (user_id, id, deployment_id, deployment_revision, status, permission_mode, idempotency_key, created_at, updated_at)
   VALUES ('smoke-user', 'run-1', 'dep-1', 1, 'running', 'default', 'launch-1', ?, ?)`,
).run(now, now)

// A failed post-upgrade transaction must roll back all writes, including its earlier event.
assert.throws(() => {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO deployment_events
         (event_id, user_id, deployment_id, run_id, type, actor, ts, data_json)
       VALUES ('rollback-event', 'smoke-user', 'dep-1', 'run-1', 'rollback-check', 'system', ?, '{}')`,
    ).run(now)
    db.prepare(
      `INSERT INTO deployment_runs
         (user_id, id, deployment_id, deployment_revision, status, permission_mode, idempotency_key, created_at, updated_at)
       VALUES ('smoke-user', 'run-duplicate', 'dep-1', 1, 'running', 'default', 'launch-1', ?, ?)`,
    ).run(now, now)
  })()
}, /UNIQUE constraint failed/)
assert.equal(
  db.prepare("SELECT COUNT(*) AS count FROM deployment_events WHERE type = 'rollback-check'").get().count,
  0,
)

const first = effects.reserveDeploymentEffect({
  userId: "smoke-user",
  runId: "run-1",
  effectKey: "step:send",
  toolName: "email-output",
})
assert.equal(first.ok, true)
assert.equal(first.tracked, true)
assert.equal(effects.settleDeploymentEffect({
  userId: "smoke-user",
  runId: "run-1",
  effectKey: "step:send",
  ok: true,
  result: { sent: true },
}).ok, true)
const duplicate = effects.reserveDeploymentEffect({
  userId: "smoke-user",
  runId: "run-1",
  effectKey: "step:send",
  toolName: "email-output",
})
assert.equal(duplicate.duplicate, true)
assert.equal(duplicate.status, "committed")

dbModule.closeDb()
fs.rmSync(tempRoot, { recursive: true, force: true })
console.log("PASS populated deployment upgrade, rollback, idempotency, and durable effect fencing")
