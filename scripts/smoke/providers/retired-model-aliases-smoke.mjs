/**
 * Retired model aliases smoke (token-efficiency close-out, workstream M).
 *
 *   RA-1..RA-6  src/providers/models/retired-model-aliases: retired -> replacement, current / still-served legacy /
 *               unknown unchanged, case-insensitivity, provider scoping, every replacement is a current picker model.
 *   RA-7        runtime path: a stored retired default (integration_state snapshot) and a retired agent-task model
 *               (preferredModel) resolve to current IDs, and the request a stubbed fetch / fake OpenAI client sees
 *               carries only current IDs.
 *   RA-8        HUD mission client (hud/lib/missions/llm/providers.ts through the real integrations store): a stored
 *               retired default and a retired node override reach the stubbed fetch as current IDs; the Claude
 *               request omits temperature for a 4.7+ model.
 *   RA-9        ChatKit config: a retired NOVA_CHATKIT_MODEL resolves to its replacement.
 *
 * No network: fetch is stubbed. Data lives in a throwaway NOVA_DATA_DIR (isolated-data-dir, imported first).
 */
import "../lib/isolated-data-dir.mjs"
import assert from "node:assert/strict"
import fs from "node:fs"
import Module, { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

import { getDb, nowIso } from "../../../src/db/index.js"
import {
  CLAUDE_MODEL_PRICING_USD_PER_1M,
  GEMINI_MODEL_PRICING_USD_PER_1M,
  GROK_MODEL_PRICING_USD_PER_1M,
  LEGACY_MODEL_PRICING_USD_PER_1M,
  OPENAI_MODEL_PRICING_USD_PER_1M,
} from "../../../src/providers/pricing/index.js"
import {
  RETIRED_MODEL_ALIASES,
  findRetiredModel,
  isRetiredModelId,
  listRetiredModelAliases,
  resolveCurrentModelId,
} from "../../../src/providers/models/retired-model-aliases/index.js"
import {
  claudeMessagesCreate,
  loadIntegrationsRuntime,
  resolveConfiguredChatRuntime,
  streamOpenAiChatCompletion,
} from "../../../src/providers/runtime/index.js"
import { seedRuntimeIntegrations } from "../lib/seed-runtime-integrations.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const hudRoot = path.join(repoRoot, "hud")

const results = []
async function run(name, fn) {
  try {
    await fn()
    results.push({ status: "PASS", name })
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.stack || error.message : String(error) })
  }
}

const quiet = { log: false }
const CURRENT_BY_PROVIDER = {
  openai: OPENAI_MODEL_PRICING_USD_PER_1M,
  claude: CLAUDE_MODEL_PRICING_USD_PER_1M,
  gemini: GEMINI_MODEL_PRICING_USD_PER_1M,
  grok: GROK_MODEL_PRICING_USD_PER_1M,
}

// ---------------------------------------------------------------------------
// Alias module
// ---------------------------------------------------------------------------

await run("RA-1 documented retired IDs map to their same-tier current replacement", () => {
  const expected = {
    "claude-sonnet-4-20250514": "claude-sonnet-5",
    "claude-opus-4-20250514": "claude-opus-5-5",
    "claude-opus-4-1-20250805": "claude-opus-5-5",
    "claude-3-7-sonnet-20250219": "claude-sonnet-5",
    "claude-3-5-sonnet-20241022": "claude-sonnet-5",
    "claude-3-5-haiku-20241022": "claude-haiku-4-5-20251001",
    "claude-3-haiku-20240307": "claude-haiku-4-5-20251001",
    "claude-3-opus-20240229": "claude-opus-5-5",
    "claude-3-7-sonnet-latest": "claude-sonnet-5",
    "claude-2.1": "claude-opus-5-5",
    "claude-instant-1.2": "claude-haiku-4-5-20251001",
    "grok-4-0709": "grok-4.3",
    "grok-3": "grok-4.3",
    "grok-4-1-fast-reasoning": "grok-4.3",
    "grok-code-fast-1": "grok-build-0.1",
    "gpt-4.5-preview": "gpt-5.6-sol",
    "o1-mini": "gpt-5.6-terra",
    "gemini-2.0-flash": "gemini-3.8-flash",
    "gemini-2.0-flash-lite-001": "gemini-3.1-flash-lite",
    "gemini-2.5-pro-preview-06-05": "gemini-3.1-pro-preview",
  }
  for (const [retired, replacement] of Object.entries(expected)) {
    assert.equal(resolveCurrentModelId(undefined, retired, quiet), replacement, retired)
    assert.equal(isRetiredModelId(undefined, retired), true, retired)
  }
})

