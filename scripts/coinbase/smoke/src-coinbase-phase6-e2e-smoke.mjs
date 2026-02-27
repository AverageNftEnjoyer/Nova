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

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const generationSource = read("hud/lib/missions/workflow/generation.ts");
const executeMissionSource = read("hud/lib/missions/workflow/execute-mission.ts");
const dataExecutorsSource = read("hud/lib/missions/workflow/executors/data-executors.ts");
const coinbaseFetchSource = read("hud/lib/missions/coinbase/fetch.ts");
const schedulerSource = read("hud/lib/notifications/scheduler.ts");
const triggerRouteSource = read("hud/app/api/notifications/trigger/route.ts");
const triggerStreamSource = read("hud/app/api/notifications/trigger/stream/route.ts");
const threadMessagesRouteSource = read("hud/app/api/threads/[threadId]/messages/route.ts");
const threadsRouteSource = read("hud/app/api/threads/route.ts");
const conversationsHookSource = read("hud/lib/chat/hooks/useConversations.ts");

await run("P6-E2E-C1 Coinbase mission build path is wired from prompt generation", async () => {
  assert.equal(generationSource.includes("buildCoinbaseWorkflow"), true);
  assert.equal(generationSource.includes('type: "coinbase"'), true);
  assert.equal(generationSource.includes("coinbaseIntent"), true);
  assert.equal(generationSource.includes("promptLooksLikeCoinbaseTask"), true);
});

await run("P6-E2E-C2 Mission execution routes Coinbase nodes through the data executor path", async () => {
  assert.equal(dataExecutorsSource.includes("executeCoinbaseWorkflowStep"), true);
  assert.equal(dataExecutorsSource.includes("type: \"coinbase\" as const"), true);
  assert.equal(dataExecutorsSource.includes("artifactRef: result.artifactRef"), true);
  assert.equal(executeMissionSource.includes("EXECUTOR_REGISTRY[node.type]"), true);
});

await run("P6-E2E-C3 Coinbase mission fetch includes authenticated account data paths", async () => {
  const requiredTokens = [
    "buildCoinbaseJwt",
    "buildCoinbaseAuthHeaders",
    "buildHmacHeaders",
    "\"CB-ACCESS-KEY\"",
    "Authorization: `Bearer ${token}`",
    "/api/v3/brokerage/accounts",
    "/api/v3/brokerage/orders/historical/fills",
    "portfolio:",
    "transactions:",
  ];
  for (const token of requiredTokens) {
    assert.equal(coinbaseFetchSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P6-E2E-C4 Scheduler path includes retry + dead-letter handling", async () => {
  const requiredTokens = [
    "SCHEDULER_MAX_RETRIES_PER_RUN_KEY",
    "computeRetryDelayMs",
    "appendNotificationDeadLetter",
    "runKey",
    "attempt",
  ];
  for (const token of requiredTokens) {
    assert.equal(schedulerSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P6-E2E-C5 Manual trigger paths propagate run metadata and dead-letter data", async () => {
  const requiredTriggerTokens = ["missionRunId", "runKey", "attempt: 1", "appendNotificationDeadLetter"];
  for (const token of requiredTriggerTokens) {
    assert.equal(triggerRouteSource.includes(token), true, `trigger route missing token: ${token}`);
    assert.equal(triggerStreamSource.includes(token), true, `trigger stream missing token: ${token}`);
  }
});

await run("P6-E2E-C6 Thread message DB writes persist mission run metadata", async () => {
  const requiredTokens = [
    "missionRunId",
    "missionRunKey",
    "missionAttempt",
    "missionSource",
    "missionOutputChannel",
  ];
  for (const token of requiredTokens) {
    assert.equal(threadMessagesRouteSource.includes(token), true, `missing persisted token: ${token}`);
  }
});

await run("P6-E2E-C7 Thread history reads expose mission run metadata", async () => {
  const requiredTokens = [
    "missionRunId",
    "missionRunKey",
    "missionAttempt",
    "missionSource",
    "missionOutputChannel",
  ];
  for (const token of requiredTokens) {
    assert.equal(threadsRouteSource.includes(token), true, `missing read token: ${token}`);
  }
});

await run("P6-E2E-C8 Pending Telegram hydration carries metadata into conversation state", async () => {
  const requiredTokens = [
    "missionRunId: msg.metadata?.missionRunId",
    "missionRunKey: msg.metadata?.runKey",
    "missionAttempt:",
    "missionSource: msg.metadata?.source",
    "missionOutputChannel: msg.metadata?.outputChannel",
    "syncServerMessages(convoWithMessage)",
  ];
  for (const token of requiredTokens) {
    assert.equal(conversationsHookSource.includes(token), true, `missing hydration token: ${token}`);
  }
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
