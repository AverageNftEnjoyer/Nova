import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

await run("SIR-1 Chat handler routes switch/change song phrasing to Spotify sub-handler", async () => {
  const handlerSource = read("src/runtime/modules/chat/core/chat-handler.js");
  assert.equal(handlerSource.includes(String.raw`\b(switch|change)\s+(the\s+)?(song|track|music)\s+(to|into)\s+`), true);
  assert.equal(handlerSource.includes(String.raw`\b(switch|change)\s+to\s+.+\s+by\s+`), true);
  assert.equal(handlerSource.includes("restart|replay|start over|from the beginning|retsrat|retsart|restat"), true);
  assert.equal(handlerSource.includes("(/\\bretreat\\b/i.test(normalized) && /\\b(song|track|music)\\b/i.test(normalized))"), true);
  assert.equal(handlerSource.includes("const spotifyResult = await handleSpotify(text, ctx, llmCtx);"), true);
  assert.equal(handlerSource.includes("return spotifyResult;"), true);
});

await run("SIR-2 Spotify fast fallback maps switch/change song phrasing to play action with query", async () => {
  const spotifyHandlerSource = read("src/runtime/modules/chat/core/chat-special-handlers.js");
  assert.equal(spotifyHandlerSource.includes("const switchToQueryMatch = input.match("), true);
  assert.equal(spotifyHandlerSource.includes("const switchArtistQueryMatch = input.match("), true);
  assert.equal(spotifyHandlerSource.includes("/\\bretreat\\b/i.test(input) && /\\b(song|track|music)\\b/i.test(input)"), true);
  assert.equal(spotifyHandlerSource.includes("what song.*playing"), true);
  assert.equal(spotifyHandlerSource.includes("set_favorite_playlist"), true);
  assert.equal(spotifyHandlerSource.includes("clear_favorite_playlist"), true);
  assert.equal(spotifyHandlerSource.includes("add_to_playlist"), true);
  assert.equal(spotifyHandlerSource.includes('return { action: "play", query, response: `Switching to ${query}.` };'), true);
});

await run("SIR-3 Spotify TTS dedupe guard exists to prevent repeated spoken spam", async () => {
  const spotifyHandlerSource = read("src/runtime/modules/chat/core/chat-special-handlers.js");
  assert.equal(spotifyHandlerSource.includes("SPOTIFY_TTS_DEDUPE_WINDOW_MS"), true);
  assert.equal(spotifyHandlerSource.includes("shouldSuppressSpotifyTts(userContextId, normalized.text)"), true);
});

await run("SIR-4 Desktop Spotify fallback wraps exec errors without crashing runtime", async () => {
  const spotifyHandlerSource = read("src/runtime/modules/chat/core/chat-special-handlers.js");
  assert.equal(spotifyHandlerSource.includes("exec(command, (error) => {"), true);
  assert.equal(spotifyHandlerSource.includes("Desktop fallback command failed"), true);
  assert.equal(spotifyHandlerSource.includes("Desktop fallback command threw"), true);
});

await run("SIR-5 Spotify runtime prompt contains no hardcoded user playlist literals", async () => {
  const spotifyHandlerSource = read("src/runtime/modules/chat/core/chat-special-handlers.js");
  assert.equal(spotifyHandlerSource.toLowerCase().includes("demon time"), false);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