await run("RA-2 current and still-served legacy models are unchanged", () => {
  const current = Object.values(CURRENT_BY_PROVIDER).flatMap((table) => Object.keys(table))
  // Deprecated-but-served (priced in LEGACY) must keep working as stored, except the xAI slugs that the provider
  // itself redirects (those are in LEGACY for billing only and are mapped on purpose).
  const redirected = new Set(RETIRED_MODEL_ALIASES.map((entry) => entry.id))
  const served = Object.keys(LEGACY_MODEL_PRICING_USD_PER_1M).filter((id) => !redirected.has(id))
  for (const id of [...current, ...served]) {
    assert.equal(resolveCurrentModelId(undefined, id, quiet), id, id)
    assert.equal(findRetiredModel(undefined, id), null, id)
  }
  for (const id of ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gemini-2.5-pro", "claude-opus-4-5-20251101", "claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"]) {
    assert.equal(resolveCurrentModelId(undefined, id, quiet), id, `${id} is still served`)
  }
})

await run("RA-3 unknown / empty / non-string values pass through (trimmed)", () => {
  assert.equal(resolveCurrentModelId("openai", "my-local-llama", quiet), "my-local-llama")
  assert.equal(resolveCurrentModelId("openai", "  gpt-5.6-terra  ", quiet), "gpt-5.6-terra")
  assert.equal(resolveCurrentModelId("openai", "", quiet), "")
  assert.equal(resolveCurrentModelId("openai", undefined, quiet), "")
  assert.equal(resolveCurrentModelId("openai", null, quiet), "")
  // claude-opus-4-5+ share the "claude-opus-4" prefix but are active: no family guessing.
  assert.equal(resolveCurrentModelId("claude", "claude-opus-4-7", quiet), "claude-opus-4-7")
})

await run("RA-4 case-insensitive, provider synonyms, provider scoping", () => {
  assert.equal(resolveCurrentModelId("claude", "Claude-Sonnet-4-20250514", quiet), "claude-sonnet-5")
  assert.equal(resolveCurrentModelId("ANTHROPIC", "CLAUDE-3-OPUS-20240229", quiet), "claude-opus-5-5")
  assert.equal(resolveCurrentModelId("xai", "GROK-4-0709", quiet), "grok-4.3")
  // A different provider's base URL may serve an ID that one provider retired: scoped lookups do not cross over.
  assert.equal(resolveCurrentModelId("openai", "grok-4-0709", quiet), "grok-4-0709")
  assert.equal(resolveCurrentModelId("grok", "claude-3-haiku-20240307", quiet), "claude-3-haiku-20240307")
})

