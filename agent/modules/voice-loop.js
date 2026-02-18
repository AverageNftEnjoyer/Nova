// ===== Voice Loop =====
// Wake-word gate, duplicate suppression, mic recording, and dispatch to handleInput.
// All dependencies are injected via the deps parameter from agent.js.

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
      // Skip entirely if muted — no listening, no tokens
      if (getMuted()) {
        await new Promise((r) => setTimeout(r, MIC_IDLE_DELAY_MS));
        continue;
      }

      // Skip if HUD is driving the conversation
      if (getBusy()) {
        await new Promise((r) => setTimeout(r, MIC_IDLE_DELAY_MS));
        continue;
      }

      // Prevent re-triggers from Nova hearing its own TTS playback
      if (Date.now() < getSuppressVoiceWakeUntilMs()) {
        await new Promise((r) => setTimeout(r, MIC_IDLE_DELAY_MS));
        continue;
      }

      if (getMuted()) continue;
      broadcastState("listening");

      const micCapturePath = createMicCapturePath();
      recordMic(micCapturePath, MIC_RECORD_SECONDS);

      // Re-check after blocking record (HUD message may have arrived during recording)
      if (getBusy() || getMuted()) {
        try { fs.unlinkSync(micCapturePath); } catch {}
        continue;
      }

      let text = await transcribe(micCapturePath);
      try { fs.unlinkSync(micCapturePath); } catch {}

      // One quick retry improves pickup reliability when the first clip is too short/noisy
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

      // Broadcast what was heard so the HUD can show it
      broadcast({ type: "transcript", text, ts: Date.now() });

      const normalizedHeard = wakeWordRuntime.normalizeWakeText(text);
      const now = Date.now();

      // Duplicate text suppression
      if (
        normalizedHeard &&
        normalizedHeard === lastVoiceTextHandled &&
        now - lastVoiceTextHandledAt < VOICE_DUPLICATE_TEXT_COOLDOWN_MS
      ) {
        if (!getBusy() && !getMuted()) broadcastState("idle");
        broadcast({ type: "transcript", text: "", ts: Date.now() });
        continue;
      }

      // Wake word gate
      if (!wakeWordRuntime.containsWakeWord(text)) {
        if (!getBusy() && !getMuted()) broadcastState("idle");
        continue;
      }

      // Wake cooldown
      if (now - lastWakeHandledAt < VOICE_WAKE_COOLDOWN_MS) {
        if (!getBusy() && !getMuted()) broadcastState("idle");
        continue;
      }

      // Clear transcript once we start processing
      broadcast({ type: "transcript", text: "", ts: Date.now() });

      const cleanedVoiceInput = wakeWordRuntime.stripWakePrompt(text);
      lastWakeHandledAt = now;
      lastVoiceTextHandled = normalizedHeard;
      lastVoiceTextHandledAt = now;

      if (!cleanedVoiceInput) {
        if (!getBusy() && !getMuted()) broadcastState("idle");
        continue;
      }

      // Duplicate command suppression
      if (
        cleanedVoiceInput === lastVoiceCommandHandled &&
        now - lastVoiceCommandHandledAt < VOICE_DUPLICATE_COMMAND_COOLDOWN_MS
      ) {
        if (!getBusy() && !getMuted()) broadcastState("idle");
        continue;
      }

      // Suppress wake re-triggers immediately after processing
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
