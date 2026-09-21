import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  clearPendingMissionConfirm,
  getPendingMissionConfirm,
  setPendingMissionConfirm,
} from "../../../src/runtime/modules/chat/core/chat-utils/index.js";
import {
  cacheRecentCryptoReport,
  readRecentCryptoReport,
} from "../../../src/runtime/modules/chat/core/crypto-report-dedupe/index.js";
import {
  clearShortTermContextState,
  readShortTermContextState,
  upsertShortTermContextState,
} from "../../../src/runtime/modules/chat/core/short-term-context-engine/index.js";
import {
  getCoinbaseFollowUpKey,
  readCoinbaseFollowUpState,
  updateCoinbaseFollowUpState,
} from "../../../src/runtime/modules/chat/workers/finance/crypto-service/state/index.js";
import {
  clearPendingWeatherConfirmation,
  readPendingWeatherConfirmation,
  writePendingWeatherConfirmation,
} from "../../../src/runtime/modules/chat/workers/market/weather-service/index.js";
import { kvList } from "../../../src/db/index.js";

const results = [];
let freshImportNonce = 0;

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

async function importFresh(relativePath) {
  freshImportNonce += 1;
  const href = pathToFileURL(path.join(process.cwd(), relativePath)).href;
  return await import(`${href}?fresh=${Date.now()}-${freshImportNonce}`);
}

await run("Mission, weather, and crypto runtime state persist by user and conversation", async () => {
  const userContextId = "smoke-platform-contract-20260306";
  const conversationId = "smoke-platform-contract-thread";

  clearPendingMissionConfirm({ userContextId, conversationId });
  clearPendingWeatherConfirmation({ userContextId, conversationId });
  clearShortTermContextState({ userContextId, conversationId, domainId: "assistant" });
  updateCoinbaseFollowUpState(getCoinbaseFollowUpKey(userContextId, conversationId), { ok: true });

  setPendingMissionConfirm({
    userContextId,
    conversationId,
    prompt: "create a mission to send a Discord recap every Friday at 5pm",
  });
  writePendingWeatherConfirmation({
    userContextId,
    conversationId,
    prompt: "what's the weather in londn tomorrow",
    suggestedLocation: "London, England, GB",
  });
  upsertShortTermContextState({
    userContextId,
    conversationId,
    domainId: "assistant",
    topicAffinityId: "general_assistant",
    slots: { marker: "assistant-persisted" },
  });
  updateCoinbaseFollowUpState(getCoinbaseFollowUpKey(userContextId, conversationId), {
    ok: false,
    errorCode: "RATE_LIMITED",
    guidance: "retry",
    safeMessage: "Coinbase is rate limiting requests right now. Wait briefly, then retry.",
  });
  cacheRecentCryptoReport(userContextId, conversationId, "BTC is up 3% today.");

  const mission = getPendingMissionConfirm({ userContextId, conversationId });
  const weather = readPendingWeatherConfirmation({ userContextId, conversationId });
  const assistantState = readShortTermContextState({ userContextId, conversationId, domainId: "assistant" });
  const coinbaseFollowUp = readCoinbaseFollowUpState(getCoinbaseFollowUpKey(userContextId, conversationId));
  const cryptoReplay = readRecentCryptoReport(userContextId, conversationId);

  assert.equal(String(mission?.prompt || ""), "create a mission to send a Discord recap every Friday at 5pm");
  assert.equal(String(weather?.suggestedLocation || ""), "London, England, GB");
  assert.equal(String(assistantState?.slots?.marker || ""), "assistant-persisted");
  assert.equal(String(coinbaseFollowUp?.errorCode || ""), "RATE_LIMITED");
  assert.equal(cryptoReplay, "BTC is up 3% today.");

  // Follow-up state is stored in nova.db kv_state (namespace "short-term-context"), keyed `<conversation>::<domain>`
  // and scoped to the user, not in a per-user short-term-context-state.json file.
  const persistedKeys = new Set(kvList(userContextId, "short-term-context").map((row) => row.key));
  assert.equal(persistedKeys.size > 0, true, "expected persistent state rows in kv_state");
  for (const domain of ["mission_confirmation", "weather_confirmation", "assistant", "coinbase_followup", "crypto_report_replay"]) {
    assert.equal(persistedKeys.has(`${conversationId}::${domain}`), true, `missing kv_state key for ${domain}`);
  }
  // Rows for this user's conversation are invisible from another user scope.
  assert.equal(kvList("smoke-platform-contract-other", "short-term-context").length, 0);
});

