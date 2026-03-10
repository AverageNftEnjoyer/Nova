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

const dedupeModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler", "operator-dedupe-routing", "index.js")).href,
);
const preprocessModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler", "operator-preprocess", "index.js")).href,
);
const snapshotModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler", "operator-runtime-snapshot", "index.js")).href,
);
const runtimeSelectionModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler", "operator-runtime-selection", "index.js")).href,
);

const { handleDuplicateInboundRouting } = dedupeModule;
const { preprocessInboundText } = preprocessModule;
const { ensureRuntimeIntegrationsSnapshot } = snapshotModule;
const { selectChatRuntimeForTurn } = runtimeSelectionModule;

await run("P23-C1 preprocess bypass keeps text unchanged and emits nlp stage", async () => {
  const stages = [];
  const result = await preprocessInboundText({
    text: "hello world",
    sessionKey: "agent:nova:hud:user:smoke:dm:preflight",
    nlpBypass: true,
    latencyTelemetry: { addStage: (name, ms) => stages.push({ name, ms }) },
  });
  assert.equal(result.rawText, "hello world");
  assert.equal(result.cleanText, "hello world");
  assert.equal(Array.isArray(result.nlpCorrections), true);
  assert.equal(result.nlpBypass, true);
  assert.equal(stages.some((s) => s.name === "nlp_preprocess"), true);
});

await run("P23-C2 dedupe routing no-op when skip gate is false", async () => {
  const out = await handleDuplicateInboundRouting({
    text: "normal prompt",
    shouldSkipDuplicateInbound: () => false,
    handleDuplicateCryptoReportRequest: async () => null,
    appendRawStream: () => {},
    emitSingleChunkAssistantStream: () => {},
  });
  assert.equal(out, null);
});

await run("P23-C3 dedupe routing returns duplicate envelope when skip gate is true", async () => {
  const streamChunks = [];
  const out = await handleDuplicateInboundRouting({
    text: "repeat this",
    source: "hud",
    sender: "hud-user",
    userContextId: "smoke-user",
    sessionKey: "agent:nova:hud:user:smoke-user:dm:dup",
    inboundMessageId: "msg-1",
    conversationId: "dup",
    explicitCryptoReportRequest: false,
    duplicateMayMissionRequest: false,
    followUpContinuationCue: false,
    duplicateMayBeCryptoReport: false,
    shouldSkipDuplicateInbound: () => true,
    handleDuplicateCryptoReportRequest: async () => null,
    appendRawStream: () => {},
    emitSingleChunkAssistantStream: (reply) => streamChunks.push(String(reply || "")),
  });
  assert.equal(out?.route, "duplicate_skipped");
  assert.equal(out?.ok, true);
  assert.equal(streamChunks.length > 0, true);
});

await run("P23-C4 runtime snapshot ensure is ttl-cached per user context", async () => {
  let fetchCount = 0;
  const fetchRef = async () => {
    fetchCount += 1;
    return { ok: true, status: 200 };
  };
  const user = `smoke-preflight-${Date.now()}`;
  await ensureRuntimeIntegrationsSnapshot(
    {
      userContextId: user,
      supabaseAccessToken: "token-1",
    },
    {
      sessionRuntimeRef: { normalizeUserContextId: (value) => String(value || "").trim().toLowerCase() },
      fetchRef,
      describeUnknownErrorRef: () => "",
    },
  );
  await ensureRuntimeIntegrationsSnapshot(
    {
      userContextId: user,
      supabaseAccessToken: "token-1",
    },
    {
      sessionRuntimeRef: { normalizeUserContextId: (value) => String(value || "").trim().toLowerCase() },
      fetchRef,
      describeUnknownErrorRef: () => "",
    },
  );
  assert.equal(fetchCount, 1);
});

await run("P23-C5 runtime selection returns model+client and records latency stage", async () => {
  const stages = [];
  const out = await selectChatRuntimeForTurn(
    {
      userContextId: "smoke-user",
      supabaseAccessToken: "token",
      canRunToolLoop: true,
      sessionKey: "agent:nova:hud:user:smoke-user:dm:selection",
      source: "hud",
      latencyTelemetry: { addStage: (name) => stages.push(name) },
    },
    {
      ensureRuntimeIntegrationsSnapshotRef: async () => {},
      cachedLoadIntegrationsRuntimeRef: () => ({}),
      resolveConfiguredChatRuntimeRef: () => ({
        provider: "openai",
        apiKey: "test-key",
        connected: true,
        baseURL: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        routeReason: "test",
        rankedCandidates: ["openai"],
      }),
      getOpenAIClientRef: ({ apiKey, baseURL }) => ({ apiKey, baseURL }),
    },
  );
  assert.equal(out.activeChatRuntime.provider, "openai");
  assert.equal(out.selectedChatModel, "gpt-4.1-mini");
  assert.equal(out.activeOpenAiCompatibleClient?.apiKey, "test-key");
  assert.equal(stages.includes("provider_resolution"), true);
});

await run("P23-C6 preferred provider gracefully falls back when preferred runtime is not ready", async () => {
  const out = await selectChatRuntimeForTurn(
    {
      userContextId: "smoke-user",
      supabaseAccessToken: "token",
      canRunToolLoop: false,
      sessionKey: "agent:nova:hud:user:smoke-user:dm:selection-preferred-fallback",
      source: "hud",
      preferredProvider: "grok",
    },
    {
      ensureRuntimeIntegrationsSnapshotRef: async () => {},
      cachedLoadIntegrationsRuntimeRef: () => ({
        grok: { connected: false, apiKey: "", baseURL: "https://api.x.ai/v1", model: "grok-4-0709" },
      }),
      resolveConfiguredChatRuntimeRef: () => ({
        provider: "openai",
        apiKey: "test-key",
        connected: true,
        baseURL: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        routeReason: "resolver-fallback",
        rankedCandidates: ["openai"],
      }),
      getOpenAIClientRef: ({ apiKey, baseURL }) => ({ apiKey, baseURL }),
    },
  );
  assert.equal(out.activeChatRuntime.provider, "openai");
  assert.equal(out.selectedChatModel, "gpt-4.1-mini");
  assert.equal(out.activeOpenAiCompatibleClient?.apiKey, "test-key");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
