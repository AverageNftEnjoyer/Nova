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
      const voiceUserContextId = resolveVoiceUserContextId();
      if (!voiceUserContextId) {
        await new Promise((r) => setTimeout(r, MIC_IDLE_DELAY_MS));
        continue;
      }

      if (getMuted({ userContextId: voiceUserContextId })) {
        await new Promise((r) => setTimeout(r, MIC_IDLE_DELAY_MS));
        continue;
      }

      if (getBusy({ userContextId: voiceUserContextId })) {
        await new Promise((r) => setTimeout(r, MIC_IDLE_DELAY_MS));
        continue;
      }

      if (Date.now() < getSuppressVoiceWakeUntilMs({ userContextId: voiceUserContextId })) {
        await new Promise((r) => setTimeout(r, MIC_IDLE_DELAY_MS));
        continue;
      }
      if (getMuted({ userContextId: voiceUserContextId })) continue;
      broadcastState("listening", voiceUserContextId);

      const micCapturePath = createMicCapturePath();
      recordMic(micCapturePath, MIC_RECORD_SECONDS);

      if (getBusy({ userContextId: voiceUserContextId }) || getMuted({ userContextId: voiceUserContextId })) {
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
        await new Promise((r) => setTimeout(r, VOICE_POST_RESPONSE_GRACE_MS));
      }
    } catch (e) {
      console.error("Loop error:", e);
      const voiceUserContextId = resolveVoiceUserContextId();
      setBusy(false, { userContextId: voiceUserContextId });
      if (!getMuted({ userContextId: voiceUserContextId })) broadcastState("idle", voiceUserContextId);
    }
  }
}
