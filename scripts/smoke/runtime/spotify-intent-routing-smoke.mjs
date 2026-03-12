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

await run("SIR-1 Spotify direct-intent rules include switch/change and restart phrases", async () => {
  const intentSignalsSource = read("src/runtime/modules/chat/routing/operator-intent-signals/index.js");
  assert.equal(intentSignalsSource.includes(String.raw`\b(switch|change)\s+(the\s+)?(song|track|music)\s+(to|into)\s+`), true);
  assert.equal(intentSignalsSource.includes(String.raw`\b(switch|change)\s+to\s+.+\s+by\s+`), true);
  assert.equal(intentSignalsSource.includes("restart|replay|start over|from the beginning|retsrat|retsart|restat"), true);
  assert.equal(intentSignalsSource.includes("(/\\bretreat\\b/i.test(normalized) && /\\b(song|track|music)\\b/i.test(normalized))"), true);
});

await run("SIR-2 Operator worker executors route spotify/youtube lanes to worker modules", async () => {
  const executorsSource = read("src/runtime/modules/chat/core/chat-handler/operator-worker-executors/index.js");
  assert.equal(executorsSource.includes("import { handleSpotifyWorker }"), true);
  assert.equal(executorsSource.includes("import { handleYouTubeWorker }"), true);
  assert.equal(executorsSource.includes("spotify: ({ text, ctx, llmCtx, spotifyWorker }) => {"), true);
  assert.equal(executorsSource.includes("const runSpotifyWorker = typeof spotifyWorker === \"function\" ? spotifyWorker : handleSpotifyWorker;"), true);
  assert.equal(executorsSource.includes("youtube: ({ text, ctx, youtubeWorker }) => {"), true);
  assert.equal(executorsSource.includes("const runYouTubeWorker = typeof youtubeWorker === \"function\" ? youtubeWorker : handleYouTubeWorker;"), true);
});

await run("SIR-3 Spotify worker owns runtime flow without desktop fallback execution", async () => {
  const workerSource = read("src/runtime/modules/chat/workers/media/spotify-agent/index.js");
  assert.equal(workerSource.includes("normalizeSpotifyIntentFastPath(text)"), true);
  assert.equal(workerSource.includes("runSpotifyDomainService({"), true);
  assert.equal(workerSource.includes("runSpotifyViaHudApi("), false);
  assert.equal(workerSource.includes("runDirectSpotifyNowPlaying("), false);
  assert.equal(workerSource.includes("runDesktopSpotifyAction(action, intentQuery)"), false);
  assert.equal(workerSource.includes("shouldSuppressSpotifyTts(userContextId, normalized.text)"), true);
});

await run("SIR-3b YouTube worker owns runtime flow through the lane service boundary", async () => {
  const workerSource = read("src/runtime/modules/chat/workers/media/youtube-agent/index.js");
  assert.equal(workerSource.includes("normalizeYouTubeIntentFallback(text)"), true);
  assert.equal(workerSource.includes("runYouTubeDomainService({"), true);
  assert.equal(workerSource.includes("runYouTubeHomeControlViaHudApi("), false);
});

await run("SIR-4 Runtime utils contain no desktop exec fallback path", async () => {
  const runtimeUtilsSource = read("src/runtime/modules/chat/workers/media/spotify-agent/runtime-utils/index.js");
  assert.equal(runtimeUtilsSource.includes("exec(command, (error) => {"), false);
  assert.equal(runtimeUtilsSource.includes("Desktop command failed"), false);
  assert.equal(runtimeUtilsSource.includes("Desktop command threw"), false);
});

await run("SIR-5 Spotify worker path contains no hardcoded user playlist literals", async () => {
  const workerSource = read("src/runtime/modules/chat/workers/media/spotify-agent/index.js");
  const runtimeUtilsSource = read("src/runtime/modules/chat/workers/media/spotify-agent/runtime-utils/index.js");
  assert.equal(workerSource.toLowerCase().includes("demon time"), false);
  assert.equal(runtimeUtilsSource.toLowerCase().includes("demon time"), false);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);

