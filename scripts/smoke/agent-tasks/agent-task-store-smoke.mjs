import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { loadHudTaskStore, repoRoot } from "../lib/hud-task-store.mjs"

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-agent-task-store-"))
const workspace = path.join(tempRoot, "workspace")
fs.mkdirSync(workspace, { recursive: true })
process.env.NOVA_DATA_DIR = path.join(tempRoot, "data")

// task-store.ts transpiled into tempRoot; its src/ imports (db, pricing, budget settings) point at the real modules.
const { store, taskAttachments } = loadHudTaskStore(tempRoot)
const { taskAttachmentDir } = taskAttachments
const dbModule = await import(pathToFileURL(path.join(repoRoot, "src", "db", "index.js")).href)
const db = dbModule.getDb()
process.chdir(workspace)

const sourceFile = path.join(tempRoot, "input.txt")
fs.writeFileSync(sourceFile, "immutable snapshot", "utf8")
const task = await store.createTask("store-smoke", {
  prompt: "Review the attachment",
  agent: "openai",
  model: "gpt-4.1-mini",
  attachedFiles: [sourceFile],
})
assert.deepEqual(task.attachedFiles, ["input.txt"])
const attachment = db.prepare(
  "SELECT * FROM agent_task_attachments WHERE user_id = ? AND task_id = ?",
).get("store-smoke", task.id)
assert.ok(attachment)
assert.notEqual(path.resolve(attachment.stored_path), path.resolve(sourceFile))
const managedPath = path.resolve(process.env.NOVA_DATA_DIR, attachment.stored_path)
assert.equal(fs.readFileSync(managedPath, "utf8"), "immutable snapshot")
assert.ok(!String(db.prepare("SELECT attached_files FROM agent_tasks WHERE id = ?").get(task.id).attached_files).includes(sourceFile))
fs.writeFileSync(sourceFile, "changed source", "utf8")
assert.equal(fs.readFileSync(managedPath, "utf8"), "immutable snapshot")

const contextId = "context-smoke"
db.prepare("INSERT INTO task_contexts (user_id, id, name, created_at) VALUES (?, ?, ?, ?)").run(
  "store-smoke",
  contextId,
  "Context",
  new Date().toISOString(),
)
const contextualTask = await store.createTask("store-smoke", {
  prompt: "Use sibling context",
  agent: "claude",
  model: "claude-test",
  contextId,
})
assert.equal(
  db.prepare("SELECT context_id FROM task_context_assignments WHERE user_id = ? AND task_id = ?")
    .get("store-smoke", contextualTask.id).context_id,
  contextId,
)
assert.equal(contextualTask.prompt, "Use sibling context", "client does not inject context summaries")

db.prepare(
  `UPDATE agent_tasks
   SET status = 'paused', pause_reason = 'approval',
       pending_approval_json = '{"toolName":"write","reason":"Approval required.","approvalKey":"write:test-hash","expiresAt":"2099-01-01T00:00:00.000Z"}'
   WHERE user_id = ? AND id = ?`,
).run("store-smoke", contextualTask.id)
const approved = await store.applyTaskAction("store-smoke", contextualTask.id, "play")
assert.equal(approved.status, "queued")
assert.deepEqual(approved.approvedTools, ["write:test-hash"])
assert.equal(approved.pendingApproval, undefined)

assert.equal(await store.deleteTask("store-smoke", task.id), true)
assert.equal(db.prepare("SELECT 1 FROM agent_tasks WHERE user_id = ? AND id = ?").get("store-smoke", task.id), undefined)
assert.equal(fs.existsSync(taskAttachmentDir("store-smoke", task.id)), false)

await assert.rejects(
  store.createTask("store-smoke", {
    prompt: "Invalid directory attachment",
    agent: "openai",
    model: "gpt-4.1-mini",
    attachedFiles: [tempRoot],
  }),
  /regular file/,
)

