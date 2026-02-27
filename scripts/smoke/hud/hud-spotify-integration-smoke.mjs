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

function exists(relPath) {
  return fs.existsSync(path.join(process.cwd(), relPath));
}

await run("HSP-1 Spotify integration API routes exist", async () => {
  const required = [
    "hud/app/api/integrations/spotify/connect/route.ts",
    "hud/app/api/integrations/spotify/callback/route.ts",
    "hud/app/api/integrations/spotify/disconnect/route.ts",
    "hud/app/api/integrations/spotify/now-playing/route.ts",
    "hud/app/api/integrations/spotify/playback/route.ts",
    "hud/app/api/integrations/test-spotify/route.ts",
  ];
  for (const relPath of required) {
    assert.equal(exists(relPath), true, `missing ${relPath}`);
  }
});

await run("HSP-2 Playback contract supports now_playing and play_liked", async () => {
  const shared = read("hud/app/api/integrations/spotify/_shared.ts");
  assert.equal(shared.includes('"now_playing"'), true);
  assert.equal(shared.includes('"play_liked"'), true);
});

await run("HSP-3 Config route includes client-safe spotify shape", async () => {
  const configRoute = read("hud/app/api/integrations/config/route.ts");
  assert.equal(configRoute.includes("spotify:"), true);
  assert.equal(configRoute.includes("tokenConfigured"), true);
  assert.equal(configRoute.includes("oauthClientId"), true);
  assert.equal(configRoute.includes("redirectUri"), true);
  assert.equal(configRoute.includes("accessTokenEnc: config.spotify.accessTokenEnc"), false);
  assert.equal(configRoute.includes("refreshTokenEnc: config.spotify.refreshTokenEnc"), false);
});

await run("HSP-4 Integrations UI wires Spotify setup flow", async () => {
  const page = read("hud/app/integrations/page.tsx");
  const panel = read("hud/app/integrations/modules/components/integrations-main-panel.tsx");
  const grid = read("hud/app/integrations/components/ConnectivityGrid.tsx");
  assert.equal(page.includes("useSpotifySetup"), true);
  assert.equal(page.includes("SpotifyIcon"), true);
  assert.equal(grid.includes('"spotify"'), true);
  assert.equal(panel.includes('activeSetup === "spotify"'), true);
});

await run("HSP-5 Home surface includes Spotify connection status", async () => {
  const hook = read("hud/app/home/hooks/use-home-integrations.ts");
  const screen = read("hud/app/home/components/home-main-screen.tsx");
  assert.equal(hook.includes("spotifyConnected"), true);
  assert.equal(screen.includes("SpotifyIcon"), true);
});

await run("HSP-6 Icon registry exports Spotify SVG icon", async () => {
  const icons = read("hud/components/icons/index.tsx");
  assert.equal(icons.includes("SpotifyIcon"), true);
  assert.equal(icons.includes("/images/spotify.svg"), true);
});

await run("HSP-7 Runtime sync includes runtime-safe spotify snapshot", async () => {
  const runtimeSync = read("hud/lib/integrations/agent-runtime-sync.ts");
  assert.equal(runtimeSync.includes("buildRuntimeSafeSpotifySnapshot"), true);
  assert.equal(runtimeSync.includes("spotify:"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);

