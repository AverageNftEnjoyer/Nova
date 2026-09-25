/**
 * Token-efficiency close-out: every LLM API call outside the chat runtime lands exactly one llm_usage row.
 *
 * Drives each call site with a stubbed fetch / fake SDK (no network, no keys) and checks the ledger:
 *   - memory embeddings (src/memory/embeddings OpenAIEmbeddings): source "embedding", ref "memory-index";
 *     cache hits and local embeddings write nothing; a failed call writes nothing. MemoryIndexManager attributes
 *     a per-user index (user-context/<id>/memory.db) to that user and the shared index to nobody.
 *   - ChatKit (src/integrations/chatkit runner): one row per model response; chat / agent-task by conversation id,
 *     mission when missionRunId is set; a rejected run writes nothing.
 *   - HUD routes, transpiled to CommonJS with Next-only imports stubbed (next/server, auth, config store, rate
 *     limits): /api/missions/nova-suggest (utility / nova-suggest, all four providers) and
 *     /api/integrations/test-gemini-model (utility / model-test). HTTP errors write nothing.
 *   - HUD mission client (hud/lib/missions/llm/providers.ts) with the usage context the Gmail summary route passes
 *     (utility / gmail-summary), and buildMissionFromPrompt (hud/lib/missions/workflow/generate-mission.ts), which
 *     must hand the generation call source "mission" / ref "build-from-prompt".
 *   - Model routing (token-efficiency Stage 6) in the mission client and nova-suggest: a trivial call site goes to the
 *     provider's economy model and records the model that answered plus its tier; a refused economy model (404) is
 *     retried once on the selected model; an explicit node model, a standard call site in the default mode, the hard
 *     build-from-prompt call site and a call without a call site keep the selected model.
 *
 * Requires `npm run build:agent-core` (dist/). Runs against a temp NOVA_DATA_DIR.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const toPosix = (value) => value.replace(/\\/g, "/");
const distUrl = (...parts) => pathToFileURL(path.join(repoRoot, "dist", ...parts)).href;

process.env.NOVA_CHATKIT_ENABLED = "1";
process.env.OPENAI_API_KEY = "sk-smoke-not-a-real-key";
process.env.NOVA_CHATKIT_TIMEOUT_MS = "5000";
delete process.env.NOVA_LLM_USAGE_RETENTION_DAYS;

const { closeDb } = await import("../../../src/db/index.js");
const { listLlmUsage } = await import("../../../src/db/llm-usage.js");
const { writeModelRoutingSettings } = await import("../../../src/runtime/modules/model-routing/index.js");
const { estimateTokenCostUsd } = await import("../../../src/providers/pricing/index.js");
const embeddings = await import(distUrl("memory", "embeddings", "index.js"));
const { ensureMemorySchema } = await import(distUrl("memory", "schema", "index.js"));
const { MemoryIndexManager } = await import(distUrl("memory", "manager", "index.js"));
const chatkit = await import(distUrl("integrations", "chatkit", "runner", "index.js"));
const Database = (await import("better-sqlite3")).default;

const results = [];
async function run(name, fn) {
  try {
    await fn();
    results.push({ status: "PASS", name });
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.message : String(error) });
  }
}

const realFetch = globalThis.fetch;
/** Replace fetch with `handler(url, init)`; every call is captured. */
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return calls;
}
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const rows = (userId) => listLlmUsage(userId, { limit: 50 });

