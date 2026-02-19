// ===== Nova Runtime =====
// Runtime shell entrypoint owned by src/. This wires gateway + voice loop startup.

import path from "path";
import { fileURLToPath } from "url";
import { startMetricsBroadcast } from "../compat/metrics.js";
import { sessionRuntime, wakeWordRuntime } from "./config.js";
import {
  MIC_RECORD_SECONDS,
  MIC_RETRY_SECONDS,
  MIC_IDLE_DELAY_MS,
  VOICE_WAKE_COOLDOWN_MS,
  VOICE_POST_RESPONSE_GRACE_MS,
  VOICE_DUPLICATE_TEXT_COOLDOWN_MS,
  VOICE_DUPLICATE_COMMAND_COOLDOWN_MS,
  VOICE_AFTER_WAKE_SUPPRESS_MS,
} from "./constants.js";
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
  stopSpeaking,
} from "../compat/voice.js";
import {
  startGateway,
  broadcast,
  broadcastState,
  registerHandleInput,
} from "./hud-gateway.js";
import { handleInput } from "../compat/chat-handler.js";
import { logUpgradeIndexSummary, logAgentRuntimePreflight } from "../compat/persona-context.js";
import { startVoiceLoop } from "./voice-loop.js";

const __filename = fileURLToPath(import.meta.url);

export async function startNovaRuntime() {
  initVoiceBroadcast(broadcastState);
  registerHandleInput(handleInput);

  startGateway();
  startMetricsBroadcast(broadcast, 2000);

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
    getSuppressVoiceWakeUntilMs,
    setSuppressVoiceWakeUntilMs,
    createMicCapturePath,
    recordMic,
    transcribe,
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
