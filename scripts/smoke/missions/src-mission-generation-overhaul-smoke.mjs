import assert from "node:assert/strict";
import fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const WORKFLOW_MARKER = "[NOVA WORKFLOW]";
const results = [];
const nodeRequire = createRequire(import.meta.url);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseJsonObject(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function parseMissionWorkflow(message) {
  const raw = String(message || "");
  const idx = raw.indexOf(WORKFLOW_MARKER);
  if (idx < 0) return { description: cleanText(raw), summary: null };
  const description = cleanText(raw.slice(0, idx));
  const maybe = parseJsonObject(raw.slice(idx + WORKFLOW_MARKER.length));
  return { description, summary: maybe && typeof maybe === "object" ? maybe : null };
}

function generateShortTitle(text) {
  const words = cleanText(text).split(" ").filter(Boolean).slice(0, 6);
  return words.join(" ").slice(0, 35) || "New Mission";
}

function normalizeWorkflowStep(step, index) {
  const normalized = { ...(step || {}) };
  normalized.type = String(normalized.type || "fetch").trim().toLowerCase();
  normalized.id = String(normalized.id || `${normalized.type}-${index + 1}`).trim();
  normalized.title = cleanText(normalized.title || `${normalized.type} step`) || `${normalized.type} step`;
  return normalized;
}

function normalizeOutputRecipientsForChannel(_channel, recipients) {
  return cleanText(recipients || "");
}

function isInvalidConditionFieldPath(value) {
  const field = String(value || "").trim();
  return field.includes("{{") || field.includes("}}");
}

function extractSearchQueryFromUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return cleanText(u.searchParams.get("q") || "");
  } catch {
    return "";
  }
}

function isSearchLikeUrl(value) {
  const raw = String(value || "").toLowerCase();
  return raw.includes("google.") || raw.includes("search") || raw.includes("?q=");
}

function defaultMissionSettings() {
  return {
    timezone: "America/New_York",
    retryOnFail: false,
    retryCount: 2,
    retryIntervalMs: 5000,
    saveExecutionProgress: true,
  };
}

function loadTsModule(relativePath, requireMap = {}) {
  const fullPath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(fullPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: path.basename(relativePath),
  }).outputText;

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier in requireMap) return requireMap[specifier];
      if (specifier === "server-only") return {};
      if (specifier.startsWith("node:")) return nodeRequire(specifier);
      throw new Error(`Unexpected require for ${relativePath}: ${specifier}`);
    },
    console,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    URL,
  };
  vm.runInNewContext(compiled, sandbox, { filename: `${relativePath}.cjs` });
  return module.exports;
}

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

function getStep(summary, type) {
  return (summary.workflowSteps || []).find((step) => String(step.type || "") === type) || null;
}

function getSteps(summary, type) {
  return (summary.workflowSteps || []).filter((step) => String(step.type || "") === type);
}

function hasApiCall(summary, prefix) {
  return (summary.apiCalls || []).some((value) => String(value || "").startsWith(prefix));
}

function assertBaseExecutableShape(summary) {
  assert.equal(getStep(summary, "trigger") !== null, true);
  assert.equal(getStep(summary, "ai") !== null, true);
  assert.equal(getStep(summary, "output") !== null, true);
  assert.equal(getStep(summary, "fetch") !== null || getStep(summary, "coinbase") !== null, true);
}

const topicsModule = loadTsModule("hud/lib/missions/topics/detection.ts", {
  "../text/cleaning": { cleanText },
});

