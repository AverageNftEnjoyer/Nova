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

  let lastWakeHandledAt = 0;
  let lastVoiceTextHandled = "";
  let lastVoiceTextHandledAt = 0;
  let lastVoiceCommandHandled = "";
  let lastVoiceCommandHandledAt = 0;
  const resolveVoiceUserContextId = () => {
    if (typeof getVoiceRoutingUserContextId !== "function") return "";
    try {
      return String(getVoiceRoutingUserContextId() || "").trim();
    } catch {
      return "";
    }
  };

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
      const voiceUserContextId = resolveVoiceUserContextId();
      if (!voiceUserContextId) {
        if (!getBusy() && !getMuted()) broadcastState("idle");
        await new Promise((r) => setTimeout(r, MIC_IDLE_DELAY_MS));
        continue;
      }
      broadcastState("listening", voiceUserContextId);

      const micCapturePath = createMicCapturePath();
      recordMic(micCapturePath, MIC_RECORD_SECONDS);

      if (getBusy() || getMuted()) {
        try { fs.unlinkSync(micCapturePath); } catch {}
        continue;
      }

      const wakeWordHint =
        typeof wakeWordRuntime?.getPrimaryWakeWord === "function"
          ? wakeWordRuntime.getPrimaryWakeWord()
          : "nova";
      let text = await transcribe(micCapturePath, wakeWordHint, voiceUserContextId);
      try { fs.unlinkSync(micCapturePath); } catch {}

      if (!text || !text.trim()) {
        const retryPath = createMicCapturePath();
        recordMic(retryPath, MIC_RETRY_SECONDS);
        if (getBusy() || getMuted()) {
          try { fs.unlinkSync(retryPath); } catch {}
          continue;
        }
        text = await transcribe(retryPath, wakeWordHint, voiceUserContextId);
        try { fs.unlinkSync(retryPath); } catch {}
      }

      if (!text || getBusy() || getMuted()) {
        if (!getBusy() && !getMuted()) broadcastState("idle", voiceUserContextId);
        if (!getBusy() && !getMuted()) {
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
        if (!getBusy() && !getMuted()) broadcastState("idle", voiceUserContextId);
        broadcast(
          { type: "transcript", text: "", userContextId: voiceUserContextId, ts: Date.now() },
          { userContextId: voiceUserContextId },
        );
        continue;
      }

      if (!wakeWordRuntime.containsWakeWord(text)) {
        if (!getBusy() && !getMuted()) broadcastState("idle", voiceUserContextId);
        continue;
      }

      if (now - lastWakeHandledAt < VOICE_WAKE_COOLDOWN_MS) {
        if (!getBusy() && !getMuted()) broadcastState("idle", voiceUserContextId);
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
        if (!getMuted() && getVoiceEnabled() && typeof speak === "function") {
          setBusy(true);
          try {
            await speak("Yes?", getCurrentVoice());
          } catch {}
          finally {
            setBusy(false);
          }
        } else if (!getBusy() && !getMuted()) {
          broadcastState("idle", voiceUserContextId);
        }
        continue;
      }

      if (
        cleanedVoiceInput === lastVoiceCommandHandled &&
        now - lastVoiceCommandHandledAt < VOICE_DUPLICATE_COMMAND_COOLDOWN_MS
      ) {
        if (!getBusy() && !getMuted()) broadcastState("idle", voiceUserContextId);
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
          sender: voiceUserContextId,
          userContextId: voiceUserContextId || undefined,
          sessionKeyHint: voiceUserContextId
            ? `agent:nova:voice:dm:${voiceUserContextId}`
            : undefined,
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
      if (!getMuted()) broadcastState("idle", resolveVoiceUserContextId());
    }
  }
}
