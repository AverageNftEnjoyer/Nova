import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-agent-task-runtime-"))
process.env.NOVA_DATA_DIR = path.join(tempRoot, "data")
process.env.NOVA_AGENT_TASK_POLL_MS = "10"
process.env.NOVA_AGENT_TASK_HEARTBEAT_MS = "20"
process.env.NOVA_AGENT_TASK_LEASE_MS = "200"

const { getDb, closeDb } = await import("../../../src/db/index.js")
const { startAgentTaskService } = await import("../../../src/runtime/modules/agent-tasks/index.js")

const db = getDb()
const controls = new Map()
const calls = []
const abortedPrompts = []

function insertTask(id, priority, createdOffset) {
  const timestamp = new Date(Date.parse("2026-09-21T12:00:00.000Z") + createdOffset).toISOString()
  db.prepare(
    `INSERT INTO agent_tasks
       (user_id, id, name, prompt, agent, model, status, priority, permission_mode, progress,
        tokens_in, tokens_out, cost_usd, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, 'default', 0, 0, 0, 0, ?, ?)`,
  ).run("runtime-smoke", id, id, `prompt-${id}`, "openai", "gpt-4.1-mini", priority, timestamp, timestamp)
}

function waitFor(predicate, label, timeoutMs = 3_000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resolve()
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`Timed out waiting for ${label}`))
      }
    }, 10)
  })
}

for (const [index, priority] of ["low", "low", "high", "normal", "high", "normal", "low"].entries()) {
  insertTask(`task-${index}`, priority, index)
}

const stop = startAgentTaskService({
  handleInput: async (prompt, opts) => {
    calls.push({ prompt, opts })
    if (prompt === "prompt-task-approval") {
      return {
        ok: false,
        error: "Approval required before running elevated tool \"write\".",
        errorCode: "AGENT_TASK_APPROVAL_REQUIRED",
        pendingApproval: {
          toolName: "write",
          reason: "Approval required.",
          approvalKey: "write:test-approval-key",
        },
      }
    }
    if (prompt === "prompt-task-redaction") {
      return {
        ok: true,
        reply: `apiKey=sk-proj-${"a".repeat(48)}\n${"x".repeat(70_000)}`,
        promptTokens: 1,
        completionTokens: 1,
      }
    }
    if (prompt === "prompt-task-effect") {
      opts.reserveTaskEffect("external:test-effect");
      assert.throws(
        () => opts.reserveTaskEffect("external:test-effect"),
        (error) => error?.code === "AGENT_TASK_DUPLICATE_EFFECT",
      );
      return { ok: true, reply: "effect reserved", promptTokens: 1, completionTokens: 1 };
    }
    if (prompt === "prompt-task-expired-approval") {
      assert.deepEqual(opts.approvedTools, []);
      return { ok: true, reply: "expired grant rejected", promptTokens: 1, completionTokens: 1 };
    }
    if (prompt === "prompt-task-single-use-approval") {
      assert.deepEqual(opts.approvedTools, ["write:single-use"]);
      opts.consumeTaskApproval("write:single-use");
      assert.throws(
        () => opts.consumeTaskApproval("write:single-use"),
        /missing, expired, or already consumed/,
      );
      return { ok: true, reply: "grant consumed once", promptTokens: 1, completionTokens: 1 };
    }
    return await new Promise((resolve, reject) => {
      const onAbort = () => {
        abortedPrompts.push(prompt)
        reject(opts.abortSignal.reason || new Error("aborted"))
      }
      opts.abortSignal.addEventListener("abort", onAbort, { once: true })
      controls.set(prompt, {
        resolve: () => {
          opts.abortSignal.removeEventListener("abort", onAbort)
          resolve({
            ok: true,
            reply: `completed:${prompt}`,
            promptTokens: 120,
            completionTokens: 40,
            toolCalls: ["web_search"],
          })
        },
      })
    })
  },
})

await waitFor(() => calls.length === 5, "five claimed tasks")
assert.deepEqual(
  calls.map((call) => call.prompt),
  ["prompt-task-2", "prompt-task-4", "prompt-task-3", "prompt-task-5", "prompt-task-0"],
  "runtime claims priority then FIFO",
)
assert.ok(calls.every((call) => call.opts.preferredProvider === "openai"))
assert.ok(calls.every((call) => call.opts.preferredModel === "gpt-4.1-mini"))
assert.ok(calls.every((call) => call.opts.autonomousTask === true))

let counts = db.prepare("SELECT status, COUNT(*) AS count FROM agent_tasks GROUP BY status").all()
assert.equal(counts.find((row) => row.status === "running")?.count, 5)
assert.equal(counts.find((row) => row.status === "queued")?.count, 2)

controls.get("prompt-task-2").resolve()
await waitFor(() => calls.length === 6, "queued promotion after completion")
assert.equal(calls[5].prompt, "prompt-task-1")

for (const control of controls.values()) control.resolve()
await waitFor(
  () => Number(db.prepare("SELECT COUNT(*) AS count FROM agent_tasks WHERE status = 'completed'").get().count) >= 6,
  "completed runtime tasks",
)

