import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  claudeMessagesCreate,
  describeUnknownError,
  extractOpenAIChatText,
  getOpenAIClient,
  loadIntegrationsRuntime,
  resolveConfiguredChatRuntime,
  withTimeout,
} from "../../src/providers/runtime-compat.js";
import { extractAutoMemoryFacts } from "../../src/memory/runtime-compat.js";
import { createSessionRuntime } from "../../src/session/runtime-compat.js";
import { createToolRuntime } from "../../src/tools/runtime-compat.js";
import { createWakeWordRuntime } from "../../src/runtime/audio/wake-runtime-compat.js";

const results = [];
const SMOKE_USER_CONTEXT_ID = String(process.env.NOVA_SMOKE_USER_CONTEXT_ID || "").trim();

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

function skip(name, detail) {
  record("SKIP", name, detail);
}

function makeRuntime(connectedMap = {}) {
  const c = (key) => Boolean(connectedMap[key]);
  const k = (key) => (c(key) ? `${key}-key` : "");
  return {
    activeProvider: connectedMap.activeProvider ?? "openai",
    openai: { connected: c("openai"), apiKey: k("openai"), baseURL: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
    claude: { connected: c("claude"), apiKey: k("claude"), baseURL: "https://api.anthropic.com", model: "claude-sonnet-4-20250514" },
    grok: { connected: c("grok"), apiKey: k("grok"), baseURL: "https://api.x.ai/v1", model: "grok-4-fast-reasoning" },
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

await run("Provider fallback selects ready providers and honors override policy", async () => {
  const runtime1 = makeRuntime({ activeProvider: "gemini", openai: true });
  const resolved1 = resolveConfiguredChatRuntime(runtime1, { strictActiveProvider: false });
  assert.equal(resolved1.provider, "openai");
  assert.equal(resolved1.connected, true);

  const runtime2 = makeRuntime({ activeProvider: "openai", openai: true, claude: true, gemini: true, grok: true });
  const resolved2 = resolveConfiguredChatRuntime(runtime2, { strictActiveProvider: false });
  assert.equal(resolved2.provider, "openai");
  assert.equal(resolved2.routeReason, "active-provider-ready");

  const resolved2Override = resolveConfiguredChatRuntime(runtime2, {
    strictActiveProvider: false,
    allowActiveProviderOverride: true,
    preference: "cost",
  });
  assert.equal(resolved2Override.provider, "gemini");
  assert.equal(resolved2Override.connected, true);
  assert.equal(Array.isArray(resolved2Override.rankedCandidates), true);
  assert.equal(resolved2Override.rankedCandidates.includes("gemini"), true);

  const runtime3 = makeRuntime({ activeProvider: "grok" });
  const resolved3 = resolveConfiguredChatRuntime(runtime3, { strictActiveProvider: false });
  assert.equal(resolved3.provider, "grok");
  assert.equal(resolved3.connected, false);
});

const loaded = loadIntegrationsRuntime();
await run("Integrations runtime loads valid provider shape", async () => {
  assert.ok(["openai", "claude", "grok", "gemini"].includes(loaded.activeProvider));
  for (const key of ["openai", "claude", "grok", "gemini"]) {
    assert.equal(typeof loaded[key].connected, "boolean");
    assert.equal(typeof loaded[key].apiKey, "string");
    assert.equal(typeof loaded[key].baseURL, "string");
    assert.equal(typeof loaded[key].model, "string");
  }
});

if (SMOKE_USER_CONTEXT_ID) {
  const scopedLoaded = loadIntegrationsRuntime({ userContextId: SMOKE_USER_CONTEXT_ID });
  const scopedReadyProviders = ["openai", "claude", "grok", "gemini"].filter((key) =>
    Boolean(scopedLoaded[key].connected) &&
    String(scopedLoaded[key].apiKey || "").trim().length > 0 &&
    String(scopedLoaded[key].model || "").trim().length > 0,
  );
  await run(`User-scoped runtime loads valid provider shape (${SMOKE_USER_CONTEXT_ID})`, async () => {
    assert.ok(["openai", "claude", "grok", "gemini"].includes(scopedLoaded.activeProvider));
    for (const key of ["openai", "claude", "grok", "gemini"]) {
      assert.equal(typeof scopedLoaded[key].connected, "boolean");
      assert.equal(typeof scopedLoaded[key].apiKey, "string");
      assert.equal(typeof scopedLoaded[key].baseURL, "string");
      assert.equal(typeof scopedLoaded[key].model, "string");
    }
  });

  await run(`User-scoped runtime has key for connected providers (${SMOKE_USER_CONTEXT_ID})`, async () => {
    for (const key of ["openai", "claude", "grok", "gemini"]) {
      if (!scopedLoaded[key].connected) continue;
      assert.ok(
        String(scopedLoaded[key].apiKey || "").trim().length > 0,
        `${key} marked connected but key is empty`,
      );
    }
  });

  await run(`User-scoped runtime resolves provider route (${SMOKE_USER_CONTEXT_ID})`, async () => {
    const scopedResolved = resolveConfiguredChatRuntime(scopedLoaded, { strictActiveProvider: false });
    if (scopedReadyProviders.length > 0) {
      assert.equal(scopedResolved.connected, true, `resolved provider "${scopedResolved.provider}" is disconnected`);
      assert.ok(
        String(scopedResolved.apiKey || "").trim().length > 0,
        `resolved provider "${scopedResolved.provider}" key is empty`,
      );
      assert.equal(scopedReadyProviders.includes(scopedResolved.provider), true);
      return;
    }
    assert.equal(scopedResolved.connected, false);
    assert.ok(
      scopedResolved.routeReason === "active-provider-unavailable" || scopedResolved.routeReason === "strict-active-provider",
    );
  });

  if (scopedLoaded.openai.connected && scopedLoaded.openai.apiKey) {
    await run(`OpenAI user-scoped live ping returns text (${SMOKE_USER_CONTEXT_ID})`, async () => {
      const client = getOpenAIClient({ apiKey: scopedLoaded.openai.apiKey, baseURL: scopedLoaded.openai.baseURL });
      const completion = await withTimeout(
        client.chat.completions.create({
          model: scopedLoaded.openai.model,
          messages: [{ role: "user", content: "Reply with: PING_OK" }],
          max_completion_tokens: 512,
        }),
        30000,
        "OpenAI user-scoped live ping",
      );
      const text = extractOpenAIChatText(completion);
      const completionTokens = Number(completion?.usage?.completion_tokens || 0);
      const finishReason = String(completion?.choices?.[0]?.finish_reason || "");
      assert.ok(
        String(text || "").trim().length > 0 || (completionTokens > 0 && finishReason.length > 0),
      );
    });
  } else {
    await run(`OpenAI user-scoped branch path executes (${SMOKE_USER_CONTEXT_ID})`, async () => {
      let threw = false;
      try {
        const client = getOpenAIClient({ apiKey: "invalid-key", baseURL: scopedLoaded.openai.baseURL });
        await withTimeout(
          client.chat.completions.create({
            model: scopedLoaded.openai.model,
            messages: [{ role: "user", content: "test" }],
            max_completion_tokens: 8,
          }),
          20000,
          "OpenAI user-scoped auth-fail path",
        );
      } catch {
        threw = true;
      }
      assert.equal(threw, true);
    });
  }
} else {
  skip("User-scoped runtime validation", "Set NOVA_SMOKE_USER_CONTEXT_ID to enable.");
}

if (loaded.openai.connected && loaded.openai.apiKey) {
  await run("OpenAI live ping returns text", async () => {
    const client = getOpenAIClient({ apiKey: loaded.openai.apiKey, baseURL: loaded.openai.baseURL });
    const completion = await withTimeout(
      client.chat.completions.create({
        model: loaded.openai.model,
        messages: [{ role: "user", content: "Reply with: PING_OK" }],
        max_completion_tokens: 512,
      }),
      30000,
      "OpenAI live ping",
    );
    const text = extractOpenAIChatText(completion);
    const completionTokens = Number(completion?.usage?.completion_tokens || 0);
    const finishReason = String(completion?.choices?.[0]?.finish_reason || "");
    assert.ok(
      String(text || "").trim().length > 0 || (completionTokens > 0 && finishReason.length > 0),
    );
  });
} else {
  await run("OpenAI branch path executes (expected auth fail when unconfigured)", async () => {
    let threw = false;
    try {
      const client = getOpenAIClient({ apiKey: "invalid-key", baseURL: loaded.openai.baseURL });
      await withTimeout(
        client.chat.completions.create({
          model: loaded.openai.model,
          messages: [{ role: "user", content: "test" }],
          max_completion_tokens: 8,
        }),
        20000,
        "OpenAI auth-fail path",
      );
    } catch {
      threw = true;
    }
    assert.equal(threw, true);
  });
}

if (loaded.claude.connected && loaded.claude.apiKey) {
  await run("Claude live branch returns text", async () => {
    const response = await withTimeout(
      claudeMessagesCreate({
        apiKey: loaded.claude.apiKey,
        baseURL: loaded.claude.baseURL,
        model: loaded.claude.model,
        system: "You are a test bot.",
        userText: "Reply with CLAUDE_OK",
        maxTokens: 12,
      }),
      30000,
      "Claude live ping",
    );
    assert.ok(String(response.text || "").toUpperCase().includes("CLAUDE"));
  });
} else {
  await run("Claude branch path executes (expected auth fail when unconfigured)", async () => {
    let threw = false;
    try {
      await withTimeout(
        claudeMessagesCreate({
          apiKey: "invalid-key",
          baseURL: "https://api.anthropic.com",
          model: "claude-sonnet-4-20250514",
          system: "test",
          userText: "test",
          maxTokens: 8,
        }),
        20000,
        "Claude auth-fail path",
      );
    } catch {
      threw = true;
    }
    assert.equal(threw, true);
  });
}

async function runOpenAiCompatibleCheck(name, runtime, configuredProviderLabel) {
  if (runtime.connected && runtime.apiKey) {
    await run(`${name} live branch returns response shape`, async () => {
      const client = getOpenAIClient({ apiKey: runtime.apiKey, baseURL: runtime.baseURL });
      const completion = await withTimeout(
        client.chat.completions.create({
          model: runtime.model,
          messages: [{ role: "user", content: `Reply with ${configuredProviderLabel}_OK` }],
          max_completion_tokens: 512,
        }),
        30000,
        `${name} live ping`,
      );
      assert.ok(Array.isArray(completion?.choices));
      assert.ok(completion.choices.length > 0);
    });
  } else {
    await run(`${name} branch path executes (expected auth fail when unconfigured)`, async () => {
      let threw = false;
      try {
        const client = getOpenAIClient({ apiKey: "invalid-key", baseURL: runtime.baseURL });
        await withTimeout(
          client.chat.completions.create({
            model: runtime.model,
            messages: [{ role: "user", content: "test" }],
            max_completion_tokens: 8,
          }),
          20000,
          `${name} auth-fail path`,
        );
      } catch {
        threw = true;
      }
      assert.equal(threw, true);
    });
  }
}

await runOpenAiCompatibleCheck("Grok", loaded.grok, "GROK");
await runOpenAiCompatibleCheck("Gemini", loaded.gemini, "GEMINI");

await run("Auto memory extraction captures stable user facts", async () => {
  const nameFacts = extractAutoMemoryFacts("Call me Jack");
  assert.ok(nameFacts.some((f) => f.key === "preferred-name"));

  const timezoneFacts = extractAutoMemoryFacts("My timezone is America/New_York");
  assert.ok(timezoneFacts.some((f) => f.key === "timezone"));

  const questionFacts = extractAutoMemoryFacts("What is my timezone?");
  assert.equal(questionFacts.length, 0);
});

await run("Session/account isolation keeps per-key transcripts separated", async () => {
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
  const aSessionStorePath = path.join(tmpRoot, "user-context", "user-a", "sessions.json");
  const bSessionStorePath = path.join(tmpRoot, "user-context", "user-b", "sessions.json");
  const legacySessionStorePath = path.join(tmpRoot, "sessions.json");
  const aStore = JSON.parse(await fsp.readFile(aSessionStorePath, "utf8"));
  const bStore = JSON.parse(await fsp.readFile(bSessionStorePath, "utf8"));
  const legacyStore = JSON.parse(await fsp.readFile(legacySessionStorePath, "utf8").catch(() => "{}"));

  assert.ok(aStore[a.sessionKey], "user-a key should be in user-a scoped session store");
  assert.ok(bStore[b.sessionKey], "user-b key should be in user-b scoped session store");
  assert.equal(Boolean(legacyStore[a.sessionKey]), false, "user-a key should not remain in legacy session store");
  assert.equal(Boolean(legacyStore[b.sessionKey]), false, "user-b key should not remain in legacy session store");

  runtime.appendTranscriptTurn(a.sessionEntry.sessionId, "user", "hello-a");
  runtime.appendTranscriptTurn(b.sessionEntry.sessionId, "user", "hello-b");
  const aScopedPath = path.join(
    tmpRoot,
    "user-context",
    "user-a",
    "transcripts",
    `${a.sessionEntry.sessionId}.jsonl`,
  );
  const bScopedPath = path.join(
    tmpRoot,
    "user-context",
    "user-b",
    "transcripts",
    `${b.sessionEntry.sessionId}.jsonl`,
  );
  const aLegacyPath = path.join(tmpRoot, "transcripts", `${a.sessionEntry.sessionId}.jsonl`);
  const bLegacyPath = path.join(tmpRoot, "transcripts", `${b.sessionEntry.sessionId}.jsonl`);

  assert.equal(fs.existsSync(aScopedPath), true, "user-a transcript should be user-scoped");
  assert.equal(fs.existsSync(bScopedPath), true, "user-b transcript should be user-scoped");
  assert.equal(fs.existsSync(aLegacyPath), false, "user-a transcript should not be written to legacy global path");
  assert.equal(fs.existsSync(bLegacyPath), false, "user-b transcript should not be written to legacy global path");

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
    webSearchApiKey: String(process.env.BRAVE_API_KEY || "").trim(),
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
    webSearchApiKey: String(process.env.BRAVE_API_KEY || "").trim(),
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
