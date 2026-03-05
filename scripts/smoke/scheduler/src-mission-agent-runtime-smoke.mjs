import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const nativeRequire = createRequire(import.meta.url);
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

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function transpileSource(relativePath) {
  return ts.transpileModule(read(relativePath), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: path.basename(relativePath),
  }).outputText;
}

function loadModule(relativePath, requireMap = {}, extraGlobals = {}) {
  const compiled = transpileSource(relativePath);
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier in requireMap) return requireMap[specifier];
      if (specifier === "server-only") return {};
      return nativeRequire(specifier);
    },
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    crypto,
    ...extraGlobals,
  };
  vm.runInNewContext(compiled, sandbox, { filename: `${relativePath}.cjs` });
  return module.exports;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function createMission({ id, label, userId, nodes, connections }) {
  const nowIso = new Date("2026-03-04T14:00:00.000Z").toISOString();
  return {
    id,
    userId,
    label,
    description: "",
    category: "research",
    tags: [],
    status: "draft",
    version: 1,
    nodes,
    connections,
    variables: [],
    settings: {
      timezone: "America/New_York",
      retryOnFail: false,
      retryCount: 0,
      retryIntervalMs: 1000,
      saveExecutionProgress: true,
    },
    createdAt: nowIso,
    updatedAt: nowIso,
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    integration: "telegram",
    chatIds: [],
  };
}

function baseExecutionContext(overrides = {}) {
  return {
    missionId: "parent-mission",
    missionLabel: "Parent Mission",
    runId: "run-parent",
    runKey: "smoke-run-key",
    attempt: 1,
    now: new Date("2026-03-04T14:00:00.000Z"),
    runSource: "trigger",
    mission: undefined,
    nodeOutputs: new Map(),
    variables: {},
    scope: undefined,
    userContextId: "smoke-agent-user",
    conversationId: "smoke-conversation",
    sessionKey: "agent:nova:hud:user:smoke-agent-user:dm:smoke-conversation",
    resolveExpr: (template) => String(template || ""),
    onNodeTrace: undefined,
    agentState: {
      stateVersion: "phase0",
      userContextId: "smoke-agent-user",
      conversationId: "smoke-conversation",
      sessionKey: "agent:nova:hud:user:smoke-agent-user:dm:smoke-conversation",
      missionId: "parent-mission",
      runId: "run-parent",
      keys: {},
      declaredKeys: [],
      writePolicies: {},
      auditTrail: [],
    },
    ...overrides,
  };
}

function createAgentExecutors(deps = {}) {
  const loadMissions = deps.loadMissions || (async () => []);
  const executeMission = deps.executeMission || (async () => ({ ok: true, skipped: false, reason: "", outputs: [], nodeTraces: [] }));
  return loadModule(
    "hud/lib/missions/workflow/executors/agent-executors.ts",
    {
      "../../store": { loadMissions },
      "../execute-mission": { executeMission },
    },
  );
}

await run("P0-A1 supervisor merge order is deterministic in runtime executor", async () => {
  const { executeAgentSupervisor } = createAgentExecutors();
  const supervisorNode = {
    id: "sup",
    type: "agent-supervisor",
    label: "Operator",
    position: { x: 0, y: 0 },
    agentId: "operator",
    role: "operator",
    goal: "Compose final answer",
  };
  const mission = createMission({
    id: "parent-mission",
    label: "Parent Mission",
    userId: "smoke-agent-user",
    nodes: [
      { id: "n2", type: "manual-trigger", label: "Trigger B", position: { x: 0, y: 0 } },
      { id: "n1", type: "manual-trigger", label: "Trigger A", position: { x: 0, y: 0 } },
      supervisorNode,
    ],
    connections: [
      { id: "c2", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "sup", targetPort: "main" },
      { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "sup", targetPort: "main" },
    ],
  });
  const ctx = baseExecutionContext({ mission });
  ctx.nodeOutputs.set("n2", { ok: true, text: "second" });
  ctx.nodeOutputs.set("n1", { ok: true, text: "first" });
  const result = await executeAgentSupervisor(supervisorNode, ctx);
  assert.equal(result.ok, true);
  const mergedInputs = Array.isArray(result?.data?.mergedInputs) ? result.data.mergedInputs : [];
  assert.equal(mergedInputs.length, 2);
  assert.equal(String(mergedInputs[0]?.sourceNodeId || ""), "n1");
  assert.equal(String(mergedInputs[1]?.sourceNodeId || ""), "n2");
});

