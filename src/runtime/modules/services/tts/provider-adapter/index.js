import { speak, stopSpeaking } from "../../../audio/voice/index.js";

import { createVoiceProviderAdapter } from "../../voice/provider-adapter/index.js";

function normalizeText(value = "", fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function createTtsProviderAdapter(deps = {}) {
  const voiceAdapter = deps.voiceAdapter && typeof deps.voiceAdapter === "object"
    ? deps.voiceAdapter
    : createVoiceProviderAdapter(deps);
  const speakRef = typeof deps.speak === "function" ? deps.speak : speak;
  const stopSpeakingRef = typeof deps.stopSpeaking === "function" ? deps.stopSpeaking : stopSpeaking;

  return {
    id: "tts-runtime-provider-adapter",
    getScopedState(userContextId = "") {
      return voiceAdapter.getScopedState(userContextId);
    },
    updateVoiceState(input = {}) {
      return voiceAdapter.updateUserState(input);
    },
    syncRuntimeForUser(userContextId = "", options = {}) {
      return voiceAdapter.syncRuntimeForUser(userContextId, options);
    },
    async speakText({ userContextId = "", text = "", ttsVoice = "" } = {}) {
      const state = voiceAdapter.getScopedState(userContextId);
      const resolvedVoice = voiceAdapter.resolveVoiceId(ttsVoice || state.ttsVoice || "default");
      await speakRef(normalizeText(text), resolvedVoice, { userContextId });
      return {
        ...state,
        ttsVoice: resolvedVoice,
      };
    },
    stopSpeaking({ userContextId = "" } = {}) {
      stopSpeakingRef(userContextId ? { userContextId } : undefined);
    },
  };
}
