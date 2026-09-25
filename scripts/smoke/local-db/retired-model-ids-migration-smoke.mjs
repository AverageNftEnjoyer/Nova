/**
 * Migration 16 (retired-model-ids) smoke.
 *
 *   RM-1  the runner applies a `run(db)`-only migration once, tracked by its meta marker; an empty stub keeps its
 *         user_version-only semantics; a throwing run rolls back and leaves no marker
 *   RM-2  a DB at version 15 seeded with retired IDs in every stored place migrates to latest: current choices are
 *         rewritten, history is not, the fake encrypted secret is byte-identical, non-JSON rows are skipped,
 *         the audit record is written
 *   RM-3  running the data step again changes nothing (idempotent) and adds no audit entries
 *   RM-4  a DB that recorded 16 as an empty stub (user_version 17, no marker) still gets 16 applied
 *   RM-5  a fresh DB migrates cleanly with no audit rows
 *
 * Temp files only (os.tmpdir()); the real .user data dir is never opened.
 */
import "../lib/isolated-data-dir.mjs"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { LATEST_VERSION, openDbAt, runMigrations } from "../../../src/db/index.js"
import { MIGRATIONS } from "../../../src/db/migrations/index.js"
import { AUDIT_KEY, AUDIT_NAMESPACE, migration as retiredModelIds } from "../../../src/db/migrations/0016-retired-model-ids.js"

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-retired-model-ids-smoke-"))
let counter = 0
const scratchDb = (label) => path.join(tempRoot, `${label}-${(counter += 1)}.db`)

const results = []
async function run(name, fn) {
  try {
    await fn()
    results.push({ status: "PASS", name })
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.stack || error.message : String(error) })
  }
}

const userVersion = (db) => db.pragma("user_version", { simple: true })
const hasMarker = (db, version) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get()) &&
  Boolean(db.prepare("SELECT 1 FROM meta WHERE key = ?").get(`migration:${version}`))
const upTo = (version) => MIGRATIONS.filter((entry) => entry.version <= version)

// Console lines from the migration are expected; keep the smoke output readable.
function silenced(fn) {
  const original = console.log
  console.log = () => {}
  try {
    return fn()
  } finally {
    console.log = original
  }
}

