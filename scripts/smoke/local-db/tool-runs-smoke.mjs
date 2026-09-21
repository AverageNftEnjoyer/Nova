/**
 * tool_runs audit trail: the live tool loop records every tool invocation, with redaction and a 2KB cap, and a
 * failing/unavailable database can never break the loop.
 * Runs entirely against a throwaway NOVA_DATA_DIR (scripts/smoke/lib/isolated-data-dir.mjs).
 */
import "../lib/isolated-data-dir.mjs" // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict"

import { closeDb, getDb } from "../../../src/db/index.js"
import { runToolLoop } from "../../../src/runtime/modules/chat/core/chat-handler/tool-loop-runner/index.js"
import {
  TOOL_LOOP_RUN_MAX_CHARS,
  listToolRuns,
  recordToolRun,
  recordToolRunSafe,
} from "../../../src/session/sqlite-store/index.js"

const results = []
async function run(name, fn) {
  try {
    await fn()
    results.push({ status: "PASS", name })
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.stack || error.message : String(error) })
  }
}

const FAKE_OPENAI_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"
const FAKE_BEARER = "Bearer BEARERMARKzzzzzzzzzzzzzzzzzzzzzz"
const FAKE_TG_TOKEN = "123456789:AAEabcdefghijklmnopqrstuvwxyz012345"

function rawRows(userId) {
  return getDb().prepare("SELECT * FROM tool_runs WHERE user_id = ? ORDER BY created_at").all(userId)
}

await run("recordToolRunSafe redacts key-named fields and inline secrets in input and output", () => {
  const user = "u-redact"
  const id = recordToolRunSafe(user, {
    threadId: "t1",
    toolName: "web_fetch",
    input: { url: "https://example.com", apiKey: FAKE_OPENAI_KEY, headers: { Authorization: FAKE_BEARER }, note: `use ${FAKE_TG_TOKEN}` },
    // Tool results arrive as serialized JSON strings: key-based redaction must apply to those too.
    output: JSON.stringify({ ok: true, access_token: "ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxxxxxxxxxx", body: `key=${FAKE_OPENAI_KEY}` }),
    status: "success",
    latencyMs: 12,
  })
  assert.ok(id, "row id returned")
  const [row] = rawRows(user)
  const blob = `${row.input_json}${row.output_json}`
  for (const secret of [FAKE_OPENAI_KEY, "BEARERMARK", FAKE_TG_TOKEN, "ya29.a0AfH6SMB"]) {
    assert.ok(!blob.includes(secret), `secret leaked into tool_runs: ${secret}`)
  }
  assert.ok(blob.includes("[redacted]"), "redaction marker expected")
  assert.equal(JSON.parse(row.input_json).url, "https://example.com", "non-secret fields survive")
  const listed = listToolRuns(user, "t1")
  assert.equal(listed.length, 1)
  assert.equal(listed[0].toolName, "web_fetch")
  assert.equal(listed[0].latencyMs, 12)
})

await run("recordToolRunSafe caps input/output at 2KB and keeps valid JSON", () => {
  const user = "u-cap"
  recordToolRunSafe(user, {
    threadId: "t1",
    toolName: "web_fetch",
    input: { text: "x".repeat(50_000) },
    output: "y".repeat(50_000),
  })
  const [row] = rawRows(user)
  assert.ok(row.input_json.length <= TOOL_LOOP_RUN_MAX_CHARS, `input_json ${row.input_json.length} > cap`)
  assert.ok(row.output_json.length <= TOOL_LOOP_RUN_MAX_CHARS, `output_json ${row.output_json.length} > cap`)
  assert.equal(JSON.parse(row.input_json).truncated, true)
  assert.equal(JSON.parse(row.output_json).truncated, true)
  // A secret sitting past the truncation point can never leak through the preview either.
  recordToolRunSafe(user, { toolName: "t", input: { blob: `${"a".repeat(100)} ${FAKE_OPENAI_KEY}` }, output: "" })
  assert.ok(!rawRows(user).some((r) => r.input_json.includes(FAKE_OPENAI_KEY)))
})

await run("recordToolRunSafe never throws (bad input, circular data, missing user/tool)", () => {
  const circular = {}
  circular.self = circular
  assert.doesNotThrow(() => recordToolRunSafe("u-safe", { toolName: "x", input: circular, output: circular }))
  assert.equal(recordToolRunSafe("", { toolName: "x" }), null)
  assert.equal(recordToolRunSafe("u-safe", { toolName: "" }), null)
  assert.equal(recordToolRunSafe("u-safe", undefined), null)
  assert.equal(recordToolRunSafe(undefined, { toolName: "x" }), null)
})

await run("recordToolRunSafe swallows database failures", () => {
  const user = "u-dbfail"
  const db = getDb()
  db.exec("ALTER TABLE tool_runs RENAME TO tool_runs_hidden")
  try {
    assert.doesNotThrow(() => assert.equal(recordToolRunSafe(user, { toolName: "x", input: {}, output: {} }), null))
  } finally {
    db.exec("ALTER TABLE tool_runs_hidden RENAME TO tool_runs")
  }
})

await run("recordToolRun keeps its own (larger) default cap and valid JSON when truncating", () => {
  const user = "u-default-cap"
  recordToolRun(user, { toolName: "big", input: { text: "z".repeat(200_000) }, output: { ok: true } })
  const [row] = rawRows(user)
  assert.ok(row.input_json.length <= 64 * 1024)
  assert.equal(JSON.parse(row.input_json).truncated, true)
  assert.deepEqual(JSON.parse(row.output_json), { ok: true })
})