// ── HUD TypeScript loader ───────────────────────────────────────────────────────────────────────────────────────
const hudOut = fs.mkdtempSync(path.join(os.tmpdir(), "nova-llm-usage-coverage-"));
const stubDir = path.join(hudOut, "stubs");
fs.mkdirSync(stubDir, { recursive: true });
const STUBS = {
  "server-only": "module.exports = {}",
  "next/server": "exports.NextResponse = { json: (body, init) => Response.json(body, init) }",
  "local-user": "exports.requireLocalUser = async () => ({ userId: globalThis.__smoke.userId })",
  "rate-limit": [
    "exports.RATE_LIMIT_POLICIES = new Proxy({}, { get: () => ({}) })",
    "exports.checkUserRateLimit = () => ({ allowed: true })",
    "exports.rateLimitExceededResponse = () => Response.json({ ok: false }, { status: 429 })",
  ].join("\n"),
  "server-store": "exports.loadIntegrationsConfig = async () => globalThis.__smoke.config",
  "provider-selection": "exports.resolveConfiguredLlmProvider = () => globalThis.__smoke.selected",
  "provider-base-url": [
    "exports.resolveProviderProbeTarget = (p) => ({ ok: true, apiKey: p.callerApiKey || p.storedApiKey,",
    "  baseUrl: p.callerBaseUrl || p.storedBaseUrl || p.defaultBaseUrl })",
  ].join("\n"),
  // generate-mission.ts dependencies: only the completeWithConfiguredLlm wrapper is under test.
  "catalog-server": "exports.loadIntegrationCatalog = async () => []",
  "text-cleaning": "exports.parseJsonObject = (t) => JSON.parse(t)",
  "missions-store": "exports.buildMission = (m) => ({ id: 'mission-1', ...m })",
  "agent-flags": "exports.isMissionAgentGraphEnabled = () => false; exports.missionUsesAgentGraph = () => false",
  "versioning": "exports.validateMissionGraphForVersioning = () => []",
  "llm-providers-spy": [
    "exports.completeWithConfiguredLlm = async (...args) => { globalThis.__smoke.llmCalls.push(args);",
    "  return { provider: 'openai', model: 'gpt-6-luna', text: '{}', usage: {} } }",
  ].join("\n"),
  "build-from-prompt-spy": [
    "exports.runBuildMissionFromPrompt = async (prompt, options, deps) => {",
    "  await deps.completeWithConfiguredLlm('system', prompt, 2000, options && options.scope)",
    "  return { mission: { id: 'mission-1' }, provider: 'openai', model: 'gpt-6-luna' } }",
  ].join("\n"),
};
const stubPath = {};
for (const [name, source] of Object.entries(STUBS)) {
  const file = path.join(stubDir, `${name.replace(/\//g, "-")}.cjs`);
  fs.writeFileSync(file, `${source}\n`, "utf8");
  stubPath[name] = toPosix(file);
}
const srcPath = (...parts) => toPosix(path.join(repoRoot, "src", ...parts));
const USAGE_MODULE = srcPath("providers", "usage", "index.js");
const MODEL_ROUTING_MODULE = srcPath("runtime", "modules", "model-routing", "index.js");

/** Transpile one HUD TS file to CommonJS in hudOut, rewriting the given import specifiers; returns its exports. */
function loadHudModule(relativePath, rewrites) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  let output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  for (const [specifier, target] of Object.entries(rewrites)) {
    output = output.split(`"${specifier}"`).join(JSON.stringify(target));
  }
  const unresolved = [...output.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]).filter((s) => !path.isAbsolute(s));
  assert.deepEqual(unresolved, [], `${relativePath}: unrewritten imports`);
  const target = path.join(hudOut, relativePath.replace(/\.ts$/, ".cjs"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, output, "utf8");
  return createRequire(path.join(hudOut, "loader.cjs"))(target);
}

const COMMON_ROUTE_REWRITES = {
  "next/server": stubPath["next/server"],
  "@/lib/auth/local-user": stubPath["local-user"],
  "@/lib/integrations/store/server-store": stubPath["server-store"],
  "@/lib/integrations/llm/provider-selection": stubPath["provider-selection"],
  "@/lib/security/rate-limit": stubPath["rate-limit"],
  "@/lib/security/provider-base-url": stubPath["provider-base-url"],
};

const smokeConfig = (overrides = {}) => ({
  openai: { connected: true, apiKey: "sk-o", baseUrl: "", defaultModel: "gpt-6-luna" },
  claude: { connected: true, apiKey: "sk-c", baseUrl: "", defaultModel: "claude-haiku-4-5-20251001" },
  grok: { connected: true, apiKey: "sk-g", baseUrl: "", defaultModel: "grok-4.3" },
  gemini: { connected: true, apiKey: "sk-m", baseUrl: "", defaultModel: "gemini-3.8-flash" },
  ...overrides,
});
globalThis.__smoke = { userId: "", config: smokeConfig(), selected: null, llmCalls: [] };

// ── Embeddings ──────────────────────────────────────────────────────────────────────────────────────────────────
function memoryDb() {
  const db = new Database(":memory:");
  ensureMemorySchema(db);
  return db;
}

