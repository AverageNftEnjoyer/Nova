/**
 * Agent Task File Drop Smoke Test
 *
 * Verifies the file drag-and-drop implementation:
 * - Types include attachedFiles field
 * - Modal has dropzone UI and file management
 * - Electron handles file drops
 * - Database supports attached_files column
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const hudRoot = path.join(process.cwd(), "hud")
const srcRoot = path.join(process.cwd(), "src")
const read = (rel, root = hudRoot) => fs.readFileSync(path.join(root, rel), "utf8")

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}\n  ${error.message}`)
    process.exitCode = 1
  }
}

check("types.ts includes attachedFiles in AgentTask", () => {
  const types = read("lib/agents/types.ts")
  assert.match(types, /attachedFiles\?: string\[\]/, "AgentTask missing attachedFiles field")
})

check("types.ts includes attachedFiles in CreateAgentTaskInput", () => {
  const types = read("lib/agents/types.ts")
  assert.match(types, /export interface CreateAgentTaskInput/, "CreateAgentTaskInput interface not found")
  const inputInterface = types.match(/export interface CreateAgentTaskInput \{[^}]+\}/s)?.[0]
  assert.ok(inputInterface?.includes("attachedFiles"), "CreateAgentTaskInput missing attachedFiles field")
})

check("create-task-modal has File icon import", () => {
  const modal = read("components/agents/create-task-modal.tsx")
  assert.match(modal, /import \{[^}]*File[^}]*\} from "lucide-react"/, "File icon not imported")
})

check("create-task-modal has attachedFiles state", () => {
  const modal = read("components/agents/create-task-modal.tsx")
  assert.match(modal, /useState<string\[\]>\(\[\]\)/, "attachedFiles state not found")
})

check("create-task-modal has isDragging state", () => {
  const modal = read("components/agents/create-task-modal.tsx")
  assert.match(modal, /isDragging/, "isDragging state not found")
})

check("create-task-modal has removeFile function", () => {
  const modal = read("components/agents/create-task-modal.tsx")
  assert.match(modal, /removeFile/, "removeFile function not found")
})

check("create-task-modal has dropzone UI with drag handlers", () => {
  const modal = read("components/agents/create-task-modal.tsx")
  assert.match(modal, /onDragOver/, "onDragOver handler not found")
  assert.match(modal, /onDragLeave/, "onDragLeave handler not found")
  assert.match(modal, /onDrop/, "onDrop handler not found")
})

check("create-task-modal includes attachedFiles in onCreate call", () => {
  const modal = read("components/agents/create-task-modal.tsx")
  assert.match(modal, /attachedFiles:.*attachedFiles/, "attachedFiles not passed to onCreate")
})

check("create-task-modal clears attachedFiles on success", () => {
  const modal = read("components/agents/create-task-modal.tsx")
  assert.match(modal, /setAttachedFiles\(\[\]\)/, "attachedFiles not cleared on success")
})

check("create-task-modal listens for Electron file drops", () => {
  const modal = read("components/agents/create-task-modal.tsx")
  assert.match(modal, /electronAPI\?\.onFileDrop/, "onFileDrop listener not found")
  assert.match(modal, /return \(\) => \{[\s\S]*unsubscribe\(\)/, "file-drop listener is not removed on cleanup")
})

check("create-task-modal reads dropped file paths", () => {
  const modal = read("components/agents/create-task-modal.tsx")
  assert.match(modal, /e\.dataTransfer\?\.files/, "drop handler does not read dropped files")
  assert.match(modal, /getPathForFile\(file\)/, "drop handler does not resolve the Electron file path")
})

check("electron/main.js handles file drops", () => {
  const main = read("electron/main.js")
  assert.match(main, /will-navigate/, "will-navigate handler not found")
  assert.match(main, /event\.preventDefault\(\)/, "file navigation is not blocked")
  assert.match(main, /file-dropped/, "file-dropped event not found")
  assert.match(main, /require\('\.\/file-url-path'\)/, "file URL path decoder is not used")
})

check("file URLs decode to local paths", async () => {
  const { fileUrlToPath } = await import("../../../hud/electron/file-url-path.js")
  if (process.platform === "win32") {
    assert.equal(fileUrlToPath("file:///C:/Users/Jack/My%20File.txt"), "C:/Users/Jack/My File.txt")
  } else {
    assert.equal(fileUrlToPath("file:///tmp/My%20File.txt"), "/tmp/My File.txt")
  }
  assert.equal(fileUrlToPath("notaurl"), "")
})

check("electron/preload.js exposes onFileDrop", () => {
  const preload = read("electron/preload.js")
  assert.match(preload, /onFileDrop:/, "onFileDrop not exposed")
  assert.match(preload, /removeListener\('file-dropped', listener\)/, "onFileDrop does not unsubscribe its own listener")
  assert.match(preload, /getPathForFile: \(file\) => webUtils\.getPathForFile\(file\)/, "getPathForFile is not exposed")
})

check("task-store handles attachedFiles in rowToTask", () => {
  const store = read("lib/agents/task-store.ts")
  assert.match(store, /attached_files/, "attached_files column not referenced")
  assert.match(store, /JSON\.parse\(row\.attached_files\)/, "attachedFiles not parsed from JSON")
})

check("task-store includes attached_files in upsertTask", () => {
  const store = read("lib/agents/task-store.ts")
  assert.match(store, /attached_files/, "attached_files not in INSERT statement")
  assert.match(store, /JSON\.stringify\(task\.attachedFiles\)/, "attachedFiles not stringified for storage")
})

check("task-store validates attachedFiles in validateCreateInput", () => {
  const store = read("lib/agents/task-store.ts")
  assert.match(store, /attachedFiles.*input.*attachedFiles/, "attachedFiles validation not found")
  assert.match(store, /slice\(0, 20\)/, "file limit (20) not enforced")
})

check("migration 0006 adds attached_files column", () => {
  const migration = read("db/migrations/0006-agent-task-files.js", srcRoot)
  assert.match(migration, /ALTER TABLE agent_tasks ADD COLUMN attached_files TEXT/, "migration doesn't add attached_files column")
})

check("migrations index includes 0006", () => {
  const index = read("db/migrations/index.js", srcRoot)
  assert.match(index, /0006-agent-task-files/, "migration 0006 not imported")
  assert.match(index, /agentTaskFiles/, "agentTaskFiles not in MIGRATIONS array")
})

console.log(`\n${passed} checks passed`)
if (process.exitCode) {
  console.log("❌ Some checks failed")
} else {
  console.log("✅ All checks passed")
}