await run("RA-5 every replacement is a current picker model of the same provider; every entry has a source", () => {
  const listing = listRetiredModelAliases()
  assert.ok(listing.length >= RETIRED_MODEL_ALIASES.length + 1)
  for (const entry of listing) {
    const table = CURRENT_BY_PROVIDER[entry.provider]
    assert.ok(table, `unknown provider ${entry.provider}`)
    assert.ok(Object.hasOwn(table, entry.replacement), `${entry.match} -> ${entry.replacement} is not a current ${entry.provider} model`)
    assert.match(entry.source, /^https:\/\/(platform\.claude\.com|developers\.openai\.com|ai\.google\.dev|docs\.x\.ai)\//)
    assert.match(entry.retired, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(entry.retired <= "2026-09-24", `${entry.match} is not retired yet (${entry.retired})`)
    assert.equal(isRetiredModelId(entry.provider, entry.replacement), false, "a replacement must never be retired itself")
  }
})

await run("RA-6 an applied alias is logged once per ID, never with log:false", () => {
  const original = console.warn
  const lines = []
  console.warn = (...args) => lines.push(args.join(" "))
  try {
    resolveCurrentModelId("claude", "claude-sonnet-4-0", quiet)
    assert.equal(lines.length, 0)
    resolveCurrentModelId("claude", "claude-sonnet-4-0")
    resolveCurrentModelId("claude", "CLAUDE-SONNET-4-0")
    resolveCurrentModelId("claude", "claude-sonnet-5")
  } finally {
    console.warn = original
  }
  assert.equal(lines.length, 1)
  assert.match(lines[0], /claude-sonnet-4-0.*claude-sonnet-5/)
})

// ---------------------------------------------------------------------------
// Runtime request path
// ---------------------------------------------------------------------------

const RUNTIME_USER = "retired-alias-runtime"

await run("RA-7 runtime: stored retired defaults and task models never reach a request", async () => {
  seedRuntimeIntegrations(RUNTIME_USER, {
    activeLlmProvider: "claude",
    openai: { connected: true, apiKey: "sk-smoke-openai", baseUrl: "", defaultModel: "o1-mini" },
    claude: { connected: true, apiKey: "sk-smoke-claude", baseUrl: "", defaultModel: "claude-sonnet-4-20250514" },
    grok: { connected: true, apiKey: "sk-smoke-grok", baseUrl: "", defaultModel: "GROK-4-0709" },
    gemini: { connected: true, apiKey: "sk-smoke-gemini", baseUrl: "", defaultModel: "gemini-2.0-flash" },
  })
  const runtime = loadIntegrationsRuntime({ userContextId: RUNTIME_USER })
  assert.equal(runtime.openai.model, "gpt-5.6-terra")
  assert.equal(runtime.claude.model, "claude-sonnet-5")
  assert.equal(runtime.grok.model, "grok-4.3")
  assert.equal(runtime.gemini.model, "gemini-3.8-flash")

  const active = resolveConfiguredChatRuntime(runtime)
  assert.equal(active.model, "claude-sonnet-5")
  // Agent task: agent_tasks.model is passed as preferredModel.
  const task = resolveConfiguredChatRuntime(runtime, { preferredProvider: "claude", preferredModel: "claude-3-opus-20240229" })
  assert.equal(task.model, "claude-opus-5-5")
  const openAiTask = resolveConfiguredChatRuntime(runtime, { preferredProvider: "openai", preferredModel: "gpt-4.1-mini" })
  assert.equal(openAiTask.model, "gpt-4.1-mini", "a still-served model stays as chosen")

  const seenModels = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    seenModels.push(JSON.parse(String(init?.body || "{}")).model)
    return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  try {
    await claudeMessagesCreate({ apiKey: task.apiKey, baseURL: task.baseURL, model: task.model, system: "s", userText: "u" })
    await claudeMessagesCreate({ apiKey: active.apiKey, baseURL: active.baseURL, model: active.model, system: "s", userText: "u" })
  } finally {
    globalThis.fetch = originalFetch
  }

  const fakeClient = {
    chat: {
      completions: {
        create: async (request) => {
          seenModels.push(request.model)
          return (async function* stream() {
            yield { choices: [{ delta: { content: "ok" } }] }
          })()
        },
      },
    },
  }
  const openAi = resolveConfiguredChatRuntime(runtime, { preferredProvider: "openai" })
  await streamOpenAiChatCompletion({ client: fakeClient, model: openAi.model, messages: [], timeoutMs: 5_000, onDelta: () => {} })

  assert.deepEqual(seenModels, ["claude-opus-5-5", "claude-sonnet-5", "gpt-5.6-terra"])
  for (const model of seenModels) assert.equal(isRetiredModelId(undefined, model), false)
})

// ---------------------------------------------------------------------------
// HUD mission client (TypeScript loaded in plain Node)
// ---------------------------------------------------------------------------

/**
 * Minimal CommonJS loader for HUD TypeScript: transpiles .ts/.tsx on require, maps "@/..." to hud/ and stubs
 * "server-only". src/ ESM modules are loaded through require(esm), so they are the SAME instances this smoke uses.
 */
function installHudTsLoader() {
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-retired-alias-stub-"))
  const serverOnlyStub = path.join(stubDir, "server-only.cjs")
  fs.writeFileSync(serverOnlyStub, "module.exports = {}\n")
  const originalResolve = Module._resolveFilename
  Module._resolveFilename = function resolveHud(request, parent, ...rest) {
    if (request === "server-only") return serverOnlyStub
    const mapped = request.startsWith("@/") ? path.join(hudRoot, request.slice(2)) : request
    return originalResolve.call(this, mapped, parent, ...rest)
  }
  const compile = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8")
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    })
    module._compile(output.outputText, filename)
  }
  Module._extensions[".ts"] = compile
  Module._extensions[".tsx"] = compile
  return createRequire(path.join(hudRoot, "loader.cjs"))
}

