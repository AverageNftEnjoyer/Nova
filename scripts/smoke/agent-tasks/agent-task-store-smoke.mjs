import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-agent-task-store-"))
const workspace = path.join(tempRoot, "workspace")
fs.mkdirSync(workspace, { recursive: true })
process.env.NOVA_DATA_DIR = path.join(tempRoot, "data")

const dbModulePath = path.join(repoRoot, "src", "db", "index.js").replace(/\\/g, "/")
const dbPathsModulePath = path.join(repoRoot, "src", "db", "paths.js").replace(/\\/g, "/")

function transpile(relativePaths) {
  for (const relativePath of relativePaths) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    })
    const target = path.join(tempRoot, relativePath.replace(/\.ts$/, ".js"))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const rewritten = output.outputText
      .split("../../../src/db/index.js").join(dbModulePath)
      .split("../../../src/db/paths.js").join(dbPathsModulePath)
    fs.writeFileSync(target, rewritten, "utf8")
  }
}

transpile([
  "hud/lib/agents/types.ts",
  "hud/lib/agents/task-events.ts",
  "hud/lib/agents/task-stats.ts",
  "hud/lib/agents/task-attachments.ts",
  "hud/lib/git/worktree-manager.ts",
  "hud/lib/agents/task-store.ts",
  "hud/app/integrations/constants/types.ts",
  "hud/app/integrations/constants/pricing.ts",
  "hud/app/integrations/constants/openai-models.ts",
  "hud/app/integrations/constants/claude-models.ts",
  "hud/app/integrations/constants/grok-models.ts",
  "hud/app/integrations/constants/gemini-models.ts",
])

const require = createRequire(path.join(tempRoot, "loader.cjs"))
const store = require("./hud/lib/agents/task-store.js")
const { taskAttachmentDir } = require("./hud/lib/agents/task-attachments.js")
const dbModule = require(dbModulePath)
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

process.chdir(repoRoot)
dbModule.closeDb()
fs.rmSync(tempRoot, { recursive: true, force: true })
console.log("PASS task store: immutable managed attachments, atomic contexts, approvals and cleanup")