await run("E1 embedding call writes one 'embedding' row with the API's prompt_tokens and the model price", async () => {
  const user = "u-embed";
  const calls = stubFetch(() =>
    jsonResponse({ data: [{ embedding: [1, 0] }, { embedding: [0, 1] }], usage: { prompt_tokens: 42, total_tokens: 42 } }),
  );
  const provider = new embeddings.OpenAIEmbeddings({ apiKey: "sk-e", model: "text-embedding-3-small", db: memoryDb(), userContextId: user });
  await provider.embedBatch(["alpha", "beta"]);
  assert.equal(calls.length, 1);
  const ledger = rows(user);
  assert.equal(ledger.length, 1);
  const [row] = ledger;
  assert.equal(row.source, "embedding");
  assert.equal(row.refId, "memory-index");
  assert.equal(row.provider, "openai");
  assert.equal(row.model, "text-embedding-3-small");
  assert.equal(row.inputTokens, 42);
  assert.equal(row.outputTokens, 0);
  assert.equal(row.costUsd, estimateTokenCostUsd("text-embedding-3-small", 42, 0));
  // 42 tokens x $0.02 / 1M, at the ledger's 6-decimal precision.
  assert.equal(row.costUsd, Number(((42 * 0.02) / 1_000_000).toFixed(6)));
});

await run("E2 cache hits make no call and write no row; a failed call writes none", async () => {
  const user = "u-embed-2";
  const db = memoryDb();
  stubFetch(() => jsonResponse({ data: [{ embedding: [1, 0] }], usage: { prompt_tokens: 5, total_tokens: 5 } }));
  const provider = new embeddings.OpenAIEmbeddings({ apiKey: "sk-e", model: "text-embedding-3-small", db, userContextId: user });
  await provider.embed("gamma");
  const cachedCalls = stubFetch(() => jsonResponse({}));
  await provider.embed("gamma");
  assert.equal(cachedCalls.length, 0);
  stubFetch(() => jsonResponse({ error: { message: "boom" } }, 500));
  await assert.rejects(() => provider.embed("delta"));
  assert.equal(rows(user).length, 1);
});

await run("E3 local embeddings and user-less indexes write no row", async () => {
  const calls = stubFetch(() => jsonResponse({ data: [{ embedding: [1] }], usage: { prompt_tokens: 3 } }));
  const local = embeddings.createEmbeddingProvider({ provider: "local", model: "x", apiKey: "", db: memoryDb(), userContextId: "u-local" });
  await local.embed("text");
  assert.equal(calls.length, 0);
  assert.equal(rows("u-local").length, 0);
  const anonymous = new embeddings.OpenAIEmbeddings({ apiKey: "sk-e", model: "text-embedding-3-small", db: memoryDb() });
  await anonymous.embed("text");
  assert.equal(calls.length, 1);
});

await run("E4 MemoryIndexManager attributes a per-user index to its user and the shared index to nobody", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-memory-attrib-"));
  const base = {
    enabled: true, embeddingProvider: "openai", embeddingModel: "text-embedding-3-small", embeddingApiKey: "sk-e",
    chunkSize: 400, chunkOverlap: 40, hybridVectorWeight: 0.7, hybridBm25Weight: 0.3, topK: 5,
    syncOnSessionStart: false, sourceDirs: [],
  };
  const userDir = path.join(root, "user-context", "u-mem");
  fs.mkdirSync(userDir, { recursive: true });
  const scoped = new MemoryIndexManager({ ...base, dbPath: path.join(userDir, "memory.db") });
  const shared = new MemoryIndexManager({ ...base, dbPath: path.join(root, "memory.db") });
  const explicit = new MemoryIndexManager({ ...base, dbPath: path.join(root, "other.db") }, { userContextId: "u-explicit" });
  stubFetch(() => jsonResponse({ data: [{ embedding: [1, 0] }], usage: { prompt_tokens: 7 } }));
  for (const manager of [scoped, shared, explicit]) await manager.provider.embed("hello memory");
  assert.equal(rows("u-mem").length, 1);
  assert.equal(rows("u-explicit").length, 1);
  for (const manager of [scoped, shared, explicit]) manager.db.close();
});

