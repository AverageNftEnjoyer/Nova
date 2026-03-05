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

const modulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "core",
  "chat-handler",
  "operator-route-decisions",
  "index.js",
)).href;
const { buildOperatorRouteDecisions } = await import(modulePath);

const always = () => true;
const never = () => false;

await run("P26-C1 youtube direct overrides spotify direct", async () => {
  const out = buildOperatorRouteDecisions({
    text: "open media",
    isYouTubeDirectIntent: always,
    isSpotifyDirectIntent: always,
  });
  assert.equal(out.shouldRouteToYouTube, true);
  assert.equal(out.shouldRouteToSpotify, false);
  assert.equal(out.selectedRouteId, "youtube");
});

await run("P26-C2 spotify direct overrides youtube contextual follow-up", async () => {
  const out = buildOperatorRouteDecisions({
    text: "play spotify playlist",
    spotifyShortTermFollowUp: false,
    youtubeShortTermFollowUp: true,
    isSpotifyDirectIntent: always,
    isYouTubeDirectIntent: never,
  });
  assert.equal(out.shouldRouteToSpotify, true);
  assert.equal(out.shouldRouteToYouTube, false);
  assert.equal(out.selectedRouteId, "spotify");
});

await run("P26-C3 earlier lane wins when multiple follow-ups are active", async () => {
  const out = buildOperatorRouteDecisions({
    text: "refresh this",
    coinbaseShortTermFollowUp: true,
    gmailShortTermFollowUp: true,
    isCoinbaseDirectIntent: never,
    isGmailDirectIntent: never,
  });
  assert.equal(out.shouldRouteToCoinbase, true);
  assert.equal(out.shouldRouteToGmail, false);
  assert.equal(out.selectedRouteId, "coinbase");
});

await run("P26-C4 voice lane wins over tts lane by precedence", async () => {
  const out = buildOperatorRouteDecisions({
    text: "speak and mute",
    isVoiceDirectIntent: always,
    isTtsDirectIntent: always,
  });
  assert.equal(out.shouldRouteToVoice, true);
  assert.equal(out.shouldRouteToTts, false);
  assert.equal(out.selectedRouteId, "voice");
});

await run("P26-C5 no matches returns no selected operator lane", async () => {
  const out = buildOperatorRouteDecisions({
    text: "hello there",
    isSpotifyDirectIntent: never,
    isYouTubeDirectIntent: never,
    isPolymarketDirectIntent: never,
    isCoinbaseDirectIntent: never,
    isGmailDirectIntent: never,
    isTelegramDirectIntent: never,
    isDiscordDirectIntent: never,
    isCalendarDirectIntent: never,
    isReminderDirectIntent: never,
    isWebResearchDirectIntent: never,
    isCryptoDirectIntent: never,
    isMarketDirectIntent: never,
    isFilesDirectIntent: never,
    isDiagnosticsDirectIntent: never,
    isVoiceDirectIntent: never,
    isTtsDirectIntent: never,
  });
  assert.equal(out.selectedRouteId, "");
  assert.equal(out.shouldRouteToSpotify, false);
  assert.equal(out.shouldRouteToTts, false);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
