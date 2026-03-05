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
const executorsModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "core",
  "chat-handler",
  "operator-worker-executors",
  "index.js",
)).href;

const { OPERATOR_LANE_SEQUENCE } = await import(laneConfigModulePath);
const { resolveOperatorWorkerExecutor, getOperatorWorkerExecutorKindMap, getOperatorExecutionControls } = await import(executorsModulePath);

await run("P30-C1 worker executor kind map covers every operator lane", async () => {
  const kindMap = getOperatorWorkerExecutorKindMap();
  const laneIds = OPERATOR_LANE_SEQUENCE.map((lane) => lane.id);
  for (const laneId of laneIds) {
    assert.equal(typeof kindMap[laneId], "string");
    assert.equal(kindMap[laneId].length > 0, true);
  }
});

await run("P30-C1b operator execution controls default to enabled", async () => {
  const controls = getOperatorExecutionControls();
  assert.equal(controls.forceToolLoopAllowed, true);
  assert.equal(controls.forceWebSearchPreloadAllowed, true);
  assert.equal(controls.forceWebFetchPreloadAllowed, true);
});

await run("P30-C2 gmail executor injects operator lane + worker hints", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "gmail");
  const baseHints = { fastLaneSimpleChat: false };
  let resolvedHints = null;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "check gmail",
    ctx: {},
    llmCtx: {},
    requestHints: baseHints,
    executeChatRequest: async (_text, _ctx, _llmCtx, hints) => {
      resolvedHints = hints;
      return { ok: true };
    },
  });
  await runExecutor();
  assert.equal(resolvedHints?.operatorLane?.id, "gmail");
  assert.equal(resolvedHints?.operatorLane?.executorKind, "gmail");
  assert.equal(resolvedHints?.operatorWorker?.agentId, "gmail-agent");
  assert.equal(resolvedHints?.operatorWorker?.routeHint, "gmail");
  assert.equal(resolvedHints?.forceToolLoop, true);
  assert.equal("operatorLane" in baseHints, false);
});

await run("P30-C3 spotify executor uses specialized handler", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "spotify");
  let called = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "play spotify",
    ctx: {},
    llmCtx: {},
    handleSpotify: async () => {
      called = true;
      return { ok: true, route: "spotify" };
    },
    executeChatRequest: async () => ({ ok: false }),
  });
  const out = await runExecutor();
  assert.equal(called, true);
  assert.equal(out?.route, "spotify");
});

await run("P30-C4 youtube executor uses specialized handler", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "youtube");
  let called = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "show youtube videos",
    ctx: {},
    llmCtx: {},
    handleYouTube: async () => {
      called = true;
      return { ok: true, route: "youtube" };
    },
    executeChatRequest: async () => ({ ok: false }),
  });
  const out = await runExecutor();
  assert.equal(called, true);
  assert.equal(out?.route, "youtube");
});

await run("P30-C5 polymarket executor uses dedicated hints and executor kind", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "polymarket");
  const baseHints = { fastLaneSimpleChat: true };
  let resolvedHints = null;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "scan polymarket odds",
    ctx: {},
    llmCtx: {},
    requestHints: baseHints,
    executeChatRequest: async (_text, _ctx, _llmCtx, hints) => {
      resolvedHints = hints;
      return { ok: true, route: "polymarket" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "polymarket");
  assert.equal(resolvedHints?.operatorLane?.executorKind, "polymarket");
  assert.equal(resolvedHints?.operatorWorker?.agentId, "polymarket-agent");
  assert.equal(resolvedHints?.fastLaneSimpleChat, false);
  assert.equal(baseHints.fastLaneSimpleChat, true);
});

await run("P30-C6 coinbase executor uses dedicated tool-loop hints", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "coinbase");
  let resolvedHints = null;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "refresh coinbase holdings",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    executeChatRequest: async (_text, _ctx, _llmCtx, hints) => {
      resolvedHints = hints;
      return { ok: true, route: "coinbase" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "coinbase");
  assert.equal(resolvedHints?.operatorLane?.executorKind, "coinbase");
  assert.equal(resolvedHints?.forceToolLoop, true);
  assert.equal(resolvedHints?.fastLaneSimpleChat, false);
});

