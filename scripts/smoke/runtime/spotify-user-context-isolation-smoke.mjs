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

await run("RSI-1 Playback route scopes user context to verified identity", async () => {
  const routeSource = read("hud/app/api/integrations/spotify/playback/route.ts");
  assert.equal(routeSource.includes("requestedUserContextId !== verifiedUserContextId"), true);
  assert.equal(routeSource.includes("playback.user_scope_hint_mismatch"), true);
  assert.equal(routeSource.includes("userId = verifiedUserContextId || verified.user.id"), true);
});

await run("RSI-2 Playback route enforces runtime shared token verification", async () => {
  const routeSource = read("hud/app/api/integrations/spotify/playback/route.ts");
  assert.equal(routeSource.includes("verifyRuntimeSharedToken"), true);
  assert.equal(routeSource.includes("runtimeSharedTokenErrorResponse"), true);
});

await run("RSI-3 Runtime Spotify service keeps playback routing inside the lane adapter", async () => {
  const serviceSource = read("src/runtime/modules/services/spotify/index.js");
  const adapterSource = read("src/runtime/modules/services/spotify/provider-adapter/hud-http/index.js");
  assert.equal(serviceSource.includes("resolveSpotifyProviderId"), true);
  assert.equal(adapterSource.includes("/api/integrations/spotify/playback"), true);
  assert.equal(adapterSource.includes("userContextId: normalizedUserContextId"), true);
});

await run("RSI-4 Runtime Spotify service adapters preserve scoped auth and direct lookup handling", async () => {
  const adapterSource = read("src/runtime/modules/services/spotify/provider-adapter/hud-http/index.js");
  const directSource = read("src/runtime/modules/services/spotify/provider-adapter/direct-now-playing/index.js");
  assert.equal(adapterSource.includes("resolveRuntimeSharedTokenHeader"), true);
  assert.equal(adapterSource.includes("resolveRuntimeSharedToken"), true);
  assert.equal(adapterSource.includes("Authorization: `Bearer ${token}`"), true);
  assert.equal(directSource.includes("Spotify runtime direct lookup requires userContextId."), true);
  assert.equal(directSource.includes("Authorization: `Bearer ${supabaseServiceRoleKey}`"), true);
});

await run("RSI-5 Runtime/provider snapshot contract includes spotify runtime block", async () => {
  const providerTs = read("src/providers/runtime/index.ts");
  const providerCompat = read("src/providers/runtime-compat/index.js");
  assert.equal(providerTs.includes("spotify: SpotifyRuntime"), true);
  assert.equal(providerTs.includes("parseSpotifyRuntime"), true);
  assert.equal(providerCompat.includes("spotify: spotifyIntegration"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);

