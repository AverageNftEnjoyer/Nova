import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Source-guard checks for client-side polling / re-render churn in the HUD.
// These assert the structural guarantees (visibility gating, slow cadences, debounced persistence,
// conditional GETs) so a regression fails loudly instead of quietly burning idle CPU.

const hudRoot = path.join(process.cwd(), "hud");
const read = (rel) => fs.readFileSync(path.join(hudRoot, rel), "utf8").replace(/\r\n/g, "\n");

function numericConst(source, name) {
  const match = source.match(new RegExp(`const ${name}\\s*=\\s*([0-9_]+)`));
  assert.ok(match, `constant ${name} not found`);
  return Number(match[1].replace(/_/g, ""));
}

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}\n  ${error.message}`);
    process.exitCode = 1;
  }
}

check("spotify poll loop has a hidden-page guard and resumes on visibility/focus", () => {
  const src = read("app/home/hooks/use-home-integrations.ts");
  assert.match(src, /document\.visibilityState === "hidden"/);
  assert.match(src, /addEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(src, /addEventListener\("focus", resumeOnForeground\)/);
  // runPollCycle bails out on a hidden page before fetching.
  const cycle = src.slice(src.indexOf("const runPollCycle"));
  assert.ok(cycle.indexOf("isPageHidden()") !== -1 && cycle.indexOf("isPageHidden()") < cycle.indexOf("refreshSpotifyNowPlaying(true"));
});

check("spotify poll cadence is relaxed (playing >= 4s, near end >= 2s)", () => {
  const src = read("app/home/hooks/use-home-integrations.ts");
  assert.ok(numericConst(src, "SPOTIFY_POLL_INTERVAL_PLAYING_MS") >= 4_000);
  assert.ok(numericConst(src, "SPOTIFY_POLL_INTERVAL_PLAYING_NEAR_END_MS") >= 2_000);
});

check("spotify silent polls skip the loading flag and only set state on meaningful change", () => {
  const src = read("app/home/hooks/use-home-integrations.ts");
  assert.match(src, /options\?\.silent && spotifyNowPlayingRef\.current/);
  assert.match(src, /if \(showLoading\) setSpotifyLoading\(true\)/);
  assert.match(src, /refreshSpotifyNowPlaying\(true, \{ silent: true \}\)/);
  assert.match(src, /hasMeaningfulSpotifyChange\(/);
  assert.equal(numericConst(src, "SPOTIFY_PROGRESS_DRIFT_THRESHOLD_MS"), 1_500);
});

check("spotify module drives progress via DOM refs (no per-tick React progress state) and pauses when hidden", () => {
  const src = read("app/home/components/spotify-home-module.tsx");
  assert.doesNotMatch(src, /setLiveProgressMs/);
  assert.match(src, /progressFillRef/);
  assert.match(src, /updateProgressDom/);
  assert.ok(numericConst(src, "PROGRESS_DOM_TICK_MS") >= 1_000);
  assert.ok(numericConst(src, "GLOW_STATE_TICK_MS") >= 2_000);
  assert.match(src, /document\.visibilityState === "hidden"/);
});

check("notes poll interval is >= 30s, visibility-gated, and refreshes on focus/visibility return", () => {
  const src = read("app/home/hooks/use-home-notes.ts");
  assert.ok(numericConst(src, "POLL_INTERVAL_MS") >= 30_000);
  assert.match(src, /document\.visibilityState !== "visible"/);
  assert.match(src, /addEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(src, /addEventListener\("focus", resumeOnForeground\)/);
  assert.ok((src.match(/void refreshNotes\(true\)/g) || []).length >= 3, "create/update/delete refresh after mutation");
});

check("conversation persistence is debounced and flushed on stream done / hide / unload", () => {
  const src = read("lib/chat/hooks/useConversations.ts");
  assert.ok(numericConst(src, "CONVERSATION_PERSIST_DEBOUNCE_MS") >= 1_500);
  assert.match(src, /scheduleStorageWrite/);
  assert.match(src, /deferStorage: deferStorageWrite/);
  assert.match(src, /event\.type === "assistant_stream_delta" \|\| event\.type === "assistant_stream_start"/);
  assert.match(src, /event\.type === "assistant_stream_done"\)\) \{\s*flushPendingStorageWrite\(\)/);
  assert.match(src, /visibilityState === "hidden"\) flushPendingStorageWrite\(\)/);
  assert.match(src, /addEventListener\("pagehide", flushPendingStorageWrite\)/);
  assert.match(src, /addEventListener\("beforeunload", flushPendingStorageWrite\)/);
  // The delta path must not call saveConversations synchronously.
  const persistBody = src.slice(src.indexOf("const persist = useCallback"), src.indexOf("const resolveTransportConversationId"));
  assert.match(persistBody, /if \(options\?\.deferStorage\) \{\s*scheduleStorageWrite\(convos\)/);
});

check("dev-logs poll is >= 15s, page-active gated, and uses If-None-Match", () => {
  const src = read("app/dev-logs/hooks/use-dev-logs-data.ts");
  assert.ok(numericConst(src, "DEV_LOGS_POLL_MS") >= 15_000);
  assert.match(src, /usePageActive\(\)/);
  assert.match(src, /"If-None-Match"/);
  assert.match(src, /res\.status === 304/);
});

check("dev-logs route answers 304 from stat before tailing the log", () => {
  const src = read("app/api/dev-logs/route.ts");
  assert.match(src, /if-none-match/);
  assert.match(src, /status: 304/);
  assert.ok(src.indexOf("status: 304") < src.indexOf("await readJsonlTail(logPath"), "304 must short-circuit before the tail read");
  assert.match(src, /ETag/);
});

check("missions pollers are visibility-gated and merged (10s active / 30s idle / 60s reliability)", () => {
  const src = read("app/missions/hooks/use-missions-page-state.ts");
  assert.equal(numericConst(src, "QUEUE_METRICS_POLL_ACTIVE_MS"), 10_000);
  assert.ok(numericConst(src, "QUEUE_METRICS_POLL_IDLE_MS") >= 30_000);
  assert.ok(numericConst(src, "MISSION_RELIABILITY_POLL_MS") >= 60_000);
  assert.match(src, /document\.visibilityState === "hidden"/);
  assert.match(src, /addEventListener\("visibilitychange", onVisibilityChange\)/);
  // The old standalone 60s reliability interval and 10s metrics interval are gone.
  assert.doesNotMatch(src, /QUEUE_METRICS_POLL_MS\b/);
  assert.doesNotMatch(src, /}, 60_000\)/);
  // 4s queued-run poll only exists while a run is queued.
  assert.match(src, /const hasQueuedRuns = useMemo/);
  assert.match(src, /if \(!hasQueuedRuns\) return/);
  assert.match(src, /isDocumentHidden\(\)\) return/);
});

console.log(`\nperf-client-polling source guard: ${passed} checks passed`);