// ── ChatKit ─────────────────────────────────────────────────────────────────────────────────────────────────────
function fakeAgentsSdk(runImpl) {
  return async () => ({
    Agent: class { constructor(params) { this.params = params; } },
    Runner: class { run(agent, input) { return runImpl(agent, input); } },
    withTrace: async (_name, fn) => fn(),
    setTracingDisabled: () => undefined,
  });
}
const twoResponses = async () => ({
  finalOutputText: "chatkit reply",
  rawResponses: [
    { usage: { inputTokens: 100, outputTokens: 20, inputTokensDetails: [{ cached_tokens: 40 }] } },
    { usage: { input_tokens: 50, output_tokens: 5, input_tokens_details: { cached_tokens: 0 } } },
  ],
});

await run("C1 ChatKit chat run writes one 'chat' row per model response", async () => {
  const result = await chatkit.runChatKitWorkflow(
    { prompt: "hi", context: { userContextId: "u-ck", conversationId: "conv-1" } },
    { loadSdk: fakeAgentsSdk(twoResponses) },
  );
  assert.equal(result.ok, true);
  const ledger = rows("u-ck").sort((a, b) => b.inputTokens - a.inputTokens);
  assert.equal(ledger.length, 2);
  assert.deepEqual(
    ledger.map((r) => [r.source, r.refId, r.provider, r.inputTokens, r.outputTokens, r.cachedInputTokens]),
    [["chat", "conv-1", "openai", 100, 20, 40], ["chat", "conv-1", "openai", 50, 5, 0]],
  );
  assert.equal(ledger[0].model, "gpt-5.6-luna");
});

await run("C2 ChatKit agent-task and mission runs use their own source/ref", async () => {
  await chatkit.runChatKitWorkflow(
    { prompt: "hi", context: { userContextId: "u-ck-task", conversationId: "agent-task-t42" } },
    { loadSdk: fakeAgentsSdk(twoResponses) },
  );
  await chatkit.runChatKitWorkflow(
    { prompt: "hi", context: { userContextId: "u-ck-mission", conversationId: "conv-9", missionRunId: "run-7" } },
    { loadSdk: fakeAgentsSdk(twoResponses) },
  );
  assert.deepEqual([...new Set(rows("u-ck-task").map((r) => `${r.source}:${r.refId}`))], ["agent-task:t42"]);
  assert.deepEqual([...new Set(rows("u-ck-mission").map((r) => `${r.source}:${r.refId}`))], ["mission:run-7"]);
});

await run("C3 a rejected ChatKit run writes no row", async () => {
  const result = await chatkit.runChatKitWorkflow(
    { prompt: "hi", context: { userContextId: "u-ck-fail", conversationId: "conv-2" } },
    { loadSdk: fakeAgentsSdk(async () => { throw new Error("upstream 500"); }) },
  );
  assert.equal(result.ok, false);
  assert.equal(rows("u-ck-fail").length, 0);
});

// ── HUD routes ──────────────────────────────────────────────────────────────────────────────────────────────────
const suggestRoute = loadHudModule("hud/app/api/missions/nova-suggest/route.ts", {
  ...COMMON_ROUTE_REWRITES,
  "../../../../../src/providers/usage/index.js": USAGE_MODULE,
  "../../../../../src/runtime/modules/model-routing/index.js": MODEL_ROUTING_MODULE,
});
const postSuggest = () =>
  suggestRoute.POST(new Request("http://local/api/missions/nova-suggest", { method: "POST", body: JSON.stringify({ stepTitle: "Digest" }) }));

