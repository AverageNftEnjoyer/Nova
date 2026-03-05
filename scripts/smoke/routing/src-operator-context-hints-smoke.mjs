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

const modulePath = pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler", "operator-context-hints", "index.js")).href;
const { buildOperatorContextHints } = await import(modulePath);

await run("P25-C1 assistant cancel clears assistant short-term context", async () => {
  const clearCalls = [];
  const out = buildOperatorContextHints({
    text: "cancel that",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: true },
    userContextId: "u1",
    conversationId: "c1",
    isSpotifyDirectIntent: () => false,
    isSpotifyContextualFollowUpIntent: () => false,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: domainId === "assistant",
      isNewTopic: false,
      isNonCriticalFollowUp: false,
    }),
    readShortTermContextState: ({ domainId }) => (domainId === "assistant" ? { topicAffinityId: "assistant_topic" } : null),
    clearShortTermContextState: (payload) => clearCalls.push(payload),
    summarizeShortTermContextForPrompt: () => "summary",
  });
  assert.equal(out.requestHints.fastLaneSimpleChat, true);
  assert.equal(clearCalls.length, 1);
  assert.equal(clearCalls[0]?.domainId, "assistant");
});

await run("P25-C2 spotify contextual follow-up emits spotify hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "what song is this",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u2",
    conversationId: "c2",
    isSpotifyDirectIntent: () => false,
    isSpotifyContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "spotify",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "spotify"
        ? { topicAffinityId: "spotify_topic", slots: { lastTrack: "track" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "spotify summary",
  });
  assert.equal(out.spotifyShortTermFollowUp, true);
  assert.equal(out.requestHints.spotifyShortTermFollowUp, true);
  assert.equal(out.requestHints.spotifyShortTermContextSummary, "spotify summary");
  assert.equal(out.requestHints.spotifyTopicAffinityId, "spotify_topic");
});

await run("P25-C3 polymarket contextual follow-up emits polymarket hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "more odds on that market",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u3",
    conversationId: "c3",
    isSpotifyDirectIntent: () => false,
    isSpotifyContextualFollowUpIntent: () => false,
    isYouTubeDirectIntent: () => false,
    isYouTubeContextualFollowUpIntent: () => false,
    isPolymarketDirectIntent: () => false,
    isPolymarketContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "polymarket",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "polymarket"
        ? { topicAffinityId: "polymarket_topic", slots: { lastMarket: "election-2028" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "polymarket summary",
  });
  assert.equal(out.polymarketShortTermFollowUp, true);
  assert.equal(out.requestHints.polymarketShortTermFollowUp, true);
  assert.equal(out.requestHints.polymarketShortTermContextSummary, "polymarket summary");
  assert.equal(out.requestHints.polymarketTopicAffinityId, "polymarket_topic");
});

await run("P25-C4 coinbase contextual follow-up emits coinbase hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "refresh balances again",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u4",
    conversationId: "c4",
    isCoinbaseDirectIntent: () => false,
    isCoinbaseContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "coinbase",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "coinbase"
        ? { topicAffinityId: "coinbase_topic", slots: { lastAsset: "btc" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "coinbase summary",
  });
  assert.equal(out.coinbaseShortTermFollowUp, true);
  assert.equal(out.requestHints.coinbaseShortTermFollowUp, true);
  assert.equal(out.requestHints.coinbaseShortTermContextSummary, "coinbase summary");
  assert.equal(out.requestHints.coinbaseTopicAffinityId, "coinbase_topic");
});

await run("P25-C5 gmail contextual follow-up emits gmail hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "show unread emails",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u5",
    conversationId: "c5",
    isGmailDirectIntent: () => false,
    isGmailContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "gmail",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "gmail"
        ? { topicAffinityId: "gmail_topic", slots: { mailbox: "inbox" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "gmail summary",
  });
  assert.equal(out.gmailShortTermFollowUp, true);
  assert.equal(out.requestHints.gmailShortTermFollowUp, true);
  assert.equal(out.requestHints.gmailShortTermContextSummary, "gmail summary");
  assert.equal(out.requestHints.gmailTopicAffinityId, "gmail_topic");
});

