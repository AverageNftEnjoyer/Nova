// ===== Voice Loop =====
// Wake-word gate, duplicate suppression, mic recording, and dispatch to handleInput.
// All dependencies are injected via the deps parameter from runtime entrypoint.

import fs from "fs";

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
  } = deps;

  let lastWakeHandledAt = 0;
  let lastVoiceTextHandled = "";
  let lastVoiceTextHandledAt = 0;
  let lastVoiceCommandHandled = "";
  let lastVoiceCommandHandledAt = 0;

  while (true) {
    try {
      if (getMuted()) {
        await new Promise((r) => setTimeout(r, MIC_IDLE_DELAY_MS));
        continue;
      }

      if (getBusy()) {
        await new Promise((r) => setTimeout(r, MIC_IDLE_DELAY_MS));
        continue;
      }

      if (Date.now() < getSuppressVoiceWakeUntilMs()) {
        await new Promise((r) => setTimeout(r, MIC_IDLE_DELAY_MS));
        continue;
      }

      if (getMuted()) continue;
      broadcastState("listening");

      const micCapturePath = createMicCapturePath();
      recordMic(micCapturePath, MIC_RECORD_SECONDS);

      if (getBusy() || getMuted()) {
        try { fs.unlinkSync(micCapturePath); } catch {}
        continue;
      }

      let text = await transcribe(micCapturePath);
      try { fs.unlinkSync(micCapturePath); } catch {}

      if (!text || !text.trim()) {
        const retryPath = createMicCapturePath();
        recordMic(retryPath, MIC_RETRY_SECONDS);
        if (getBusy() || getMuted()) {
          try { fs.unlinkSync(retryPath); } catch {}
          continue;
        }
        text = await transcribe(retryPath);
        try { fs.unlinkSync(retryPath); } catch {}
      }

      if (!text || getBusy() || getMuted()) {
        if (!getBusy() && !getMuted()) broadcastState("idle");
        if (!getBusy() && !getMuted()) broadcast({ type: "transcript", text: "", ts: Date.now() });
        continue;
      }

      broadcast({ type: "transcript", text, ts: Date.now() });

      const normalizedHeard = wakeWordRuntime.normalizeWakeText(text);
      const now = Date.now();

      if (
        normalizedHeard &&
        normalizedHeard === lastVoiceTextHandled &&
        now - lastVoiceTextHandledAt < VOICE_DUPLICATE_TEXT_COOLDOWN_MS
      ) {
        if (!getBusy() && !getMuted()) broadcastState("idle");
        broadcast({ type: "transcript", text: "", ts: Date.now() });
        continue;
      }

      if (!wakeWordRuntime.containsWakeWord(text)) {
        if (!getBusy() && !getMuted()) broadcastState("idle");
        continue;
      }

      if (now - lastWakeHandledAt < VOICE_WAKE_COOLDOWN_MS) {
        if (!getBusy() && !getMuted()) broadcastState("idle");
        continue;
      }

      broadcast({ type: "transcript", text: "", ts: Date.now() });

      const cleanedVoiceInput = wakeWordRuntime.stripWakePrompt(text);
      lastWakeHandledAt = now;
      lastVoiceTextHandled = normalizedHeard;
      lastVoiceTextHandledAt = now;

      if (!cleanedVoiceInput) {
        if (!getBusy() && !getMuted()) broadcastState("idle");
        continue;
      }

      if (
        cleanedVoiceInput === lastVoiceCommandHandled &&
        now - lastVoiceCommandHandledAt < VOICE_DUPLICATE_COMMAND_COOLDOWN_MS
      ) {
        if (!getBusy() && !getMuted()) broadcastState("idle");
        continue;
      }

      if (VOICE_AFTER_WAKE_SUPPRESS_MS > 0) {
        setSuppressVoiceWakeUntilMs(Math.max(getSuppressVoiceWakeUntilMs(), Date.now() + VOICE_AFTER_WAKE_SUPPRESS_MS));
      }

      stopSpeaking();
      console.log("Heard:", cleanedVoiceInput);
      setBusy(true);
      lastVoiceCommandHandled = cleanedVoiceInput;
      lastVoiceCommandHandledAt = now;

      try {
        await handleInput(cleanedVoiceInput, {
          voice: getVoiceEnabled(),
          ttsVoice: getCurrentVoice(),
          source: "voice",
          sender: "local-mic",
        });
      } finally {
        setBusy(false);
      }

      if (VOICE_POST_RESPONSE_GRACE_MS > 0) {
        await new Promise((r) => setTimeout(r, VOICE_POST_RESPONSE_GRACE_MS));
      }
    } catch (e) {
      console.error("Loop error:", e);
      setBusy(false);
      if (!getMuted()) broadcastState("idle");
    }
  }
}
