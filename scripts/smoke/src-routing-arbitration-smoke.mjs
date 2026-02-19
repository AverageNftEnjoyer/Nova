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
  pathToFileURL(path.join(process.cwd(), "dist", "providers", "index.js")).href,
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

await run("P17-C1 cost preference chooses Gemini as cheapest ready fallback", async () => {
  const integrations = buildIntegrations({
    activeProvider: "openai",
    ready: ["claude", "gemini", "grok"],
  });
  const resolved = resolveConfiguredChatRuntime(integrations, {
    strictActiveProvider: false,
    preference: "cost",
  });
  assert.equal(resolved.provider, "gemini");
  assert.equal(resolved.routeReason, "ranked-fallback");
  assert.deepEqual(resolved.rankedCandidates, ["gemini", "grok", "claude"]);
});

await run("P17-C2 latency+tool bias can override active provider when enabled", async () => {
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
  assert.equal(resolved.provider, "gemini");
  assert.equal(resolved.routeReason, "ranked-fallback");
  assert.deepEqual(resolved.rankedCandidates, ["gemini", "openai", "claude"]);
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
  assert.equal(resolved.provider, "claude");
  assert.equal(resolved.routeReason, "active-provider-ready");
  assert.deepEqual(resolved.rankedCandidates, ["claude"]);
});

await run("P17-C4 preferred provider hints are deterministic and respected", async () => {
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
  assert.equal(first.provider, "claude");
  assert.equal(second.provider, "claude");
  assert.deepEqual(first.rankedCandidates, second.rankedCandidates);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
