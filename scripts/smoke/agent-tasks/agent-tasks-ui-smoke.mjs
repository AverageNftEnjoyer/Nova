import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const hudRoot = path.join(process.cwd(), "hud");
const read = (rel) => fs.readFileSync(path.join(hudRoot, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(hudRoot, rel));

// Every UI file of /runs, /deployments and /deployments/new, plus the shared agent-run components.
const uiFiles = [
  "app/runs/page.tsx",
  "app/runs/components/runs-screen.tsx",
  "app/runs/components/runs-table.tsx",
  "app/runs/components/run-detail-sheet.tsx",
  "app/runs/components/run-row-actions.tsx",
  "app/runs/components/waiting-for-you.tsx",
  "app/runs/hooks/use-run-actions.ts",
  "app/runs/lib/run-rows.ts",
  "app/deployments/page.tsx",
  "app/deployments/new/page.tsx",
  "app/deployments/components/deployment-list-screen.tsx",
  "app/deployments/components/deployment-detail-sheet.tsx",
  "app/deployments/components/new-deployment-screen.tsx",
  "app/deployments/components/new-deployment-flow.tsx",
  "app/deployments/components/new-deployment-tabs.ts",
  "app/deployments/components/manager-panel.tsx",
  "app/deployments/components/automation-panel.tsx",
  "app/deployments/hooks/use-deployment-manager.ts",
  "app/deployments/hooks/use-deployments-data.ts",
  "components/agents/advanced-task-form.tsx",
  "components/agents/budget.tsx",
  "components/agents/raise-budget-form.tsx",
  "components/agents/permission-modes.ts",
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

check("/runs renders the runs screen with status tabs, waiting-for-you and the run sheet", () => {
  assert.match(read("app/runs/page.tsx"), /<RunsScreen \/>/);
  const screen = read("app/runs/components/runs-screen.tsx");
  assert.match(screen, /searchParams\.get\("run"\)/, "/runs?run=<id> must open that run");
  assert.match(screen, /<WaitingForYou/);
  assert.match(screen, /<RunDetailSheet/);
  assert.match(screen, /<RunsTable/);
  assert.match(screen, /useAgentTasks\(\)/);
  assert.match(screen, /useDeploymentsData\(\)/);
  const rows = read("app/runs/lib/run-rows.ts");
  for (const label of ["All", "Needs approval", "Running", "Completed", "Failed"]) {
    assert.match(rows, new RegExp(`label: "${label}"`), `missing tab ${label}`);
  }
});

check("run rows map every deployment-run and agent-task status", () => {
  const rows = read("app/runs/lib/run-rows.ts");
  for (const status of ["pending", "queued", "running", "paused", "succeeded", "failed", "cancelled", "dead"]) {
    assert.match(rows, new RegExp(`\\n  ${status}: "`), `run status not mapped: ${status}`);
  }
  for (const status of ["queued", "running", "paused", "completed", "failed", "cancelled"]) {
    assert.ok(rows.includes(`${status}: "`), `task status not mapped: ${status}`);
  }
  assert.match(rows, /pauseReason === "approval"/);
  assert.match(rows, /pauseReason === "budget"/);
  assert.match(rows, /runNeedsReview\(run\)/);
});

check("run actions cover approve, deny, cancel, pause/resume and raise budget", () => {
  const actions = read("app/runs/hooks/use-run-actions.ts");
  for (const action of ["approve", "deny", "approve-tool", "deny-tool", "pause", "resume", "cancel", "retry", "rerun", "delete"]) {
    assert.ok(actions.includes(`"${action}"`), `missing action ${action}`);
  }
  assert.match(actions, /data\.raiseBudget\(row\.run\.id, input\)/);
  assert.match(actions, /agentTasks\.raiseBudget\(row\.task\.id, input\)/);
  const data = read("app/deployments/hooks/use-deployments-data.ts");
  assert.match(data, /\/api\/deployment-runs\/\$\{encodeURIComponent\(runId\)\}\/budget/);
  assert.match(data, /\/approval/);
  assert.match(data, /\/action/);
});

check("budget states ok / warning / degraded / exhausted have labels", () => {
  const budget = read("components/agents/budget.tsx");
  for (const state of ["ok", "warning", "degraded", "exhausted"]) {
    assert.match(budget, new RegExp(`\\n  ${state}: \\{`), `missing budget state ${state}`);
  }
});

check("/deployments is the list page with a detail sheet and a confirmed delete", () => {
  const page = read("app/deployments/page.tsx");
  assert.doesNotMatch(page, /redirect\(/, "/deployments must not redirect any more");
  assert.match(page, /<DeploymentListScreen \/>/);
  const screen = read("app/deployments/components/deployment-list-screen.tsx");
  assert.match(screen, /<DeploymentDetailSheet/);
  assert.match(screen, /<Dialog/);
  assert.match(screen, /NEW_DEPLOYMENT_HREF/);
  assert.match(screen, /\/missions\?editId=/);
  assert.match(read("app/deployments/components/deployment-detail-sheet.tsx"), /\/runs\?run=/);
});

check("/deployments/new hosts NewDeploymentFlow with tab fallback, prompt prefill and launch navigation", () => {
  assert.match(read("app/deployments/new/page.tsx"), /<NewDeploymentScreen \/>/);
  const screen = read("app/deployments/components/new-deployment-screen.tsx");
  assert.match(screen, /isNewDeploymentTab\(requestedTab\) \? requestedTab : "describe"/);
  assert.match(screen, /searchParams\.get\("prompt"\)/);
  assert.match(screen, /<NewDeploymentFlow/);
  assert.match(screen, /\/runs\?run=/);
  assert.match(screen, /Deployment launched/);
  const tabs = read("app/deployments/components/new-deployment-tabs.ts");
  for (const tab of ["describe", "task", "automation"]) assert.match(tabs, new RegExp(`id: "${tab}"`));
  const flow = read("app/deployments/components/new-deployment-flow.tsx");
  assert.match(flow, /<ManagerPanel/);
  assert.match(flow, /<AdvancedTaskForm/);
  assert.match(flow, /<AutomationPanel/);
  assert.match(flow, /MissionCanvasModal/);
});

check("legacy Depot room and redirect stay deleted; old links redirect to the new pages", () => {
  for (const rel of [
    "app/home/components/rooms/room-new-deployment.tsx",
    "app/home/components/rooms/room-deployments-panel.tsx",
    "app/deployments/components/deployments-screen.tsx",
    "app/deployments/components/deployment-ui.tsx",
    "components/agents/task-card.tsx",
    "components/agents/task-list.tsx",
  ]) {
    assert.ok(!exists(rel), `${rel} must stay deleted`);
  }
  const config = read("next.config.js");
  assert.match(config, /destination: "\/deployments\/new\?tab=automation"/);
  assert.match(config, /homeRoom\("depot", "\/runs"\)/);
});

check("task form wires all 5 permission modes and the bypass warning", () => {
  const modes = read("components/agents/permission-modes.ts");
  const form = read("components/agents/advanced-task-form.tsx");
  for (const mode of ["default", "accept-edits", "plan-mode", "dont-ask", "bypass"]) {
    assert.ok(modes.includes(mode), `permission label missing: ${mode}`);
  }
  assert.match(form, /PERMISSION_MODE_LABELS/);
  assert.match(form, /permissionMode === "bypass"/);
  assert.match(form, /Bypass allows elevated operations/);
});

check("task form loads configured provider options from the server", () => {
  const form = read("components/agents/advanced-task-form.tsx");
  const selection = read("lib/integrations/llm/provider-selection.ts");
  assert.match(form, /TASK_OPTIONS_URL = "\/api\/agent-tasks\/options"/);
  assert.match(form, /label="Provider"/);
  assert.match(selection, /listConfiguredLlmProviders/);
  assert.match(selection, /validateConfiguredLlmSelection/);
  for (const constant of ["CLAUDE_MODEL_OPTIONS", "OPENAI_MODEL_OPTIONS", "GEMINI_MODEL_OPTIONS", "GROK_MODEL_OPTIONS"]) {
    assert.ok(selection.includes(constant), `missing ${constant}`);
  }
});

check("no legacy API, console.log, old product name or legacy skin classes in the run/deployment UI", () => {
  const legacy = /font-pixel|home-spotlight|home-border-glow|holo-|pixel-ui|\btext-s-\d|\bbg-s-\d|bg-accent-(10|15|20)\b|backdrop-blur|text-white\/|bg-black\//;
  for (const rel of uiFiles) {
    const source = read(rel);
    assert.ok(!source.includes("/api/tasks"), `${rel} references /api/tasks`);
    assert.ok(!source.includes("console.log"), `${rel} contains console.log`);
    assert.ok(!source.includes("U.B Agents"), `${rel} still says U.B Agents`);
    assert.doesNotMatch(source, legacy, `${rel} uses a legacy skin class`);
  }
});

console.log(`${passed} checks passed`);