// ── Stage 4: per-task budgets (defaults, own budgets, budget pause, raise, resume, retry) ──
const fresh = await store.createTask("store-smoke", { prompt: "Budget defaults", agent: "openai", model: "gpt-5.6-terra" })
assert.equal(fresh.budgetState, "ok")
assert.deepEqual(fresh.budget, { costUsd: 0.25, tokens: 100000, costSource: "default", tokenSource: "default", active: true })
const own = await store.createTask("store-smoke", { prompt: "Own budget", agent: "openai", model: "gpt-5.6-terra", costBudgetUsd: 1.5, tokenBudget: null })
assert.equal(own.costBudgetUsd, 1.5)
assert.equal(own.tokenBudget, undefined)
assert.equal(own.budget.costSource, "task")
assert.equal(db.prepare("SELECT cost_budget_usd FROM agent_tasks WHERE id = ?").get(own.id).cost_budget_usd, 1.5)
await assert.rejects(store.createTask("store-smoke", { prompt: "x", agent: "openai", model: "m", costBudgetUsd: 500 }), /between \$0.01 and \$100/)
await assert.rejects(store.createTask("store-smoke", { prompt: "x", agent: "openai", model: "m", tokenBudget: 10 }), /1,000 and 10,000,000/)

// Budget pause: spent $0.30 of $0.25 default.
db.prepare(`UPDATE agent_tasks SET status = 'paused', pause_reason = 'budget', budget_state = 'exhausted', cost_usd = 0.30,
  tokens_in = 20000, tokens_out = 1000, error = 'Paused: budget' WHERE id = ?`).run(fresh.id)
const listed = (await store.listTasks("store-smoke")).find((t) => t.id === fresh.id)
assert.equal(listed.pauseReason, "budget")
assert.equal(listed.budgetState, "exhausted")
await assert.rejects(store.applyTaskAction("store-smoke", fresh.id, "play"), /already spent its budget/)
await assert.rejects(store.raiseTaskBudget("store-smoke", fresh.id, { costBudgetUsd: 0.3 }), /above the \$0.3 this task already spent/)
await assert.rejects(store.raiseTaskBudget("store-smoke", fresh.id, {}), /Enter a new cost or token budget/)
await assert.rejects(store.raiseTaskBudget("store-smoke", own.id, { costBudgetUsd: 2 }), /Only a task paused for its budget/)
const raised = await store.raiseTaskBudget("store-smoke", fresh.id, { costBudgetUsd: 0.35 })
assert.equal(raised.status, "queued")
assert.equal(raised.costBudgetUsd, 0.35)
assert.equal(raised.budgetState, "warning", "0.30/0.35 >= 80%")
assert.equal(raised.pauseReason, undefined)
assert.equal(raised.error, undefined)
const row = db.prepare("SELECT status, cost_budget_usd, budget_state, pause_reason FROM agent_tasks WHERE id = ?").get(fresh.id)
assert.deepEqual({ ...row }, { status: "queued", cost_budget_usd: 0.35, budget_state: "warning", pause_reason: null })

// Resume after the user raised the global default.
db.prepare(`UPDATE agent_tasks SET status = 'paused', pause_reason = 'budget', budget_state = 'exhausted', cost_usd = 0.30,
  cost_budget_usd = NULL WHERE id = ?`).run(fresh.id)
await assert.rejects(store.applyTaskAction("store-smoke", fresh.id, "play"), /already spent/)
assert.throws(() => store.updateTaskBudgetSettings("store-smoke", { defaultCostBudgetUsd: 1000 }), /between/)
assert.throws(() => store.updateTaskBudgetSettings("store-smoke", { economyModels: { openai: "claude-sonnet-5" } }), /economy model/)
assert.throws(() => store.updateTaskBudgetSettings("store-smoke", { economyModels: { mistral: "x" } }), /Unknown provider/)
const saved = store.updateTaskBudgetSettings("store-smoke", { defaultCostBudgetUsd: 1, defaultTokenBudget: null })
assert.equal(saved.defaultCostBudgetUsd, 1)
assert.equal(saved.defaultTokenBudget, null)
const resumed = await store.applyTaskAction("store-smoke", fresh.id, "play")
assert.equal(resumed.status, "queued")
assert.equal(resumed.budgetState, "ok")
assert.deepEqual(resumed.budget, { costUsd: 1, tokens: null, costSource: "default", tokenSource: "none", active: true })

// Retry of a failed task resets budget state.
db.prepare("UPDATE agent_tasks SET status = 'failed', budget_state = 'degraded' WHERE id = ?").run(own.id)
const retried = await store.applyTaskAction("store-smoke", own.id, "play")
assert.equal(retried.budgetState, "ok")

process.chdir(repoRoot)
dbModule.closeDb()
fs.rmSync(tempRoot, { recursive: true, force: true })
console.log("PASS task store: immutable managed attachments, atomic contexts, approvals, cleanup and budgets")