await run("P25-C6 telegram contextual follow-up emits telegram hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "status again",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u6",
    conversationId: "c6",
    isTelegramDirectIntent: () => false,
    isTelegramContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "telegram",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "telegram"
        ? { topicAffinityId: "telegram_topic", slots: { chatId: "12345" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "telegram summary",
  });
  assert.equal(out.telegramShortTermFollowUp, true);
  assert.equal(out.requestHints.telegramShortTermFollowUp, true);
  assert.equal(out.requestHints.telegramShortTermContextSummary, "telegram summary");
  assert.equal(out.requestHints.telegramTopicAffinityId, "telegram_topic");
});

await run("P25-C7 discord contextual follow-up emits discord hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "retry that post",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u7",
    conversationId: "c7",
    isDiscordDirectIntent: () => false,
    isDiscordContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "discord",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "discord"
        ? { topicAffinityId: "discord_topic", slots: { webhook: "configured" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "discord summary",
  });
  assert.equal(out.discordShortTermFollowUp, true);
  assert.equal(out.requestHints.discordShortTermFollowUp, true);
  assert.equal(out.requestHints.discordShortTermContextSummary, "discord summary");
  assert.equal(out.requestHints.discordTopicAffinityId, "discord_topic");
});

await run("P25-C8 calendar contextual follow-up emits calendar hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "reschedule to tomorrow afternoon",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u8",
    conversationId: "c8",
    isCalendarDirectIntent: () => false,
    isCalendarContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "calendar",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "calendar"
        ? { topicAffinityId: "calendar_topic", slots: { view: "agenda" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "calendar summary",
  });
  assert.equal(out.calendarShortTermFollowUp, true);
  assert.equal(out.requestHints.calendarShortTermFollowUp, true);
  assert.equal(out.requestHints.calendarShortTermContextSummary, "calendar summary");
  assert.equal(out.requestHints.calendarTopicAffinityId, "calendar_topic");
});

await run("P25-C9 reminders contextual follow-up emits reminders hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "change it to 5pm",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u9",
    conversationId: "c9",
    isReminderDirectIntent: () => false,
    isReminderContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "reminders",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "reminders"
        ? { topicAffinityId: "reminders_topic", slots: { reminderId: "r-1" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "reminders summary",
  });
  assert.equal(out.remindersShortTermFollowUp, true);
  assert.equal(out.requestHints.remindersShortTermFollowUp, true);
  assert.equal(out.requestHints.remindersShortTermContextSummary, "reminders summary");
  assert.equal(out.requestHints.remindersTopicAffinityId, "reminders_topic");
});

await run("P25-C10 web research contextual follow-up emits web research hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "add more sources with citations",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u10",
    conversationId: "c10",
    isWebResearchDirectIntent: () => false,
    isWebResearchContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "web_research",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "web_research"
        ? { topicAffinityId: "web_topic", slots: { query: "ai safety" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "web summary",
  });
  assert.equal(out.webResearchShortTermFollowUp, true);
  assert.equal(out.requestHints.webResearchShortTermFollowUp, true);
  assert.equal(out.requestHints.webResearchShortTermContextSummary, "web summary");
  assert.equal(out.requestHints.webResearchTopicAffinityId, "web_topic");
});

await run("P25-C11 crypto contextual follow-up emits crypto hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "refresh btc again",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u11",
    conversationId: "c11",
    isCryptoDirectIntent: () => false,
    isCryptoContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "crypto",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "crypto"
        ? { topicAffinityId: "crypto_topic", slots: { asset: "btc" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "crypto summary",
  });
  assert.equal(out.cryptoShortTermFollowUp, true);
  assert.equal(out.requestHints.cryptoShortTermFollowUp, true);
  assert.equal(out.requestHints.cryptoShortTermContextSummary, "crypto summary");
  assert.equal(out.requestHints.cryptoTopicAffinityId, "crypto_topic");
});

