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

function writeJson(relPath, value) {
  const abs = path.join(process.cwd(), relPath);
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

const generationSource = read("hud/lib/missions/workflow/generation.ts");
const executionSource = read("hud/lib/missions/workflow/execution.ts");
const coinbaseFetchSource = read("hud/lib/missions/coinbase/fetch.ts");
const schedulerSource = read("hud/lib/notifications/scheduler.ts");
const triggerRouteSource = read("hud/app/api/notifications/trigger/route.ts");
const triggerStreamSource = read("hud/app/api/notifications/trigger/stream/route.ts");
const threadMessagesRouteSource = read("hud/app/api/threads/[threadId]/messages/route.ts");
const threadsRouteSource = read("hud/app/api/threads/route.ts");
const conversationsHookSource = read("hud/lib/chat/hooks/useConversations.ts");
const deadLetterSource = read("hud/lib/notifications/dead-letter.ts");

await run("P13-C1 mission build maps natural-language prompts to Coinbase primitives", async () => {
  const required = [
    "inferCoinbasePrimitive(",
    "daily_portfolio_summary",
    "weekly_pnl_summary",
    "price_alert_digest",
    "buildCoinbaseWorkflow(",
    "fetchSource: \"coinbase\"",
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
    "parseCoinbaseFetchQuery",
    "fetchCoinbaseMissionData",
    "source === \"coinbase\"",
  ];
  for (const token of requiredExecTokens) {
    assert.equal(executionSource.includes(token), true, `missing execution token: ${token}`);
  }
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
    "appendNotificationDeadLetter",
    "runKey",
    "attempt",
    "missionRunId",
  ];
  for (const token of schedulerTokens) {
    assert.equal(schedulerSource.includes(token), true, `scheduler missing token: ${token}`);
  }
  const triggerTokens = ["appendNotificationDeadLetter", "missionRunId", "runKey", "attempt: 1"];
  for (const token of triggerTokens) {
    assert.equal(triggerRouteSource.includes(token), true, `trigger route missing token: ${token}`);
    assert.equal(triggerStreamSource.includes(token), true, `trigger stream missing token: ${token}`);
  }
  assert.equal(deadLetterSource.includes("notification-dead-letter.jsonl"), true);
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
    "missionRunId: msg.metadata?.missionRunId",
    "missionRunKey: msg.metadata?.runKey",
    "missionAttempt:",
  ];
  for (const token of hydrationTokens) {
    assert.equal(conversationsHookSource.includes(token), true, `conversation hydration missing token: ${token}`);
  }
});

const userContextId = sanitizeUserContextId(process.env.NOVA_SMOKE_USER_CONTEXT_ID || "");
const deadLetterCandidates = [];
if (userContextId) {
  deadLetterCandidates.push(path.join(process.cwd(), ".agent", "user-context", userContextId, "notification-dead-letter.jsonl"));
}
deadLetterCandidates.push(path.join(process.cwd(), "data", "notification-dead-letter.jsonl"));
const resolvedDeadLetterPath = deadLetterCandidates.find((candidate) => fs.existsSync(candidate)) || "";

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
      hasMissionRunId: conversationsHookSource.includes("missionRunId: msg.metadata?.missionRunId"),
      hasMissionRunKey: conversationsHookSource.includes("missionRunKey: msg.metadata?.runKey"),
      hasMissionAttempt: conversationsHookSource.includes("missionAttempt:"),
    },
  },
  note: "Static source snapshot for Phase 13-C mission metadata persistence paths.",
};
const deadLetterSnapshot = {
  ts: new Date().toISOString(),
  userContextId: userContextId || null,
  deadLetterPath: resolvedDeadLetterPath || null,
  deadLetterExists: Boolean(resolvedDeadLetterPath),
  sample: (() => {
    if (!resolvedDeadLetterPath) return null;
    try {
      const lines = String(fs.readFileSync(resolvedDeadLetterPath, "utf8") || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) return null;
      return JSON.parse(lines[lines.length - 1]);
    } catch {
      return null;
    }
  })(),
};

const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const report = {
  ts: new Date().toISOString(),
  pass,
  fail,
  results,
  artifacts: {
    metadataSnapshot: "archive/logs/coinbase-phase13-db-metadata-snapshot.json",
    deadLetterSnapshot: "archive/logs/coinbase-phase13-dead-letter-snapshot.json",
  },
  context: {
    userContextId: userContextId || null,
  },
};

const reportPath = writeJson("archive/logs/coinbase-phase13-mission-e2e-report.json", report);
const metadataSnapshotPath = writeJson("archive/logs/coinbase-phase13-db-metadata-snapshot.json", metadataSnapshot);
const deadLetterSnapshotPath = writeJson("archive/logs/coinbase-phase13-dead-letter-snapshot.json", deadLetterSnapshot);

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`report=${reportPath}`);
console.log(`metadataSnapshot=${metadataSnapshotPath}`);
console.log(`deadLetterSnapshot=${deadLetterSnapshotPath}`);
console.log(`Summary: pass=${pass} fail=${fail}`);

if (fail > 0) process.exit(1);

