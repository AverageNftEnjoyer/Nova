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
const weatherFastPathModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "fast-path", "weather-fast-path", "index.js")).href,
);

const { handleMissionContextRouting, handleMissionBuildRouting } = missionRoutingModule;
const { handleWeatherConfirmationRouting } = weatherRoutingModule;
const { setPendingMissionConfirm, clearPendingMissionConfirm, getPendingMissionConfirm } = chatUtilsModule;
const { setPendingWeatherConfirm, clearPendingWeatherConfirm, getPendingWeatherConfirm } = weatherFastPathModule;

await run("P20-C1 mission context cancel clears pending state and short-term context", async () => {
  const sessionKey = "agent:nova:hud:user:test-user:dm:mission-cancel";
  setPendingMissionConfirm(sessionKey, "build me a mission");
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
    userContextId: "test-user",
    conversationId: "mission-cancel",
    sessionKey,
    ctx: {},
    sendDirectAssistantReply: async () => "cleared",
    upsertShortTermContextState: () => {},
    clearShortTermContextState: (payload) => clearCalls.push(payload),
  });
  assert.equal(result?.route, "mission_context_canceled");
  assert.equal(result?.ok, true);
  assert.equal(getPendingMissionConfirm(sessionKey), null);
  assert.equal(clearCalls.length, 1);
  assert.equal(clearCalls[0]?.domainId, "mission_task");
});

await run("P20-C2 mission confirm yes delegates merged prompt to workflow build path", async () => {
  const sessionKey = "agent:nova:hud:user:test-user:dm:mission-confirm";
  setPendingMissionConfirm(sessionKey, "Create a daily BTC digest");
  let delegatedText = "";
  const result = await handleMissionBuildRouting({
    text: "yes at 9am on telegram",
    userContextId: "test-user",
    conversationId: "mission-confirm",
    sessionKey,
    ctx: {},
    delegateToOrgChartWorker: async (payload) => {
      delegatedText = String(payload?.text || "");
      return { route: "workflow_build", ok: true, delegatedText };
    },
    sendDirectAssistantReply: async () => "",
    handleWorkflowBuild: async () => ({ route: "workflow_build", ok: true }),
    upsertShortTermContextState: () => {},
    clearShortTermContextState: () => {},
  });
  assert.equal(result?.route, "workflow_build");
  assert.equal(result?.ok, true);
  assert.equal(delegatedText.toLowerCase().includes("daily btc digest"), true);
  assert.equal(delegatedText.toLowerCase().includes("9am"), true);
  assert.equal(getPendingMissionConfirm(sessionKey), null);
});

await run("P20-C3 weather confirm no declines and clears pending confirmation", async () => {
  const sessionKey = "agent:nova:hud:user:test-user:dm:weather-no";
  setPendingWeatherConfirm(sessionKey, "weather in paris", "Paris, France");
  const result = await handleWeatherConfirmationRouting({
    text: "no",
    sessionKey,
    userContextId: "test-user",
    ctx: {},
    sendDirectAssistantReply: async () => "declined",
  });
  assert.equal(result?.route, "weather_confirm_declined");
  assert.equal(result?.ok, true);
  assert.equal(getPendingWeatherConfirm(sessionKey), null);
});

await run("P20-C4 weather non-confirm text clears stale pending confirmation", async () => {
  const sessionKey = "agent:nova:hud:user:test-user:dm:weather-stale";
  setPendingWeatherConfirm(sessionKey, "weather in tokyo", "Tokyo, Japan");
  const result = await handleWeatherConfirmationRouting({
    text: "new question",
    sessionKey,
    userContextId: "test-user",
    ctx: {},
    sendDirectAssistantReply: async () => "",
  });
  assert.equal(result, null);
  assert.equal(getPendingWeatherConfirm(sessionKey), null);
});

clearPendingMissionConfirm("agent:nova:hud:user:test-user:dm:mission-cancel");
clearPendingMissionConfirm("agent:nova:hud:user:test-user:dm:mission-confirm");
clearPendingWeatherConfirm("agent:nova:hud:user:test-user:dm:weather-no");
clearPendingWeatherConfirm("agent:nova:hud:user:test-user:dm:weather-stale");

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
