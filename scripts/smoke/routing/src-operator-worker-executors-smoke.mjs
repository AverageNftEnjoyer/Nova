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

await run("P30-C2 gmail executor routes to dedicated worker with operator lane + worker hints", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "gmail");
  let genericCalled = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "check gmail",
    ctx: {
      userContextId: "gmail-user",
      conversationId: "gmail-thread",
      sessionKey: "agent:nova:hud:user:gmail-user:dm:gmail-thread",
    },
    llmCtx: {
      runtimeTools: {
        async executeToolUse() {
          return { content: JSON.stringify({ ok: true, data: { connected: true, email: "user@example.com", scopes: [], missingScopes: [] } }) };
        },
      },
      availableTools: [{ name: "gmail_capabilities" }],
      activeChatRuntime: { provider: "openai" },
    },
    requestHints: { fastLaneSimpleChat: false },
    executeChatRequest: async () => {
      genericCalled = true;
      return { ok: true };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "gmail");
  assert.equal(genericCalled, false);
  assert.equal(out?.requestHints?.operatorLane?.id, "gmail");
  assert.equal(out?.requestHints?.operatorLane?.executorKind, "gmail");
  assert.equal(out?.requestHints?.operatorWorker?.agentId, "gmail-agent");
  assert.equal(out?.requestHints?.operatorWorker?.routeHint, "gmail");
  assert.equal(out?.requestHints?.forceToolLoop, true);
});

await run("P30-C2b telegram executor routes to dedicated worker and never calls executeChatRequest", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "telegram");
  let executeChatRequestCalled = false;
  let receivedHints = null;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "send this to telegram",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    telegramWorker: async (_text, _ctx, _llmCtx, hints) => {
      receivedHints = hints;
      return { ok: true, route: "telegram" };
    },
    executeChatRequest: async () => {
      executeChatRequestCalled = true;
      return { ok: false, route: "chat" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "telegram");
  assert.equal(executeChatRequestCalled, false);
  assert.equal(receivedHints?.operatorLane?.id, "telegram");
  assert.equal(receivedHints?.operatorLane?.executorKind, "telegram");
});

await run("P30-C3 spotify executor uses specialized handler", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "spotify");
  let called = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "play spotify",
    ctx: {},
    llmCtx: {},
    spotifyWorker: async () => {
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
    youtubeWorker: async () => {
      called = true;
      return { ok: true, route: "youtube" };
    },
    executeChatRequest: async () => ({ ok: false }),
  });
  const out = await runExecutor();
  assert.equal(called, true);
  assert.equal(out?.route, "youtube");
});

await run("P30-C5 polymarket executor uses dedicated worker and never calls generic execute", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "polymarket");
  const baseHints = { fastLaneSimpleChat: true };
  let resolvedHints = null;
  let polymarketCalled = false;
  let genericCalled = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "scan polymarket odds",
    ctx: {},
    llmCtx: {},
    requestHints: baseHints,
    polymarketWorker: async (_text, _ctx, _llmCtx, hints) => {
      polymarketCalled = true;
      resolvedHints = hints;
      return { ok: true, route: "polymarket" };
    },
    executeChatRequest: async () => {
      genericCalled = true;
      return { ok: true, route: "chat" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "polymarket");
  assert.equal(polymarketCalled, true);
  assert.equal(genericCalled, false);
  assert.equal(resolvedHints?.operatorLane?.executorKind, "polymarket");
  assert.equal(resolvedHints?.operatorWorker?.agentId, "polymarket-agent");
  assert.equal(resolvedHints?.fastLaneSimpleChat, false);
  assert.equal(baseHints.fastLaneSimpleChat, true);
});

await run("P30-C6 coinbase executor uses specialized worker handler", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "coinbase");
  let called = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "refresh coinbase holdings",
    ctx: {},
    llmCtx: {},
    coinbaseWorker: async () => {
      called = true;
      return { ok: true, route: "coinbase" };
    },
    executeChatRequest: async () => ({ ok: false, route: "chat" }),
  });
  const out = await runExecutor();
  assert.equal(out?.route, "coinbase");
  assert.equal(called, true);
});

await run("P30-C7 web research executor enforces web preload hints and avoids generic fallback", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "web_research");
  let genericCalled = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "research sources for latest model release",
    ctx: {
      userContextId: "wr-user",
      conversationId: "wr-thread",
      sessionKey: "agent:nova:hud:user:wr-user:dm:wr-thread",
    },
    llmCtx: {
      runtimeTools: {
        async executeToolUse() {
          return { content: "[1] Example Source\nhttps://example.com\nSummary." };
        },
      },
      availableTools: [{ name: "web_search" }],
    },
    requestHints: {},
    executeChatRequest: async () => {
      genericCalled = true;
      return { ok: true, route: "chat" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "web_research");
  assert.equal(out?.provider, "web_search");
  assert.equal(genericCalled, false);
  assert.equal(out?.requestHints?.operatorLane?.executorKind, "web_research");
  assert.equal(out?.requestHints?.forceWebSearchPreload, true);
  assert.equal(out?.requestHints?.forceWebFetchPreload, true);
});

