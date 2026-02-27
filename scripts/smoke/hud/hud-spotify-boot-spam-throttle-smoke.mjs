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

await run("SBS-1 Playback route adds per-user device-unavailable cooldown for play_smart", async () => {
  const route = read("hud/app/api/integrations/spotify/playback/route.ts");
  assert.equal(route.includes("DEVICE_UNAVAILABLE_COOLDOWN_MS"), true, "cooldown constant missing");
  assert.equal(route.includes("playSmartUnavailableByUser"), true, "per-user memory map missing");
  assert.equal(route.includes("playback.device_unavailable_throttled"), true, "throttled telemetry event missing");
  assert.equal(route.includes('action: "play_smart"'), true, "play_smart gating missing");
  assert.equal(route.includes("fallbackRecommended: false"), true, "throttled response must suppress fallback relaunch");
  assert.equal(route.includes("retryAfterMs"), true, "retry hint missing");
});

await run("SBS-2 Home hook enforces local desktop-launch cooldown", async () => {
  const hook = read("hud/app/home/hooks/use-home-integrations.ts");
  assert.equal(hook.includes("SPOTIFY_DESKTOP_LAUNCH_COOLDOWN_MS"), true, "client cooldown constant missing");
  assert.equal(hook.includes("lastSpotifyDesktopLaunchAtRef"), true, "client launch timestamp ref missing");
  assert.equal(hook.includes("now - lastSpotifyDesktopLaunchAtRef.current"), true, "client cooldown check missing");
});

await run("SBS-3 Browser-tab spotify: fallback is removed from Home Spotify paths", async () => {
  const hook = read("hud/app/home/hooks/use-home-integrations.ts");
  const module = read("hud/app/home/components/spotify-home-module.tsx");
  assert.equal(hook.includes('window.open("spotify:", "_blank")'), false, "window.open spotify blank-tab fallback still present in hook");
  assert.equal(module.includes('window.open("spotify:", "_blank")'), false, "window.open spotify blank-tab fallback still present in module");
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);

