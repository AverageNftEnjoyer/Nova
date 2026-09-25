/**
 * Opt-in LIVE token/caching check (`npm run smoke:live-token-check`).
 *
 * Not part of any release chain: it makes real, billable LLM calls with the user's own API key. It measures what
 * the offline harness can't: how many input tokens the provider actually served from its prompt cache.
 *
 *   NOVA_LIVE_TOKEN_CHECK=1           run it (otherwise: prints a skip message and exits 0)
 *   NOVA_LIVE_TOKEN_CHECK_CAP_USD     spend cap in USD (default 1). The run stops before the next turn once
 *                                     recorded spend reaches 80% of the cap, so one turn can't push it past the cap.
 *   NOVA_SMOKE_USER_CONTEXT_ID=<id>   optional; which user's integrations to use
 *   --out <file>                      optional; save the per-call rows as JSON
 *
 * Safety (same as smoke:live-latency): the real nova.db is opened READ-ONLY, only to read the active provider's
 * credentials. Everything else runs in a throwaway temp data dir seeded with that one runtime snapshot, so nothing
 * is written to the real data dir. The agent task runs in plan mode (read-only tools) on a temp fixture workspace.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (String(process.env.NOVA_LIVE_TOKEN_CHECK || "").trim() !== "1") {
  console.log(
    "smoke:live-token-check skipped: set NOVA_LIVE_TOKEN_CHECK=1 to run it.\n"
    + "  It uses the provider API key stored in your real nova.db (read-only) and makes real, billable LLM calls\n"
    + "  (default cap $1, NOVA_LIVE_TOKEN_CHECK_CAP_USD to change).",
  );
  process.exit(0);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const capUsd = Math.max(0.05, Number(process.env.NOVA_LIVE_TOKEN_CHECK_CAP_USD || 1) || 1);
const stopAtUsd = capUsd * 0.8;
// Guard for a model without a price (cost can't be tracked): stop past this many input tokens instead.
const UNPRICED_INPUT_TOKEN_STOP = 250_000;
const outIndex = process.argv.indexOf("--out");
const outFile = outIndex > 0 ? process.argv[outIndex + 1] : "";

const root = process.cwd();
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { resolveDataDir, DB_FILENAME, openDbAt } = await load("src/db/index.js");
const secrets = await load("src/security/secrets/index.js");

// ---- Phase 1: read credentials from the REAL data dir, read-only ----
const realDbFile = path.join(resolveDataDir(), DB_FILENAME);
if (!fs.existsSync(realDbFile)) fail(`no nova.db at ${realDbFile}. Launch Nova and connect an LLM provider first.`);
const explicitUser = String(process.env.NOVA_SMOKE_USER_CONTEXT_ID || process.env.NOVA_USER_CONTEXT_ID || "").trim();

let userId = "";
let snapshot = null;
const realDb = openDbAt(realDbFile, { readonly: true });
try {
  const rows = realDb
    .prepare("SELECT user_id, value_json FROM integration_state WHERE integration = 'runtime' AND key = 'snapshot' ORDER BY user_id")
    .all();
  const pick = explicitUser ? rows.find((r) => r.user_id === explicitUser.toLowerCase()) : rows[0];
  if (!pick) fail("no runtime integrations snapshot found. Open Nova and save your LLM provider key first.");
  userId = pick.user_id;
  snapshot = JSON.parse(pick.value_json);
} finally {
  realDb.close();
}

const provider = ["claude", "grok", "gemini", "openai"].includes(snapshot?.activeLlmProvider) ? snapshot.activeLlmProvider : "openai";
const integration = snapshot?.[provider] && typeof snapshot[provider] === "object" ? snapshot[provider] : {};
const storedKey = String(integration.apiKey || "").trim();
let apiKey = "";
try {
  apiKey = storedKey && secrets.isSecretCiphertext(storedKey) ? secrets.decryptSecret(storedKey) : storedKey;
} catch (error) {
  fail(`could not decrypt the "${provider}" API key: ${error instanceof Error ? error.message : String(error)}`);
}
if (!String(apiKey || "").trim()) fail(`no API key for the active provider "${provider}". Add it on the Integrations page.`);

// ---- Phase 2: isolated temp data dir seeded with only that snapshot ----
const { createIsolatedDataDir } = await load("scripts/smoke/lib/isolated-data-dir.mjs");
createIsolatedDataDir("nova-live-token-check-");
secrets.resetSecretsCache();
const { getDb } = await load("src/db/index.js");
const seeded = { ...snapshot, [provider]: { ...integration, apiKey: secrets.encryptSecret(apiKey), connected: true } };
getDb()
  .prepare(
    "INSERT INTO integration_state (user_id, integration, key, value_json, updated_at) VALUES (?, 'runtime', 'snapshot', ?, ?) "
    + "ON CONFLICT(user_id, integration, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
  )
  .run(userId, JSON.stringify(seeded), new Date().toISOString());
apiKey = "";

const { handleInput } = await load("src/runtime/modules/chat/core/chat-handler/index.js");
const { listLlmUsage, sumLlmUsage } = await load("src/db/llm-usage.js");

console.log(`live-token-check: provider=${provider} model=${integration.model || "(default)"} cap=$${capUsd.toFixed(2)} (credentials read-only; runs in a temp data dir)`);

function spendGuard() {
  const total = sumLlmUsage(userId);
  const rows = listLlmUsage(userId, { limit: 1000 });
  const unpricedInput = rows.filter((row) => row.costUsd === null).reduce((sum, row) => sum + row.inputTokens, 0);
  if (total.costUsd >= stopAtUsd) return `spend $${total.costUsd.toFixed(4)} reached 80% of the $${capUsd.toFixed(2)} cap`;
  if (unpricedInput >= UNPRICED_INPUT_TOKEN_STOP) return `unpriced model: ${unpricedInput} input tokens reached the token stop`;
  return "";
}

const CHAT_TURNS = [
  "Hey Nova, good morning.",
  "I'm planning a small dinner party for six on Saturday. Suggest a simple three-course menu.",
  "One guest is vegetarian and another can't eat nuts. Adjust the menu.",
  "What can I prepare the day before?",
  "Give me a short shopping list grouped by store section.",
  "How long should the chicken and potatoes roast, and at what temperature?",
  "Suggest a simple dessert that fits the constraints.",
  "Draft a two-sentence invitation for the guests.",
  "Summarize the final plan in exactly 3 bullet points.",
  "Thanks, that's really helpful!",
];

let stoppedReason = "";
const chatConversationId = "live-token-check-chat";
for (const text of CHAT_TURNS) {
  stoppedReason = spendGuard();
  if (stoppedReason) break;
  await handleInput(text, {
    source: "hud",
    sender: "hud-user",
    voice: false,
    userContextId: userId,
    conversationId: chatConversationId,
    sessionKeyHint: `agent:nova:hud:user:${userId}:dm:${chatConversationId}`,
  });
}

// Agent task: read-only tools (plan mode) on a small temp workspace, same options the agent-task service passes.
const taskId = "live-token-check-task";
const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-live-token-ws-"));
fs.mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
fs.writeFileSync(path.join(workspaceDir, "README.md"), "# orders-api\n\nSmall Express API for orders. See src/server.js.\n");
fs.writeFileSync(
  path.join(workspaceDir, "src", "server.js"),
  "// TODO: validate request bodies\nconst express = require('express');\nconst app = express();\n"
  + "app.get('/orders', (req, res) => res.json([]));\n// TODO: add pagination\napp.listen(3000);\n",
);
if (!stoppedReason) stoppedReason = spendGuard();
if (!stoppedReason) {
  await handleInput(
    "List the files in the workspace, read README.md and src/server.js, and report every TODO with its file and line.",
    {
      voice: false,
      source: "agent-task",
      sender: "agent-task",
      userContextId: userId,
      conversationId: `agent-task-${taskId}`,
      sessionKeyHint: `agent-task:${userId}:${taskId}`,
      autonomousTask: true,
      permissionMode: "plan-mode",
      approvedTools: [],
      taskId,
      workspaceDir,
      worktreePath: "",
      executionFenceCheck: () => {},
      consumeTaskApproval: () => {},
      reserveTaskEffect: () => {},
      customInstructions:
        "Execute this as an autonomous background task. Use available Nova integrations and tools when needed. "
        + "Return a clear final result describing completed work and any blockers.",
    },
  );
}

// ---- Report ----
const rows = listLlmUsage(userId, { limit: 1000 }).reverse();
function summarize(label, list) {
  const later = list.slice(1);
  const sum = (items, key) => items.reduce((total, row) => total + row[key], 0);
  const input = sum(list, "inputTokens");
  const cached = sum(list, "cachedInputTokens");
  const laterInput = sum(later, "inputTokens");
  const laterCached = sum(later, "cachedInputTokens");
  const cost = list.reduce((total, row) => total + (row.costUsd || 0), 0);
  console.log(
    `${label}: calls=${list.length} input=${input} cached=${cached} (${input ? ((cached / input) * 100).toFixed(1) : "0.0"}%) `
    + `calls2+ cached=${laterInput ? ((laterCached / laterInput) * 100).toFixed(1) : "0.0"}% `
    + `cacheWrite=${sum(list, "cacheWriteInputTokens")} output=${sum(list, "outputTokens")} cost=$${cost.toFixed(4)}`,
  );
}
console.log("\nPer call (oldest first): source | model | input | cached | cacheWrite | output | cost");
for (const row of rows) {
  console.log(
    `  ${row.source} | ${row.model} | ${row.inputTokens} | ${row.cachedInputTokens} | ${row.cacheWriteInputTokens} | ${row.outputTokens} | `
    + `${row.costUsd === null ? "unpriced" : `$${row.costUsd.toFixed(5)}`}`,
  );
}
summarize("chat", rows.filter((row) => row.refId === chatConversationId || row.source === "chat"));
summarize("agent-task", rows.filter((row) => row.source === "agent-task"));
const total = sumLlmUsage(userId);
console.log(`total: calls=${total.calls} cost=$${total.costUsd.toFixed(4)} of cap $${capUsd.toFixed(2)}`);
if (stoppedReason) console.log(`stopped early: ${stoppedReason}`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ provider, model: integration.model || "", capUsd, rows, total, stoppedReason }, null, 2));
fs.rmSync(workspaceDir, { recursive: true, force: true });
process.exit(0);
