import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

function resolveSmokeUserContextId() {
  const explicit = String(
    process.env.NOVA_SMOKE_USER_CONTEXT_ID
    || process.env.NOVA_USER_CONTEXT_ID
    || process.env.USER_CONTEXT_ID
    || "",
  ).trim();
  if (explicit) return explicit;
  const root = path.join(process.cwd(), ".agent", "user-context");
  if (!fs.existsSync(root)) return "";
  const candidates = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .filter(Boolean);
  if (candidates.length === 1) return candidates[0];
  if (candidates.includes("smoke-user-ctx")) return "smoke-user-ctx";
  const withIntegrationsConfig = candidates.filter((name) =>
    fs.existsSync(path.join(root, name, "state", "integrations-config.json"))
    || fs.existsSync(path.join(root, name, "integrations-config.json")));
  if (withIntegrationsConfig.length > 0) return withIntegrationsConfig[0];
  if (candidates.length > 0) return candidates[0];
  return "";
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

const userContextId = resolveSmokeUserContextId();
if (!userContextId) {
  record(
    "FAIL",
    "Workstream D live latency smoke requires NOVA_SMOKE_USER_CONTEXT_ID",
    "Set NOVA_SMOKE_USER_CONTEXT_ID to run the real 10-turn HUD workload.",
  );
  summarize(results[0]);
  process.exit(1);
}

const providerRuntimeModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/providers/runtime-compat/index.js")).href,
);
const { loadIntegrationsRuntime } = providerRuntimeModule;
const providerRuntime = loadIntegrationsRuntime({ userContextId });
const activeProvider = String(providerRuntime?.activeProvider || "openai").trim().toLowerCase();
const activeConfig = providerRuntime && typeof providerRuntime === "object" ? providerRuntime[activeProvider] : null;
const activeApiKey = String(activeConfig?.apiKey || "").trim();
if (!activeApiKey) {
  record(
    "FAIL",
    "Workstream D live latency smoke active provider key is required",
    `missing key for active provider \"${activeProvider}\" userContextId=${userContextId}`,
  );
  summarize(results[0]);
  process.exit(1);
}

const chatHandlerModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/core/chat-handler/index.js")).href,
);
const { handleInput } = chatHandlerModule;

const now = Date.now();
const conversationId = `workstream-d-live-${now}`;
const sessionKeyHint = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;

const turns = [
  "hello nova",
  "Call me Alex for this chat.",
  "Give exactly 2 short sentences on why exponential backoff with jitter matters.",
  "Give exactly 3 bullet points for websocket reconnect reliability.",
  "What name did I ask you to call me?",
  "Summarize current weather expectations for Indianapolis, Indiana today.",
  "Yes, confirm Indianapolis weather.",
  "Actually switch weather context to Pittsburgh, Pennsylvania.",
  "Yes, confirm Pittsburgh weather.",
  "Respond with JSON only with keys risk and action about retry storms.",
];

const turnMetrics = [];
const routeCounts = new Map();
const nonOkTurns = [];
const emptyReplies = [];
const sessionKeys = new Set();

async function ask(text, index) {
  const startedAt = Date.now();
  const result = await handleInput(text, {
    source: "hud",
    sender: "hud-user",
    voice: false,
    userContextId,
    conversationId,
    sessionKeyHint,
  });
  const latencyMs = Number(result?.latencyMs || Date.now() - startedAt);
  const route = String(result?.responseRoute || result?.route || "unknown");
  const reply = String(result?.reply || "").trim();
  const ok = result?.ok !== false;
  const sessionKey = String(result?.sessionKey || "").trim();

  turnMetrics.push({ index, text, route, latencyMs, ok, replyChars: reply.length });
  routeCounts.set(route, Number(routeCounts.get(route) || 0) + 1);
  if (!ok) nonOkTurns.push({ index, route });
  if (!reply) emptyReplies.push({ index, route });
  if (sessionKey) sessionKeys.add(sessionKey);
}

await run("Workstream D live 10-turn mixed HUD workload", async () => {
  for (let idx = 0; idx < turns.length; idx += 1) {
    await ask(turns[idx], idx + 1);
  }

  assert.equal(turnMetrics.length, 10, "expected 10 turns");
  assert.equal(nonOkTurns.length, 0, `non-ok turns: ${JSON.stringify(nonOkTurns)}`);
  assert.equal(emptyReplies.length, 0, `empty replies: ${JSON.stringify(emptyReplies)}`);
  assert.equal(sessionKeys.size >= 1, true, "missing session key in turn summaries");
});

const latencies = turnMetrics.map((turn) => Number(turn.latencyMs || 0)).filter((value) => Number.isFinite(value) && value > 0);
const avgLatencyMs =
  latencies.length > 0
    ? Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(1))
    : 0;
const p95LatencyMs = Number(percentile(latencies, 95).toFixed(1));
const p50LatencyMs = Number(percentile(latencies, 50).toFixed(1));
const p99LatencyMs = Number(percentile(latencies, 99).toFixed(1));
const maxLatencyMs = Number((latencies.length > 0 ? Math.max(...latencies) : 0).toFixed(1));
const okTurns = turnMetrics.filter((turn) => turn.ok).length;
const nonEmptyTurns = turnMetrics.filter((turn) => Number(turn.replyChars || 0) > 0).length;
const latencyTargetMet =
  avgLatencyMs <= 9000 &&
  p95LatencyMs <= 18500 &&
  p99LatencyMs <= 22000 &&
  okTurns === turnMetrics.length &&
  nonEmptyTurns === turnMetrics.length;

const report = {
  id: `workstream-d-live-${now}`,
  ts: new Date(now).toISOString(),
  userContextId,
  conversationId,
  sessionKeyHint,
  turns: turnMetrics,
  summary: {
    totalTurns: turnMetrics.length,
    okTurns,
    nonEmptyTurns,
    emptyTurnCount: Math.max(0, turnMetrics.length - nonEmptyTurns),
    nonOkTurnCount: Math.max(0, turnMetrics.length - okTurns),
    avgLatencyMs,
    p50LatencyMs,
    p95LatencyMs,
    p99LatencyMs,
    maxLatencyMs,
    latencyTargetMet,
    sessionKeyCount: sessionKeys.size,
    routeCounts: Object.fromEntries([...routeCounts.entries()].sort((a, b) => b[1] - a[1])),
  },
};

const reportPath = path.join(process.cwd(), "archive", "logs", `${report.id}-report.json`);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

for (const result of results) summarize(result);
console.log(`\nConversation: ${conversationId}`);
console.log(`Session key hint: ${sessionKeyHint}`);
console.log(`avg=${avgLatencyMs}ms p50=${p50LatencyMs}ms p95=${p95LatencyMs}ms p99=${p99LatencyMs}ms max=${maxLatencyMs}ms`);
console.log(`sessionKeysObserved=${sessionKeys.size}`);
console.log(`routes=${JSON.stringify(report.summary.routeCounts)}`);
console.log(`latencyTargetMet=${latencyTargetMet}`);
console.log(`report=${reportPath}`);

const failCount = results.filter((r) => r.status === "FAIL").length;
if (failCount > 0) process.exit(1);

