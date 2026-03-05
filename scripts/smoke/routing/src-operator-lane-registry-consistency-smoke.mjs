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
const routingRegistryModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "routing",
  "org-chart-routing",
  "registry.js",
)).href;
const lanePoliciesModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "core",
  "chat-handler",
  "operator-lane-policies",
  "index.js",
)).href;
const followUpCueModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "core",
  "chat-handler",
  "operator-followup-cue",
  "index.js",
)).href;

const { OPERATOR_LANE_SEQUENCE } = await import(laneConfigModulePath);
const { DOMAIN_WORKER_RULES } = await import(routingRegistryModulePath);
const { buildOperatorLanePolicies } = await import(lanePoliciesModulePath);
const { hasFollowUpContinuationCue } = await import(followUpCueModulePath);

await run("P27-C1 operator lane config ids are unique", async () => {
  const ids = OPERATOR_LANE_SEQUENCE.map((lane) => lane.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length);
});

await run("P27-C2 operator lane route flags are unique", async () => {
  const flags = OPERATOR_LANE_SEQUENCE.map((lane) => lane.shouldRouteFlag);
  const uniqueFlags = new Set(flags);
  assert.equal(uniqueFlags.size, flags.length);
});

await run("P27-C3 each operator lane route hint maps to a registry worker", async () => {
  const unmatched = [];

  for (const lane of OPERATOR_LANE_SEQUENCE) {
    const match = DOMAIN_WORKER_RULES.find((rule) => (
      Array.isArray(rule.routeTokens) && rule.routeTokens.includes(lane.routeHint)
    ));
    if (!match) unmatched.push(`${lane.id}:${lane.routeHint}`);
  }

  assert.deepEqual(unmatched, []);
});

await run("P27-C4 each operator lane response route maps to a registry worker", async () => {
  const unmatched = [];

  for (const lane of OPERATOR_LANE_SEQUENCE) {
    const match = DOMAIN_WORKER_RULES.find((rule) => (
      Array.isArray(rule.responseRouteTokens) && rule.responseRouteTokens.includes(lane.responseRoute)
    ));
    if (!match) unmatched.push(`${lane.id}:${lane.responseRoute}`);
  }

  assert.deepEqual(unmatched, []);
});

await run("P27-C5 each operator lane declares intent and follow-up key wiring", async () => {
  for (const lane of OPERATOR_LANE_SEQUENCE) {
    assert.equal(typeof lane.directIntentFnKey, "string");
    assert.equal(lane.directIntentFnKey.length > 0, true);
    assert.equal(typeof lane.contextualFollowUpIntentFnKey, "string");
    assert.equal(lane.contextualFollowUpIntentFnKey.length > 0, true);
    assert.equal(typeof lane.shortTermFollowUpFlag, "string");
    assert.equal(lane.shortTermFollowUpFlag.length > 0, true);
  }
});

await run("P27-C6 lane policy builder exposes policy keys for each configured lane", async () => {
  const lanePolicies = buildOperatorLanePolicies((domainId) => ({ domainId }));
  const expectedKeys = OPERATOR_LANE_SEQUENCE.map((lane) => (
    `${String(lane.shortTermFollowUpFlag || "").replace(/ShortTermFollowUp$/, "")}Policy`
  ));
  for (const key of expectedKeys) {
    assert.equal(Object.prototype.hasOwnProperty.call(lanePolicies, key), true);
    assert.equal(typeof lanePolicies[key], "object");
  }
});

await run("P27-C7 follow-up cue evaluator requires non-cancel non-new-topic follow-up", async () => {
  const falsePolicy = {
    isNonCriticalFollowUp: () => true,
    isCancel: () => true,
    isNewTopic: () => false,
  };
  const truePolicy = {
    isNonCriticalFollowUp: () => true,
    isCancel: () => false,
    isNewTopic: () => false,
  };
  assert.equal(hasFollowUpContinuationCue({
    normalizedTextForRouting: "keep going",
    policies: [falsePolicy],
  }), false);
  assert.equal(hasFollowUpContinuationCue({
    normalizedTextForRouting: "keep going",
    policies: [falsePolicy, truePolicy],
  }), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
