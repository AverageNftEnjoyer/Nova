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
  "routing",
  "operator-intent-signals",
  "index.js",
)).href;

const signals = await import(modulePath);

await run("P29-C1 spotify direct requires spotify context when youtube keyword is present", async () => {
  assert.equal(signals.isSpotifyDirectIntent("play this on spotify"), true);
  assert.equal(signals.isSpotifyDirectIntent("show youtube videos"), false);
});

await run("P29-C2 spotify and youtube contextual cues are detected", async () => {
  assert.equal(signals.isSpotifyContextualFollowUpIntent("that song"), true);
  assert.equal(signals.isYouTubeContextualFollowUpIntent("next video"), true);
});

await run("P29-C3 media lane direct intents are detected", async () => {
  assert.equal(signals.isYouTubeDirectIntent("show youtube videos about ai"), true);
  assert.equal(signals.isVoiceDirectIntent("mute microphone"), true);
  assert.equal(signals.isTtsDirectIntent("read this aloud"), true);
});

await run("P29-C4 finance lane direct intents are detected", async () => {
  assert.equal(signals.isPolymarketDirectIntent("show odds on election market"), true);
  assert.equal(signals.isCoinbaseDirectIntent("sync coinbase portfolio"), true);
  assert.equal(signals.isCryptoDirectIntent("btc price update"), true);
  assert.equal(signals.isMarketDirectIntent("weather in boston"), true);
});

await run("P29-C5 finance lane contextual follow-ups are detected", async () => {
  assert.equal(signals.isPolymarketContextualFollowUpIntent("more odds"), true);
  assert.equal(signals.isCoinbaseContextualFollowUpIntent("refresh balances again"), true);
  assert.equal(signals.isCryptoContextualFollowUpIntent("what about eth"), true);
  assert.equal(signals.isMarketContextualFollowUpIntent("and nasdaq"), true);
});

await run("P29-C6 comms lane direct intents are detected", async () => {
  assert.equal(signals.isGmailDirectIntent("check gmail inbox"), true);
  assert.equal(signals.isTelegramDirectIntent("send update to telegram"), true);
  assert.equal(signals.isDiscordDirectIntent("post digest to discord"), true);
});

await run("P29-C7 comms lane contextual follow-ups are detected", async () => {
  assert.equal(signals.isGmailContextualFollowUpIntent("reply and send it"), true);
  assert.equal(signals.isTelegramContextualFollowUpIntent("retry send and status"), true);
  assert.equal(signals.isDiscordContextualFollowUpIntent("retry post and status"), true);
});

await run("P29-C8 productivity lane direct intents are detected", async () => {
  assert.equal(signals.isCalendarDirectIntent("show calendar tomorrow"), true);
  assert.equal(signals.isReminderDirectIntent("set a reminder for 5pm"), true);
});

await run("P29-C9 productivity lane contextual follow-ups are detected", async () => {
  assert.equal(signals.isCalendarContextualFollowUpIntent("reschedule to next week"), true);
  assert.equal(signals.isReminderContextualFollowUpIntent("change it to tonight"), true);
});

await run("P29-C10 system lane direct intents are detected", async () => {
  assert.equal(signals.isWebResearchDirectIntent("research latest ai with citations"), true);
  assert.equal(signals.isFilesDirectIntent("list files in workspace"), true);
  assert.equal(signals.isDiagnosticsDirectIntent("run diagnostics"), true);
});

await run("P29-C11 system and media contextual follow-ups are detected", async () => {
  assert.equal(signals.isWebResearchContextualFollowUpIntent("add citations"), true);
  assert.equal(signals.isFilesContextualFollowUpIntent("open that file"), true);
  assert.equal(signals.isDiagnosticsContextualFollowUpIntent("rerun diagnostics with more detail"), true);
  assert.equal(signals.isVoiceContextualFollowUpIntent("unmute mic"), true);
  assert.equal(signals.isTtsContextualFollowUpIntent("speak this again"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