await run("runToolLoop records each tool call (success, error, redaction) without disturbing the loop", async () => {
  const user = "u-loop"
  const conversationId = "conv-loop-1"
  let completions = 0
  const client = {
    chat: {
      completions: {
        create: async () => {
          completions += 1
          if (completions === 1) {
            return {
              usage: {},
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      { id: "call-1", type: "function", function: { name: "lookup_thing", arguments: JSON.stringify({ q: "hello", apiKey: FAKE_OPENAI_KEY }) } },
                      { id: "call-2", type: "function", function: { name: "explode", arguments: "{}" } },
                    ],
                  },
                },
              ],
            }
          }
          return { usage: {}, choices: [{ message: { content: "all done", tool_calls: [] } }] }
        },
      },
    },
  }
  const runtimeTools = {
    async executeToolUse(toolUse) {
      if (toolUse.name === "explode") throw new Error(`boom with ${FAKE_OPENAI_KEY}`)
      return { tool_use_id: toolUse.id, content: JSON.stringify({ ok: true, token: "supersecretvalue123", data: "fine" }) }
    },
  }
  const toolRuntime = {
    toOpenAiToolUseBlock: (call) => ({ id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments || "{}") }),
  }
  const toolExecutions = []
  const out = await runToolLoop({
    activeOpenAiCompatibleClient: client,
    modelUsed: "test-model",
    messages: [{ role: "user", content: "hi" }],
    openAiToolDefs: [],
    openAiMaxCompletionTokens: 64,
    openAiRequestTuningForModel: () => ({}),
    runtimeTools,
    toolRuntime,
    availableTools: [],
    assistantStreamId: "s1",
    source: "smoke",
    conversationId,
    userContextId: user,
    hudOpToken: "",
    sessionKey: "sess",
    text: "hi",
    latencyTelemetry: { incrementCounter() {} },
    observedToolCalls: [],
    toolExecutions,
    retries: 0,
    markRecovery() {},
  })
  assert.equal(out.reply, "all done", "loop still completes normally")
  const rows = listToolRuns(user, conversationId)
  const byName = Object.fromEntries(rows.map((r) => [r.toolName, r]))
  assert.equal(Object.keys(byName).length, 2, `expected two recorded tool runs, got ${JSON.stringify(rows.map((r) => r.toolName))}`)
  assert.equal(byName.lookup_thing.status, "success")
  assert.equal(byName.explode.status, "error")
  const stored = rawRows(user).map((r) => `${r.input_json}${r.output_json}`).join("\n")
  assert.ok(!stored.includes(FAKE_OPENAI_KEY), "api key from tool arguments/errors must be redacted")
  assert.ok(!stored.includes("supersecretvalue123"), "token from tool result must be redacted")
  assert.ok(stored.includes("fine"), "non-secret result data is kept")
})

await run("runToolLoop keeps working when tool_runs is unavailable", async () => {
  const db = getDb()
  db.exec("ALTER TABLE tool_runs RENAME TO tool_runs_hidden")
  try {
    let completions = 0
    const client = {
      chat: {
        completions: {
          create: async () => {
            completions += 1
            return completions === 1
              ? { usage: {}, choices: [{ message: { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "t", arguments: "{}" } }] } }] }
              : { usage: {}, choices: [{ message: { content: "still fine", tool_calls: [] } }] }
          },
        },
      },
    }
    const out = await runToolLoop({
      activeOpenAiCompatibleClient: client,
      modelUsed: "m",
      messages: [{ role: "user", content: "hi" }],
      openAiToolDefs: [],
      openAiMaxCompletionTokens: 64,
      openAiRequestTuningForModel: () => ({}),
      runtimeTools: { executeToolUse: async (u) => ({ tool_use_id: u.id, content: "ok" }) },
      toolRuntime: { toOpenAiToolUseBlock: (c) => ({ id: c.id, name: c.function.name, input: {} }) },
      availableTools: [],
      assistantStreamId: "s2",
      source: "smoke",
      conversationId: "conv-x",
      userContextId: "u-loop-2",
      hudOpToken: "",
      sessionKey: "sess",
      text: "hi",
      latencyTelemetry: { incrementCounter() {} },
      observedToolCalls: [],
      toolExecutions: [],
      retries: 0,
      markRecovery() {},
    })
    assert.equal(out.reply, "still fine")
  } finally {
    db.exec("ALTER TABLE tool_runs_hidden RENAME TO tool_runs")
  }
})

await run("per-user pruning keeps the newest rows only", () => {
  const user = "u-prune"
  const db = getDb()
  const insert = db.prepare(
    "INSERT INTO tool_runs (user_id, id, thread_id, tool_name, input_json, output_json, status, latency_ms, created_at) VALUES (?, ?, NULL, 'seed', '{}', '{}', 'success', 1, ?)",
  )
  db.transaction(() => {
    for (let i = 0; i < 5100; i += 1) insert.run(user, `seed-${i}`, new Date(1_700_000_000_000 + i * 1000).toISOString())
  })()
  // pruning runs every 100th write in this process; force it deterministically
  for (let i = 0; i < 100; i += 1) recordToolRunSafe(user, { toolName: "fresh", input: {}, output: {} })
  const count = db.prepare("SELECT COUNT(*) AS n FROM tool_runs WHERE user_id = ?").get(user).n
  assert.ok(count <= 5000 + 100, `expected pruning to trim the table, got ${count}`)
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM tool_runs WHERE user_id = ? AND tool_name = 'fresh'").get(user).n > 0)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tool_runs WHERE user_id = ? AND id = 'seed-0'").get(user).n, 0, "oldest row pruned")
})

closeDb()
let failed = 0
for (const r of results) {
  console.log(`${r.status} ${r.name}${r.detail ? `\n${r.detail}` : ""}`)
  if (r.status === "FAIL") failed += 1
}
console.log(`Summary: pass=${results.length - failed} fail=${failed}`)
process.exit(failed ? 1 : 0)
