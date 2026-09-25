import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  claudeMessagesCreate,
  describeUnknownError,
  getOpenAIClient,
  loadIntegrationsRuntime,
  resolveConfiguredChatRuntime,
  withTimeout,
} from "../../../src/providers/runtime/index.js";
import { extractAutoMemoryFacts } from "../../../src/memory/runtime/index.js";
import { createSessionRuntime } from "../../../src/session/runtime/index.js";
import { createToolRuntime } from "../../../src/tools/runtime/index.js";
import { createWakeWordRuntime } from "../../../src/runtime/audio/wake-runtime/index.js";
import { seedRuntimeIntegrations } from "../lib/seed-runtime-integrations.mjs";

const results = [];

function record(status, name, detail = "") {
  results.push({ status, name, detail });
}

async function run(name, fn) {
  try {
    await fn();
    record("PASS", name);
  } catch (err) {
    record("FAIL", name, describeUnknownError(err));
  }
}

function makeRuntime(connectedMap = {}) {
  const c = (key) => Boolean(connectedMap[key]);
  const k = (key) => (c(key) ? `${key}-key` : "");
  return {
    activeProvider: connectedMap.activeProvider ?? "openai",
    openai: { connected: c("openai"), apiKey: k("openai"), baseURL: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
    claude: { connected: c("claude"), apiKey: k("claude"), baseURL: "https://api.anthropic.com", model: "claude-sonnet-5" },
    grok: { connected: c("grok"), apiKey: k("grok"), baseURL: "https://api.x.ai/v1", model: "grok-4.3" },
    gemini: { connected: c("gemini"), apiKey: k("gemini"), baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-pro" },
  };
}

await run("Provider strict mode returns active provider for all 4", async () => {
  const providers = ["openai", "claude", "grok", "gemini"];
  for (const provider of providers) {
    const runtime = makeRuntime({ activeProvider: provider, [provider]: true });
    const resolved = resolveConfiguredChatRuntime(runtime, { strictActiveProvider: true });
    assert.equal(resolved.provider, provider);
    assert.equal(resolved.strict, true);
  }
});

// V.59 removed the cross-provider fallback: routing is always the active (or task-selected) provider, even when
// that provider is not connected (the caller reports it instead of silently switching providers).
await run("Provider routing never falls back to another provider; a task-selected provider wins", async () => {
  const runtime1 = makeRuntime({ activeProvider: "gemini", openai: true });
  const resolved1 = resolveConfiguredChatRuntime(runtime1, { strictActiveProvider: false });
  assert.equal(resolved1.provider, "gemini");
  assert.equal(resolved1.connected, false);
  assert.equal(resolved1.routeReason, "strict-active-provider");
  assert.deepEqual(resolved1.rankedCandidates, ["gemini"]);

  const runtime2 = makeRuntime({ activeProvider: "openai", openai: true, claude: true, gemini: true, grok: true });
  const resolved2Override = resolveConfiguredChatRuntime(runtime2, {
    strictActiveProvider: false,
    allowActiveProviderOverride: true,
    preference: "cost",
  });
  assert.equal(resolved2Override.provider, "openai", "legacy override/preference options are ignored");

  const taskSelected = resolveConfiguredChatRuntime(runtime2, { preferredProvider: "claude", preferredModel: "claude-task-model" });
  assert.equal(taskSelected.provider, "claude");
  assert.equal(taskSelected.connected, true);
  assert.equal(taskSelected.model, "claude-task-model");
  assert.equal(taskSelected.routeReason, "task-selected-provider");
});

// Provider runtime is per-user only (no global fallback): loads read the user's runtime snapshot row in nova.db.
// The smoke seeds its own user in the isolated temp data dir. Provider endpoints point at a closed loopback port,
// so the client error paths run without any network egress (live pings live in smoke:src-providers).
const SMOKE_USER_CONTEXT_ID = "smoke-runtime-user";
const OFFLINE_BASE_URL = "http://127.0.0.1:9";
seedRuntimeIntegrations(SMOKE_USER_CONTEXT_ID, {
  activeLlmProvider: "claude",
  openai: { connected: true, apiKey: "", baseUrl: OFFLINE_BASE_URL, defaultModel: "gpt-smoke-model" },
  claude: { connected: true, apiKey: "smoke-claude-key", baseUrl: OFFLINE_BASE_URL, defaultModel: "claude-smoke-model" },
  grok: { connected: false, apiKey: "smoke-grok-key", baseUrl: OFFLINE_BASE_URL, defaultModel: "grok-smoke-model" },
  gemini: { connected: false, baseUrl: `${OFFLINE_BASE_URL}/v1beta/openai`, defaultModel: "gemini-smoke-model" },
});

function assertProviderShape(runtime) {
  assert.ok(["openai", "claude", "grok", "gemini"].includes(runtime.activeProvider));
  for (const key of ["openai", "claude", "grok", "gemini"]) {
    assert.equal(typeof runtime[key].connected, "boolean");
    assert.equal(typeof runtime[key].apiKey, "string");
    assert.equal(typeof runtime[key].baseURL, "string");
    assert.equal(typeof runtime[key].model, "string");
  }
}

await run("Integrations runtime requires a userContextId (no global config)", async () => {
  assert.throws(() => loadIntegrationsRuntime(), /userContextId/);
});

const loaded = loadIntegrationsRuntime({ userContextId: SMOKE_USER_CONTEXT_ID });
await run("User-scoped runtime loads the seeded provider snapshot", async () => {
  assertProviderShape(loaded);
  assert.equal(loaded.activeProvider, "claude");
  assert.equal(loaded.claude.connected, true);
  assert.equal(loaded.claude.apiKey, "smoke-claude-key");
  assert.equal(loaded.claude.model, "claude-smoke-model");
  assert.equal(loaded.claude.baseURL, OFFLINE_BASE_URL);
  assert.equal(loaded.openai.connected, false, "connected flag without a key is not connected");
  assert.equal(loaded.grok.connected, false, "a key without the connected flag is not connected");
  assert.equal(loaded.gemini.connected, false);
  assert.equal(loaded.openai.baseURL, `${OFFLINE_BASE_URL}/v1`);
});

await run("User-scoped runtime resolves the route to the ready provider", async () => {
  const resolved = resolveConfiguredChatRuntime(loaded, { strictActiveProvider: false });
  assert.equal(resolved.provider, "claude");
  assert.equal(resolved.connected, true);
  assert.equal(resolved.apiKey, "smoke-claude-key");
});

await run("Unknown user falls back to a disconnected runtime of valid shape", async () => {
  const unknown = loadIntegrationsRuntime({ userContextId: "smoke-unknown-user" });
  assertProviderShape(unknown);
  for (const key of ["openai", "claude", "grok", "gemini"]) assert.equal(unknown[key].connected, false);
  assert.equal(resolveConfiguredChatRuntime(unknown, { strictActiveProvider: false }).connected, false);
});

async function assertOpenAiLikeClientFails(name, runtime) {
  await run(`${name} client error path executes offline`, async () => {
    const client = getOpenAIClient({ apiKey: "invalid-key", baseURL: runtime.baseURL });
    await assert.rejects(() =>
      withTimeout(
        client.chat.completions.create({
          model: runtime.model,
          messages: [{ role: "user", content: "test" }],
          max_completion_tokens: 8,
        }),
        20000,
        `${name} offline error path`,
      ));
  });
}

await assertOpenAiLikeClientFails("OpenAI", loaded.openai);
await run("Claude client error path executes offline", async () => {
  await assert.rejects(() =>
    withTimeout(
      claudeMessagesCreate({
        apiKey: "invalid-key",
        baseURL: loaded.claude.baseURL,
        model: loaded.claude.model,
        system: "test",
        userText: "test",
        maxTokens: 8,
      }),
      20000,
      "Claude offline error path",
    ));
});
await assertOpenAiLikeClientFails("Grok", loaded.grok);
await assertOpenAiLikeClientFails("Gemini", loaded.gemini);

await run("Auto memory extraction captures stable user facts", async () => {
  const nameFacts = extractAutoMemoryFacts("Call me Jack");
  assert.ok(nameFacts.some((f) => f.key === "preferred-name"));

  const timezoneFacts = extractAutoMemoryFacts("My timezone is America/New_York");
  assert.ok(timezoneFacts.some((f) => f.key === "timezone"));

  const questionFacts = extractAutoMemoryFacts("What is my timezone?");
  assert.equal(questionFacts.length, 0);
});

await run("Session/account isolation keeps per-key transcripts separated (nova.db, no legacy files)", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-session-smoke-"));
  const runtime = createSessionRuntime({
    sessionStorePath: path.join(tmpRoot, "sessions.json"),
    transcriptDir: path.join(tmpRoot, "transcripts"),
    sessionIdleMinutes: 120,
    sessionMainKey: "main",
  });

  const a = runtime.resolveSessionContext({
    source: "hud",
    sender: "hud-user:user-a",
    userContextId: "user-a",
    sessionKeyHint: "agent:nova:hud:user:user-a:dm:conv-1",
  });
  const b = runtime.resolveSessionContext({
    source: "hud",
    sender: "hud-user:user-b",
    userContextId: "user-b",
    sessionKeyHint: "agent:nova:hud:user:user-b:dm:conv-9",
  });

  assert.notEqual(a.sessionKey, b.sessionKey);
  assert.notEqual(a.sessionEntry.sessionId, b.sessionEntry.sessionId);
  assert.equal(runtime.resolveUserContextId({ source: "hud", sender: "hud-user:user-a" }), "user-a");
  runtime.appendTranscriptTurn(a.sessionEntry.sessionId, "user", "hello-a");
  runtime.appendTranscriptTurn(b.sessionEntry.sessionId, "user", "hello-b");
  // Sessions and transcripts live in nova.db (the isolated data dir): the legacy path options write no files.
  assert.deepEqual(await fsp.readdir(tmpRoot), [], "no session/transcript files are written to the legacy paths");

  const a2 = runtime.resolveSessionContext({ sessionKeyHint: "agent:nova:hud:user:user-a:dm:conv-1" });
  const b2 = runtime.resolveSessionContext({ sessionKeyHint: "agent:nova:hud:user:user-b:dm:conv-9" });

  const aText = a2.transcript.map((t) => t.content).join(" ");
  const bText = b2.transcript.map((t) => t.content).join(" ");
  assert.ok(aText.includes("hello-a"));
  assert.ok(!aText.includes("hello-b"));
  assert.ok(bText.includes("hello-b"));
  assert.ok(!bText.includes("hello-a"));
});

await run("Tool runtime initializes and executes file tool", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-tools-smoke-"));
  const memDir = path.join(tmpRoot, "memory-src");
  await fsp.mkdir(memDir, { recursive: true });
  await fsp.writeFile(path.join(memDir, "notes.md"), "# Smoke\n\nlaunch checklist and provider notes", "utf8");

  const runtime = createToolRuntime({
    enabled: true,
    memoryEnabled: true,
    rootDir: process.cwd(),
    memoryDbPath: path.join(tmpRoot, "memory.db"),
    memorySourceDir: memDir,
    enabledTools: ["read", "write", "edit", "ls", "grep", "web_search", "web_fetch", "memory_search", "memory_get"],
    execApprovalMode: "ask",
    safeBinaries: ["ls", "cat", "grep"],
    webSearchProvider: "brave",
    webSearchApiKey: "",
    memoryConfig: {
      embeddingProvider: "local",
      embeddingModel: "text-embedding-3-small",
      embeddingApiKey: "",
      chunkSize: 400,
      chunkOverlap: 80,
      hybridVectorWeight: 0.7,
      hybridBm25Weight: 0.3,
      topK: 5,
    },
    describeUnknownError,
  });

  const state = await runtime.initToolRuntimeIfNeeded();
  assert.ok(Array.isArray(state.tools) && state.tools.length > 0);
  const toolNames = new Set(state.tools.map((tool) => tool.name));
  assert.ok(toolNames.has("read"));
  assert.ok(toolNames.has("web_search"));

  const readResult = await state.executeToolUse(
    { id: "smoke-read", name: "read", type: "tool_use", input: { path: "package.json" } },
    state.tools,
  );
  assert.equal(readResult.is_error, undefined);
  assert.ok(String(readResult.content).includes("\"name\""));

  assert.ok(state.memoryManager, "memory manager did not initialize");
  await state.memoryManager.indexDirectory(memDir);
  const hits = await state.memoryManager.search("launch checklist", 3);
  assert.ok(Array.isArray(hits));
  assert.ok(hits.length > 0);
});