await run("P0-A2 subworkflow sync success carries user-scoped execution context", async () => {
  const childMission = createMission({
    id: "child-sync",
    label: "Child Sync Mission",
    userId: "smoke-agent-user",
    nodes: [{ id: "child-trigger", type: "manual-trigger", label: "Trigger", position: { x: 0, y: 0 } }],
    connections: [],
  });
  let capturedInput = null;
  const { executeAgentSubworkflow } = createAgentExecutors({
    loadMissions: async ({ userId }) => {
      assert.equal(userId, "smoke-agent-user");
      return [childMission];
    },
    executeMission: async (input) => {
      capturedInput = input;
      return { ok: true, skipped: false, reason: "", outputs: [{ ok: true }], nodeTraces: [] };
    },
  });

  const node = {
    id: "sub-sync",
    type: "agent-subworkflow",
    label: "Subworkflow Sync",
    position: { x: 0, y: 0 },
    missionId: "child-sync",
    waitForCompletion: true,
  };
  const ctx = baseExecutionContext({ runId: "run-sync", missionId: "parent-sync" });
  const result = await executeAgentSubworkflow(node, ctx);

  assert.equal(result.ok, true);
  assert.equal(Boolean(capturedInput), true);
  assert.equal(String(capturedInput.userContextId || ""), "smoke-agent-user");
  assert.equal(String(capturedInput.conversationId || ""), "smoke-conversation");
  assert.equal(String(capturedInput.sessionKey || ""), "agent:nova:hud:user:smoke-agent-user:dm:smoke-conversation");
  assert.equal(String(capturedInput.runKey || ""), "run-sync:subworkflow:sub-sync:child-sync");
  assert.equal(String(result?.data?.missionId || ""), "child-sync");
  assert.equal(result?.data?.waitForCompletion, true);
  assert.equal(Number(result?.data?.result?.outputCount || 0), 1);
  assert.equal(String(result?.data?.envelope?.result?.status || ""), "completed");
});

await run("P0-A3 subworkflow async path returns immediate started envelope and dispatches child run", async () => {
  const childMission = createMission({
    id: "child-async",
    label: "Child Async Mission",
    userId: "smoke-agent-user",
    nodes: [{ id: "child-trigger", type: "manual-trigger", label: "Trigger", position: { x: 0, y: 0 } }],
    connections: [],
  });
  const runKeys = [];
  const { executeAgentSubworkflow } = createAgentExecutors({
    loadMissions: async () => [childMission],
    executeMission: async (input) => {
      runKeys.push(String(input.runKey || ""));
      return { ok: true, skipped: false, reason: "", outputs: [], nodeTraces: [] };
    },
  });

  const node = {
    id: "sub-async",
    type: "agent-subworkflow",
    label: "Subworkflow Async",
    position: { x: 0, y: 0 },
    missionId: "child-async",
    waitForCompletion: false,
  };
  const ctx = baseExecutionContext({ runId: "run-async", missionId: "parent-async" });
  const result = await executeAgentSubworkflow(node, ctx);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(result.ok, true);
  assert.equal(result?.data?.waitForCompletion, false);
  assert.equal(String(result?.data?.envelope?.result?.status || ""), "started");
  assert.equal(runKeys.length, 1);
  assert.equal(runKeys[0], "run-async:subworkflow:sub-async:child-async");
});

