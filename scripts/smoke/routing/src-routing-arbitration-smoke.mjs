import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
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

const providersModule = await import(
  pathToFileURL(path.join(process.cwd(), "dist", "providers", "index", "index.js")).href,
);
const { resolveConfiguredChatRuntime } = providersModule;

function providerRuntime(ready, label) {
  return {
    connected: Boolean(ready),
    apiKey: ready ? `${label}_key` : "",
    baseURL: `https://example.com/${label}`,
    model: `${label}-model`,
  };
}

function buildIntegrations(params) {
  const ready = new Set(params.ready || []);
  return {
    sourcePath: "smoke",
    activeProvider: params.activeProvider || "openai",
    openai: providerRuntime(ready.has("openai"), "openai"),
    claude: providerRuntime(ready.has("claude"), "claude"),
    grok: providerRuntime(ready.has("grok"), "grok"),
    gemini: providerRuntime(ready.has("gemini"), "gemini"),
  };
}

// V.59 removed ranked/cost/latency provider fallback: resolveConfiguredChatRuntime always answers with the user's
// active provider (routeReason "strict-active-provider") and never fails over. P17-C1..C4 keep their IDs and assert
// that contract for the same inputs the old ranking tests used.
function assertStrictActive(resolved, provider, connected) {
  assert.equal(resolved.provider, provider);
  assert.equal(resolved.strict, true);
  assert.equal(resolved.routeReason, "strict-active-provider");
  assert.equal(resolved.connected, connected);
  assert.deepEqual(resolved.rankedCandidates, [provider]);
}

await run("P17-C1 cost preference never fails over: the active provider is used even when it is not ready", async () => {
  const integrations = buildIntegrations({
    activeProvider: "openai",
    ready: ["claude", "gemini", "grok"],
  });
  const resolved = resolveConfiguredChatRuntime(integrations, {
    strictActiveProvider: false,
    preference: "cost",
  });
  assertStrictActive(resolved, "openai", false);
  assert.equal(resolved.apiKey, "");
});

await run("P17-C2 latency+tool bias cannot override the active provider", async () => {
  const integrations = buildIntegrations({
    activeProvider: "claude",
    ready: ["openai", "claude", "gemini"],
  });
  const resolved = resolveConfiguredChatRuntime(integrations, {
    strictActiveProvider: false,
    preference: "latency",
    requiresToolCalling: true,
    allowActiveProviderOverride: true,
  });
  assertStrictActive(resolved, "claude", true);
});

await run("P17-C3 active provider remains sticky when override is disabled", async () => {
  const integrations = buildIntegrations({
    activeProvider: "claude",
    ready: ["openai", "claude", "gemini"],
  });
  const resolved = resolveConfiguredChatRuntime(integrations, {
    strictActiveProvider: false,
    preference: "latency",
    requiresToolCalling: true,
    allowActiveProviderOverride: false,
  });
  assertStrictActive(resolved, "claude", true);
});

await run("P17-C4 preferred provider hints are ignored deterministically (active provider wins)", async () => {
  const integrations = buildIntegrations({
    activeProvider: "grok",
    ready: ["openai", "claude"],
  });
  const options = {
    strictActiveProvider: false,
    preference: "quality",
    allowActiveProviderOverride: true,
    preferredProviders: ["claude"],
  };
  const first = resolveConfiguredChatRuntime(integrations, options);
  const second = resolveConfiguredChatRuntime(integrations, options);
  assertStrictActive(first, "grok", false);
  assert.deepEqual(first, second);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
