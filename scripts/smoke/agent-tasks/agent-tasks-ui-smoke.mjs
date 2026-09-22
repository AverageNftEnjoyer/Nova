import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const hudRoot = path.join(process.cwd(), "hud");
const read = (rel) => fs.readFileSync(path.join(hudRoot, rel), "utf8");

const uiFiles = [
  "components/agents/task-card.tsx",
  "components/agents/task-list.tsx",
  "components/agents/create-task-modal.tsx",
  "app/home/components/agent-tasks-home-module.tsx",
];

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}\n  ${error.message}`);
    process.exitCode = 1;
  }
}

check("home-main-screen wires AgentTasksHomeModule and NotesHomeModule", () => {
  const screen = read("app/home/components/home-main-screen.tsx");
  assert.match(screen, /import \{ AgentTasksHomeModule \} from "\.\/agent-tasks-home-module"/);
  assert.match(screen, /import \{ NotesHomeModule \} from "\.\/notes-home-module"/);
  assert.match(screen, /<AgentTasksHomeModule/);
  assert.match(screen, /<NotesHomeModule/);
  assert.doesNotMatch(screen, /Placeholder(One|Two)HomeModule/);
});

check("module is driven by useAgentTasks and opens the create modal", () => {
  const mod = read("app/home/components/agent-tasks-home-module.tsx");
  assert.match(mod, /useAgentTasks\(\)/);
  assert.match(mod, /<CreateTaskModal/);
  assert.match(mod, /<TaskList/);
  assert.doesNotMatch(mod, /setInterval/);
});

check("task card renders all 6 statuses", () => {
  const card = read("components/agents/task-card.tsx");
  for (const status of ["running", "queued", "paused", "completed", "failed", "cancelled"]) {
    assert.ok(card.includes(`${status}: { label:`), `missing status style: ${status}`);
  }
});

check("task list groups Running / Queued / Completed / Failed", () => {
  const list = read("components/agents/task-list.tsx");
  for (const label of ["Running", "Queued", "Completed", "Failed"]) {
    assert.match(list, new RegExp(`label: "${label}"`));
  }
  assert.match(list, /statuses: \["queued", "paused"\]/);
  assert.match(list, /statuses: \["failed", "cancelled"\]/);
});

check("modal wires all 5 permission modes and the bypass warning", () => {
  const card = read("components/agents/task-card.tsx");
  const modal = read("components/agents/create-task-modal.tsx");
  for (const mode of ["default", "accept-edits", "plan-mode", "dont-ask", "bypass"]) {
    assert.ok(card.includes(mode), `permission label missing: ${mode}`);
  }
  assert.match(modal, /PERMISSION_MODE_LABELS/);
  assert.match(modal, /permissionMode === "bypass"/);
  assert.match(modal, /Bypass allows elevated operations/);
});

check("modal offers all four providers from the shared model option constants", () => {
  const modal = read("components/agents/create-task-modal.tsx");
  for (const constant of ["CLAUDE_MODEL_OPTIONS", "OPENAI_MODEL_OPTIONS", "GEMINI_MODEL_OPTIONS", "GROK_MODEL_OPTIONS"]) {
    assert.ok(modal.includes(constant), `missing ${constant}`);
  }
});

check("no legacy /api/tasks route and no console.log in the UI", () => {
  for (const rel of uiFiles) {
    const source = read(rel);
    assert.ok(!source.includes("/api/tasks"), `${rel} references /api/tasks`);
    assert.ok(!source.includes("console.log"), `${rel} contains console.log`);
  }
});

check("no horizontal-overflow regressions in the task list container", () => {
  const list = read("components/agents/task-list.tsx");
  assert.match(list, /overflow-y-auto overflow-x-hidden/);
  assert.match(list, /min-h-0/);
});

console.log(`${passed} checks passed`);
