/**
 * W5 smoke: home notes, agent tasks and calendar reschedule overrides on SQLite.
 * Everything runs against throwaway data dirs under the OS temp dir; the real .user / nova.db is never touched.
 * hud TypeScript (the task store) is transpiled to a temp dir, with its src/db import pointed at the real module.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import ts from "typescript"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const toUrl = (file) => pathToFileURL(file).href
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-local-data-smoke-"))
const dataDir = path.join(tempRoot, "data")
const previousDataDir = process.env.NOVA_DATA_DIR
process.env.NOVA_DATA_DIR = dataDir

const dbPath = path.join(repoRoot, "src", "db", "index.js")
const db = await import(toUrl(dbPath))
const notes = await import(toUrl(path.join(repoRoot, "src", "runtime", "modules", "services", "notes", "index.js")))
const overrides = await import(
  toUrl(path.join(repoRoot, "src", "runtime", "modules", "services", "calendar", "overrides-store", "index.js"))
)

// ─── transpile the hud task store ────────────────────────────────────────────
const dbModulePath = dbPath.replace(/\\/g, "/")
const TASK_FILES = [
  "hud/lib/agents/types.ts",
  "hud/lib/agents/task-events.ts",
  "hud/lib/agents/task-stats.ts",
  "hud/lib/git/worktree-manager.ts",
  "hud/lib/agents/task-store.ts",
  "hud/app/integrations/constants/types.ts",
  "hud/app/integrations/constants/pricing.ts",
  "hud/app/integrations/constants/openai-models.ts",
  "hud/app/integrations/constants/claude-models.ts",
  "hud/app/integrations/constants/grok-models.ts",
  "hud/app/integrations/constants/gemini-models.ts",
]
for (const relativePath of TASK_FILES) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  })
  const target = path.join(tempRoot, "ts", relativePath.replace(/\.ts$/, ".js"))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, output.outputText.split("../../../src/db/index.js").join(dbModulePath), "utf8")
}
const require = createRequire(path.join(tempRoot, "ts", "loader.cjs"))
const store = require("./hud/lib/agents/task-store.js")
const events = require("./hud/lib/agents/task-events.js")

// ─── harness ─────────────────────────────────────────────────────────────────
const results = []
async function run(name, fn) {
  try {
    await fn()
    results.push({ status: "PASS", name })
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.stack || error.message : String(error) })
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const rowCount = (table, userId) =>
  db.getDb().prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`).get(userId).n

function listFilesDeep(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFilesDeep(full))
    else out.push(full)
  }
  return out
}

const TASK_INPUT = { prompt: "do the thing", agent: "claude", model: "claude-sonnet-4-5" }

// ─── notes ───────────────────────────────────────────────────────────────────
await run("W5-1 notes: CRUD lives in the notes table and is scoped per user", async () => {
  const a = "w5-notes-a"
  const b = "w5-notes-b"
  const created = await notes.createHomeNote({ userContextId: a, content: "alpha note", source: "nova", conversationId: "Thread 1" })
  assert.equal(created.ok, true)
  assert.equal(created.note.createdBy, "nova")
  assert.equal(created.note.conversationId, "thread-1")
  await notes.createHomeNote({ userContextId: b, content: "bravo note" })
  assert.equal(rowCount("notes", a), 1)
  assert.equal(rowCount("notes", b), 1)

  const updated = await notes.updateHomeNote({ userContextId: a, noteId: created.note.id, content: "alpha edited" })
  assert.equal(updated.ok, true)
  assert.equal(updated.note.content, "alpha edited")
  const crossUpdate = await notes.updateHomeNote({ userContextId: b, noteId: created.note.id, content: "hijack" })
  assert.equal(crossUpdate.code, "notes.not_found", "user B cannot edit user A's note")
  const crossDelete = await notes.deleteHomeNote({ userContextId: b, noteId: created.note.id })
  assert.equal(crossDelete.code, "notes.not_found", "user B cannot delete user A's note")

  assert.deepEqual((await notes.listHomeNotes({ userContextId: b })).map((n) => n.content), ["bravo note"])
  assert.equal((await notes.deleteHomeNote({ userContextId: a, noteId: created.note.id })).ok, true)
  assert.equal(rowCount("notes", a), 0)
})

await run("W5-2 notes: newest first, content capped, 300-note cap evicts the oldest", async () => {
  const user = "w5-notes-cap"
  const first = await notes.createHomeNote({ userContextId: user, content: "y".repeat(900) })
  assert.equal(first.note.content.length, 400)
  await sleep(5)
  for (let i = 0; i < 300; i += 1) await notes.createHomeNote({ userContextId: user, content: `note ${i}` })
  assert.equal(rowCount("notes", user), 300)
  const listed = await notes.listHomeNotes({ userContextId: user, limit: 500 })
  assert.equal(listed.length, 300)
  assert.equal(listed.some((n) => n.id === first.note.id), false)
  const sorted = [...listed].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt) || y.id.localeCompare(x.id))
  assert.deepEqual(listed.map((n) => n.id), sorted.map((n) => n.id))
})

// ─── agent tasks ─────────────────────────────────────────────────────────────
await run("W5-3 tasks: create/action/delete round-trip, scoped per user", async () => {
  const a = "w5-tasks-a"
  const b = "w5-tasks-b"
  const task = await store.createTask(a, TASK_INPUT)
  assert.equal(task.status, "queued")
  assert.equal(rowCount("agent_tasks", a), 1)
  assert.equal((await store.listTasks(b)).length, 0)
  assert.equal(await store.getTask(b, task.id), null)
  await assert.rejects(() => store.applyTaskAction(b, task.id, "pause"), store.AgentTaskNotFoundError)
  assert.equal(await store.deleteTask(b, task.id), false, "user B cannot delete user A's task")

  const paused = await store.applyTaskAction(a, task.id, "pause")
  assert.equal(paused.status, "paused")
  assert.ok(paused.pausedAt)
  await assert.rejects(() => store.applyTaskAction(a, task.id, "play").then((t) => store.applyTaskAction(a, t.id, "stop")).then((t) => store.applyTaskAction(a, t.id, "stop")), store.AgentTaskTransitionError)
  assert.equal(await store.deleteTask(a, task.id), true)
  assert.equal(rowCount("agent_tasks", a), 0)
})

await run("W5-4 tasks: a throwing mutator rolls back and publishes nothing", async () => {
  const user = "w5-tasks-rollback"
  const task = await store.createTask(user, TASK_INPUT)
  const seen = []
  const unsubscribe = events.subscribeTaskEvents(user, (event) => seen.push(event))
  await assert.rejects(
    () =>
      store.mutateTasks(user, (tasks) => {
        tasks[0].progress = 77
        throw new Error("boom")
      }),
    /boom/,
  )
  unsubscribe()
  assert.equal(seen.length, 0, "no event on rollback")
  assert.equal((await store.getTask(user, task.id)).progress, 0, "progress change was rolled back")
})

await run("W5-5 tasks: one event per changed task, delete publishes task.deleted, no-op emits nothing", async () => {
  const user = "w5-tasks-events"
  const seen = []
  const unsubscribe = events.subscribeTaskEvents(user, (event) => seen.push(event))
  const task = await store.createTask(user, TASK_INPUT)
  assert.deepEqual(seen.map((e) => e.type), ["task.upserted"])
  await store.mutateTasks(user, () => undefined)
  assert.equal(seen.length, 1, "unchanged mutate emits nothing")
  await store.applyTaskAction(user, task.id, "pause")
  assert.equal(seen.length, 2)
  await store.deleteTask(user, task.id)
  unsubscribe()
  assert.deepEqual(seen.map((e) => e.type), ["task.upserted", "task.upserted", "task.deleted"])
  assert.equal(seen[2].id, task.id)
})

await run("W5-6 tasks: 300-task cap evicts the oldest finished task only", async () => {
  const user = "w5-tasks-cap"
  const created = []
  for (let i = 0; i < 300; i += 1) created.push(await store.createTask(user, { ...TASK_INPUT, name: `t${i}` }))
  await assert.rejects(() => store.createTask(user, TASK_INPUT), /Task limit reached/)
  await store.mutateTasks(user, (tasks) => {
    const target = tasks.find((t) => t.id === created[5].id)
    target.status = "completed"
  })
  const extra = await store.createTask(user, { ...TASK_INPUT, name: "extra" })
  const ids = new Set((await store.listTasks(user)).map((t) => t.id))
  assert.equal(ids.size, 300)
  assert.equal(ids.has(created[5].id), false, "the completed task was evicted")
  assert.equal(ids.has(extra.id), true)
})

// ─── calendar overrides ──────────────────────────────────────────────────────
await run("W5-7 calendar overrides: set/get/load/delete, update keeps original time, user-scoped", async () => {
  const a = "w5-cal-a"
  const b = "w5-cal-b"
  const t0 = "2026-10-01T09:00:00.000Z"
  const t1 = "2026-10-02T09:00:00.000Z"
  const t2 = "2026-10-03T09:00:00.000Z"
  const first = await overrides.setRescheduleOverride(a, "mission-1", t1, t0)
  assert.equal(first.originalTime, t0)
  assert.equal(first.overriddenTime, t1)
  assert.equal(first.overriddenBy, "calendar")
  await sleep(5)
  const second = await overrides.setRescheduleOverride(a, "mission-1", t2, "2030-01-01T00:00:00.000Z")
  assert.equal(second.originalTime, t0, "original time is kept on update")
  assert.equal(second.overriddenTime, t2)
  assert.equal(second.createdAt, first.createdAt)
  assert.notEqual(second.updatedAt, first.updatedAt)
  assert.equal((await overrides.loadRescheduleOverrides(a)).length, 1)
  assert.equal(await overrides.getRescheduleOverride(b, "mission-1"), null)
  assert.deepEqual(await overrides.loadRescheduleOverrides(b), [])
  assert.equal(await overrides.deleteRescheduleOverride(b, "mission-1"), false, "user B cannot delete user A's override")
  assert.equal(await overrides.deleteRescheduleOverride(a, "mission-1"), true)
  assert.equal(await overrides.getRescheduleOverride(a, "mission-1"), null)
})

await run("W5-8 calendar overrides: invalid input throws, blank user is inert", async () => {
  await assert.rejects(() => overrides.setRescheduleOverride("u", "m", "not-a-date", "2026-10-01T09:00:00.000Z"), /Invalid calendar override input/)
  await assert.rejects(() => overrides.setRescheduleOverride("u", "m", "2026-10-01T09:00:00.000Z", ""), /Invalid calendar override input/)
  await assert.rejects(() => overrides.setRescheduleOverride("", "m", "2026-10-01T09:00:00.000Z", "2026-10-01T09:00:00.000Z"), /Invalid calendar override input/)
  assert.deepEqual(await overrides.loadRescheduleOverrides(""), [])
  assert.equal(await overrides.getRescheduleOverride("", "m"), null)
  assert.equal(await overrides.deleteRescheduleOverride("", "m"), false)
})

// ─── persistence across reopen + no JSON left behind ─────────────────────────
await run("W5-9 data survives closing and reopening the database; no JSON state files are written", async () => {
  const before = (await notes.listHomeNotes({ userContextId: "w5-notes-b" })).map((n) => n.id)
  const tasksBefore = (await store.listTasks("w5-tasks-cap")).length
  db.closeDb()
  assert.deepEqual((await notes.listHomeNotes({ userContextId: "w5-notes-b" })).map((n) => n.id), before)
  assert.equal((await store.listTasks("w5-tasks-cap")).length, tasksBefore)
  const jsonFiles = listFilesDeep(dataDir).filter((file) => /\.jsonl?$/i.test(file))
  assert.deepEqual(jsonFiles, [], "the SQLite stores must not write JSON files")
})

await run("W5-10 migration 0004 creates the local-data tables", async () => {
  const conn = db.getDb()
  const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  for (const table of ["notes", "agent_tasks", "calendar_overrides"]) assert.ok(tables.includes(table), `${table} table exists`)
  assert.ok(db.LATEST_VERSION >= 4)
})

// ─── report ──────────────────────────────────────────────────────────────────
db.closeDb()
if (previousDataDir === undefined) delete process.env.NOVA_DATA_DIR
else process.env.NOVA_DATA_DIR = previousDataDir
fs.rmSync(tempRoot, { recursive: true, force: true })

let failed = 0
for (const { status, name, detail } of results) {
  if (status === "FAIL") failed += 1
  console.log(`${status} ${name}${detail ? `\n     ${detail}` : ""}`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
