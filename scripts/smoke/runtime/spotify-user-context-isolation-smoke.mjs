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

await run("RSI-1 Playback route rejects cross-user userContextId mismatches", async () => {
  const routeSource = read("hud/app/api/integrations/spotify/playback/route.ts");
  assert.equal(routeSource.includes("requestedUserContextId !== verifiedUserContextId"), true);
  assert.equal(routeSource.includes('"FORBIDDEN_USER_SCOPE"'), true);
  assert.equal(routeSource.includes("status: 403"), true);
});

await run("RSI-2 Playback route enforces runtime shared token verification", async () => {
  const routeSource = read("hud/app/api/integrations/spotify/playback/route.ts");
  assert.equal(routeSource.includes("verifyRuntimeSharedToken"), true);
  assert.equal(routeSource.includes("runtimeSharedTokenErrorResponse"), true);
});

await run("RSI-3 Runtime Spotify handler forwards userContextId to playback API", async () => {
  const handlerSource = read("src/runtime/modules/chat/core/chat-special-handlers.js");
  assert.equal(handlerSource.includes("/api/integrations/spotify/playback"), true);
  assert.equal(handlerSource.includes("userContextId: normalizedUserContextId"), true);
});

await run("RSI-4 Runtime Spotify handler attaches runtime token header when configured", async () => {
  const handlerSource = read("src/runtime/modules/chat/core/chat-special-handlers.js");
  assert.equal(handlerSource.includes("RUNTIME_SHARED_TOKEN_HEADER"), true);
  assert.equal(handlerSource.includes("RUNTIME_SHARED_TOKEN"), true);
  assert.equal(handlerSource.includes("Authorization: `Bearer ${token}`"), true);
});

await run("RSI-5 Runtime/provider snapshot contract includes spotify runtime block", async () => {
  const providerTs = read("src/providers/runtime.ts");
  const providerCompat = read("src/providers/runtime-compat.js");
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

