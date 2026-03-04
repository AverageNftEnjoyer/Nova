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

const dispatchModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler", "operator-dispatch-routing", "index.js")).href,
);
const { routeOperatorDispatch } = dispatchModule;

await run("P24-C1 chat route delegates to chat worker path", async () => {
  const calls = [];
  const out = await routeOperatorDispatch({
    text: "hello",
    ctx: {},
    llmCtx: {},
    requestHints: { fastLaneSimpleChat: true },
    shouldRouteToSpotify: false,
    userContextId: "user-1",
    conversationId: "thread-1",
    sessionKey: "agent:nova:hud:user:user-1:dm:thread-1",
    activeChatRuntime: { provider: "openai" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    handleSpotify: async () => ({ route: "spotify", ok: true }),
    executeChatRequest: async () => ({ route: "chat", ok: true, reply: "ok" }),
    upsertShortTermContextState: () => {},
  });
  assert.equal(out?.route, "chat");
  assert.equal(out?.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "chat");
});

await run("P24-C2 spotify route updates short-term context on success", async () => {
  const contextUpdates = [];
  const calls = [];
  const out = await routeOperatorDispatch({
    text: "play my focus playlist",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: true,
    spotifyShortTermFollowUp: true,
    spotifyPolicy: {
      resolveTopicAffinityId: () => "spotify_focus",
    },
    spotifyShortTermContext: null,
    spotifyShortTermContextSnapshot: null,
    userContextId: "user-2",
    conversationId: "thread-2",
    sessionKey: "agent:nova:hud:user:user-2:dm:thread-2",
    activeChatRuntime: { provider: "openai" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    handleSpotify: async () => ({ route: "spotify", ok: true, reply: "Playing now" }),
    executeChatRequest: async () => ({ route: "chat", ok: true }),
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "spotify");
  assert.equal(out?.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "spotify");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "spotify");
  assert.equal(contextUpdates[0]?.topicAffinityId, "spotify_focus");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C3 spotify route does not update context on failure", async () => {
  let updates = 0;
  const out = await routeOperatorDispatch({
    text: "spotify fail path",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: true,
    spotifyShortTermFollowUp: false,
    spotifyPolicy: null,
    spotifyShortTermContext: null,
    spotifyShortTermContextSnapshot: null,
    userContextId: "user-3",
    conversationId: "thread-3",
    sessionKey: "agent:nova:hud:user:user-3:dm:thread-3",
    activeChatRuntime: { provider: "openai" },
    delegateToOrgChartWorker: async (payload) => {
      return await payload.run();
    },
    handleSpotify: async () => ({ route: "spotify", ok: false, error: "provider_unavailable" }),
    executeChatRequest: async () => ({ route: "chat", ok: true }),
    upsertShortTermContextState: () => { updates += 1; },
  });
  assert.equal(out?.route, "spotify");
  assert.equal(out?.ok, false);
  assert.equal(updates, 0);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);

