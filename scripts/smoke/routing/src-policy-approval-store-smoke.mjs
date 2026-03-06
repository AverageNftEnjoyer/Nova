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

const modulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "routing",
  "policy-approval-store",
  "index.js",
)).href;
const constantsModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "core",
  "constants",
  "index.js",
)).href;

const { grantPolicyApproval, consumePolicyApproval } = await import(modulePath);
const { USER_CONTEXT_ROOT } = await import(constantsModulePath);

await run("P32-C1 policy approval grants are user+conversation scoped and one-time consumable", async () => {
  const userContextId = `smoke-policy-${Date.now()}`;
  const conversationId = "thread-1";
  const sessionKey = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;

  const granted = grantPolicyApproval({
    userContextId,
    conversationId,
    sessionKey,
    source: "smoke_test",
    ttlMs: 120000,
  });
  assert.equal(granted, true);

  const firstConsume = consumePolicyApproval({
    userContextId,
    conversationId,
    sessionKey,
  });
  const secondConsume = consumePolicyApproval({
    userContextId,
    conversationId,
    sessionKey,
  });
  assert.equal(firstConsume, true);
  assert.equal(secondConsume, false);
});

await run("P32-C2 policy approval does not leak across conversations", async () => {
  const userContextId = `smoke-policy-${Date.now()}-b`;
  const sessionKeyA = `agent:nova:hud:user:${userContextId}:dm:thread-a`;
  const sessionKeyB = `agent:nova:hud:user:${userContextId}:dm:thread-b`;
  grantPolicyApproval({
    userContextId,
    conversationId: "thread-a",
    sessionKey: sessionKeyA,
    source: "smoke_test",
    ttlMs: 120000,
  });

  const crossConsume = consumePolicyApproval({
    userContextId,
    conversationId: "thread-b",
    sessionKey: sessionKeyB,
  });
  assert.equal(crossConsume, false);
});

await run("P32-C3 policy approval store persists under user state directory", async () => {
  const userContextId = `smoke-policy-${Date.now()}-c`;
  const conversationId = "thread-c";
  const sessionKey = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;
  grantPolicyApproval({
    userContextId,
    conversationId,
    sessionKey,
    source: "smoke_test",
    ttlMs: 120000,
  });
  const storePath = path.join(
    USER_CONTEXT_ROOT,
    userContextId.toLowerCase(),
    "state",
    "policy-approvals.json",
  );
  assert.equal(fs.existsSync(storePath), true);
  const raw = fs.readFileSync(storePath, "utf8");
  assert.equal(raw.includes("records"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