await run("P25-C12 market contextual follow-up emits market hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "latest weather update",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u12",
    conversationId: "c12",
    isMarketDirectIntent: () => false,
    isMarketContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "market",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "market"
        ? { topicAffinityId: "market_topic", slots: { view: "weather" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "market summary",
  });
  assert.equal(out.marketShortTermFollowUp, true);
  assert.equal(out.requestHints.marketShortTermFollowUp, true);
  assert.equal(out.requestHints.marketShortTermContextSummary, "market summary");
  assert.equal(out.requestHints.marketTopicAffinityId, "market_topic");
});

await run("P25-C13 files contextual follow-up emits files hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "open that file",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u13",
    conversationId: "c13",
    isFilesDirectIntent: () => false,
    isFilesContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "files",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "files"
        ? { topicAffinityId: "files_topic", slots: { path: "src/app.ts" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "files summary",
  });
  assert.equal(out.filesShortTermFollowUp, true);
  assert.equal(out.requestHints.filesShortTermFollowUp, true);
  assert.equal(out.requestHints.filesShortTermContextSummary, "files summary");
  assert.equal(out.requestHints.filesTopicAffinityId, "files_topic");
});

await run("P25-C14 diagnostics contextual follow-up emits diagnostics hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "rerun diagnostics with more detail",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u14",
    conversationId: "c14",
    isDiagnosticsDirectIntent: () => false,
    isDiagnosticsContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "diagnostics",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "diagnostics"
        ? { topicAffinityId: "diag_topic", slots: { metric: "latency" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "diag summary",
  });
  assert.equal(out.diagnosticsShortTermFollowUp, true);
  assert.equal(out.requestHints.diagnosticsShortTermFollowUp, true);
  assert.equal(out.requestHints.diagnosticsShortTermContextSummary, "diag summary");
  assert.equal(out.requestHints.diagnosticsTopicAffinityId, "diag_topic");
});

await run("P25-C15 voice contextual follow-up emits voice hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "mute it for this call",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u15",
    conversationId: "c15",
    isVoiceDirectIntent: () => false,
    isVoiceContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "voice",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "voice"
        ? { topicAffinityId: "voice_topic", slots: { mode: "mute" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "voice summary",
  });
  assert.equal(out.voiceShortTermFollowUp, true);
  assert.equal(out.requestHints.voiceShortTermFollowUp, true);
  assert.equal(out.requestHints.voiceShortTermContextSummary, "voice summary");
  assert.equal(out.requestHints.voiceTopicAffinityId, "voice_topic");
});

await run("P25-C16 tts contextual follow-up emits tts hint summary", async () => {
  const out = buildOperatorContextHints({
    text: "read that paragraph again",
    turnPolicy: { weatherIntent: false, cryptoIntent: false, fastLaneSimpleChat: false },
    userContextId: "u16",
    conversationId: "c16",
    isTtsDirectIntent: () => false,
    isTtsContextualFollowUpIntent: () => true,
    applyShortTermContextTurnClassification: ({ domainId }) => ({
      isCancel: false,
      isNewTopic: false,
      isNonCriticalFollowUp: domainId === "tts",
    }),
    readShortTermContextState: ({ domainId }) => (
      domainId === "tts"
        ? { topicAffinityId: "tts_topic", slots: { voice: "nova" } }
        : null
    ),
    clearShortTermContextState: () => {},
    summarizeShortTermContextForPrompt: () => "tts summary",
  });
  assert.equal(out.ttsShortTermFollowUp, true);
  assert.equal(out.requestHints.ttsShortTermFollowUp, true);
  assert.equal(out.requestHints.ttsShortTermContextSummary, "tts summary");
  assert.equal(out.requestHints.ttsTopicAffinityId, "tts_topic");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