const generationModule = loadTsModule("hud/lib/missions/workflow/generation.ts", {
  "@/lib/integrations/catalog-server": {
    loadIntegrationCatalog: async () => ([
      { kind: "llm", id: "openai", connected: true },
      { kind: "channel", id: "telegram", connected: true },
      { kind: "channel", id: "discord", connected: true },
      { kind: "channel", id: "novachat", connected: true },
      { kind: "channel", id: "webhook", connected: true },
    ]),
  },
  "@/lib/integrations/server-store": {
    loadIntegrationsConfig: async () => ({
      activeLlmProvider: "openai",
      openai: { defaultModel: "gpt-5-mini" },
      claude: { defaultModel: "" },
      grok: { defaultModel: "" },
      gemini: { defaultModel: "" },
    }),
  },
  "../text/cleaning": { cleanText, parseJsonObject },
  "../text/formatting": { generateShortTitle },
  "../utils/config": { normalizeWorkflowStep, normalizeOutputRecipientsForChannel },
  "../utils/validation": { isInvalidConditionFieldPath },
  "../web/fetch": { extractSearchQueryFromUrl },
  "../web/quality": { isSearchLikeUrl },
  "../llm/providers": {
    completeWithConfiguredLlm: async () => ({
      provider: "openai",
      model: "stub-llm",
      text: JSON.stringify({
        label: "Stub mission",
        description: "",
        integration: "telegram",
        workflowSteps: [{ type: "output", title: "only output" }],
      }),
    }),
  },
  "../topics/detection": topicsModule,
});

const storeModule = loadTsModule("hud/lib/missions/store.ts", {
  "node:fs/promises": fsPromises,
  "node:crypto": nodeRequire("node:crypto"),
  "node:path": nodeRequire("node:path"),
  "@/lib/notifications/store": {},
  "./types": { defaultMissionSettings },
  "./workflow/parsing": { parseMissionWorkflow },
  "./utils/config": { normalizeWorkflowStep },
});

const bridgeModule = loadTsModule("hud/app/missions/canvas/workflow-autofix-bridge.ts", {});

const { buildWorkflowFromPrompt } = generationModule;
const { migrateLegacyScheduleToMission } = storeModule;
const { missionToWorkflowSummaryForAutofix } = bridgeModule;

function toLegacySchedule(prompt, workflow) {
  const message = `${workflow.summary.description || cleanText(prompt)}\n\n${WORKFLOW_MARKER}\n${JSON.stringify(workflow.summary)}`;
  return {
    id: `smoke-${Math.random().toString(36).slice(2, 8)}`,
    userId: "smoke-user",
    integration: workflow.integration || "telegram",
    label: workflow.label || "Smoke Mission",
    message,
    time: workflow.summary?.schedule?.time || "09:00",
    timezone: workflow.summary?.schedule?.timezone || "America/New_York",
    enabled: true,
    chatIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runCount: 0,
    successCount: 0,
    failureCount: 0,
  };
}

async function runPromptScenario(name, prompt, assertFn) {
  await run(name, async () => {
    const built = await buildWorkflowFromPrompt(prompt);
    assertBaseExecutableShape(built.workflow.summary);
    assert.equal(String(getStep(built.workflow.summary, "ai")?.aiPrompt || "").toLowerCase().includes("user request:"), true);
    await assertFn(built);
  });
}

await runPromptScenario(
  "MG-1 Non-crypto reminder mission is executable and specific",
  "Set a mission to remind me every weekday at 07:45 ET to review priority inbox and send to novachat.",
  async ({ workflow }) => {
    assert.equal(getStep(workflow.summary, "coinbase") === null, true);
    assert.equal(String(getStep(workflow.summary, "output")?.outputChannel || ""), "novachat");
  },
);

await runPromptScenario(
  "MG-2 Multi-topic news mission preserves multiple fetch steps",
  "Daily at 08:30 ET send me NBA scores and weather in New York on discord.",
  async ({ workflow }) => {
    const fetchSteps = getSteps(workflow.summary, "fetch");
    assert.equal(fetchSteps.length >= 2, true);
    assert.equal(hasApiCall(workflow.summary, "FETCH:web"), true);
  },
);

await runPromptScenario(
  "MG-3 Complex condition+transform mission keeps advanced steps",
  "Every weekday 9:00am build a mission: fetch project incidents, normalize and dedupe results, if severity greater than 7 then send to telegram.",
  async ({ workflow }) => {
    assert.equal(getStep(workflow.summary, "transform") !== null, true);
    assert.equal(getStep(workflow.summary, "condition") !== null, true);
    assert.equal(String(getStep(workflow.summary, "condition")?.conditionField || "").length > 0, true);
  },
);

