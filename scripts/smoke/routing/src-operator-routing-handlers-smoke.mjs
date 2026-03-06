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

const missionRoutingModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler", "operator-mission-routing", "index.js")).href,
);
const weatherRoutingModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler", "operator-weather-routing", "index.js")).href,
);
const chatUtilsModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-utils", "index.js")).href,
);
const weatherServiceModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "workers", "market", "weather-service", "index.js")).href,
);

const { handleMissionContextRouting, handleMissionBuildRouting } = missionRoutingModule;
const { handleWeatherConfirmationRouting } = weatherRoutingModule;
const { setPendingMissionConfirm, clearPendingMissionConfirm, getPendingMissionConfirm } = chatUtilsModule;
const {
  writePendingWeatherConfirmation,
  clearPendingWeatherConfirmation,
  readPendingWeatherConfirmation,
} = weatherServiceModule;

await run("P20-C1 mission context cancel clears pending state and short-term context", async () => {
  const userContextId = "test-user";
  const conversationId = "mission-cancel";
  const sessionKey = "agent:nova:hud:user:test-user:dm:mission-cancel";
  setPendingMissionConfirm({ userContextId, conversationId, prompt: "build me a mission" });
  const clearCalls = [];
  const result = await handleMissionContextRouting({
    text: "cancel",
    normalizedTextForRouting: "cancel",
    missionContextIsPrimary: true,
    missionShortTermContext: { slots: { pendingPrompt: "build me a mission" } },
    missionPolicy: {
      isCancel: () => true,
      isNonCriticalFollowUp: () => false,
      isNewTopic: () => false,
    },
    userContextId,
    conversationId,
    sessionKey,
    ctx: {},
    sendDirectAssistantReply: async () => "cleared",
    upsertShortTermContextState: () => {},
    clearShortTermContextState: (payload) => clearCalls.push(payload),
  });
  assert.equal(result?.route, "mission_context_canceled");
  assert.equal(result?.ok, true);
  assert.equal(getPendingMissionConfirm({ userContextId, conversationId }), null);
  assert.equal(clearCalls.length, 1);
  assert.equal(clearCalls[0]?.domainId, "mission_task");
});

await run("P20-C2 mission confirm yes delegates merged prompt to workflow build path", async () => {
  const userContextId = "test-user";
  const conversationId = "mission-confirm";
  const sessionKey = "agent:nova:hud:user:test-user:dm:mission-confirm";
  setPendingMissionConfirm({ userContextId, conversationId, prompt: "Create a daily BTC digest" });
  let delegatedText = "";
  let delegatedRouteHint = "";
  let delegatedToolCalls = [];
  let missionWorkerCalled = false;
  const result = await handleMissionBuildRouting({
    text: "yes at 9am on telegram",
    userContextId,
    conversationId,
    sessionKey,
    ctx: {},
    delegateToOrgChartWorker: async (payload) => {
      delegatedText = String(payload?.text || "");
      delegatedRouteHint = String(payload?.routeHint || "");
      delegatedToolCalls = Array.isArray(payload?.toolCalls) ? payload.toolCalls : [];
      return { route: "workflow_build", ok: true, delegatedText };
    },
    sendDirectAssistantReply: async () => "",
    missionWorker: async () => {
      missionWorkerCalled = true;
      return { route: "workflow_build", ok: true };
    },
    upsertShortTermContextState: () => {},
    clearShortTermContextState: () => {},
  });
  assert.equal(result?.route, "workflow_build");
  assert.equal(result?.ok, true);
  assert.equal(delegatedText.toLowerCase().includes("daily btc digest"), true);
  assert.equal(delegatedText.toLowerCase().includes("9am"), true);
  assert.equal(delegatedRouteHint, "workflow");
  assert.deepEqual(delegatedToolCalls, ["mission"]);
  assert.equal(missionWorkerCalled, false);
  assert.equal(getPendingMissionConfirm({ userContextId, conversationId }), null);
});

await run("P20-C3 weather confirm no declines and clears pending confirmation", async () => {
  const userContextId = "test-user";
  const conversationId = "weather-no";
  const sessionKey = "agent:nova:hud:user:test-user:dm:weather-no";
  writePendingWeatherConfirmation({ userContextId, conversationId, prompt: "weather in paris", suggestedLocation: "Paris, France" });
  const result = await handleWeatherConfirmationRouting({
    text: "no",
    sessionKey,
    userContextId,
    conversationId,
    ctx: {},
    sendDirectAssistantReply: async () => "declined",
  });
  assert.equal(result?.route, "weather_confirm_declined");
  assert.equal(result?.ok, true);
  assert.equal(readPendingWeatherConfirmation({ userContextId, conversationId }), null);
});

await run("P20-C4 weather non-confirm text clears stale pending confirmation", async () => {
  const userContextId = "test-user";
  const conversationId = "weather-stale";
  const sessionKey = "agent:nova:hud:user:test-user:dm:weather-stale";
  writePendingWeatherConfirmation({ userContextId, conversationId, prompt: "weather in tokyo", suggestedLocation: "Tokyo, Japan" });
  const result = await handleWeatherConfirmationRouting({
    text: "new question",
    sessionKey,
    userContextId,
    conversationId,
    ctx: {},
    sendDirectAssistantReply: async () => "",
  });
  assert.equal(result, null);
  assert.equal(readPendingWeatherConfirmation({ userContextId, conversationId }), null);
});

await run("P20-C5 weather confirm yes resolves through shared weather lookup", async () => {
  const userContextId = "test-user";
  const conversationId = "weather-yes";
  const sessionKey = "agent:nova:hud:user:test-user:dm:weather-yes";
  writePendingWeatherConfirmation({ userContextId, conversationId, prompt: "weather in paris", suggestedLocation: "Paris, France" });
  const result = await handleWeatherConfirmationRouting({
    text: "yes",
    sessionKey,
    userContextId,
    conversationId,
    ctx: {},
    runWeatherLookup: async (input) => {
      assert.equal(input?.forcedLocation, "Paris, France");
      assert.equal(input?.bypassConfirmation, true);
      return { reply: "Paris, France right now: 61F, clear skies." };
    },
    sendDirectAssistantReply: async () => "confirmed",
  });
  assert.equal(result?.route, "weather_confirm_accepted");
  assert.equal(result?.ok, true);
  assert.equal(result?.reply, "confirmed");
  assert.equal(readPendingWeatherConfirmation({ userContextId, conversationId }), null);
});

clearPendingMissionConfirm({ userContextId: "test-user", conversationId: "mission-cancel" });
clearPendingMissionConfirm({ userContextId: "test-user", conversationId: "mission-confirm" });
clearPendingWeatherConfirmation({ userContextId: "test-user", conversationId: "weather-no" });
clearPendingWeatherConfirmation({ userContextId: "test-user", conversationId: "weather-stale" });
clearPendingWeatherConfirmation({ userContextId: "test-user", conversationId: "weather-yes" });

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
