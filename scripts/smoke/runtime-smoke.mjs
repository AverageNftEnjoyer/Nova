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
} from "../../agent/providers.js";
import { createSessionRuntime } from "../../agent/runtime/session.js";
import { createToolRuntime } from "../../agent/runtime/tools-runtime.js";
import { createWakeWordRuntime } from "../../agent/runtime/voice.js";

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

await run("Provider fallback order prefers claude > openai > gemini > grok", async () => {
  const runtime1 = makeRuntime({ activeProvider: "gemini", openai: true });
  const resolved1 = resolveConfiguredChatRuntime(runtime1, { strictActiveProvider: false });
  assert.equal(resolved1.provider, "openai");

  const runtime2 = makeRuntime({ activeProvider: "openai", claude: true, gemini: true, grok: true });
  runtime2.openai.connected = false;
  runtime2.openai.apiKey = "";
  const resolved2 = resolveConfiguredChatRuntime(runtime2, { strictActiveProvider: false });
  assert.equal(resolved2.provider, "claude");

  const runtime3 = makeRuntime({ activeProvider: "grok" });
  const resolved3 = resolveConfiguredChatRuntime(runtime3, { strictActiveProvider: false });
  assert.equal(resolved3.provider, "grok");
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

if (loaded.openai.connected && loaded.openai.apiKey) {
  await run("OpenAI live ping returns text", async () => {
    const client = getOpenAIClient({ apiKey: loaded.openai.apiKey, baseURL: loaded.openai.baseURL });
    const completion = await withTimeout(
      client.chat.completions.create({
        model: loaded.openai.model,
        messages: [{ role: "user", content: "Reply with: PING_OK" }],
        max_completion_tokens: 256,
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
  skip("OpenAI live ping returns text", "OpenAI is not fully configured in integrations");
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
        temperature: 0,
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
          temperature: 0,
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
          max_completion_tokens: 256,
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

  runtime.appendTranscriptTurn(a.sessionEntry.sessionId, "user", "hello-a");
  runtime.appendTranscriptTurn(b.sessionEntry.sessionId, "user", "hello-b");

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

await run("Voice wake logic gates/strips correctly", async () => {
  const wake = createWakeWordRuntime({ wakeWord: "nova", wakeWordVariants: ["nova", "nava"] });
  assert.equal(wake.containsWakeWord("hey nova what time is it"), true);
  assert.equal(wake.containsWakeWord("hello there"), false);
  assert.equal(wake.stripWakePrompt("hey nova run diagnostics"), "run diagnostics");
});

await run("Brave-only web search remains enforced (no Tavily/Serper refs)", async () => {
  const webSearchSource = await fsp.readFile(path.join(process.cwd(), "agent", "runtime", "tools-runtime.js"), "utf8");
  const missionSource = await fsp.readFile(path.join(process.cwd(), "hud", "lib", "missions", "runtime.ts"), "utf8");
  const combined = `${webSearchSource}\n${missionSource}`.toLowerCase();
  assert.equal(combined.includes("tavily"), false);
  assert.equal(combined.includes("serper"), false);
  assert.equal(combined.includes("brave"), true);
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
