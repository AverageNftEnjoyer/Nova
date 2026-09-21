import "../../smoke/lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
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

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// Reports are written under the (isolated temp) data dir, not into the repo checkout.
function writeJson(relPath, value) {
  const abs = path.join(process.env.NOVA_DATA_DIR, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return abs;
}

function sanitizeUserContextId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

// Prompt->graph generation lives in shared runtime modules (build-from-prompt prompt text, llm-graph-parser node mapping)
// and the coinbase intent handling in hud's coinbase-step; the assertions below cover all three.
const generationSource = [
  read("src/runtime/modules/services/missions/build-from-prompt/index.js"),
  read("src/runtime/modules/services/missions/llm-graph-parser/index.js"),
  read("hud/lib/missions/workflow/coinbase-step.ts"),
].join("\n");
const executeMissionSource = read("hud/lib/missions/workflow/execute-mission.ts");
const dataExecutorsSource = read("hud/lib/missions/workflow/executors/data-executors.ts");
const coinbaseFetchSource = read("hud/lib/missions/coinbase/fetch.ts");
// The scheduler tick (retry gates, idempotency keys) lives in the shared scheduler core the HUD scheduler delegates to.
const schedulerSource = read("src/runtime/modules/services/missions/scheduler-core/index.js");
const triggerRouteSource = read("hud/app/api/missions/trigger/route.ts");
const triggerStreamSource = read("hud/app/api/missions/trigger/stream/route.ts");
const threadMessagesRouteSource = read("hud/app/api/threads/[threadId]/messages/route.ts");
const threadsRouteSource = read("hud/app/api/threads/route.ts");
const conversationsHookSource = read("hud/lib/chat/hooks/use-conversations/shared.ts");
const deadLetterSource = read("hud/lib/notifications/dead-letter/index.ts");

await run("P13-C1 mission build maps natural-language prompts to Coinbase primitives", async () => {
  const required = [
    "case \"coinbase\":",
    "type: \"coinbase\"",
    "intent === \"status\"",
    "intent === \"price\"",
    "intent === \"portfolio\"",
    "intent === \"transactions\"",
    "intent === \"report\"",
    "For crypto/Coinbase tasks use a coinbase node",
    "coinbase: intent=report|portfolio|price|transactions|status",
  ];
  for (const token of required) {
    assert.equal(generationSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P13-C2 scheduler execution path uses authenticated account + transaction data", async () => {
  const requiredFetchTokens = [
    "buildCoinbaseJwt",
    "buildCoinbaseAuthHeaders",
    "/api/v3/brokerage/accounts",
    "/api/v3/brokerage/orders/historical/fills",
    "portfolio:",
    "transactions:",
  ];
  for (const token of requiredFetchTokens) {
    assert.equal(coinbaseFetchSource.includes(token), true, `missing fetch token: ${token}`);
  }
  const requiredExecTokens = [
    "executeCoinbaseNode(",
    "export async function executeCoinbase(",
    "artifactRef: result.artifactRef",
  ];
  for (const token of requiredExecTokens) {
    assert.equal(dataExecutorsSource.includes(token), true, `missing execution token: ${token}`);
  }
  assert.equal(executeMissionSource.includes("EXECUTOR_REGISTRY[node.type]"), true, "missing executor registry dispatch");
});

await run("P13-C3 primitive data requirements are explicitly gated", async () => {
  const required = [
    "primitive === \"daily_portfolio_summary\" || primitive === \"price_alert_digest\" || primitive === \"weekly_pnl_summary\"",
    "input.primitive === \"price_alert_digest\" || input.primitive === \"weekly_pnl_summary\"",
    "const requiresAccountData =",
    "primitive === \"weekly_pnl_summary\" || primitive === \"daily_portfolio_summary\"",
    "const ok =",
    "primitive === \"weekly_pnl_summary\" ? (hasPortfolio && hasTransactions) :",
    "primitive === \"daily_portfolio_summary\" ? hasPortfolio :",
  ];
  for (const token of required) {
    assert.equal(coinbaseFetchSource.includes(token), true, `missing primitive gate token: ${token}`);
  }
});

await run("P13-C4 retry + dead-letter behavior is present for scheduled and manual triggers", async () => {
  const schedulerTokens = [
    "SCHEDULER_MAX_RETRIES_PER_RUN_KEY",
    "computeRetryDelayMs",
    "idempotencyKey =",
  ];
  for (const token of schedulerTokens) {
    assert.equal(schedulerSource.includes(token), true, `scheduler missing token: ${token}`);
  }
  const triggerTokens = ["appendNotificationDeadLetter", "missionRunId", "runKey", "attempt: 1"];
  for (const token of triggerTokens) {
    assert.equal(triggerRouteSource.includes(token), true, `trigger route missing token: ${token}`);
    assert.equal(triggerStreamSource.includes(token), true, `trigger stream missing token: ${token}`);
  }
  // Dead letters are nova.db rows (dead_letters, kind "notification"), no longer notification-dead-letter.jsonl.
  assert.equal(deadLetterSource.includes("appendDeadLetterRecord(\"notification\""), true);
  assert.equal(deadLetterSource.includes("notification-dead-letter.jsonl"), false);
});

await run("P13-C5 transcript persistence contains mission metadata fields in API write + read paths", async () => {
  const messageWriteTokens = [
    "missionRunId",
    "missionRunKey",
    "missionAttempt",
    "missionSource",
    "missionOutputChannel",
  ];
  for (const token of messageWriteTokens) {
    assert.equal(threadMessagesRouteSource.includes(token), true, `messages route missing token: ${token}`);
    assert.equal(threadsRouteSource.includes(token), true, `threads route missing token: ${token}`);
  }
  const hydrationTokens = [
    "missionRunId = String(msg.metadata?.missionRunId || \"\").trim()",
    "const runKey = String(msg.metadata?.runKey || \"\").trim()",
    "attempt?: number",
  ];
  for (const token of hydrationTokens) {
    assert.equal(conversationsHookSource.includes(token), true, `conversation hydration missing token: ${token}`);
  }
});

const userContextId = sanitizeUserContextId(process.env.NOVA_SMOKE_USER_CONTEXT_ID || "");
const { listDeadLetterRecords } = await import("../../../src/runtime/modules/services/missions/persistence/sqlite-store.js");
// Latest notification dead letter for the smoke user (null when none / no user configured).
const latestDeadLetter = userContextId ? (listDeadLetterRecords("notification", userContextId, 1)[0] ?? null) : null;

const metadataSnapshot = {
  ts: new Date().toISOString(),
  sourceChecks: {
    threadMessagesRoute: {
      hasMissionRunId: threadMessagesRouteSource.includes("missionRunId"),
      hasMissionRunKey: threadMessagesRouteSource.includes("missionRunKey"),
      hasMissionAttempt: threadMessagesRouteSource.includes("missionAttempt"),
    },
    threadsRoute: {
      hasMissionRunId: threadsRouteSource.includes("missionRunId"),
      hasMissionRunKey: threadsRouteSource.includes("missionRunKey"),
      hasMissionAttempt: threadsRouteSource.includes("missionAttempt"),
    },
    conversationHydration: {
      hasMissionRunId: conversationsHookSource.includes("missionRunId = String(msg.metadata?.missionRunId || \"\").trim()"),
      hasMissionRunKey: conversationsHookSource.includes("const runKey = String(msg.metadata?.runKey || \"\").trim()"),
      hasMissionAttempt: conversationsHookSource.includes("attempt?: number"),
    },
  },
  note: "Static source snapshot for Phase 13-C mission metadata persistence paths.",
};
const deadLetterSnapshot = {
  ts: new Date().toISOString(),
  userContextId: userContextId || null,
  deadLetterStore: "sqlite:dead_letters/notification",
  deadLetterExists: latestDeadLetter !== null,
  sample: latestDeadLetter,
};

const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const report = {
  ts: new Date().toISOString(),
  pass,
  fail,
  results,
  artifacts: {
    metadataSnapshot: "archive/logs/coinbase-mission-contracts-db-metadata-snapshot.json",
    deadLetterSnapshot: "archive/logs/coinbase-mission-contracts-dead-letter-snapshot.json",
  },
  context: {
    userContextId: userContextId || null,
  },
};

const reportPath = writeJson("archive/logs/coinbase-mission-contracts-report.json", report);
const metadataSnapshotPath = writeJson("archive/logs/coinbase-mission-contracts-db-metadata-snapshot.json", metadataSnapshot);
const deadLetterSnapshotPath = writeJson("archive/logs/coinbase-mission-contracts-dead-letter-snapshot.json", deadLetterSnapshot);

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`report=${reportPath}`);
console.log(`metadataSnapshot=${metadataSnapshotPath}`);
console.log(`deadLetterSnapshot=${deadLetterSnapshotPath}`);
console.log(`Summary: pass=${pass} fail=${fail}`);

if (fail > 0) process.exit(1);

