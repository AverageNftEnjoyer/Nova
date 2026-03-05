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
const snapshotsModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "core",
  "chat-handler",
  "operator-lane-snapshots",
  "index.js",
)).href;
const dispatchInputModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "core",
  "chat-handler",
  "operator-dispatch-input",
  "index.js",
)).href;

const { OPERATOR_LANE_SEQUENCE, resolveOperatorLaneKeyPrefix } = await import(laneConfigModulePath);
const { readOperatorLaneShortTermContextSnapshots, isMissionContextPrimary } = await import(snapshotsModulePath);
const { buildOperatorDispatchInput } = await import(dispatchInputModulePath);

await run("P28-C1 lane snapshot reader emits snapshot keys for all configured lanes", async () => {
  const domainCalls = [];
  const snapshots = readOperatorLaneShortTermContextSnapshots({
    userContextId: "u28",
    conversationId: "c28",
    readShortTermContextState: ({ domainId }) => {
      domainCalls.push(domainId);
      return { domainId, ts: 1 };
    },
  });

  assert.equal(domainCalls.length, OPERATOR_LANE_SEQUENCE.length);
  for (const lane of OPERATOR_LANE_SEQUENCE) {
    const keyPrefix = resolveOperatorLaneKeyPrefix(lane);
    const snapshotKey = `${keyPrefix}ShortTermContextSnapshot`;
    assert.equal(Object.prototype.hasOwnProperty.call(snapshots, snapshotKey), true);
    assert.equal(snapshots[snapshotKey]?.domainId, lane.domainId);
  }
});

await run("P28-C2 mission context primary evaluator compares mission timestamp against all lane snapshots", async () => {
  const laneSnapshots = {};
  for (const lane of OPERATOR_LANE_SEQUENCE) {
    const keyPrefix = resolveOperatorLaneKeyPrefix(lane);
    laneSnapshots[`${keyPrefix}ShortTermContextSnapshot`] = { ts: 10 };
  }
  assert.equal(isMissionContextPrimary({
    missionShortTermContext: { ts: 11 },
    operatorLaneSnapshots: laneSnapshots,
  }), true);
  laneSnapshots.spotifyShortTermContextSnapshot = { ts: 12 };
  assert.equal(isMissionContextPrimary({
    missionShortTermContext: { ts: 11 },
    operatorLaneSnapshots: laneSnapshots,
  }), false);
});

await run("P28-C3 dispatch input builder maps route decisions and context hints to lane runtime keys", async () => {
  const routeDecisions = {
    shouldRouteToGmail: true,
    shouldRouteToSpotify: false,
  };
  const contextHints = {
    gmailShortTermFollowUp: true,
    gmailShortTermContext: { topicAffinityId: "gmail_topic" },
    spotifyShortTermFollowUp: false,
    spotifyShortTermContext: null,
  };
  const lanePolicies = {
    gmailPolicy: { name: "gmail" },
    spotifyPolicy: { name: "spotify" },
  };
  const operatorLaneSnapshots = {
    gmailShortTermContextSnapshot: { topicAffinityId: "gmail_prev" },
    spotifyShortTermContextSnapshot: { topicAffinityId: "spotify_prev" },
  };

  const dispatchInput = buildOperatorDispatchInput({
    text: "check gmail",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    routeDecisions,
    contextHints,
    lanePolicies,
    operatorLaneSnapshots,
    userContextId: "u28",
    conversationId: "c28",
    sessionKey: "s28",
    activeChatRuntime: { provider: "openai" },
    delegateToOrgChartWorker: async () => ({}),
    handleSpotify: async () => ({}),
    handleYouTube: async () => ({}),
    executeChatRequest: async () => ({}),
    upsertShortTermContextState: () => {},
  });

  assert.equal(dispatchInput.shouldRouteToGmail, true);
  assert.equal(dispatchInput.gmailShortTermFollowUp, true);
  assert.equal(dispatchInput.gmailPolicy?.name, "gmail");
  assert.equal(dispatchInput.gmailShortTermContext?.topicAffinityId, "gmail_topic");
  assert.equal(dispatchInput.gmailShortTermContextSnapshot?.topicAffinityId, "gmail_prev");
  assert.equal(dispatchInput.shouldRouteToSpotify, false);
  assert.equal(dispatchInput.spotifyShortTermFollowUp, false);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
