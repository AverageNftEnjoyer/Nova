import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const results = [];

function record(status, name, detail = "") {
  results.push({ status, name, detail });
}

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

const laneConfigModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "core",
  "chat-handler",
  "operator-lane-config",
  "index.js",
)).href;
const workerExecutorsModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "core",
  "chat-handler",
  "operator-worker-executors",
  "index.js",
)).href;
const signalsModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "routing",
  "operator-intent-signals",
  "index.js",
)).href;
const policyModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "core",
  "short-term-context-policies",
  "index.js",
)).href;
const registryModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "routing",
  "org-chart-routing",
  "registry.js",
)).href;
const missionRoutingModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "core",
  "chat-handler",
  "operator-mission-routing",
  "index.js",
)).href;

const { OPERATOR_LANE_SEQUENCE } = await import(laneConfigModulePath);
const { getOperatorWorkerExecutorKindMap } = await import(workerExecutorsModulePath);
const intentSignals = await import(signalsModulePath);
const { getShortTermContextPolicy } = await import(policyModulePath);
const { DOMAIN_WORKER_RULES } = await import(registryModulePath);
const missionRouting = await import(missionRoutingModulePath);

const executorKindMap = getOperatorWorkerExecutorKindMap();

const workerRules = DOMAIN_WORKER_RULES.filter((rule) => String(rule.workerAgentId || "").trim().length > 0);
const checks = [];

for (const rule of workerRules) {
  const workerAgentId = String(rule.workerAgentId || "");
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => {
    const routeTokens = Array.isArray(rule.routeTokens) ? rule.routeTokens : [];
    return routeTokens.includes(entry.routeHint);
  });

  checks.push({
    name: `${workerAgentId} has registry route/response tokens`,
    ok: Array.isArray(rule.routeTokens) && rule.routeTokens.length > 0
      && Array.isArray(rule.responseRouteTokens) && rule.responseRouteTokens.length > 0,
  });

  if (workerAgentId === "missions-agent") {
    checks.push({
      name: "missions-agent has mission routing handlers",
      ok: typeof missionRouting.handleMissionBuildRouting === "function"
        && typeof missionRouting.handleMissionContextRouting === "function",
    });
    checks.push({
      name: "missions-agent has mission short-term context policy",
      ok: getShortTermContextPolicy("mission_task")?.domainId === "mission_task",
    });
    checks.push({
      name: "missions-agent has mission intent helpers wired",
      ok: typeof missionRouting.mergeMissionPrompt === "function",
    });
    continue;
  }

  checks.push({
    name: `${workerAgentId} has operator lane mapping`,
    ok: Boolean(lane),
  });

  if (!lane) continue;

  checks.push({
    name: `${workerAgentId} has intent signal functions`,
    ok: typeof intentSignals[lane.directIntentFnKey] === "function"
      && typeof intentSignals[lane.contextualFollowUpIntentFnKey] === "function",
  });

  checks.push({
    name: `${workerAgentId} has short-term context policy`,
    ok: getShortTermContextPolicy(lane.domainId)?.domainId === lane.domainId,
  });

  checks.push({
    name: `${workerAgentId} has explicit worker executor kind`,
    ok: typeof executorKindMap[lane.id] === "string" && executorKindMap[lane.id].length > 0,
  });
  checks.push({
    name: `${workerAgentId} executor kind is non-default`,
    ok: executorKindMap[lane.id] !== "default",
  });

  if (workerAgentId === "polymarket-agent") {
    checks.push({
      name: "polymarket-agent has dedicated executor kind",
      ok: executorKindMap[lane.id] === "polymarket",
    });
  }
  if (workerAgentId === "coinbase-agent") {
    checks.push({
      name: "coinbase-agent has dedicated executor kind",
      ok: executorKindMap[lane.id] === "coinbase",
    });
  }
  if (workerAgentId === "web-research-agent") {
    checks.push({
      name: "web-research-agent has dedicated executor kind",
      ok: executorKindMap[lane.id] === "web_research",
    });
  }
  if (workerAgentId === "market-agent") {
    checks.push({
      name: "market-agent has dedicated executor kind",
      ok: executorKindMap[lane.id] === "market",
    });
  }
}

const total = checks.length;
const passed = checks.filter((check) => check.ok).length;
const failed = total - passed;
const completenessPercent = total > 0 ? Math.round((passed / total) * 1000) / 10 : 0;

for (const check of checks) {
  record(check.ok ? "PASS" : "FAIL", check.name);
}
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passed} fail=${failed} total=${total} completeness=${completenessPercent}%`);
assert.equal(failed, 0);