await runPromptScenario(
  "MG-4 Degraded upstream LLM payload is repaired to full chain",
  "Create a mission to summarize support escalations every day at 11:00.",
  async ({ workflow }) => {
    assert.equal(getStep(workflow.summary, "fetch") !== null || getStep(workflow.summary, "coinbase") !== null, true);
    assert.equal(String(getStep(workflow.summary, "ai")?.aiPrompt || "").length >= 40, true);
  },
);

await runPromptScenario(
  "MG-5 DevOps mission includes data->ai->output with non-vague prompt",
  "Build a daily 06:30 mission to collect deployment failures and propose concrete mitigations to discord.",
  async ({ workflow }) => {
    assert.equal(getStep(workflow.summary, "coinbase") === null, true);
    assert.equal(String(getStep(workflow.summary, "output")?.outputChannel || ""), "discord");
  },
);

await runPromptScenario(
  "MG-6 Complex marketing workflow keeps transform and condition",
  "Every morning fetch ad spend and conversion data, aggregate by campaign, alert only if CPA exceeds target.",
  async ({ workflow }) => {
    assert.equal(getStep(workflow.summary, "transform") !== null, true);
    assert.equal(getStep(workflow.summary, "condition") !== null, true);
  },
);

await runPromptScenario(
  "MG-7 Crypto holdings prompt still guarantees Coinbase step",
  "Every morning send my wallet balances and crypto portfolio summary to telegram.",
  async ({ workflow }) => {
    assert.equal(getStep(workflow.summary, "coinbase") !== null, true);
    assert.equal(hasApiCall(workflow.summary, "COINBASE:"), true);
  },
);

await run("MG-8 Canvas mapping keeps complex steps after workflow->mission->workflow roundtrip", async () => {
  const prompt = "Daily 8am fetch market headlines and release notes, normalize format, if impact is high then notify discord.";
  const built = await buildWorkflowFromPrompt(prompt);
  const schedule = toLegacySchedule(prompt, built.workflow);
  const mission = migrateLegacyScheduleToMission(schedule);
  const fromCanvas = missionToWorkflowSummaryForAutofix(mission);

  const generatedTypes = new Set((built.workflow.summary.workflowSteps || []).map((step) => String(step.type || "")));
  const roundTripTypes = new Set((fromCanvas.workflowSteps || []).map((step) => String(step.type || "")));
  assert.equal(roundTripTypes.has("trigger"), true);
  assert.equal(roundTripTypes.has("output"), true);
  assert.equal(roundTripTypes.has("fetch") || roundTripTypes.has("coinbase"), true);
  if (generatedTypes.has("transform")) assert.equal(roundTripTypes.has("transform"), true);
  if (generatedTypes.has("condition")) assert.equal(roundTripTypes.has("condition"), true);
});

await run("MG-9 Canvas migration uses condition true-branch connection port", async () => {
  const summary = {
    description: "Condition branch mission",
    workflowSteps: [
      { type: "trigger", title: "Start", triggerMode: "daily", triggerTime: "09:00", triggerTimezone: "America/New_York" },
      { type: "fetch", title: "Fetch", fetchSource: "web", fetchQuery: "incident severity today" },
      { type: "condition", title: "Check", conditionField: "data.payload.severity", conditionOperator: "greater_than", conditionValue: "7" },
      { type: "output", title: "Send", outputChannel: "telegram" },
    ],
  };
  const message = `Condition mission\n\n${WORKFLOW_MARKER}\n${JSON.stringify(summary)}`;
  const mission = migrateLegacyScheduleToMission({
    id: "cond-smoke",
    userId: "smoke-user",
    integration: "telegram",
    label: "Condition Mission",
    message,
    time: "09:00",
    timezone: "America/New_York",
    enabled: true,
    chatIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runCount: 0,
    successCount: 0,
    failureCount: 0,
  });
  const conditionNode = mission.nodes.find((node) => node.type === "condition");
  assert.equal(Boolean(conditionNode), true);
  const outgoing = mission.connections.filter((connection) => connection.sourceNodeId === conditionNode.id);
  assert.equal(outgoing.length > 0, true);
  assert.equal(outgoing.every((connection) => connection.sourcePort === "true"), true);
});