await run("RM-1 runner: run(db) migrations are marker-tracked, transactional; empty stubs unchanged", () => {
  const db = openDbAt(scratchDb("runner"), { skipMigrations: true })
  try {
    runMigrations(db, upTo(1))
    let calls = 0
    const dataStep = { version: 2, name: "data-step", sql: "", run: (conn) => {
      calls += 1
      conn.prepare("INSERT INTO kv_state (user_id, namespace, key, value_json, updated_at) VALUES ('u', 'n', 'k', '1', 'now')").run()
    } }
    const stub = { version: 3, name: "stub", sql: "" }
    const failing = { version: 4, name: "failing", sql: "CREATE TABLE should_roll_back (x INTEGER);", run: () => {
      throw new Error("boom")
    } }
    assert.deepEqual(runMigrations(db, [...upTo(1), dataStep, stub]), { from: 1, to: 3 })
    assert.equal(calls, 1)
    assert.equal(hasMarker(db, 2), true)
    assert.equal(hasMarker(db, 3), false, "an empty stub records no marker")
    runMigrations(db, [...upTo(1), dataStep, stub])
    assert.equal(calls, 1, "applied once")
    assert.throws(() => runMigrations(db, [...upTo(1), dataStep, stub, failing]), /Migration 4 \(failing\) failed: boom/)
    assert.equal(userVersion(db), 3)
    assert.equal(hasMarker(db, 4), false)
    assert.equal(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'should_roll_back'").get()), false)
    const asyncStep = { version: 4, name: "async", sql: "", run: async () => {} }
    assert.throws(() => runMigrations(db, [...upTo(1), dataStep, stub, asyncStep]), /must be synchronous/)
    assert.equal(hasMarker(db, 4), false)
  } finally {
    db.close()
  }
})

const FAKE_SECRET = "nv1:ZmFrZS1pdi0xMjM0NTY3OA==:ZmFrZS1jaXBoZXJ0ZXh0LW5vdC1hLXJlYWwta2V5:dGFn"
const TS = "2026-09-01T00:00:00.000Z"

function seedV15(db) {
  const config = {
    activeLlmProvider: "claude",
    openai: { connected: true, apiKey: FAKE_SECRET, baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1" },
    claude: { connected: true, apiKey: FAKE_SECRET, baseUrl: "https://api.anthropic.com", defaultModel: "claude-sonnet-4-20250514" },
    grok: { connected: false, apiKey: "", baseUrl: "https://api.x.ai/v1", defaultModel: "grok-4-0709" },
    gemini: { connected: false, apiKey: FAKE_SECRET, baseUrl: "", defaultModel: "Gemini-2.0-Flash" },
    brave: { connected: true, apiKey: FAKE_SECRET },
    telegram: { connected: false, botToken: FAKE_SECRET, chatIds: [] },
  }
  const insertConfig = db.prepare("INSERT INTO integration_configs (user_id, config_json, updated_at) VALUES (?, ?, ?)")
  insertConfig.run("alice", JSON.stringify(config), TS)
  insertConfig.run("broken", "{not json", TS)
  const insertState = db.prepare(
    "INSERT INTO integration_state (user_id, integration, key, value_json, expires_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
  insertState.run("alice", "runtime", "snapshot", JSON.stringify(config), TS)
  insertState.run("alice", "other", "snapshot", JSON.stringify({ claude: { defaultModel: "claude-3-haiku-20240307" } }), TS)
  insertState.run("broken", "runtime", "snapshot", "[not an object", TS)

  const insertTask = db.prepare(
    `INSERT INTO agent_tasks (user_id, id, name, prompt, agent, model, status, priority, permission_mode, progress,
       tokens_in, tokens_out, cost_usd, created_at, updated_at, deleted_at)
     VALUES (?, ?, 'task', 'p', ?, ?, ?, 'normal', 'default', 0, 0, 0, 0, ?, ?, ?)`,
  )
  insertTask.run("alice", "t-queued", "claude", "claude-3-7-sonnet-20250219", "queued", TS, TS, null)
  insertTask.run("alice", "t-paused", "grok", "grok-code-fast-1", "paused", TS, TS, null)
  insertTask.run("alice", "t-running", "openai", "o1-mini", "running", TS, TS, null)
  insertTask.run("alice", "t-served", "openai", "gpt-4.1-mini", "queued", TS, TS, null)
  insertTask.run("alice", "t-done", "claude", "claude-opus-4-20250514", "completed", TS, TS, null)
  insertTask.run("alice", "t-failed", "claude", "claude-opus-4-20250514", "failed", TS, TS, null)
  insertTask.run("alice", "t-cancelled", "claude", "claude-opus-4-20250514", "cancelled", TS, TS, null)
  insertTask.run("alice", "t-deleted", "claude", "claude-opus-4-20250514", "queued", TS, TS, TS)

  const mission = {
    id: "m1",
    label: "Daily brief",
    nodes: [
      { id: "n1", type: "ai-summarize", integration: "claude", model: "claude-3-5-haiku-20241022", prompt: "p" },
      { id: "n2", type: "ai-generate", integration: "gemini", model: "gemini-2.5-pro", prompt: "p" },
      { id: "n3", type: "ai-chat", integration: "grok", model: "grok-3", messages: [] },
      { id: "n4", type: "http-request", url: "https://example.test", body: "claude-3-opus-20240229" },
    ],
    workflowSteps: [{ type: "ai", aiIntegration: "openai", aiModel: "gpt-4.5-preview" }],
  }
  const insertMission = db.prepare(
    "INSERT INTO missions (user_id, id, data_json, label, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
  )
  insertMission.run("alice", "m1", JSON.stringify(mission), "Daily brief", TS, TS)
  insertMission.run("alice", "m-broken", "{oops", "Broken", TS, TS)
  db.prepare("INSERT INTO mission_versions (id, user_id, mission_id, ts, data_json) VALUES (?, ?, ?, ?, ?)")
    .run("v1", "alice", "m1", TS, JSON.stringify(mission))

  const insertKv = db.prepare("INSERT INTO kv_state (user_id, namespace, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?)")
  insertKv.run("alice", "agent-task-budget", "settings", JSON.stringify({
    defaultCostBudgetUsd: 2,
    economyModels: { openai: "gpt-5.6-luna", claude: "claude-3-haiku-20240307", gemini: "gemini-2.0-flash-lite", grok: "grok-build-0.1" },
  }), TS)
  insertKv.run("broken", "agent-task-budget", "settings", "not json", TS)
  insertKv.run("alice", "ui-storage", "nova_user_settings", JSON.stringify({ model: "claude-3-haiku-20240307" }), TS)

  db.prepare(
    `INSERT INTO llm_usage (user_id, id, ts, source, ref_id, provider, model, input_tokens, output_tokens)
     VALUES ('alice', 'u1', ?, 'chat', '', 'claude', 'claude-sonnet-4-20250514', 1, 1)`,
  ).run(TS)
}

function snapshotRows(db) {
  return {
    configs: db.prepare("SELECT user_id, config_json FROM integration_configs ORDER BY user_id").all(),
    state: db.prepare("SELECT user_id, integration, value_json FROM integration_state ORDER BY user_id, integration").all(),
    tasks: db.prepare("SELECT id, model FROM agent_tasks ORDER BY id").all(),
    missions: db.prepare("SELECT id, data_json FROM missions ORDER BY id").all(),
    versions: db.prepare("SELECT id, data_json FROM mission_versions ORDER BY id").all(),
    kv: db.prepare("SELECT user_id, namespace, key, value_json FROM kv_state ORDER BY user_id, namespace, key").all(),
    usage: db.prepare("SELECT id, model FROM llm_usage ORDER BY id").all(),
  }
}

const migratedDbPath = scratchDb("v15")

await run("RM-2 v15 DB: retired IDs rewritten where they are current choices, history kept, secrets untouched", () => {
  const db = openDbAt(migratedDbPath, { skipMigrations: true })
  try {
    runMigrations(db, upTo(15))
    assert.equal(userVersion(db), 15)
    seedV15(db)
    const before = snapshotRows(db)
    silenced(() => runMigrations(db))
    assert.equal(userVersion(db), LATEST_VERSION)
    assert.equal(hasMarker(db, 16), true)
    const after = snapshotRows(db)

    const aliceConfig = JSON.parse(after.configs.find((row) => row.user_id === "alice").config_json)
    assert.equal(aliceConfig.claude.defaultModel, "claude-sonnet-5")
    assert.equal(aliceConfig.grok.defaultModel, "grok-4.3")
    assert.equal(aliceConfig.gemini.defaultModel, "gemini-3.8-flash")
    assert.equal(aliceConfig.openai.defaultModel, "gpt-4.1", "still served: unchanged")
    for (const field of [aliceConfig.openai.apiKey, aliceConfig.claude.apiKey, aliceConfig.gemini.apiKey, aliceConfig.brave.apiKey, aliceConfig.telegram.botToken]) {
      assert.equal(field, FAKE_SECRET, "secret fields are byte-identical")
    }
    const beforeConfig = JSON.parse(before.configs.find((row) => row.user_id === "alice").config_json)
    assert.deepEqual(
      { ...aliceConfig, claude: { ...aliceConfig.claude, defaultModel: "" }, grok: { ...aliceConfig.grok, defaultModel: "" }, gemini: { ...aliceConfig.gemini, defaultModel: "" } },
      { ...beforeConfig, claude: { ...beforeConfig.claude, defaultModel: "" }, grok: { ...beforeConfig.grok, defaultModel: "" }, gemini: { ...beforeConfig.gemini, defaultModel: "" } },
      "only the model fields changed",
    )
    assert.equal(after.configs.find((row) => row.user_id === "broken").config_json, "{not json", "non-JSON row skipped")

    const runtimeSnapshot = JSON.parse(after.state.find((row) => row.user_id === "alice" && row.integration === "runtime").value_json)
    assert.equal(runtimeSnapshot.claude.defaultModel, "claude-sonnet-5")
    assert.equal(runtimeSnapshot.claude.apiKey, FAKE_SECRET)
    assert.deepEqual(
      after.state.find((row) => row.integration === "other"),
      before.state.find((row) => row.integration === "other"),
      "only the runtime snapshot is an integrations config",
    )
    assert.equal(after.state.find((row) => row.user_id === "broken").value_json, "[not an object")

    const taskModels = Object.fromEntries(after.tasks.map((row) => [row.id, row.model]))
    assert.deepEqual(taskModels, {
      "t-cancelled": "claude-opus-4-20250514",
      "t-deleted": "claude-opus-4-20250514",
      "t-done": "claude-opus-4-20250514",
      "t-failed": "claude-opus-4-20250514",
      "t-paused": "grok-build-0.1",
      "t-queued": "claude-sonnet-5",
      "t-running": "gpt-5.6-terra",
      "t-served": "gpt-4.1-mini",
    })

    const mission = JSON.parse(after.missions.find((row) => row.id === "m1").data_json)
    assert.equal(mission.nodes[0].model, "claude-haiku-4-5-20251001")
    assert.equal(mission.nodes[1].model, "gemini-2.5-pro", "still served: unchanged")
    assert.equal(mission.nodes[2].model, "grok-4.3")
    assert.equal(mission.nodes[3].body, "claude-3-opus-20240229", "only model fields are touched")
    assert.equal(mission.workflowSteps[0].aiModel, "gpt-5.6-sol")
    assert.equal(after.missions.find((row) => row.id === "m-broken").data_json, "{oops")
    assert.deepEqual(after.versions, before.versions, "mission_versions (history) unchanged")
    assert.deepEqual(after.usage, before.usage, "llm_usage (ledger) unchanged")

    const kv = (user, namespace, key) => after.kv.find((row) => row.user_id === user && row.namespace === namespace && row.key === key)
    const budget = JSON.parse(kv("alice", "agent-task-budget", "settings").value_json)
    assert.deepEqual(budget.economyModels, {
      openai: "gpt-5.6-luna",
      claude: "claude-haiku-4-5-20251001",
      gemini: "gemini-3.1-flash-lite",
      grok: "grok-build-0.1",
    })
    assert.equal(budget.defaultCostBudgetUsd, 2)
    assert.equal(kv("broken", "agent-task-budget", "settings").value_json, "not json")
    assert.equal(kv("alice", "ui-storage", "nova_user_settings").value_json, JSON.stringify({ model: "claude-3-haiku-20240307" }))

    const audit = JSON.parse(kv("alice", AUDIT_NAMESPACE, AUDIT_KEY).value_json)
    assert.equal(audit.length, 3 + 3 + 3 + 3 + 2) // configs, snapshot, tasks, mission fields, economy models
    for (const entry of audit) {
      assert.deepEqual(Object.keys(entry).sort(), ["field", "new", "old", "table", "ts", "where"])
      assert.doesNotMatch(JSON.stringify(entry), /nv1:/, "no secret in the audit")
    }
    assert.ok(audit.some((entry) => entry.table === "agent_tasks" && entry.where === "id=t-queued" && entry.old === "claude-3-7-sonnet-20250219" && entry.new === "claude-sonnet-5"))
    assert.ok(audit.some((entry) => entry.table === "integration_configs" && entry.field === "claude.defaultModel"))
    assert.equal(kv("broken", AUDIT_NAMESPACE, AUDIT_KEY), undefined, "no audit for a user with no change")
  } finally {
    db.close()
  }
})

await run("RM-3 idempotent: the data step run again changes nothing", () => {
  const db = openDbAt(migratedDbPath)
  try {
    const before = snapshotRows(db)
    runMigrations(db)
    let changed = -1
    db.exec("BEGIN IMMEDIATE")
    try {
      changed = retiredModelIds.run(db)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
    assert.equal(changed, 0)
    assert.deepEqual(snapshotRows(db), before)
  } finally {
    db.close()
  }
})

await run("RM-4 a DB that recorded 16 as an empty stub (user_version 17, no marker) still gets it applied", () => {
  const db = openDbAt(scratchDb("stub-recorded"), { skipMigrations: true })
  try {
    const asStub = MIGRATIONS.map((entry) => (entry.version === 16 ? { version: 16, name: entry.name, sql: "" } : entry))
    runMigrations(db, asStub)
    assert.equal(userVersion(db), LATEST_VERSION)
    assert.equal(hasMarker(db, 16), false)
    db.prepare("INSERT INTO integration_configs (user_id, config_json, updated_at) VALUES ('bob', ?, ?)")
      .run(JSON.stringify({ claude: { defaultModel: "claude-opus-4-1" } }), TS)
    silenced(() => runMigrations(db))
    assert.equal(hasMarker(db, 16), true)
    assert.equal(userVersion(db), LATEST_VERSION, "user_version never moves backwards")
    const config = JSON.parse(db.prepare("SELECT config_json FROM integration_configs WHERE user_id = 'bob'").get().config_json)
    assert.equal(config.claude.defaultModel, "claude-opus-5-5")
  } finally {
    db.close()
  }
})

await run("RM-5 fresh DB migrates cleanly with no audit rows", () => {
  const db = openDbAt(scratchDb("fresh"))
  try {
    assert.equal(userVersion(db), LATEST_VERSION)
    assert.equal(hasMarker(db, 16), true)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM kv_state WHERE namespace = ?").get(AUDIT_NAMESPACE).n, 0)
  } finally {
    db.close()
  }
})

try {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
} catch {
  // best effort
}

for (const result of results) {
  console.log(`[${result.status}] ${result.name}${result.detail ? `\n${result.detail}` : ""}`)
}
const failed = results.filter((result) => result.status === "FAIL").length
console.log(`\nretired-model-ids migration smoke: ${results.length - failed}/${results.length} passed`)
if (failed > 0) process.exitCode = 1