await run("P30-C7 web research executor enforces web preload hints", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "web_research");
  let resolvedHints = null;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "research sources for latest model release",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    executeChatRequest: async (_text, _ctx, _llmCtx, hints) => {
      resolvedHints = hints;
      return { ok: true, route: "web_research" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "web_research");
  assert.equal(resolvedHints?.operatorLane?.executorKind, "web_research");
  assert.equal(resolvedHints?.forceWebSearchPreload, true);
  assert.equal(resolvedHints?.forceWebFetchPreload, true);
});

await run("P30-C8 market executor enforces freshness-oriented preload hints", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "market");
  let resolvedHints = null;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "weather and market brief",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    executeChatRequest: async (_text, _ctx, _llmCtx, hints) => {
      resolvedHints = hints;
      return { ok: true, route: "weather" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "weather");
  assert.equal(resolvedHints?.operatorLane?.executorKind, "market");
  assert.equal(resolvedHints?.forceWebSearchPreload, true);
  assert.equal(resolvedHints?.fastLaneSimpleChat, false);
});

await run("P30-C9 operator execution controls can disable force flags", async () => {
  const previous = {
    toolLoop: process.env.NOVA_OPERATOR_FORCE_TOOL_LOOP,
    webSearch: process.env.NOVA_OPERATOR_FORCE_WEB_SEARCH_PRELOAD,
    webFetch: process.env.NOVA_OPERATOR_FORCE_WEB_FETCH_PRELOAD,
  };
  try {
    process.env.NOVA_OPERATOR_FORCE_TOOL_LOOP = "0";
    process.env.NOVA_OPERATOR_FORCE_WEB_SEARCH_PRELOAD = "0";
    process.env.NOVA_OPERATOR_FORCE_WEB_FETCH_PRELOAD = "0";
    const {
      resolveOperatorWorkerExecutor: resolveWithDisabledForceFlags,
      getOperatorExecutionControls: getControlsWithDisabledForceFlags,
    } = await import(`${executorsModulePath}?controls=disabled-${Date.now()}`);
    const controls = getControlsWithDisabledForceFlags();
    assert.equal(controls.forceToolLoopAllowed, false);
    assert.equal(controls.forceWebSearchPreloadAllowed, false);
    assert.equal(controls.forceWebFetchPreloadAllowed, false);

    const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "web_research");
    let resolvedHints = null;
    const runExecutor = resolveWithDisabledForceFlags({
      lane,
      text: "research latest routing updates",
      ctx: {},
      llmCtx: {},
      requestHints: {},
      executeChatRequest: async (_text, _ctx, _llmCtx, hints) => {
        resolvedHints = hints;
        return { ok: true, route: "web_research" };
      },
    });
    const out = await runExecutor();
    assert.equal(out?.route, "web_research");
    assert.equal(Boolean(resolvedHints?.forceToolLoop), false);
    assert.equal(Boolean(resolvedHints?.forceWebSearchPreload), false);
    assert.equal(Boolean(resolvedHints?.forceWebFetchPreload), false);
    assert.equal(resolvedHints?.operatorExecutionControls?.forceToolLoopAllowed, false);
    assert.equal(resolvedHints?.operatorExecutionControls?.forceWebSearchPreloadAllowed, false);
    assert.equal(resolvedHints?.operatorExecutionControls?.forceWebFetchPreloadAllowed, false);
  } finally {
    if (typeof previous.toolLoop === "undefined") delete process.env.NOVA_OPERATOR_FORCE_TOOL_LOOP;
    else process.env.NOVA_OPERATOR_FORCE_TOOL_LOOP = previous.toolLoop;
    if (typeof previous.webSearch === "undefined") delete process.env.NOVA_OPERATOR_FORCE_WEB_SEARCH_PRELOAD;
    else process.env.NOVA_OPERATOR_FORCE_WEB_SEARCH_PRELOAD = previous.webSearch;
    if (typeof previous.webFetch === "undefined") delete process.env.NOVA_OPERATOR_FORCE_WEB_FETCH_PRELOAD;
    else process.env.NOVA_OPERATOR_FORCE_WEB_FETCH_PRELOAD = previous.webFetch;
  }
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
