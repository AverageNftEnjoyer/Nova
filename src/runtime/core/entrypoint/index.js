// ===== Nova Runtime =====
// Runtime shell entrypoint owned by src/. This wires gateway + voice loop startup.

import path from "path";
import { fileURLToPath } from "url";
import { startMetricsBroadcast } from "../../modules/infrastructure/metrics/index.js";
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
} from "../../modules/audio/voice/index.js";
import {
  startGateway,
  stopGateway,
  broadcast,
  broadcastState,
  getVoiceRoutingUserContextId,
  registerHandleInput,
} from "../../infrastructure/hud-gateway/index.js";
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

/**
 * `startNovaRuntime` never returns under normal operation: it ends in an infinite voice loop
 * (see `startVoiceLoop`), matching its historical role as the entire lifetime of a
 * dedicated "Agent" process (see nova.js). A caller that hosts this in-process (the packaged Electron
 * main process) and needs to shut pieces down on quit cannot `await` this function's return value to
 * get a stop handle, so `onReady(handle)` is called once the gateway and the agent-task scheduler are
 * up, before the function blocks on the voice loop. This is purely additive: `onReady` is optional and
 * the dev/nova.js call site below (which awaits with no arguments) is unaffected.
 *
 * `handleInput`, when passed, replaces the chat-handler import for this process only. The packaged
 * boot smoke uses that to prove the scheduler claims a SQLite row without a live model call. It is
 * an in-process argument, not an IPC channel, and Electron main does not pass it.
 */
function delay(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function startNovaRuntime({ onReady, handleInput } = {}) {
  const abort = new AbortController();
  let stopped = false;

  initVoiceBroadcast(broadcastState, getVoiceRoutingUserContextId);

  let runtimeHandleInput = async () => "Nova runtime is starting. Chat handler unavailable.";
  if (typeof handleInput === "function") {
    runtimeHandleInput = handleInput;
  } else {
    try {
      const chatModule = await import("../../modules/chat/core/chat-handler/index.js");
      if (typeof chatModule?.handleInput === "function") {
        runtimeHandleInput = chatModule.handleInput;
      }
    } catch (err) {
      console.error(`[CoreEngine] Chat handler load failed: ${String(err?.message || err)}`);
    }
  }
  registerHandleInput(runtimeHandleInput);

  startGateway();
  let stopAgentTaskService = () => {};
  try {
    const taskModule = await import("../../modules/agent-tasks/index.js");
    if (typeof taskModule?.startAgentTaskService === "function") {
      stopAgentTaskService = taskModule.startAgentTaskService({ handleInput: runtimeHandleInput }) || (() => {});
    }
  } catch (err) {
    console.error(`[AgentTasks] Runtime service failed to start: ${String(err?.message || err)}`);
  }

  // Metrics events are intentionally global (empty userContextId) because payloads are host-level telemetry.
  const userContextId = "";
  const stopMetrics = startMetricsBroadcast(
    (payload) => broadcast(payload, { userContextId: payload?.userContextId ?? userContextId }),
    2000,
    { userContextId },
  ) || (() => {});

  const stop = () => {
    if (stopped) return;
    stopped = true;
    abort.abort();
    try {
      stopAgentTaskService();
    } catch {
      // best effort only
    }
    try {
      stopMetrics();
    } catch {
      // best effort only
    }
    try {
      stopGateway();
    } catch {
      // best effort only
    }
  };

  if (typeof onReady === "function") {
    try {
      onReady({ stop });
    } catch (err) {
      console.error(`[CoreEngine] onReady hook failed: ${String(err?.message || err)}`);
    }
  }

  sessionRuntime.ensureSessionStorePaths();
  try {
    const personaModule = await import("../../modules/context/persona-context/index.js");
    if (typeof personaModule?.logUpgradeIndexSummary === "function") personaModule.logUpgradeIndexSummary();
    if (typeof personaModule?.logAgentRuntimePreflight === "function") personaModule.logAgentRuntimePreflight();
  } catch (err) {
    console.warn(`[CoreEngine] Persona preflight skipped: ${String(err?.message || err)}`);
  }
  console.log("[CoreEngine] mode=src");

  await delay(15000, abort.signal);
  if (stopped || abort.signal.aborted) return;

  cleanupAudioArtifacts();
  console.log("Nova online.");
  const startupVoiceUserContextId = getVoiceRoutingUserContextId();
  broadcastState(
    getMuted({ userContextId: startupVoiceUserContextId }) ? "muted" : "idle",
    startupVoiceUserContextId,
  );

  await startVoiceLoop({
    abortSignal: abort.signal,
    handleInput: runtimeHandleInput,
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
