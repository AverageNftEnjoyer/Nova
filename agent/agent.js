// ===== Nova Agent — Entry Point =====
// Thin orchestrator: wires modules together, runs startup, starts voice loop.

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { startMetricsBroadcast } from "./modules/metrics.js";

// Runtime singletons
import { sessionRuntime, wakeWordRuntime } from "./modules/config.js";

// Constants needed at orchestration level
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

// Voice state accessors & audio functions
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
} from "./modules/voice.js";

// HUD gateway
import {
  startGateway,
  broadcast,
  broadcastState,
  registerHandleInput,
} from "./modules/hud-gateway.js";

// Chat handler
import { handleInput } from "./modules/chat-handler.js";

// Preflight diagnostics
import { logUpgradeIndexSummary, logAgentRuntimePreflight } from "./modules/persona-context.js";

// Voice loop
import { startVoiceLoop } from "./modules/voice-loop.js";

// ===== Load .env =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// ===== Resolve circular dependencies =====
initVoiceBroadcast(broadcastState);   // voice.js can now call broadcastState
registerHandleInput(handleInput);      // hud-gateway.js can now call handleInput

// ===== Startup =====
startGateway();
startMetricsBroadcast(broadcast, 2000);

sessionRuntime.ensureSessionStorePaths();
logUpgradeIndexSummary();
logAgentRuntimePreflight();

// Startup delay — give the HUD time to connect before broadcasting ready state
await new Promise((r) => setTimeout(r, 15000));
cleanupAudioArtifacts();
console.log("Nova online.");
broadcastState(getMuted() ? "muted" : "idle");

// ===== Voice loop (runs forever) =====
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
