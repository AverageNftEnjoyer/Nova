import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  describeUnknownError as describeCompatError,
  loadIntegrationsRuntime as loadCompatIntegrationsRuntime,
  resolveConfiguredChatRuntime as resolveCompatConfiguredChatRuntime,
} from "../../src/providers/runtime-compat.js";

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
    record("FAIL", name, describeCompatError(err));
  }
}

function skip(name, detail) {
  record("SKIP", name, detail);
}

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

function isMaxTokensLimitError(error) {
  const message = describeCompatError(error).toLowerCase();
  return message.includes("max_tokens") || message.includes("model output limit");
}

async function openAiLikePingWithRetry(params) {
  const tokenBudgets = [64, 256, 512, 1024];
  let lastError = null;
  for (const maxCompletionTokens of tokenBudgets) {
    try {
      return await openAiLikeChatCompletion({
        ...params,
        maxCompletionTokens,
      });
    } catch (error) {
      lastError = error;
      if (!isMaxTokensLimitError(error)) throw error;
    }
  }
  throw lastError || new Error("OpenAI-compatible ping failed after token budget retries.");
}

function assertOpenAiCompletionUsable(completion) {
  const text = extractOpenAiChatText(completion);
  const completionTokens = Number(completion?.usage?.completion_tokens || 0);
  const finishReason = String(completion?.choices?.[0]?.finish_reason || "");
  assert.ok(
    String(text || "").trim().length > 0 || (completionTokens > 0 && finishReason.length > 0),
  );
}

const providersModule = await import(pathToFileURL(path.join(process.cwd(), "dist", "providers", "index.js")).href);
const {
  loadIntegrationsRuntime: loadSrcIntegrationsRuntime,
  resolveConfiguredChatRuntime: resolveSrcConfiguredChatRuntime,
  openAiLikeChatCompletion,
  extractOpenAiChatText,
  claudeMessagesCreate,
} = providersModule;

await run("src/providers module loads from dist", async () => {
  assert.equal(typeof loadSrcIntegrationsRuntime, "function");
  assert.equal(typeof resolveSrcConfiguredChatRuntime, "function");
});

const legacyGlobal = loadCompatIntegrationsRuntime();
const srcGlobal = loadSrcIntegrationsRuntime({ workspaceRoot: process.cwd() });

await run("Global provider runtime parity (legacy vs src)", async () => {
  for (const provider of ["openai", "claude", "grok", "gemini"]) {
    const a = legacyGlobal[provider];
    const b = srcGlobal[provider];
    assert.equal(typeof b.connected, "boolean");
    assert.equal(typeof b.apiKey, "string");
    assert.equal(typeof b.baseURL, "string");
    assert.equal(typeof b.model, "string");
    assert.equal(Boolean(a.connected), Boolean(b.connected), `${provider}.connected mismatch`);
    assert.equal(String(a.model || ""), String(b.model || ""), `${provider}.model mismatch`);
  }
  assert.equal(legacyGlobal.activeProvider, srcGlobal.activeProvider, "activeProvider mismatch");
});

await run("Global active runtime parity (legacy vs src, strict)", async () => {
  const legacyStrict = resolveCompatConfiguredChatRuntime(legacyGlobal, { strictActiveProvider: true });
  const srcStrict = resolveSrcConfiguredChatRuntime(srcGlobal, { strictActiveProvider: true });
  assert.equal(legacyStrict.provider, srcStrict.provider);
  assert.equal(legacyStrict.model, srcStrict.model);
  assert.equal(Boolean(legacyStrict.connected), Boolean(srcStrict.connected));
  assert.equal(Boolean(legacyStrict.apiKey), Boolean(srcStrict.apiKey));
});

await run("Global active runtime parity (legacy vs src, fallback)", async () => {
  const legacyFallback = resolveCompatConfiguredChatRuntime(legacyGlobal, { strictActiveProvider: false });
  const srcFallback = resolveSrcConfiguredChatRuntime(srcGlobal, { strictActiveProvider: false });
  assert.equal(legacyFallback.provider, srcFallback.provider);
  assert.equal(Boolean(legacyFallback.connected), Boolean(srcFallback.connected));
});