await run("P0-A4 subworkflow maps child mission failure to stable contract error", async () => {
  const childMission = createMission({
    id: "child-fail",
    label: "Child Fail Mission",
    userId: "smoke-agent-user",
    nodes: [{ id: "child-trigger", type: "manual-trigger", label: "Trigger", position: { x: 0, y: 0 } }],
    connections: [],
  });
  const { executeAgentSubworkflow } = createAgentExecutors({
    loadMissions: async () => [childMission],
    executeMission: async () => ({ ok: false, skipped: false, reason: "child execution failed", outputs: [], nodeTraces: [] }),
  });

  const node = {
    id: "sub-fail",
    type: "agent-subworkflow",
    label: "Subworkflow Fail",
    position: { x: 0, y: 0 },
    missionId: "child-fail",
    waitForCompletion: true,
  };
  const ctx = baseExecutionContext({ runId: "run-fail", missionId: "parent-fail" });
  const result = await executeAgentSubworkflow(node, ctx);

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "AGENT_SUBWORKFLOW_EXECUTION_FAILED");
  assert.equal(String(result.error || "").includes("child execution failed"), true);
});

await run("P0-A5 engine-level execution preserves deterministic supervisor merge order", async () => {
  const agentExecutors = createAgentExecutors();
  const executeMissionModule = loadModule(
    "hud/lib/missions/workflow/execute-mission.ts",
    {
      "./executors/index": {
        EXECUTOR_REGISTRY: {
          "manual-trigger": async () => ({ ok: true, text: "Manual trigger", data: { triggered: true } }),
          "agent-supervisor": async (node, ctx) => {
            const result = await agentExecutors.executeAgentSupervisor(node, ctx);
            const mergedIds = Array.isArray(result?.data?.mergedInputs)
              ? result.data.mergedInputs.map((entry) => String(entry?.sourceNodeId || "")).join(",")
              : "";
            return { ...result, text: `merged-order:${mergedIds}` };
          },
        },
      },
      "./time": {
        getLocalParts: () => ({ dayStamp: "2026-03-04", weekday: "wednesday", hour: 14, minute: 0 }),
        parseTime: () => ({ hour: 9, minute: 0 }),
      },
      "./execution-guard": {
        acquireMissionExecutionSlot: async () => ({
          ok: true,
          slot: {
            reportOutcome: () => undefined,
            release: async () => undefined,
          },
        }),
      },
      "../telemetry": {
        emitMissionTelemetryEvent: async () => undefined,
      },
      "./versioning": {
        validateMissionGraphForVersioning: () => [],
      },
      "@/lib/shared/timezone": {
        resolveTimezone: (...values) => firstNonEmpty(...values) || "America/New_York",
      },
      "../retry-policy": {
        shouldRetry: () => false,
        computeRetryDelayMs: () => 0,
      },
      "./agent-flags": {
        isMissionAgentGraphEnabled: () => true,
        isMissionAgentExecutorEnabled: () => true,
        missionUsesAgentGraph: () => true,
      },
    },
  );

  const mission = createMission({
    id: "merge-parent",
    label: "Merge Parent",
    userId: "smoke-agent-user",
    nodes: [
      { id: "n2", type: "manual-trigger", label: "Trigger B", position: { x: 0, y: 0 } },
      { id: "n1", type: "manual-trigger", label: "Trigger A", position: { x: 0, y: 0 } },
      {
        id: "sup",
        type: "agent-supervisor",
        label: "Operator",
        position: { x: 0, y: 0 },
        agentId: "operator",
        role: "operator",
        goal: "Compose final answer",
      },
    ],
    connections: [
      { id: "c2", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "sup", targetPort: "main" },
      { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "sup", targetPort: "main" },
    ],
  });

  const result = await executeMissionModule.executeMission({
    mission,
    source: "trigger",
    userContextId: "smoke-agent-user",
    conversationId: "smoke-conversation",
    sessionKey: "agent:nova:hud:user:smoke-agent-user:dm:smoke-conversation",
    runKey: "smoke-merge-run",
  });
  assert.equal(result.ok, true);
  const supervisorTrace = Array.isArray(result.nodeTraces) ? result.nodeTraces.find((trace) => trace.nodeId === "sup") : null;
  assert.equal(Boolean(supervisorTrace), true);
  assert.equal(String(supervisorTrace?.detail || "").includes("merged-order:n1,n2"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