await run("P30-C8 crypto executor uses specialized worker handler", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "crypto");
  let called = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "show crypto prices",
    ctx: {},
    llmCtx: {},
    cryptoWorker: async () => {
      called = true;
      return { ok: true, route: "crypto" };
    },
    executeChatRequest: async () => ({ ok: false, route: "chat" }),
  });
  const out = await runExecutor();
  assert.equal(out?.route, "crypto");
  assert.equal(called, true);
});

await run("P30-C9 market executor uses specialized weather handler for weather lanes", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "market");
  let called = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "weather and market brief",
    ctx: {},
    llmCtx: {},
    weatherWorker: async () => {
      called = true;
      return { ok: true, route: "weather" };
    },
    executeChatRequest: async () => ({ ok: false, route: "chat" }),
  });
  const out = await runExecutor();
  assert.equal(out?.route, "weather");
  assert.equal(called, true);
});

await run("P30-C9c market executor uses dedicated market worker and never calls generic execute", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "market");
  let marketCalled = false;
  let genericCalled = false;
  let receivedHints = null;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "show stock market trend",
    ctx: {},
    llmCtx: { turnPolicy: { weatherIntent: false } },
    requestHints: { marketTopicAffinityId: "market_equities" },
    marketWorker: async (_text, _ctx, _llmCtx, hints) => {
      marketCalled = true;
      receivedHints = hints;
      return { ok: true, route: "market" };
    },
    executeChatRequest: async () => {
      genericCalled = true;
      return { ok: true, route: "chat" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "market");
  assert.equal(marketCalled, true);
  assert.equal(genericCalled, false);
  assert.equal(receivedHints?.operatorLane?.routeHint, "market");
  assert.equal(receivedHints?.operatorLane?.responseRoute, "market");
});

await run("P30-C9d market executor honors dispatch-selected weather route over text heuristics", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "market");
  let weatherCalled = false;
  let marketCalled = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "refresh",
    ctx: {},
    llmCtx: { turnPolicy: { weatherIntent: false } },
    requestHints: { operatorDispatchRouteHint: "weather" },
    weatherWorker: async () => {
      weatherCalled = true;
      return { ok: true, route: "weather" };
    },
    marketWorker: async () => {
      marketCalled = true;
      return { ok: true, route: "market" };
    },
    executeChatRequest: async () => ({ ok: false, route: "chat" }),
  });
  const out = await runExecutor();
  assert.equal(out?.route, "weather");
  assert.equal(weatherCalled, true);
  assert.equal(marketCalled, false);
});

await run("P30-C9b discord executor uses dedicated discord worker and never calls generic execute", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "discord");
  let discordCalled = false;
  let genericCalled = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "post update to discord",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    discordWorker: async () => {
      discordCalled = true;
      return { ok: true, route: "discord" };
    },
    executeChatRequest: async () => {
      genericCalled = true;
      return { ok: true, route: "chat" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "discord");
  assert.equal(discordCalled, true);
  assert.equal(genericCalled, false);
});

await run("P30-C9e calendar executor uses dedicated calendar worker and never calls generic execute", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "calendar");
  let genericCalled = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "calendar update",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    executeChatRequest: async () => {
      genericCalled = true;
      return { ok: true, route: "chat" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "calendar");
  assert.equal(genericCalled, false);
});

await run("P30-C9f reminders executor uses dedicated reminders worker and never calls generic execute", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "reminders");
  let genericCalled = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "set reminder",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    executeChatRequest: async () => {
      genericCalled = true;
      return { ok: true, route: "chat" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "reminder");
  assert.equal(genericCalled, false);
});

await run("P30-C9g voice executor uses dedicated voice worker and never calls generic execute", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "voice");
  let genericCalled = false;
  let voiceWorkerCalled = false;
  let receivedHints = null;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "voice settings",
    ctx: {
      userContextId: "voice-user",
      conversationId: "voice-thread",
      sessionKey: "agent:nova:hud:user:voice-user:dm:voice-thread",
    },
    llmCtx: {},
    requestHints: {},
    voiceWorker: async (_text, _ctx, _llmCtx, hints) => {
      voiceWorkerCalled = true;
      receivedHints = hints;
      return { ok: true, route: "voice" };
    },
    executeChatRequest: async () => {
      genericCalled = true;
      return { ok: true, route: "chat" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "voice");
  assert.equal(voiceWorkerCalled, true);
  assert.equal(genericCalled, false);
  assert.equal(receivedHints?.operatorLane?.id, "voice");
  assert.equal(receivedHints?.operatorWorker?.agentId, "voice-agent");
});