const HUD_USER = "retired-alias-hud"

await run("RA-8 HUD mission client: stored retired default and node override are sent as current IDs", async () => {
  getDb()
    .prepare("INSERT INTO integration_configs (user_id, config_json, updated_at) VALUES (?, ?, ?)")
    .run(
      HUD_USER,
      JSON.stringify({
        activeLlmProvider: "claude",
        claude: { connected: true, apiKey: "sk-smoke-claude", baseUrl: "https://api.anthropic.com", defaultModel: "claude-3-5-sonnet-20241022" },
        grok: { connected: true, apiKey: "sk-smoke-grok", baseUrl: "https://api.x.ai/v1", defaultModel: "grok-4-0709" },
      }),
      nowIso(),
    )
  const hudRequire = installHudTsLoader()
  const store = hudRequire("./lib/integrations/store/server-store.ts")
  const { completeWithConfiguredLlm } = hudRequire("./lib/missions/llm/providers.ts")

  const config = await store.loadIntegrationsConfig({ userId: HUD_USER })
  assert.equal(config.claude.defaultModel, "claude-sonnet-5", "the store normalises a retired stored default")
  assert.equal(config.grok.defaultModel, "grok-4.3")

  const requests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body || "{}"))
    requests.push({ url: String(url), body })
    const payload = String(url).endsWith("/v1/messages")
      ? { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }
      : { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })
  }
  try {
    const scope = { userId: HUD_USER }
    const byDefault = await completeWithConfiguredLlm("s", "u", 100, scope)
    const byOverride = await completeWithConfiguredLlm("s", "u", 100, scope, { provider: "claude", model: "claude-3-haiku-20240307" })
    const grokOverride = await completeWithConfiguredLlm("s", "u", 100, scope, { provider: "grok", model: "grok-3" })
    assert.equal(byDefault.model, "claude-sonnet-5")
    assert.equal(byOverride.model, "claude-haiku-4-5-20251001")
    assert.equal(grokOverride.model, "grok-4.3")
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.deepEqual(requests.map((request) => request.body.model), ["claude-sonnet-5", "claude-haiku-4-5-20251001", "grok-4.3"])
  assert.equal("temperature" in requests[0].body, false, "Claude 4.7+ models reject a non-default temperature")
  assert.equal(requests[1].body.temperature, 0, "Haiku 4.5 still accepts temperature 0")
})

await run("RA-9 ChatKit config resolves a retired NOVA_CHATKIT_MODEL", async () => {
  const previous = process.env.NOVA_CHATKIT_MODEL
  process.env.NOVA_CHATKIT_MODEL = "o1-preview"
  try {
    const { resolveChatKitRuntimeConfig } = await import("../../../dist/integrations/chatkit/config/index.js")
    assert.equal(resolveChatKitRuntimeConfig().model, "gpt-5.6-sol")
    process.env.NOVA_CHATKIT_MODEL = "gpt-5.6-luna"
    assert.equal(resolveChatKitRuntimeConfig().model, "gpt-5.6-luna")
  } finally {
    if (previous === undefined) delete process.env.NOVA_CHATKIT_MODEL
    else process.env.NOVA_CHATKIT_MODEL = previous
  }
})

for (const result of results) {
  console.log(`[${result.status}] ${result.name}${result.detail ? `\n${result.detail}` : ""}`)
}
const failed = results.filter((result) => result.status === "FAIL").length
console.log(`\nretired-model-aliases smoke: ${results.length - failed}/${results.length} passed`)
if (failed > 0) process.exitCode = 1