const SUGGEST_CASES = [
  { provider: "claude", model: "claude-haiku-4-5-20251001", body: { content: [{ type: "text", text: "Do X." }], usage: { input_tokens: 30, output_tokens: 12, cache_read_input_tokens: 10 } }, expect: [40, 12, 10] },
  { provider: "grok", model: "grok-4.3", body: { choices: [{ message: { content: "Do X." } }], usage: { prompt_tokens: 31, completion_tokens: 11 } }, expect: [31, 11, 0] },
  { provider: "gemini", model: "gemini-3.8-flash", body: { choices: [{ message: { content: "Do X." } }], usage: { prompt_tokens: 32, completion_tokens: 10 } }, expect: [32, 10, 0] },
  { provider: "openai", model: "gpt-6-luna", body: { choices: [{ message: { content: "Do X." } }], usage: { prompt_tokens: 33, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 3 } } }, expect: [33, 9, 3] },
];
for (const testCase of SUGGEST_CASES) {
  await run(`R1 nova-suggest (${testCase.provider}) writes one utility/nova-suggest row; an HTTP error writes none`, async () => {
    const user = `u-suggest-${testCase.provider}`;
    writeModelRoutingSettings(user, { mode: "off" });
    globalThis.__smoke.userId = user;
    globalThis.__smoke.config = smokeConfig();
    globalThis.__smoke.selected = { provider: testCase.provider, model: testCase.model };
    const calls = stubFetch(() => jsonResponse(testCase.body));
    const ok = await postSuggest();
    assert.equal(ok.status, 200);
    assert.equal(calls.length, 1);
    stubFetch(() => jsonResponse({ error: { message: "rate limited" } }, 429));
    const failed = await postSuggest();
    assert.equal(failed.status, 400);
    const ledger = rows(user);
    assert.equal(ledger.length, 1);
    const [row] = ledger;
    assert.deepEqual([row.source, row.refId, row.provider, row.model], ["utility", "nova-suggest", testCase.provider, testCase.model]);
    assert.deepEqual([row.inputTokens, row.outputTokens, row.cachedInputTokens], testCase.expect);
  });
}

await run("R2 test-gemini-model writes one utility/model-test row; an HTTP error writes none", async () => {
  const route = loadHudModule("hud/app/api/integrations/test-gemini-model/route.ts", {
    ...COMMON_ROUTE_REWRITES,
    "../../../../../src/providers/usage/index.js": USAGE_MODULE,
  });
  const user = "u-model-test";
  globalThis.__smoke.userId = user;
  globalThis.__smoke.config = smokeConfig();
  const post = () =>
    route.POST(new Request("http://local/api/integrations/test-gemini-model", { method: "POST", body: JSON.stringify({ model: "gemini-3.8-flash" }) }));
  stubFetch(() => jsonResponse({ choices: [{ message: { content: "pong" } }], usage: { prompt_tokens: 4, completion_tokens: 1 } }));
  assert.equal((await post()).status, 200);
  stubFetch(() => jsonResponse({ error: { message: "model not found" } }, 404));
  assert.equal((await post()).status, 400);
  const ledger = rows(user);
  assert.equal(ledger.length, 1);
  assert.deepEqual(
    [ledger[0].source, ledger[0].refId, ledger[0].provider, ledger[0].model, ledger[0].inputTokens, ledger[0].outputTokens],
    ["utility", "model-test", "gemini", "gemini-3.8-flash", 4, 1],
  );
});

loadHudModule("hud/lib/missions/utils/config.ts", {});
const providers = loadHudModule("hud/lib/missions/llm/providers.ts", {
  "server-only": stubPath["server-only"],
  "@/lib/integrations/store/server-store": stubPath["server-store"],
  "@/lib/integrations/llm/provider-selection": stubPath["provider-selection"],
  "../utils/config": toPosix(path.join(hudOut, "hud", "lib", "missions", "utils", "config.cjs")),
  "../../../../src/providers/usage/index.js": USAGE_MODULE,
  "../../../../src/providers/models/retired-model-aliases/index.js": srcPath("providers", "models", "retired-model-aliases", "index.js"),
  "../../../../src/runtime/modules/model-routing/index.js": MODEL_ROUTING_MODULE,
});