await run("Persistent runtime follow-up state survives a fresh module load", async () => {
  const userContextId = "smoke-platform-contract-restart";
  const conversationId = "smoke-platform-contract-restart-thread";

  clearPendingMissionConfirm({ userContextId, conversationId });
  clearPendingWeatherConfirmation({ userContextId, conversationId });
  clearShortTermContextState({ userContextId, conversationId, domainId: "assistant" });
  updateCoinbaseFollowUpState(getCoinbaseFollowUpKey(userContextId, conversationId), { ok: true });

  setPendingMissionConfirm({
    userContextId,
    conversationId,
    prompt: "send a team recap every weekday at 9am",
  });
  writePendingWeatherConfirmation({
    userContextId,
    conversationId,
    prompt: "weather in seattle tomorrow",
    suggestedLocation: "Seattle, WA, US",
  });
  upsertShortTermContextState({
    userContextId,
    conversationId,
    domainId: "assistant",
    topicAffinityId: "general_assistant",
    slots: { marker: "restart-safe" },
  });
  updateCoinbaseFollowUpState(getCoinbaseFollowUpKey(userContextId, conversationId), {
    ok: false,
    errorCode: "AUTH_FAILED",
    guidance: "reconnect",
    safeMessage: "Coinbase auth failed.",
  });
  cacheRecentCryptoReport(userContextId, conversationId, "ETH is flat today.");

  const freshChatUtils = await importFresh("src/runtime/modules/chat/core/chat-utils/index.js");
  const freshWeather = await importFresh("src/runtime/modules/chat/workers/market/weather-service/index.js");
  const freshShortTermContext = await importFresh("src/runtime/modules/chat/core/short-term-context-engine/index.js");
  const freshCryptoState = await importFresh("src/runtime/modules/chat/workers/finance/crypto-service/state/index.js");
  const freshCryptoReplay = await importFresh("src/runtime/modules/chat/core/crypto-report-dedupe/index.js");

  const mission = freshChatUtils.getPendingMissionConfirm({ userContextId, conversationId });
  const weather = freshWeather.readPendingWeatherConfirmation({ userContextId, conversationId });
  const assistantState = freshShortTermContext.readShortTermContextState({
    userContextId,
    conversationId,
    domainId: "assistant",
  });
  const coinbaseFollowUp = freshCryptoState.readCoinbaseFollowUpState(
    freshCryptoState.getCoinbaseFollowUpKey(userContextId, conversationId),
  );
  const cryptoReplay = freshCryptoReplay.readRecentCryptoReport(userContextId, conversationId);

  assert.equal(String(mission?.prompt || ""), "send a team recap every weekday at 9am");
  assert.equal(String(weather?.suggestedLocation || ""), "Seattle, WA, US");
  assert.equal(String(assistantState?.slots?.marker || ""), "restart-safe");
  assert.equal(String(coinbaseFollowUp?.errorCode || ""), "AUTH_FAILED");
  assert.equal(cryptoReplay, "ETH is flat today.");
});

await run("Persistent confirmation and crypto state clearing remains scoped", async () => {
  const conversationId = "smoke-platform-contract-shared";
  const userA = "smoke-platform-contract-a";
  const userB = "smoke-platform-contract-b";

  setPendingMissionConfirm({ userContextId: userA, conversationId, prompt: "mission for a" });
  setPendingMissionConfirm({ userContextId: userB, conversationId, prompt: "mission for b" });
  writePendingWeatherConfirmation({
    userContextId: userA,
    conversationId,
    prompt: "weather a",
    suggestedLocation: "Austin, TX, US",
  });
  writePendingWeatherConfirmation({
    userContextId: userB,
    conversationId,
    prompt: "weather b",
    suggestedLocation: "Boston, MA, US",
  });

  clearPendingMissionConfirm({ userContextId: userA, conversationId });
  clearPendingWeatherConfirmation({ userContextId: userA, conversationId });
  updateCoinbaseFollowUpState(getCoinbaseFollowUpKey(userA, conversationId), { ok: true });

  assert.equal(getPendingMissionConfirm({ userContextId: userA, conversationId }), null);
  assert.equal(String(getPendingMissionConfirm({ userContextId: userB, conversationId })?.prompt || ""), "mission for b");
  assert.equal(readPendingWeatherConfirmation({ userContextId: userA, conversationId }), null);
  assert.equal(
    String(readPendingWeatherConfirmation({ userContextId: userB, conversationId })?.suggestedLocation || ""),
    "Boston, MA, US",
  );
});

await run("Manual worker sources normalize their summaries before delegation wrapping", async () => {
  const workerFiles = [
    "src/runtime/modules/chat/workers/productivity/missions-agent/index.js",
    "src/runtime/modules/chat/workers/media/spotify-agent/index.js",
    "src/runtime/modules/chat/workers/media/youtube-agent/index.js",
  ];

  for (const relativePath of workerFiles) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    assert.equal(source.includes("normalizeWorkerSummary(summary"), true, `${relativePath} should normalize summary`);
    assert.equal(source.includes("userContextId:"), true, `${relativePath} should pass userContextId fallback`);
    assert.equal(source.includes("conversationId:"), true, `${relativePath} should pass conversationId fallback`);
    assert.equal(source.includes("sessionKey:"), true, `${relativePath} should pass sessionKey fallback`);
  }
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
