import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-agent-task-provider-"))
process.env.NOVA_DATA_DIR = path.join(tempRoot, "data")
const { runClaudeToolLoop } = await import("../../../src/runtime/modules/chat/core/chat-handler/claude-tool-loop/index.js")
const { closeDb } = await import("../../../src/db/index.js")

const requests = []
const server = http.createServer(async (req, res) => {
  let body = ""
  for await (const chunk of req) body += chunk
  requests.push(JSON.parse(body))
  res.setHeader("content-type", "application/json")
  if (requests.length === 1) {
    res.end(JSON.stringify({
      content: [{ type: "tool_use", id: "tool-1", name: "integration_probe", input: { target: "calendar" } }],
      usage: { input_tokens: 25, output_tokens: 8 },
      stop_reason: "tool_use",
    }))
    return
  }
  res.end(JSON.stringify({
    content: [{ type: "text", text: "Calendar integration is available." }],
    usage: { input_tokens: 31, output_tokens: 9 },
    stop_reason: "end_turn",
  }))
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
if (!address || typeof address === "string") throw new Error("Mock Claude server failed to bind")

const observedToolCalls = []
const toolExecutions = []
const result = await runClaudeToolLoop({
  activeChatRuntime: {
    apiKey: "test-key",
    baseURL: `http://127.0.0.1:${address.port}`,
  },
  selectedChatModel: "claude-test",
  systemPrompt: "Execute the task.",
  historyMessages: [],
  text: "Check my calendar integration.",
  availableTools: [{
    name: "integration_probe",
    description: "Check an integration.",
    input_schema: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
    },
  }],
  runtimeTools: {
    executeToolUse: async (toolUse) => ({
      tool_use_id: toolUse.id,
      content: JSON.stringify({ ok: true, target: toolUse.input.target }),
    }),
  },
  userContextId: "provider-contract-smoke",
  conversationId: "agent-task-provider-contract",
  observedToolCalls,
  toolExecutions,
  abortSignal: new AbortController().signal,
})

assert.equal(result.reply, "Calendar integration is available.")
assert.equal(result.promptTokens, 56)
assert.equal(result.completionTokens, 17)
assert.deepEqual(observedToolCalls, ["integration_probe"])
assert.equal(toolExecutions.length, 1)
assert.equal(requests.length, 2)
assert.equal(requests[0].model, "claude-test")
assert.equal(requests[0].tools[0].name, "integration_probe")
assert.equal(requests[1].messages.at(-1).content[0].type, "tool_result")

await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
closeDb()
fs.rmSync(tempRoot, { recursive: true, force: true })
console.log("PASS Claude task provider contract: native tool_use/tool_result loop and real usage")