await run("R3 mission client with the Gmail summary usage context writes utility/gmail-summary", async () => {
  const user = "u-gmail";
  globalThis.__smoke.config = smokeConfig();
  globalThis.__smoke.selected = { provider: "openai", model: "gpt-6-luna" };
  stubFetch(() => jsonResponse({ choices: [{ message: { content: "- urgent" } }], usage: { prompt_tokens: 60, completion_tokens: 15 } }));
  // Same arguments as hud/app/api/integrations/gmail/summary/route.ts.
  const context = { source: "utility", refId: "gmail-summary", callSite: "utility.gmail-summary" };
  await providers.completeWithConfiguredLlm("sys", "emails", 700, { userId: user }, undefined, context);
  stubFetch(() => jsonResponse({ error: { message: "bad" } }, 500));
  await assert.rejects(() => providers.completeWithConfiguredLlm("sys", "emails", 700, { userId: user }, undefined, context));
  const ledger = rows(user);
  assert.equal(ledger.length, 1);
  assert.deepEqual([ledger[0].source, ledger[0].refId, ledger[0].inputTokens, ledger[0].tier], ["utility", "gmail-summary", 60, "trivial"]);
  const gmailRoute = fs.readFileSync(path.join(repoRoot, "hud/app/api/integrations/gmail/summary/route.ts"), "utf8");
  assert.match(
    gmailRoute,
    /\{ source: "utility", refId: "gmail-summary", callSite: "utility.gmail-summary" \}/,
    "gmail summary route passes the usage context",
  );
});

await run("R4 buildMissionFromPrompt hands the generation call source mission / ref build-from-prompt", async () => {
  const generate = loadHudModule("hud/lib/missions/workflow/generate-mission.ts", {
    "server-only": stubPath["server-only"],
    "@/lib/integrations/store/server-store": stubPath["server-store"],
    "@/lib/integrations/catalog/server": stubPath["catalog-server"],
    "@/lib/missions/text/cleaning": stubPath["text-cleaning"],
    "../store": stubPath["missions-store"],
    "../llm/providers": stubPath["llm-providers-spy"],
    "../../../../src/runtime/modules/services/missions/build-from-prompt/index.js": stubPath["build-from-prompt-spy"],
    "./agent-flags": stubPath["agent-flags"],
    "./versioning": stubPath["versioning"],
  });
  globalThis.__smoke.llmCalls = [];
  await generate.buildMissionFromPrompt("daily digest", { userId: "u-build", scope: { userId: "u-build" } });
  assert.equal(globalThis.__smoke.llmCalls.length, 1);
  const args = globalThis.__smoke.llmCalls[0];
  assert.deepEqual(args[3], { userId: "u-build" });
  assert.deepEqual(args[5], { source: "mission", refId: "build-from-prompt", callSite: "mission.build-from-prompt" });
});

// ── Model routing (Stage 6) ─────────────────────────────────────────────────────────────────────────────────────
const SONNET = "claude-sonnet-5";
const HAIKU = "claude-haiku-4-5-20251001"; // the default Claude economy model
const claudeOk = (usage = { input_tokens: 20, output_tokens: 5 }) => jsonResponse({ content: [{ type: "text", text: "ok" }], usage });
const sentBody = (call) => JSON.parse(String(call.init?.body || "{}"));
function useClaudeSonnet() {
  globalThis.__smoke.config = smokeConfig({ claude: { connected: true, apiKey: "sk-c", baseUrl: "", defaultModel: SONNET } });
  globalThis.__smoke.selected = { provider: "claude", model: SONNET };
}

await run("M1 a trivial mission call site goes to the economy model and records it with tier trivial", async () => {
  const user = "u-route-classify";
  useClaudeSonnet();
  const calls = stubFetch(() => claudeOk());
  const result = await providers.completeWithConfiguredLlm("", "classify this", 500, { userId: user }, undefined, {
    refId: "run-1",
    callSite: "mission.ai-classify",
  });
  assert.equal(calls.length, 1);
  const body = sentBody(calls[0]);
  assert.equal(body.model, HAIKU);
  assert.equal(body.temperature, 0, "temperature follows the model actually sent (Haiku 4.5 accepts it)");
  assert.deepEqual([result.model, result.tier, result.routed], [HAIKU, "trivial", true]);
  const [row] = rows(user);
  assert.deepEqual([row.source, row.refId, row.model, row.tier], ["mission", "run-1", HAIKU, "trivial"]);
});

await run("M2 a refused economy model (404) is retried once on the selected model", async () => {
  const user = "u-route-fallback";
  useClaudeSonnet();
  const calls = stubFetch((_url, init) =>
    JSON.parse(String(init?.body || "{}")).model === HAIKU
      ? jsonResponse({ error: { message: "model: claude-haiku-4-5-20251001" } }, 404)
      : claudeOk(),
  );
  const result = await providers.completeWithConfiguredLlm("", "extract this", 500, { userId: user }, undefined, {
    refId: "run-2",
    callSite: "mission.ai-extract",
  });
  assert.deepEqual(calls.map((call) => sentBody(call).model), [HAIKU, SONNET]);
  assert.equal("temperature" in sentBody(calls[1]), false, "Sonnet 5 gets no temperature");
  assert.deepEqual([result.model, result.tier, result.routed], [SONNET, "trivial", false]);
  const ledger = rows(user);
  assert.equal(ledger.length, 1);
  assert.deepEqual([ledger[0].model, ledger[0].tier], [SONNET, "trivial"]);
});

