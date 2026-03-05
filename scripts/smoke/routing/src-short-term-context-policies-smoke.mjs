import assert from "node:assert/strict";
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

const { OPERATOR_LANE_SEQUENCE } = await import(laneConfigModulePath);
const { getShortTermContextPolicy, classifyShortTermContextTurn } = await import(policyModulePath);

await run("P31-C1 each configured operator lane domain resolves to a domain policy", async () => {
  for (const lane of OPERATOR_LANE_SEQUENCE) {
    const policy = getShortTermContextPolicy(lane.domainId);
    assert.equal(policy?.domainId, lane.domainId);
    assert.equal(typeof policy?.isCancel, "function");
    assert.equal(typeof policy?.isNewTopic, "function");
    assert.equal(typeof policy?.isNonCriticalFollowUp, "function");
    assert.equal(typeof policy?.resolveTopicAffinityId, "function");
  }
});

await run("P31-C2 mission and assistant core domains resolve to dedicated policies", async () => {
  assert.equal(getShortTermContextPolicy("mission_task")?.domainId, "mission_task");
  assert.equal(getShortTermContextPolicy("assistant")?.domainId, "assistant");
});

await run("P31-C3 unknown domain falls back to assistant policy", async () => {
  const policy = getShortTermContextPolicy("unknown_domain_xyz");
  assert.equal(policy?.domainId, "assistant");
});

await run("P31-C4 classify helper normalizes and evaluates follow-up/cancel/new-topic", async () => {
  const followUp = classifyShortTermContextTurn({ domainId: "crypto", text: "refresh again please" });
  assert.equal(followUp.isNonCriticalFollowUp, true);
  const cancel = classifyShortTermContextTurn({ domainId: "crypto", text: "cancel that" });
  assert.equal(cancel.isCancel, true);
  const newTopic = classifyShortTermContextTurn({ domainId: "crypto", text: "new topic now" });
  assert.equal(newTopic.isNewTopic, true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
