// ===== Nova Runtime =====
// Runtime shell entrypoint owned by src/. This wires gateway + voice loop startup.

import path from "path";
import { fileURLToPath } from "url";
import { startMetricsBroadcast } from "../../compat/metrics/index.js";
import { sessionRuntime, wakeWordRuntime } from "../config/index.js";
import {
  MIC_RECORD_SECONDS,
  MIC_RETRY_SECONDS,
  MIC_IDLE_DELAY_MS,
  VOICE_WAKE_COOLDOWN_MS,
  VOICE_POST_RESPONSE_GRACE_MS,
  VOICE_DUPLICATE_TEXT_COOLDOWN_MS,
  VOICE_DUPLICATE_COMMAND_COOLDOWN_MS,
  VOICE_AFTER_WAKE_SUPPRESS_MS,
} from "../constants/index.js";
import {
  initVoiceBroadcast,
  getBusy,
  setBusy,
  getMuted,
  getCurrentVoice,
  getVoiceEnabled,
  getSuppressVoiceWakeUntilMs,
  setSuppressVoiceWakeUntilMs,
  createMicCapturePath,
  cleanupAudioArtifacts,
  recordMic,
  transcribe,
  speak,
  stopSpeaking,
} from "../../compat/voice/index.js";
import {
  startGateway,
  broadcast,
  broadcastState,
  getVoiceRoutingUserContextId,
  registerHandleInput,
} from "../../infrastructure/hud-gateway/index.js";
import { handleInput } from "../../compat/chat-handler/index.js";
import { logUpgradeIndexSummary, logAgentRuntimePreflight } from "../../compat/persona-context/index.js";
import { startVoiceLoop } from "../../audio/voice-loop/index.js";
import { createRequire } from "module";

// Pre-warm the NLP spell checker so the first user message doesn't pay the load cost.
(async () => {
  try {
    const require = createRequire(import.meta.url);
    const nlp = require("../../../dist/nlp/preprocess/index.js");
    if (typeof nlp?.warmSpellChecker === "function") {
      await nlp.warmSpellChecker();
      console.log("[NLP] Spell checker warmed.");
    }
  } catch {
    // Non-fatal: spell checker will warm on first use instead
  }
})();

const __filename = fileURLToPath(import.meta.url);

export async function startNovaRuntime() {
  initVoiceBroadcast(broadcastState);
  registerHandleInput(handleInput);

  startGateway();
  // Metrics events are intentionally global (empty userContextId) because payloads are host-level telemetry.
  const userContextId = "";
  startMetricsBroadcast(
    (payload) => broadcast(payload, { userContextId: payload?.userContextId ?? userContextId }),
    2000,
    { userContextId },
  );

  sessionRuntime.ensureSessionStorePaths();
  logUpgradeIndexSummary();
  logAgentRuntimePreflight();
  console.log("[CoreEngine] mode=src");

  await new Promise((r) => setTimeout(r, 15000));
  cleanupAudioArtifacts();
  console.log("Nova online.");
  broadcastState(getMuted() ? "muted" : "idle");

  await startVoiceLoop({
    handleInput,
    wakeWordRuntime,
    broadcast,
    broadcastState,
    getBusy,
    setBusy,
    getMuted,
    getCurrentVoice,
    getVoiceEnabled,
    getVoiceRoutingUserContextId,
    getSuppressVoiceWakeUntilMs,
    setSuppressVoiceWakeUntilMs,
    createMicCapturePath,
    recordMic,
    transcribe,
    speak,
    stopSpeaking,
    MIC_RECORD_SECONDS,
    MIC_RETRY_SECONDS,
    MIC_IDLE_DELAY_MS,
    VOICE_WAKE_COOLDOWN_MS,
    VOICE_POST_RESPONSE_GRACE_MS,
    VOICE_DUPLICATE_TEXT_COOLDOWN_MS,
    VOICE_DUPLICATE_COMMAND_COOLDOWN_MS,
    VOICE_AFTER_WAKE_SUPPRESS_MS,
  });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  await startNovaRuntime();
}
