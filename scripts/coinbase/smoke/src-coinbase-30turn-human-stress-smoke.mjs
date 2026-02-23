import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  const withIntegrationsConfig = candidates.filter((name) =>
    fs.existsSync(path.join(root, name, "integrations-config.json")));
  if (withIntegrationsConfig.length > 0) return withIntegrationsConfig[0];
  return candidates[0] || "";
}

function clampScore(v) {
  return Math.max(1, Math.min(10, Number.isFinite(v) ? Math.round(v) : 1));
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

function has(text, pattern) {
  return String(text || "").toLowerCase().includes(String(pattern || "").toLowerCase());
}

const userContextId = resolveSmokeUserContextId();
if (!userContextId) {
  console.error("FAIL: missing smoke user context id");
  process.exit(1);
}

const chatHandlerModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/core/chat-handler.js")).href,
);
const { handleInput } = chatHandlerModule;

const startedAt = Date.now();
const runId = `coinbase-human30-${startedAt}`;
const conversationId = `${runId}-thread`;
const sessionKeyHint = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;

const turns = [
  "hey nova i wanna talk about my crypto",
  "cool, start with a daily report please",
  "only show sui in my crypto reports from now on",
  "run that daily report again",
  "remove the recent net cash-flow pnl proxy line from my daily report",
  "run it one more time so i can confirm",
  "what is my portfolio total balance right now",
  "and what is the total price of it",
  "price sui",
  "also price btc and eth in usd",
  "show recent transactions",
  "what did i ask you to remove earlier",
  "give me the detailed version of the report",
  "actually keep it concise",
  "can you include freshness in the report",
  "now hide freshness again",
  "coinbase status",
  "if i say report again, what format will you use",
  "report again",
  "new topic: create a weekday 8am reminder to check sui",
  "also add discord delivery",
  "never mind cancel that mission",
  "back to crypto, show my daily report",
  "can you explain the trend in plain english",
  "ok make the report less technical going forward",
  "daily crypto report again",
  "do not include timestamps ever",
  "daily crypto report again",
  "weekly pnl please",
  "last one: concise daily report of crypto",
];

const results = [];
for (let i = 0; i < turns.length; i += 1) {
  const prompt = turns[i];
  const t0 = Date.now();
  const response = await handleInput(prompt, {
    source: "hud",
    sender: "hud-user",
    voice: false,
    userContextId,
    conversationId,
    sessionKeyHint,
  });
  results.push({
    turn: i + 1,
    prompt,
    reply: String(response?.reply || ""),
    route: String(response?.responseRoute || response?.route || "unknown"),
    ok: response?.ok !== false,
    latencyMs: Number(response?.latencyMs || Date.now() - t0),
  });
}

const nonEmptyTurns = results.filter((r) => String(r.reply || "").trim().length > 0).length;
const okTurns = results.filter((r) => r.ok).length;
const totalTurns = results.length;
const reliability = clampScore((((nonEmptyTurns / totalTurns) + (okTurns / totalTurns)) / 2) * 10);

let followUps = 0;
if (has(results[7]?.reply, "estimated total balance")) followUps += 1;
if (has(results[11]?.reply, "remove")) followUps += 1;
if (has(results[22]?.reply, "coinbase") || has(results[22]?.reply, "crypto")) followUps += 1;
const contextualFollowUp = clampScore((followUps / 3) * 10);

let formattingPass = 0;
if (!has(results[3]?.reply, "timestamp:")) formattingPass += 1;
if (has(results[6]?.reply, "$")) formattingPass += 1;
if (!has(results[27]?.reply, "timestamp:")) formattingPass += 1;
if (has(results[29]?.reply, "date:")) formattingPass += 1;
const reportFormatting = clampScore((formattingPass / 4) * 10);

let duplicateCount = 0;
for (let i = 1; i < results.length; i += 1) {
  const prev = String(results[i - 1]?.reply || "").trim();
  const cur = String(results[i]?.reply || "").trim();
  if (prev && cur && prev === cur) duplicateCount += 1;
}
const duplicateControl = clampScore(((Math.max(0, totalTurns - duplicateCount)) / totalTurns) * 10);

const latencies = results.map((r) => Number(r.latencyMs || 0)).filter((v) => Number.isFinite(v) && v > 0);
const avgLatencyMs = Number((latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length)).toFixed(1));
const p95LatencyMs = Number(percentile(latencies, 95).toFixed(1));
let latencyConsistency = 10;
if (avgLatencyMs > 6000) latencyConsistency -= 2;
if (p95LatencyMs > 12000) latencyConsistency -= 2;
latencyConsistency = clampScore(latencyConsistency);

const overall = clampScore(
  reliability * 0.3
  + contextualFollowUp * 0.2
  + reportFormatting * 0.2
  + duplicateControl * 0.15
  + latencyConsistency * 0.15,
);

const scores = {
  reliability,
  contextualFollowUp,
  reportFormatting,
  duplicateControl,
  latencyConsistency,
  overall,
};

const findings = [];
for (const row of results) {
  if (!row.ok) findings.push(`Turn ${row.turn} returned ok=false (${row.route}).`);
  if (!String(row.reply || "").trim()) findings.push(`Turn ${row.turn} returned an empty reply.`);
}
if (has(results[3]?.reply, "timestamp:") || has(results[27]?.reply, "timestamp:")) {
  findings.push("Timestamp is still visible in at least one report turn.");
}
if (duplicateCount > 0) findings.push(`Detected ${duplicateCount} identical consecutive assistant replies.`);

const summary = {
  runId,
  ts: new Date(startedAt).toISOString(),
  userContextId,
  conversationId,
  sessionKeyHint,
  totals: { turns: totalTurns, okTurns, nonEmptyTurns },
  latency: { avgLatencyMs, p95LatencyMs },
  scores,
  findings,
};

const reportJsonPath = path.join(process.cwd(), "archive", "documents", `${runId}-crypto-feedback.json`);
const reportMdPath = path.join(process.cwd(), "archive", "documents", `${runId}-crypto-feedback.md`);
fs.mkdirSync(path.dirname(reportJsonPath), { recursive: true });
fs.writeFileSync(reportJsonPath, `${JSON.stringify({ summary, turns: results }, null, 2)}\n`, "utf8");

const md = [
  "# Nova Crypto 30-Turn Human Stress Feedback",
  "",
  `- Run ID: \`${runId}\``,
  `- Timestamp: \`${new Date(startedAt).toISOString()}\``,
  `- User Context: \`${userContextId}\``,
  `- Conversation ID: \`${conversationId}\``,
  "",
  "## Scores",
  "",
  "| Metric | Score |",
  "|---|---:|",
  ...Object.entries(scores).map(([k, v]) => `| ${k} | ${v} |`),
  "",
  "## Findings",
  "",
  ...(findings.length > 0 ? findings.map((line) => `- ${line}`) : ["- No critical failures detected."]),
  "",
  "## Turn Log",
  "",
  ...results.map((row) => [
    `### Turn ${row.turn}`,
    `- Prompt: ${row.prompt}`,
    `- Route: ${row.route}`,
    `- OK: ${row.ok}`,
    `- Latency: ${row.latencyMs}ms`,
    "- Reply:",
    "```text",
    String(row.reply || "").trim(),
    "```",
    "",
  ].join("\n")),
].join("\n");
fs.writeFileSync(reportMdPath, `${md}\n`, "utf8");

console.log(`json=${reportJsonPath}`);
console.log(`md=${reportMdPath}`);
console.log(`scores=${JSON.stringify(scores)}`);