await run("M3 explicit node model, standard / hard call sites and no call site keep the selected model", async () => {
  const user = "u-route-kept";
  useClaudeSonnet();
  const calls = stubFetch(() => claudeOk());
  const scope = { userId: user };
  const explicit = await providers.completeWithConfiguredLlm("", "p", 500, scope, { model: SONNET }, { refId: "r", callSite: "mission.ai-classify" });
  const standard = await providers.completeWithConfiguredLlm("", "p", 500, scope, undefined, { refId: "r", callSite: "mission.ai-summarize" });
  const hard = await providers.completeWithConfiguredLlm("", "p", 500, scope, undefined, { refId: "r", callSite: "mission.build-from-prompt" });
  const plain = await providers.completeWithConfiguredLlm("", "p", 500, scope, undefined, { refId: "r" });
  assert.deepEqual(calls.map((call) => sentBody(call).model), [SONNET, SONNET, SONNET, SONNET]);
  assert.deepEqual([explicit.tier, standard.tier, hard.tier], ["trivial", "standard", "hard"]);
  assert.equal("tier" in plain || "routed" in plain, false, "a caller without a call site gets the pre-routing result shape");
  assert.deepEqual(
    rows(user).map((row) => row.tier).sort(),
    ["hard", "standard", "trivial", null].sort(),
  );
});

await run("M4 cost-saving routes standard call sites; routing off keeps every call on the selected model", async () => {
  const user = "u-route-modes";
  useClaudeSonnet();
  const calls = stubFetch(() => claudeOk());
  writeModelRoutingSettings(user, { mode: "cost-saving" });
  await providers.completeWithConfiguredLlm("", "p", 500, { userId: user }, undefined, { refId: "r", callSite: "mission.ai-summarize" });
  await providers.completeWithConfiguredLlm("", "p", 500, { userId: user }, undefined, { refId: "r", callSite: "mission.build-from-prompt" });
  writeModelRoutingSettings(user, { mode: "off" });
  await providers.completeWithConfiguredLlm("", "p", 500, { userId: user }, undefined, { refId: "r", callSite: "mission.ai-classify" });
  assert.deepEqual(calls.map((call) => sentBody(call).model), [HAIKU, SONNET, SONNET]);
});

await run("M5 nova-suggest routes to the economy model, records it with tier trivial, and falls back on a 404", async () => {
  const user = "u-route-suggest";
  globalThis.__smoke.userId = user;
  useClaudeSonnet();
  const calls = stubFetch(() => claudeOk({ input_tokens: 30, output_tokens: 12 }));
  const ok = await postSuggest();
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).model, HAIKU);
  assert.equal(sentBody(calls[0]).model, HAIKU);
  const fallbackCalls = stubFetch((_url, init) =>
    JSON.parse(String(init?.body || "{}")).model === HAIKU ? jsonResponse({ error: { message: "not found" } }, 404) : claudeOk(),
  );
  const fallback = await postSuggest();
  assert.equal(fallback.status, 200);
  assert.equal((await fallback.json()).model, SONNET);
  assert.deepEqual(fallbackCalls.map((call) => sentBody(call).model), [HAIKU, SONNET]);
  assert.deepEqual(
    rows(user).map((row) => `${row.model}:${row.tier}`).sort(),
    [`${HAIKU}:trivial`, `${SONNET}:trivial`],
  );
});

globalThis.fetch = realFetch;
closeDb();
fs.rmSync(hudOut, { recursive: true, force: true });

for (const result of results) {
  console.log(`[${result.status}] ${result.name}${result.detail ? ` :: ${result.detail}` : ""}`);
}
const failed = results.filter((result) => result.status === "FAIL").length;
console.log(`\nllm-usage-coverage: ${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
