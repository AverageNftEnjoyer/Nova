import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const results = [];

function record(status, name, detail = "") {
  results.push({ status, name, detail });
}

async function run(name, fn) {
  try {
    await fn();
    record("PASS", name);
  } catch (error) {
    record("FAIL", name, error instanceof Error ? error.message : String(error));
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

const autofixEngineSource = read("hud/lib/missions/workflow/autofix/engine.ts");
const autofixRouteSource = read("hud/app/api/missions/autofix/route.ts");
const builderHookSource = read("hud/app/missions/hooks/use-missions-page-state.ts");
const builderModalSource = read("hud/app/missions/components/mission-builder-modal.tsx");
const canvasSource = read("hud/app/missions/canvas/mission-canvas.tsx");
const canvasBridgeSource = read("hud/app/missions/canvas/workflow-autofix-bridge.ts");

await run("P3-C1 autofix engine has confidence-ranked safe vs approval gating", async () => {
  const requiredTokens = [
    "executeWorkflowAutofix",
    "safe_auto_apply",
    "needs_approval",
    "appliedFixIds",
    "pendingApprovalFixIds",
    "lowRiskConfidenceThreshold",
  ];
  for (const token of requiredTokens) {
    assert.equal(autofixEngineSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P3-C2 mission autofix API route enforces auth and user context", async () => {
  const requiredTokens = [
    "requireSupabaseApiUser",
    "executeWorkflowAutofix",
    "userContextId: userId",
    "approvedFixIds",
  ];
  for (const token of requiredTokens) {
    assert.equal(autofixRouteSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P3-C3 builder hook exposes preview and apply actions", async () => {
  const requiredTokens = [
    "previewWorkflowFixes",
    "applyWorkflowFixes",
    "workflowAutofixSelectionById",
    "previewMissionWorkflowAutofix",
    "applyMissionWorkflowAutofix",
  ];
  for (const token of requiredTokens) {
    assert.equal(builderHookSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P3-C4 mission builder UI shows fix preview and accept/reject controls", async () => {
  const requiredTokens = [
    "Workflow Autofix",
    "Preview Fixes",
    "Apply Safe",
    "Apply Selected",
    "needs_approval",
  ];
  for (const token of requiredTokens) {
    assert.equal(builderModalSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P3-C5 canvas UI and bridge support autofix preview/apply flow", async () => {
  const requiredTokens = [
    "CanvasAutofixPanel",
    "handlePreviewAutofix",
    "handleApplyAutofix",
    "missionToWorkflowSummaryForAutofix",
    "applyAutofixSummaryToMission",
  ];
  for (const token of requiredTokens) {
    assert.equal(canvasSource.includes(token), true, `missing token: ${token}`);
  }
  const bridgeTokens = [
    "missionToWorkflowSummaryForAutofix",
    "applyAutofixSummaryToMission",
    'type: "ai"',
    'type: "fetch"',
    'type: "condition"',
  ];
  for (const token of bridgeTokens) {
    assert.equal(canvasBridgeSource.includes(token), true, `missing bridge token: ${token}`);
  }
});

const passCount = results.filter((row) => row.status === "PASS").length;
const failCount = results.filter((row) => row.status === "FAIL").length;
const skipCount = results.filter((row) => row.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
