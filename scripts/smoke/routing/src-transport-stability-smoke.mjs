import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

const srcHudGatewayPath = "src/runtime/infrastructure/hud-gateway.js";
const srcVoiceLoopPath = "src/runtime/audio/voice-loop.js";
const srcEntrypointPath = "src/runtime/core/entrypoint.js";
const srcChatHandlerPath = "src/runtime/modules/chat/core/chat-handler.js";
const srcExecuteChatRequestPath = "src/runtime/modules/chat/core/chat-handler/execute-chat-request.js";
const srcChatSpecialHandlersPath = "src/runtime/modules/chat/core/chat-special-handlers.js";
const srcConfigPath = "src/runtime/core/config.js";
const srcVoiceModulePath = "src/runtime/modules/audio/voice.js";
const rootLauncherPath = "nova.js";

const srcHudGateway = read(srcHudGatewayPath);
const srcVoiceLoop = read(srcVoiceLoopPath);
const srcEntrypoint = read(srcEntrypointPath);
const srcChatHandler = read(srcChatHandlerPath);
const srcExecuteChatRequest = read(srcExecuteChatRequestPath);
const srcChatSpecialHandlers = read(srcChatSpecialHandlersPath);
const srcConfig = read(srcConfigPath);
const srcVoiceModule = read(srcVoiceModulePath);
const rootLauncher = read(rootLauncherPath);
const inboundDedupeModule = await import(pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/routing/inbound-dedupe.js")).href);
const replyNormalizerModule = await import(pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/quality/reply-normalizer.js")).href);
const wakeRuntimeModule = await import(pathToFileURL(path.join(process.cwd(), "src/runtime/audio/wake-runtime-compat.js")).href);
const { shouldSkipDuplicateInbound } = inboundDedupeModule;
const { normalizeAssistantReply, normalizeAssistantSpeechText } = replyNormalizerModule;
const { createWakeWordRuntime } = wakeRuntimeModule;

await run("P14-C1 src runtime shell entrypoint wiring exists", async () => {
  assert.equal(srcEntrypoint.includes("export async function startNovaRuntime()"), true);
  assert.equal(srcEntrypoint.includes("startGateway();"), true);
  assert.equal(srcEntrypoint.includes("await startVoiceLoop({"), true);
  assert.equal(srcEntrypoint.includes("registerHandleInput(handleInput);"), true);
  assert.equal(srcEntrypoint.includes("initVoiceBroadcast(broadcastState);"), true);
});

await run("P14-C2 HUD protocol compatibility (state + stream event contracts)", async () => {
  assert.equal(srcHudGateway.includes('type: "state"'), true);
  assert.equal(srcHudGateway.includes('export function broadcastState(state, userContextId = "")'), true);
  assert.equal(srcHudGateway.includes("resolveEventUserContextId"), true);
  assert.equal(srcHudGateway.includes('type: "assistant_stream_start"'), true);
  assert.equal(srcHudGateway.includes('type: "assistant_stream_delta"'), true);
  assert.equal(srcHudGateway.includes('type: "assistant_stream_done"'), true);
  assert.equal(srcHudGateway.includes('type: "message"'), true);
  assert.equal(srcHudGateway.includes("wsByUserContext"), true);
  assert.equal(srcHudGateway.includes("normalizeConversationId"), true);
  assert.equal(srcHudGateway.includes("conversationId: normalizedConversationId"), true);
});

await run("P14-C3 Voice-loop reliability guard rails remain", async () => {
  const required = [
    "if (getMuted())",
    "if (getBusy())",
    'broadcastState("listening", voiceUserContextId)',
    "wakeWordRuntime.containsWakeWord(text)",
    "VOICE_DUPLICATE_TEXT_COOLDOWN_MS",
    "VOICE_DUPLICATE_COMMAND_COOLDOWN_MS",
    'source: "voice"',
    "sender: voiceUserContextId",
  ];
  for (const token of required) {
    assert.equal(srcVoiceLoop.includes(token), true, `missing voice-loop token: ${token}`);
  }
});

await run("P14-C4 Assistant stream framing remains unchanged", async () => {
  const streamSource = `${srcChatHandler}\n${srcExecuteChatRequest}`;
  const startIdx = streamSource.indexOf("broadcastAssistantStreamStart(");
  const doneIdx = streamSource.indexOf("broadcastAssistantStreamDone(");
  assert.equal(startIdx >= 0, true, "assistant stream start missing in src chat-handler");
  assert.equal(doneIdx > startIdx, true, "assistant stream done missing or reordered");

  assert.equal(srcVoiceLoop.includes('{ type: "transcript", text, userContextId: voiceUserContextId, ts: Date.now() }'), true);
  assert.equal(srcVoiceLoop.includes('{ type: "transcript", text: "", userContextId: voiceUserContextId, ts: Date.now() }'), true);
});

await run("Manual memory updates emit assistant stream events", async () => {
  const memoryHandlerSource = `${srcChatHandler}\n${srcChatSpecialHandlers}`;
  assert.equal(memoryHandlerSource.includes("async function handleMemoryUpdate(text, ctx)"), true);
  assert.equal(memoryHandlerSource.includes("function sendAssistantReply(reply)"), true);
  assert.equal(memoryHandlerSource.includes("broadcastAssistantStreamStart(assistantStreamId, source, undefined, conversationId, userContextId);"), true);
  assert.equal(memoryHandlerSource.includes("broadcastAssistantStreamDelta(assistantStreamId, normalized.text, source, undefined, conversationId, userContextId);"), true);
  assert.equal(memoryHandlerSource.includes("broadcastAssistantStreamDone(assistantStreamId, source, undefined, conversationId, userContextId);"), true);
});

await run("Runtime launch/import graph is src-owned", async () => {
  assert.equal(rootLauncher.includes('["src/runtime/core/entrypoint.js"]'), true);
  assert.equal(srcEntrypoint.includes("agent/"), false, "src entrypoint should not reference agent paths");
  assert.equal(srcHudGateway.includes("agent/"), false, "src hud-gateway should not reference agent paths");
  assert.equal(srcConfig.includes("agent/"), false, "src runtime config should not reference agent paths");
});

await run("P14-C5 inbound dedupe catches retried text even when message ID changes", async () => {
  const marker = `transport-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseParams = {
    text: "hello from hud",
    source: "hud",
    sender: "hud-user",
    userContextId: marker,
    sessionKey: marker,
  };

  const first = shouldSkipDuplicateInbound({ ...baseParams, inboundMessageId: "msg-1" });
  const retriedDifferentId = shouldSkipDuplicateInbound({ ...baseParams, inboundMessageId: "msg-2" });
  const otherUser = shouldSkipDuplicateInbound({ ...baseParams, userContextId: `${marker}-other`, inboundMessageId: "msg-3" });

  assert.equal(first, false, "first message should not be skipped");
  assert.equal(retriedDifferentId, true, "same text retried with a different id should be skipped");
  assert.equal(otherUser, false, "same text from another user scope must not be skipped");
});

await run("P14-C6 reply normalization keeps UI text clean and speech-safe", async () => {
  const normalized = normalizeAssistantReply("Assistant:  hello\n\n\nworld  ");
  assert.equal(normalized.skip, false);
  assert.equal(normalized.text, "hello\n\nworld");

  const silent = normalizeAssistantReply("__silent__");
  assert.equal(silent.skip, true);

  const speech = normalizeAssistantSpeechText("**Bold** [link](https://example.com) `code`");
  assert.equal(speech.includes("*"), false);
  assert.equal(speech.includes("https://"), false);
  assert.equal(speech.length > 0, true);
});

await run("P14-C7 wake word follows assistant-name updates and STT hint wiring", async () => {
  const wakeRuntime = createWakeWordRuntime({ wakeWord: "nova", wakeWordVariants: ["nova"] });
  assert.equal(wakeRuntime.containsWakeWord("hey nova status"), true);
  wakeRuntime.setAssistantName("Lana");
  assert.equal(wakeRuntime.containsWakeWord("hey lana status"), true);
  assert.equal(wakeRuntime.containsWakeWord("hey nova status"), true, "env/base wakeword should remain a fallback");
  assert.equal(wakeRuntime.stripWakePrompt("lana what's up"), "what s up");
  assert.equal(wakeRuntime.getPrimaryWakeWord(), "lana");

  assert.equal(srcChatHandler.includes("wakeWordRuntime.setAssistantName(runtimeAssistantName)"), true);
  assert.equal(srcVoiceLoop.includes("getPrimaryWakeWord"), true);
  const hasWakeHintTranscribeCall =
    srcVoiceLoop.includes("transcribe(micCapturePath, wakeWordHint)")
    || srcVoiceLoop.includes("transcribe(micCapturePath, wakeWordHint, voiceUserContextId)");
  assert.equal(hasWakeHintTranscribeCall, true);
  assert.equal(srcVoiceModule.includes("The wake word is"), true);
  assert.equal(srcVoiceModule.includes("wakeWordHint"), true);
  assert.equal(srcHudGateway.includes("wakeWordRuntime.setAssistantName"), true);
});

await run("P14-C8 voice/session paths do not hardcode local-mic fallback", async () => {
  assert.equal(srcVoiceLoop.includes('"local-mic"'), false);
  assert.equal(srcVoiceModule.includes('userContextId = "local-mic"'), false);
  assert.equal(read("src/session/key.ts").includes("local-mic"), false);
  assert.equal(read("src/session/runtime-compat.js").includes("local-mic"), false);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