await run("Tool runtime scopes memory.db per user context", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-tools-scope-smoke-"));
  const globalMemoryDir = path.join(tmpRoot, "memory-src");
  await fsp.mkdir(globalMemoryDir, { recursive: true });
  await fsp.writeFile(path.join(globalMemoryDir, "shared.md"), "# Shared\n\nglobal reference", "utf8");

  const runtime = createToolRuntime({
    enabled: true,
    memoryEnabled: true,
    rootDir: process.cwd(),
    memoryDbPath: path.join(tmpRoot, "memory.db"),
    memorySourceDir: globalMemoryDir,
    enabledTools: ["memory_search", "memory_get"],
    execApprovalMode: "ask",
    safeBinaries: ["ls", "cat", "grep"],
    webSearchProvider: "brave",
    webSearchApiKey: "",
    memoryConfig: {
      embeddingProvider: "local",
      embeddingModel: "text-embedding-3-small",
      embeddingApiKey: "",
      chunkSize: 400,
      chunkOverlap: 80,
      hybridVectorWeight: 0.7,
      hybridBm25Weight: 0.3,
      topK: 5,
    },
    describeUnknownError,
  });

  const a = await runtime.initToolRuntimeIfNeeded({ userContextId: "user-a" });
  const b = await runtime.initToolRuntimeIfNeeded({ userContextId: "user-b" });

  assert.notEqual(a, b);
  assert.equal(String(a.scopeId), "user-a");
  assert.equal(String(b.scopeId), "user-b");
  assert.ok(String(a.memoryDbPath).toLowerCase().includes(path.join("user-context", "user-a", "memory.db")));
  assert.ok(String(b.memoryDbPath).toLowerCase().includes(path.join("user-context", "user-b", "memory.db")));
  assert.equal(fs.existsSync(String(a.memoryDbPath)), true);
  assert.equal(fs.existsSync(String(b.memoryDbPath)), true);
});

