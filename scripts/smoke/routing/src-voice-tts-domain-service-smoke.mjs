import assert from "node:assert/strict";

import { runVoiceDomainService } from "../../../src/runtime/modules/services/voice/index.js";
import { runTtsDomainService } from "../../../src/runtime/modules/services/tts/index.js";

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

await run("VOICE-TTS-DOMAIN-1 voice commands update scoped state without generic delegation", async () => {
  let genericCalled = false;
  let syncCalls = [];
  let persistedState = {
    userContextId: "voice-user",
    ttsVoice: "default",
    voiceEnabled: false,
    muted: false,
    assistantName: "",
  };
  const providerAdapter = {
    id: "voice-test-adapter",
    getScopedState: () => ({ ...persistedState }),
    updateUserState: ({ patch = {}, broadcastRuntimeState = false }) => {
      persistedState = { ...persistedState, ...patch };
      syncCalls.push({ patch: { ...patch }, broadcastRuntimeState });
      return { ...persistedState };
    },
  };
  const ctx = {
    userContextId: "voice-user",
    conversationId: "voice-thread",
    sessionKey: "agent:nova:hud:user:voice-user:dm:voice-thread",
  };

  const out = await runVoiceDomainService(
    {
      text: "mute voice",
      ctx,
      requestHints: { testHint: true },
      executeChatRequest: async () => {
        genericCalled = true;
        return { ok: true, route: "chat", responseRoute: "chat", reply: "fallback" };
      },
    },
    { providerAdapter },
  );

  assert.equal(out.ok, true);
  assert.equal(out.route, "voice");
  assert.equal(out.responseRoute, "voice");
  assert.equal(out.reply.includes("muted"), true);
  assert.equal(genericCalled, false);
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0]?.patch?.muted, true);
  assert.equal(syncCalls[0]?.broadcastRuntimeState, true);
  assert.equal(String(out.telemetry?.userContextId || ""), "voice-user");
  assert.equal(String(out.telemetry?.adapterId || ""), "voice-test-adapter");
});

await run("VOICE-TTS-DOMAIN-2 tts commands set voice and speak without generic delegation", async () => {
  let genericCalled = false;
  let spoke = null;
  let stopped = false;
  let persistedState = {
    userContextId: "tts-user",
    ttsVoice: "default",
    voiceEnabled: true,
    muted: false,
    assistantName: "",
  };
  const providerAdapter = {
    id: "tts-test-adapter",
    getScopedState: () => ({ ...persistedState }),
    updateVoiceState: ({ patch = {} }) => {
      persistedState = { ...persistedState, ...patch };
      return { ...persistedState };
    },
    async speakText({ userContextId, text, ttsVoice }) {
      spoke = { userContextId, text, ttsVoice };
      persistedState = { ...persistedState, ttsVoice };
      return { ...persistedState };
    },
    stopSpeaking() {
      stopped = true;
    },
  };
  const ctx = {
    userContextId: "tts-user",
    conversationId: "tts-thread",
    sessionKey: "agent:nova:hud:user:tts-user:dm:tts-thread",
  };

  const setVoice = await runTtsDomainService(
    {
      text: "set tts voice to peter",
      ctx,
      executeChatRequest: async () => {
        genericCalled = true;
        return { ok: true, route: "chat", responseRoute: "chat", reply: "fallback" };
      },
    },
    { providerAdapter },
  );
  const readAloud = await runTtsDomainService(
    {
      text: "read this aloud: Ship the scoped audio fix",
      ctx,
      executeChatRequest: async () => {
        genericCalled = true;
        return { ok: true, route: "chat", responseRoute: "chat", reply: "fallback" };
      },
    },
    { providerAdapter },
  );
  const stop = await runTtsDomainService(
    {
      text: "stop tts",
      ctx,
      executeChatRequest: async () => {
        genericCalled = true;
        return { ok: true, route: "chat", responseRoute: "chat", reply: "fallback" };
      },
    },
    { providerAdapter },
  );

  assert.equal(setVoice.ok, true);
  assert.equal(setVoice.reply.includes("peter"), true);
  assert.equal(readAloud.ok, true);
  assert.equal(readAloud.reply.includes("Reading aloud"), true);
  assert.deepEqual(spoke, {
    userContextId: "tts-user",
    text: "Ship the scoped audio fix",
    ttsVoice: "peter",
  });
  assert.equal(stop.ok, true);
  assert.equal(stopped, true);
  assert.equal(genericCalled, false);
  assert.equal(String(readAloud.telemetry?.adapterId || ""), "tts-test-adapter");
});

await run("VOICE-TTS-DOMAIN-3 unsupported voice and tts prompts stay on-lane without generic fallback", async () => {
  let genericCalled = false;
  const executeChatRequest = async () => {
    genericCalled = true;
    return { ok: true, route: "chat", responseRoute: "chat", reply: "fallback" };
  };
  const ctx = {
    userContextId: "lane-user",
    conversationId: "lane-thread",
    sessionKey: "agent:nova:hud:user:lane-user:dm:lane-thread",
  };
  const voiceProviderAdapter = {
    id: "voice-unsupported-adapter",
    getScopedState: () => ({
      userContextId: "lane-user",
      ttsVoice: "default",
      voiceEnabled: false,
      muted: true,
      assistantName: "",
    }),
  };
  const ttsProviderAdapter = {
    id: "tts-unsupported-adapter",
    getScopedState: () => ({
      userContextId: "lane-user",
      ttsVoice: "default",
      voiceEnabled: false,
      muted: true,
      assistantName: "",
    }),
  };

  const voice = await runVoiceDomainService(
    { text: "tell me a joke", ctx, executeChatRequest },
    { providerAdapter: voiceProviderAdapter },
  );
  const tts = await runTtsDomainService(
    { text: "tell me a joke", ctx, executeChatRequest },
    { providerAdapter: ttsProviderAdapter },
  );

  assert.equal(voice.ok, true);
  assert.equal(voice.route, "voice");
  assert.equal(voice.responseRoute, "voice");
  assert.equal(String(voice.code || ""), "voice.unsupported_command");
  assert.equal(voice.reply.includes("Voice can"), true);
  assert.equal(tts.ok, true);
  assert.equal(tts.route, "tts");
  assert.equal(tts.responseRoute, "tts");
  assert.equal(String(tts.code || ""), "tts.unsupported_command");
  assert.equal(tts.reply.includes("TTS can"), true);
  assert.equal(genericCalled, false);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
