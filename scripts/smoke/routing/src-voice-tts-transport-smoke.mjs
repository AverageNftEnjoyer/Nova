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

const voiceModule = read("src/runtime/modules/audio/voice/index.js");
const voiceLoop = read("src/runtime/audio/voice-loop/index.js");
const entrypoint = read("src/runtime/core/entrypoint/index.js");
const dispatchInput = read("src/runtime/modules/chat/core/chat-handler/operator-dispatch-input/index.js");
const dispatchRouting = read("src/runtime/modules/chat/core/chat-handler/operator-dispatch-routing/index.js");
const workerExecutors = read("src/runtime/modules/chat/core/chat-handler/operator-worker-executors/index.js");
const chatHandler = read("src/runtime/modules/chat/core/chat-handler/index.js");

await run("VT-C1 shared voice runtime resolves a scoped user context before emitting state", async () => {
  assert.equal(voiceModule.includes("const _voiceRuntimeStateByUser = new Map();"), true);
  assert.equal(voiceModule.includes("const _voiceRuntimeContext = new AsyncLocalStorage();"), true);
  assert.equal(voiceModule.includes("function resolveVoiceEventUserContextId(options = {})"), true);
  assert.equal(voiceModule.includes("export function withVoiceRuntimeContext(userContextId = \"\", fn)"), true);
  assert.equal(voiceModule.includes('_broadcastState("speaking", eventUserContextId);'), true);
  assert.equal(voiceModule.includes('_broadcastState("idle", resolveVoiceEventUserContextId(options));'), true);
});

await run("VT-C2 entrypoint and voice loop no longer emit unscoped voice state transitions", async () => {
  assert.equal(entrypoint.includes("initVoiceBroadcast(broadcastState, getVoiceRoutingUserContextId);"), true);
  assert.equal(entrypoint.includes("const startupVoiceUserContextId = getVoiceRoutingUserContextId();"), true);
  assert.equal(voiceLoop.includes('broadcastState("idle");'), false);
  assert.equal(voiceLoop.includes('stopSpeaking({ userContextId: voiceUserContextId });'), true);
  assert.equal(voiceLoop.includes("getVoiceEnabled({ userContextId: voiceUserContextId })"), true);
});

await run("VT-C3 handleInput can inject dedicated voice and tts workers through operator dispatch", async () => {
  for (const token of [
    "voiceWorker,",
    "ttsWorker,",
  ]) {
    assert.equal(dispatchInput.includes(token), true, `dispatch input missing token: ${token}`);
    assert.equal(dispatchRouting.includes(token), true, `dispatch routing missing token: ${token}`);
    assert.equal(workerExecutors.includes(token), true, `worker executors missing token: ${token}`);
  }
  assert.equal(chatHandler.includes("voiceWorker: typeof opts.voiceWorker === \"function\" ? opts.voiceWorker : undefined,"), true);
  assert.equal(chatHandler.includes("ttsWorker: typeof opts.ttsWorker === \"function\" ? opts.ttsWorker : undefined,"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
