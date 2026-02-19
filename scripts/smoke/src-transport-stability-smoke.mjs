import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const srcHudGatewayPath = "src/runtime/hud-gateway.js";
const srcVoiceLoopPath = "src/runtime/voice-loop.js";
const srcEntrypointPath = "src/runtime/entrypoint.js";
const srcChatHandlerPath = "src/runtime/modules/chat-handler.js";
const srcConfigPath = "src/runtime/config.js";
const rootLauncherPath = "nova.js";

const srcHudGateway = read(srcHudGatewayPath);
const srcVoiceLoop = read(srcVoiceLoopPath);
const srcEntrypoint = read(srcEntrypointPath);
const srcChatHandler = read(srcChatHandlerPath);
const srcConfig = read(srcConfigPath);
const rootLauncher = read(rootLauncherPath);

await run("P14-C1 src runtime shell entrypoint wiring exists", async () => {
  assert.equal(srcEntrypoint.includes("export async function startNovaRuntime()"), true);
  assert.equal(srcEntrypoint.includes("startGateway();"), true);
  assert.equal(srcEntrypoint.includes("await startVoiceLoop({"), true);
  assert.equal(srcEntrypoint.includes("registerHandleInput(handleInput);"), true);
  assert.equal(srcEntrypoint.includes("initVoiceBroadcast(broadcastState);"), true);
});

await run("P14-C2 HUD protocol compatibility (state + stream event contracts)", async () => {
  assert.equal(srcHudGateway.includes('broadcast({ type: "state", state, ts: Date.now() });'), true);
  assert.equal(
    srcHudGateway.includes('broadcast({ type: "assistant_stream_start", id, source, sender, ts: Date.now() });'),
    true,
  );
  assert.equal(
    srcHudGateway.includes('broadcast({ type: "assistant_stream_delta", id, content, source, sender, ts: Date.now() });'),
    true,
  );
  assert.equal(
    srcHudGateway.includes('broadcast({ type: "assistant_stream_done", id, source, sender, ts: Date.now() });'),
    true,
  );
  assert.equal(srcHudGateway.includes('broadcast({ type: "message", role, content, source, ts: Date.now() });'), true);
});

await run("P14-C3 Voice-loop reliability guard rails remain", async () => {
  const required = [
    "if (getMuted())",
    "if (getBusy())",
    'broadcastState("listening")',
    "wakeWordRuntime.containsWakeWord(text)",
    "VOICE_DUPLICATE_TEXT_COOLDOWN_MS",
    "VOICE_DUPLICATE_COMMAND_COOLDOWN_MS",
    'source: "voice"',
    'sender: "local-mic"',
  ];
  for (const token of required) {
    assert.equal(srcVoiceLoop.includes(token), true, `missing voice-loop token: ${token}`);
  }
});

await run("P14-C4 Assistant stream framing remains unchanged", async () => {
  const startIdx = srcChatHandler.indexOf("broadcastAssistantStreamStart(");
  const doneIdx = srcChatHandler.indexOf("broadcastAssistantStreamDone(");
  assert.equal(startIdx >= 0, true, "assistant stream start missing in src chat-handler");
  assert.equal(doneIdx > startIdx, true, "assistant stream done missing or reordered");

  assert.equal(srcVoiceLoop.includes('broadcast({ type: "transcript", text, ts: Date.now() });'), true);
  assert.equal(srcVoiceLoop.includes('broadcast({ type: "transcript", text: "", ts: Date.now() });'), true);
});

await run("Manual memory updates emit assistant stream events", async () => {
  assert.equal(srcChatHandler.includes("async function handleMemoryUpdate(text, ctx)"), true);
  assert.equal(srcChatHandler.includes("function sendAssistantReply(reply)"), true);
  assert.equal(srcChatHandler.includes("broadcastAssistantStreamStart(assistantStreamId, source);"), true);
  assert.equal(srcChatHandler.includes("broadcastAssistantStreamDelta(assistantStreamId, reply, source);"), true);
  assert.equal(srcChatHandler.includes("broadcastAssistantStreamDone(assistantStreamId, source);"), true);
});

await run("Runtime launch/import graph is src-owned", async () => {
  assert.equal(rootLauncher.includes('["src/runtime/entrypoint.js"]'), true);
  assert.equal(srcEntrypoint.includes("agent/"), false, "src entrypoint should not reference agent paths");
  assert.equal(srcHudGateway.includes("agent/"), false, "src hud-gateway should not reference agent paths");
  assert.equal(srcConfig.includes("agent/"), false, "src runtime config should not reference agent paths");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