await run("Voice wake logic gates/strips correctly", async () => {
  const wake = createWakeWordRuntime({ wakeWord: "nova", wakeWordVariants: ["nova", "nava"] });
  assert.equal(wake.containsWakeWord("hey nova what time is it"), true);
  assert.equal(wake.containsWakeWord("hello there"), false);
  assert.equal(wake.stripWakePrompt("hey nova run diagnostics"), "run diagnostics");
});

await run("Brave-only web search remains enforced (no Tavily/Serper refs)", async () => {
  const constantsPathCandidates = [
    path.join(process.cwd(), "src", "runtime", "core", "constants", "index.js"),
    path.join(process.cwd(), "src", "runtime", "core", "constants.js"),
    path.join(process.cwd(), "src", "runtime", "constants.js"),
  ];
  const constantsPath = constantsPathCandidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(constantsPath, "Unable to locate runtime constants source");
  const constantsSource = await fsp.readFile(constantsPath, "utf8");
  const missionSearchSource = await fsp.readFile(path.join(process.cwd(), "hud", "lib", "missions", "web", "search.ts"), "utf8");
  const missionFetchSource = await fsp.readFile(path.join(process.cwd(), "hud", "lib", "missions", "web", "fetch.ts"), "utf8");
  const combined = `${constantsSource}\n${missionSearchSource}\n${missionFetchSource}`.toLowerCase();
  assert.equal(combined.includes("tavily"), false);
  assert.equal(combined.includes("serper"), false);
  assert.equal(/tool_web_search_provider\s*=\s*["']brave["']/i.test(constantsSource), true);
  assert.equal(combined.includes("api.search.brave.com"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) {
  process.exit(1);
}