await run("MG-10 Enterprise formatting quality guard for AI step text", async () => {
  const prompt = "Create a complex operations mission for weekly executive status with risks, blockers, and recommended actions.";
  const built = await buildWorkflowFromPrompt(prompt);
  const aiPrompt = String(getStep(built.workflow.summary, "ai")?.aiPrompt || "");
  assert.equal(aiPrompt.includes("User request:"), true);
  assert.equal(aiPrompt.length >= 80, true);
  assert.equal(/\b(do not|must|required|grounded)\b/i.test(aiPrompt), true);
});

await run("MG-11 Complex morning briefing v1 keeps individual topic steps + Coinbase", async () => {
  const prompt = "Every morning at 7:00 ET give me NBA recap, an inspirational quote, SUI and BTC prices from Coinbase, and one tech article, then send a polished summary to telegram.";
  const built = await buildWorkflowFromPrompt(prompt);
  const summary = built.workflow.summary;
  const fetchSteps = getSteps(summary, "fetch");
  const coinbase = getStep(summary, "coinbase");
  assertBaseExecutableShape(summary);
  assert.equal(fetchSteps.length >= 3, true);
  assert.equal(Boolean(coinbase), true);
  assert.equal(hasApiCall(summary, "FETCH:web"), true);
  assert.equal(hasApiCall(summary, "COINBASE:"), true);
  assert.equal(Array.isArray(coinbase.coinbaseParams?.assets), true);
  assert.equal(coinbase.coinbaseParams.assets.includes("SUI"), true);
});

await run("MG-12 Complex morning briefing v2 uses multi-source gather then single synthesis", async () => {
  const prompt = "Build a daily 6:45am PT briefing with last night NBA scores, motivational quote of the day, ETH/SOL/SUI crypto prices, and latest AI startup news to discord.";
  const built = await buildWorkflowFromPrompt(prompt);
  const summary = built.workflow.summary;
  const fetchSteps = getSteps(summary, "fetch");
  const aiSteps = getSteps(summary, "ai");
  assertBaseExecutableShape(summary);
  assert.equal(fetchSteps.length >= 3, true);
  assert.equal(getStep(summary, "coinbase") !== null, true);
  assert.equal(aiSteps.length, 1);
  const aiPrompt = String(aiSteps[0].aiPrompt || "");
  assert.equal(
    aiPrompt.includes("User request:")
    && (aiPrompt.includes("Cover each requested area") || aiPrompt.includes("combined message") || aiPrompt.includes("Use fetched data")),
    true,
  );
});

await run("MG-13 Complex morning briefing v3 preserves adaptive mixed-topic routing", async () => {
  const prompt = "At 8am daily send me: NBA highlights, one inspirational quote, SUI price check in USD, and top tech headline with why it matters.";
  const built = await buildWorkflowFromPrompt(prompt);
  const summary = built.workflow.summary;
  const fetchSteps = getSteps(summary, "fetch");
  const output = getStep(summary, "output");
  assertBaseExecutableShape(summary);
  assert.equal(fetchSteps.length >= 3, true);
  assert.equal(getStep(summary, "coinbase") !== null, true);
  assert.equal(String(output.outputChannel || "").length > 0, true);
});

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const report = { ts: new Date().toISOString(), pass, fail, results };

const reportPath = path.join(process.cwd(), "tasks", "mission-generator-overhaul-smoke-results.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`report=${reportPath}`);
console.log(`Summary: pass=${pass} fail=${fail}`);

if (fail > 0) process.exit(1);