await run("P30-C9h tts executor uses dedicated tts worker and never calls generic execute", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "tts");
  let genericCalled = false;
  let ttsWorkerCalled = false;
  let receivedHints = null;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "tts settings",
    ctx: {
      userContextId: "tts-user",
      conversationId: "tts-thread",
      sessionKey: "agent:nova:hud:user:tts-user:dm:tts-thread",
    },
    llmCtx: {},
    requestHints: {},
    ttsWorker: async (_text, _ctx, _llmCtx, hints) => {
      ttsWorkerCalled = true;
      receivedHints = hints;
      return { ok: true, route: "tts" };
    },
    executeChatRequest: async () => {
      genericCalled = true;
      return { ok: true, route: "chat" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "tts");
  assert.equal(ttsWorkerCalled, true);
  assert.equal(genericCalled, false);
  assert.equal(receivedHints?.operatorLane?.id, "tts");
  assert.equal(receivedHints?.operatorWorker?.agentId, "tts-agent");
});

await run("P30-C9i diagnostics executor uses dedicated diagnostics worker and never calls generic execute", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "diagnostics");
  let genericCalled = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "run diagnostics",
    ctx: {
      userContextId: "diag-user",
      conversationId: "diag-thread",
      sessionKey: "agent:nova:hud:user:diag-user:dm:diag-thread",
    },
    llmCtx: {
      selectedChatModel: "gpt-5",
      activeChatRuntime: { provider: "openai" },
      availableTools: [{ name: "web_search" }],
      turnPolicy: {},
      executionPolicy: {},
    },
    requestHints: {},
    executeChatRequest: async () => {
      genericCalled = true;
      return { ok: true, route: "chat" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "diagnostic");
  assert.equal(genericCalled, false);
  assert.equal(out?.provider, "runtime_diagnostics");
});

await run("P30-C9j files executor uses dedicated files worker and never calls generic execute", async () => {
  const lane = OPERATOR_LANE_SEQUENCE.find((entry) => entry.id === "files");
  let genericCalled = false;
  const runExecutor = resolveOperatorWorkerExecutor({
    lane,
    text: "list files in .",
    ctx: {
      userContextId: "files-user",
      conversationId: "files-thread",
      sessionKey: "agent:nova:hud:user:files-user:dm:files-thread",
    },
    llmCtx: {
      runtimeTools: {
        async executeToolUse() {
          return { content: "f README.md\nf package.json\nd src" };
        },
      },
      availableTools: [{ name: "ls" }],
      activeChatRuntime: { provider: "openai" },
    },
    requestHints: {},
    executeChatRequest: async () => {
      genericCalled = true;
      return { ok: true, route: "chat" };
    },
  });
  const out = await runExecutor();
  assert.equal(out?.route, "files");
  assert.equal(genericCalled, false);
  assert.equal(out?.provider, "tool_runtime");
});

await run("P30-C10 operator execution controls can disable force flags", async () => {
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
    const runExecutor = resolveWithDisabledForceFlags({
      lane,
      text: "research latest routing updates",
      ctx: {
        userContextId: "wr-controls-user",
        conversationId: "wr-controls-thread",
        sessionKey: "agent:nova:hud:user:wr-controls-user:dm:wr-controls-thread",
      },
      llmCtx: {
        runtimeTools: {
          async executeToolUse() {
            return { content: "[1] Controls Check\nhttps://example.com\nControl-path validation." };
          },
        },
        availableTools: [{ name: "web_search" }],
      },
      requestHints: {},
      executeChatRequest: async () => ({ ok: true, route: "chat" }),
    });
    const out = await runExecutor();
    assert.equal(out?.route, "web_research");
    assert.equal(Boolean(out?.requestHints?.forceToolLoop), false);
    assert.equal(Boolean(out?.requestHints?.forceWebSearchPreload), false);
    assert.equal(Boolean(out?.requestHints?.forceWebFetchPreload), false);
    assert.equal(out?.requestHints?.operatorExecutionControls?.forceToolLoopAllowed, false);
    assert.equal(out?.requestHints?.operatorExecutionControls?.forceWebSearchPreloadAllowed, false);
    assert.equal(out?.requestHints?.operatorExecutionControls?.forceWebFetchPreloadAllowed, false);
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
