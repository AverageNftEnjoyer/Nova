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

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);