if (SMOKE_USER_CONTEXT_ID) {
  const legacyScoped = loadCompatIntegrationsRuntime({ userContextId: SMOKE_USER_CONTEXT_ID });
  const srcScoped = loadSrcIntegrationsRuntime({ workspaceRoot: process.cwd(), userContextId: SMOKE_USER_CONTEXT_ID });

  await run(`Scoped provider runtime parity (${SMOKE_USER_CONTEXT_ID})`, async () => {
    for (const provider of ["openai", "claude", "grok", "gemini"]) {
      assert.equal(Boolean(legacyScoped[provider].connected), Boolean(srcScoped[provider].connected), `${provider}.connected mismatch`);
      assert.equal(String(legacyScoped[provider].model || ""), String(srcScoped[provider].model || ""), `${provider}.model mismatch`);
      assert.equal(Boolean(legacyScoped[provider].apiKey), Boolean(srcScoped[provider].apiKey), `${provider}.apiKey presence mismatch`);
    }
    assert.equal(legacyScoped.activeProvider, srcScoped.activeProvider);
  });

  const scopedActive = resolveSrcConfiguredChatRuntime(srcScoped, { strictActiveProvider: true });
  await run(`Scoped active provider shape (${SMOKE_USER_CONTEXT_ID})`, async () => {
    assert.ok(["openai", "claude", "grok", "gemini"].includes(scopedActive.provider));
    assert.equal(typeof scopedActive.baseURL, "string");
    assert.equal(typeof scopedActive.model, "string");
    assert.equal(typeof scopedActive.connected, "boolean");
  });

  if (srcScoped.openai.connected && srcScoped.openai.apiKey) {
    await run(`src OpenAI-compatible scoped live ping returns text (${SMOKE_USER_CONTEXT_ID})`, async () => {
      const completion = await openAiLikePingWithRetry({
        apiKey: srcScoped.openai.apiKey,
        baseURL: srcScoped.openai.baseURL,
        model: srcScoped.openai.model,
        messages: [{ role: "user", content: "Reply with SRC_SCOPED_OPENAI_OK" }],
        timeoutMs: 30000,
      });
      assertOpenAiCompletionUsable(completion);
    });
  } else {
    skip(`src OpenAI-compatible scoped live ping returns text (${SMOKE_USER_CONTEXT_ID})`, "OpenAI not configured in scoped runtime");
  }

  if (srcScoped.claude.connected && srcScoped.claude.apiKey) {
    await run(`src Claude scoped live ping returns text (${SMOKE_USER_CONTEXT_ID})`, async () => {
      const response = await claudeMessagesCreate({
        apiKey: srcScoped.claude.apiKey,
        baseURL: srcScoped.claude.baseURL,
        model: srcScoped.claude.model,
        system: "You are a smoke test bot.",
        userText: "Reply with SRC_SCOPED_CLAUDE_OK",
        maxTokens: 24,
        timeoutMs: 30000,
      });
      assert.ok(String(response.text || "").trim().length > 0);
    });
  } else {
    skip(`src Claude scoped live ping returns text (${SMOKE_USER_CONTEXT_ID})`, "Claude not configured in scoped runtime");
  }

  if (srcScoped.grok.connected && srcScoped.grok.apiKey) {
    await run(`src Grok scoped live ping returns response shape (${SMOKE_USER_CONTEXT_ID})`, async () => {
      const completion = await openAiLikeChatCompletion({
        apiKey: srcScoped.grok.apiKey,
        baseURL: srcScoped.grok.baseURL,
        model: srcScoped.grok.model,
        messages: [{ role: "user", content: "Reply with SRC_SCOPED_GROK_OK" }],
        maxCompletionTokens: 64,
        timeoutMs: 30000,
      });
      assert.ok(Array.isArray(completion?.choices));
      assert.ok((completion?.choices || []).length > 0);
    });
  } else {
    skip(`src Grok scoped live ping returns response shape (${SMOKE_USER_CONTEXT_ID})`, "Grok not configured in scoped runtime");
  }

  if (srcScoped.gemini.connected && srcScoped.gemini.apiKey) {
    await run(`src Gemini scoped live ping returns response shape (${SMOKE_USER_CONTEXT_ID})`, async () => {
      const completion = await openAiLikeChatCompletion({
        apiKey: srcScoped.gemini.apiKey,
        baseURL: srcScoped.gemini.baseURL,
        model: srcScoped.gemini.model,
        messages: [{ role: "user", content: "Reply with SRC_SCOPED_GEMINI_OK" }],
        maxCompletionTokens: 64,
        timeoutMs: 30000,
      });
      assert.ok(Array.isArray(completion?.choices));
      assert.ok((completion?.choices || []).length > 0);
    });
  } else {
    skip(`src Gemini scoped live ping returns response shape (${SMOKE_USER_CONTEXT_ID})`, "Gemini not configured in scoped runtime");
  }
} else {
  skip("Scoped provider runtime parity", "Set NOVA_SMOKE_USER_CONTEXT_ID to enable.");
}

if (srcGlobal.openai.connected && srcGlobal.openai.apiKey) {
  await run("src OpenAI-compatible live ping returns text", async () => {
    const completion = await openAiLikePingWithRetry({
      apiKey: srcGlobal.openai.apiKey,
      baseURL: srcGlobal.openai.baseURL,
      model: srcGlobal.openai.model,
      messages: [{ role: "user", content: "Reply with SRC_OPENAI_OK" }],
      timeoutMs: 30000,
    });
    assertOpenAiCompletionUsable(completion);
  });
} else {
  skip("src OpenAI-compatible live ping returns text", "OpenAI not configured in global runtime");
}

if (srcGlobal.claude.connected && srcGlobal.claude.apiKey) {
  await run("src Claude live ping returns text", async () => {
    const response = await claudeMessagesCreate({
      apiKey: srcGlobal.claude.apiKey,
      baseURL: srcGlobal.claude.baseURL,
      model: srcGlobal.claude.model,
      system: "You are a smoke test bot.",
      userText: "Reply with SRC_CLAUDE_OK",
      maxTokens: 24,
      timeoutMs: 30000,
    });
    assert.ok(String(response.text || "").trim().length > 0);
  });
} else {
  skip("src Claude live ping returns text", "Claude not configured in global runtime");
}

async function runOpenAiCompatibleShape(name, runtime) {
  if (runtime.connected && runtime.apiKey) {
    await run(`src ${name} live ping returns response shape`, async () => {
      const completion = await openAiLikeChatCompletion({
        apiKey: runtime.apiKey,
        baseURL: runtime.baseURL,
        model: runtime.model,
        messages: [{ role: "user", content: `Reply with SRC_${name.toUpperCase()}_OK` }],
        maxCompletionTokens: 64,
        timeoutMs: 30000,
      });
      assert.ok(Array.isArray(completion?.choices));
      assert.ok((completion?.choices || []).length > 0);
    });
  } else {
    skip(`src ${name} live ping returns response shape`, `${name} not configured in global runtime`);
  }
}

await runOpenAiCompatibleShape("Grok", srcGlobal.grok);
await runOpenAiCompatibleShape("Gemini", srcGlobal.gemini);

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
