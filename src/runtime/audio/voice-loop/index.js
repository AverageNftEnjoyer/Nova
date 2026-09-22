// ===== Voice Loop =====
// Wake-word gate, duplicate suppression, mic recording, and dispatch to handleInput.
// All dependencies are injected via the deps parameter from runtime entrypoint.

import fs from "fs";
import { createFailureBackoff, VOICE_FAILURE_PAUSE_MS } from "./failure-backoff.js";

const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) {
    resolve();
    return;
  }
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

export async function startVoiceLoop(deps) {
  const {
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
  } = deps;

  const abortSignal = deps.abortSignal;
  let lastWakeHandledAt = 0;
  let lastVoiceTextHandled = "";
  let lastVoiceTextHandledAt = 0;
  let lastVoiceCommandHandled = "";
  let lastVoiceCommandHandledAt = 0;
  const failureBackoff = createFailureBackoff();
  const errorMessage = (error) => (error instanceof Error ? error.message : String(error));
  const resolveVoiceUserContextId = () => {
    if (typeof getVoiceRoutingUserContextId !== "function") return "";
    try {
      return String(getVoiceRoutingUserContextId() || "").trim();
    } catch {
      return "";
    }
  };

  while (!abortSignal?.aborted) {
    try {
      const voiceUserContextId = resolveVoiceUserContextId();
      if (!voiceUserContextId) {
        await sleep(MIC_IDLE_DELAY_MS, abortSignal);
        continue;
      }

      if (getMuted({ userContextId: voiceUserContextId })) {
        await sleep(MIC_IDLE_DELAY_MS, abortSignal);
        continue;
      }

      if (getBusy({ userContextId: voiceUserContextId })) {
        await sleep(MIC_IDLE_DELAY_MS, abortSignal);
        continue;
      }

      if (Date.now() < getSuppressVoiceWakeUntilMs({ userContextId: voiceUserContextId })) {
        await sleep(MIC_IDLE_DELAY_MS, abortSignal);
        continue;
      }
      if (getMuted({ userContextId: voiceUserContextId })) continue;
      broadcastState("listening", voiceUserContextId);

      const micCapturePath = createMicCapturePath();
      await recordMic(micCapturePath, MIC_RECORD_SECONDS);

      if (getBusy({ userContextId: voiceUserContextId }) || getMuted({ userContextId: voiceUserContextId })) {
        try { fs.unlinkSync(micCapturePath); } catch {}
        continue;
      }

      const wakeWordHint =
        typeof wakeWordRuntime?.getPrimaryWakeWord === "function"
          ? wakeWordRuntime.getPrimaryWakeWord()
          : "nova";
      let text;
      try {
        text = await transcribe(micCapturePath, wakeWordHint, voiceUserContextId);
      } finally {
        try { fs.unlinkSync(micCapturePath); } catch {}
      }
      // Capture + STT both worked: the pipeline is healthy again.
      failureBackoff.recordSuccess();

      if (!text || !text.trim()) {
        const retryPath = createMicCapturePath();
        await recordMic(retryPath, MIC_RETRY_SECONDS);
        if (getBusy({ userContextId: voiceUserContextId }) || getMuted({ userContextId: voiceUserContextId })) {
          try { fs.unlinkSync(retryPath); } catch {}
          continue;
        }
        text = await transcribe(retryPath, wakeWordHint, voiceUserContextId);
        try { fs.unlinkSync(retryPath); } catch {}
      }

      if (!text || getBusy({ userContextId: voiceUserContextId }) || getMuted({ userContextId: voiceUserContextId })) {
        if (!getBusy({ userContextId: voiceUserContextId }) && !getMuted({ userContextId: voiceUserContextId })) {
          broadcastState("idle", voiceUserContextId);
        }
        if (!getBusy({ userContextId: voiceUserContextId }) && !getMuted({ userContextId: voiceUserContextId })) {
          broadcast(
            { type: "transcript", text: "", userContextId: voiceUserContextId, ts: Date.now() },
            { userContextId: voiceUserContextId },
          );
        }
        continue;
      }

      broadcast(
        { type: "transcript", text, userContextId: voiceUserContextId, ts: Date.now() },
        { userContextId: voiceUserContextId },
      );

      const normalizedHeard = wakeWordRuntime.normalizeWakeText(text);
      const now = Date.now();

      if (
        normalizedHeard &&
        normalizedHeard === lastVoiceTextHandled &&
        now - lastVoiceTextHandledAt < VOICE_DUPLICATE_TEXT_COOLDOWN_MS
      ) {
        if (!getBusy({ userContextId: voiceUserContextId }) && !getMuted({ userContextId: voiceUserContextId })) {
          broadcastState("idle", voiceUserContextId);
        }
        broadcast(
          { type: "transcript", text: "", userContextId: voiceUserContextId, ts: Date.now() },
          { userContextId: voiceUserContextId },
        );
        continue;
      }

      if (!wakeWordRuntime.containsWakeWord(text)) {
        if (!getBusy({ userContextId: voiceUserContextId }) && !getMuted({ userContextId: voiceUserContextId })) {
          broadcastState("idle", voiceUserContextId);
        }
        continue;
      }

      if (now - lastWakeHandledAt < VOICE_WAKE_COOLDOWN_MS) {
        if (!getBusy({ userContextId: voiceUserContextId }) && !getMuted({ userContextId: voiceUserContextId })) {
          broadcastState("idle", voiceUserContextId);
        }
        continue;
      }

      broadcast(
        { type: "transcript", text: "", userContextId: voiceUserContextId, ts: Date.now() },
        { userContextId: voiceUserContextId },
      );

      const cleanedVoiceInput = wakeWordRuntime.stripWakePrompt(text);
      lastWakeHandledAt = now;
      lastVoiceTextHandled = normalizedHeard;
      lastVoiceTextHandledAt = now;

      if (!cleanedVoiceInput) {
        if (
          !getMuted({ userContextId: voiceUserContextId })
          && getVoiceEnabled({ userContextId: voiceUserContextId })
          && typeof speak === "function"
        ) {
          setBusy(true, { userContextId: voiceUserContextId });
          try {
            await speak("Yes?", getCurrentVoice({ userContextId: voiceUserContextId }), { userContextId: voiceUserContextId });
          } catch {}
          finally {
            setBusy(false, { userContextId: voiceUserContextId });
          }
        } else if (!getBusy({ userContextId: voiceUserContextId }) && !getMuted({ userContextId: voiceUserContextId })) {
          broadcastState("idle", voiceUserContextId);
        }
        continue;
      }

      if (
        cleanedVoiceInput === lastVoiceCommandHandled &&
        now - lastVoiceCommandHandledAt < VOICE_DUPLICATE_COMMAND_COOLDOWN_MS
      ) {
        if (!getBusy({ userContextId: voiceUserContextId }) && !getMuted({ userContextId: voiceUserContextId })) {
          broadcastState("idle", voiceUserContextId);
        }
        continue;
      }

      if (VOICE_AFTER_WAKE_SUPPRESS_MS > 0) {
        setSuppressVoiceWakeUntilMs(
          Math.max(
            getSuppressVoiceWakeUntilMs({ userContextId: voiceUserContextId }),
            Date.now() + VOICE_AFTER_WAKE_SUPPRESS_MS,
          ),
          { userContextId: voiceUserContextId },
        );
      }

      stopSpeaking({ userContextId: voiceUserContextId });
      console.log("Heard:", cleanedVoiceInput);
      setBusy(true, { userContextId: voiceUserContextId });
      lastVoiceCommandHandled = cleanedVoiceInput;
      lastVoiceCommandHandledAt = now;

      try {
        await handleInput(cleanedVoiceInput, {
          voice: getVoiceEnabled({ userContextId: voiceUserContextId }),
          ttsVoice: getCurrentVoice({ userContextId: voiceUserContextId }),
          source: "voice",
          sender: voiceUserContextId,
          userContextId: voiceUserContextId || undefined,
          sessionKeyHint: voiceUserContextId
            ? `agent:nova:voice:dm:${voiceUserContextId}`
            : undefined,
        });
      } finally {
        setBusy(false, { userContextId: voiceUserContextId });
      }

      if (VOICE_POST_RESPONSE_GRACE_MS > 0) {
        await sleep(VOICE_POST_RESPONSE_GRACE_MS, abortSignal);
      }
    } catch (e) {
      const failure = failureBackoff.recordFailure();
      // One concise line on the first failure; the pause notice below covers the rest (no stack spam).
      if (failure.first) console.error(`Loop error: ${errorMessage(e)}`);
      const voiceUserContextId = resolveVoiceUserContextId();
      setBusy(false, { userContextId: voiceUserContextId });
      if (!getMuted({ userContextId: voiceUserContextId })) broadcastState("idle", voiceUserContextId);

      if (failure.paused) {
        console.error(
          `[VoiceLoop] Paused after ${failure.failures} consecutive failures (last: ${errorMessage(e)}). `
          + "Toggle the mic off/on to resume, or it retries automatically in 5 minutes.",
        );
        await waitForMicToggleOrTimeout(voiceUserContextId);
        failureBackoff.reset();
      } else {
        await sleep(failure.delayMs, abortSignal);
      }
    }
  }

  // Idle until the user mutes+unmutes (fresh intent) or the pause window elapses.
  async function waitForMicToggleOrTimeout(userContextId) {
    const deadline = Date.now() + VOICE_FAILURE_PAUSE_MS;
    let sawMuted = Boolean(getMuted({ userContextId }));
    while (Date.now() < deadline && !abortSignal?.aborted) {
      await sleep(Math.max(250, Number(MIC_IDLE_DELAY_MS) || 1000), abortSignal);
      const muted = Boolean(getMuted({ userContextId }));
      if (muted) sawMuted = true;
      else if (sawMuted) return;
    }
  }
}