const completed = db.prepare("SELECT * FROM agent_tasks WHERE id = 'task-2'").get()
assert.equal(completed.result_text, "completed:prompt-task-2")
assert.equal(completed.tokens_in, 120)
assert.equal(completed.tokens_out, 40)
assert.deepEqual(JSON.parse(completed.tool_calls), ["web_search"])
assert.equal(completed.progress, 100)
assert.equal(completed.lease_owner, null)

controls.get("prompt-task-1")?.resolve()
await waitFor(() => calls.length === 7, "final queued promotion")
controls.get("prompt-task-6").resolve()
await waitFor(
  () => Number(db.prepare("SELECT COUNT(*) AS count FROM agent_tasks WHERE status = 'completed'").get().count) === 7,
  "all runtime tasks complete",
)

insertTask("task-pause", "high", 100)
await waitFor(() => calls.some((call) => call.prompt === "prompt-task-pause"), "pause task claimed")
db.prepare(
  "UPDATE agent_tasks SET status = 'paused', paused_at = ?, updated_at = ? WHERE id = 'task-pause'",
).run(new Date().toISOString(), new Date().toISOString())
await waitFor(() => abortedPrompts.includes("prompt-task-pause"), "pause abort propagation")
const paused = db.prepare("SELECT status, result_text FROM agent_tasks WHERE id = 'task-pause'").get()
assert.equal(paused.status, "paused")
assert.equal(paused.result_text, null)

insertTask("task-approval", "high", 101)
await waitFor(
  () => db.prepare("SELECT status FROM agent_tasks WHERE id = 'task-approval'").get()?.status === "paused",
  "approval pause persistence",
)
const approval = db.prepare(
  "SELECT pause_reason, pending_approval_json, lease_owner FROM agent_tasks WHERE id = 'task-approval'",
).get()
assert.equal(approval.pause_reason, "approval")
assert.equal(JSON.parse(approval.pending_approval_json).toolName, "write")
assert.equal(approval.lease_owner, null)

const deleteAttachmentDir = path.join(process.env.NOVA_DATA_DIR, "agent-task-files", "runtime-smoke", "task-delete")
fs.mkdirSync(deleteAttachmentDir, { recursive: true })
const deleteAttachmentPath = path.join(deleteAttachmentDir, "file.txt")
fs.writeFileSync(deleteAttachmentPath, "delete me")
db.transaction(() => {
  insertTask("task-delete", "low", 102)
  db.prepare(
    "UPDATE agent_tasks SET status = 'cancelled', deleted_at = ?, completed_at = ? WHERE id = 'task-delete'",
  ).run(new Date().toISOString(), new Date().toISOString())
  db.prepare(
    `INSERT INTO agent_task_attachments
       (user_id, task_id, id, display_name, stored_path, mime_type, size_bytes, sha256, created_at)
     VALUES ('runtime-smoke', 'task-delete', 'file', 'file.txt', ?, 'text/plain', 9, 'test', ?)`,
  ).run(deleteAttachmentPath, new Date().toISOString())
})()
await waitFor(
  () => db.prepare("SELECT 1 FROM agent_tasks WHERE id = 'task-delete'").get() === undefined,
  "deferred delete finalization",
)
assert.equal(fs.existsSync(deleteAttachmentDir), false)

insertTask("task-redaction", "low", 103)
await waitFor(
  () => db.prepare("SELECT status FROM agent_tasks WHERE id = 'task-redaction'").get()?.status === "completed",
  "redacted bounded result",
)
const boundedResult = db.prepare("SELECT result_text FROM agent_tasks WHERE id = 'task-redaction'").get().result_text
assert.ok(boundedResult.length <= 64_000)
assert.ok(!boundedResult.includes("sk-proj-"))

insertTask("task-effect", "low", 104)
await waitFor(
  () => db.prepare("SELECT status FROM agent_tasks WHERE id = 'task-effect'").get()?.status === "completed",
  "at-most-once side-effect reservation",
)
assert.equal(
  db.prepare("SELECT COUNT(*) AS count FROM agent_task_effects WHERE task_id = 'task-effect'").get().count,
  1,
)

insertTask("task-expired-approval", "low", 105)
db.prepare("UPDATE agent_tasks SET approved_tools_json = ? WHERE id = ?").run(
  JSON.stringify([{ key: "write:expired", expiresAt: "2000-01-01T00:00:00.000Z" }]),
  "task-expired-approval",
)
insertTask("task-single-use-approval", "low", 106)
db.prepare("UPDATE agent_tasks SET approved_tools_json = ? WHERE id = ?").run(
  JSON.stringify([{ key: "write:single-use", expiresAt: "2099-01-01T00:00:00.000Z" }]),
  "task-single-use-approval",
)
await waitFor(
  () => db.prepare(
    "SELECT COUNT(*) AS count FROM agent_tasks WHERE id IN ('task-expired-approval', 'task-single-use-approval') AND status = 'completed'",
  ).get().count === 2,
  "approval expiry and single-use consumption",
)

stop()
closeDb()
fs.rmSync(tempRoot, { recursive: true, force: true })
console.log("PASS real runtime scheduler: priority/FIFO, max 5, provider/model pinning, usage and result persistence")
