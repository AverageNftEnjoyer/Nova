import {
  getCurrentVoice,
  getMuted,
  getVoiceEnabled,
  setCurrentVoice,
  setMuted,
  setVoiceEnabled,
  VOICE_MAP,
} from "../../../audio/voice/index.js";
import { wakeWordRuntime } from "../../../../core/config/index.js";

import { readVoiceUserSettings, upsertVoiceUserSettings } from "../user-settings/index.js";

function normalizeUserContextId(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value = "", fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function resolveVoiceId(value = "", fallback = "default") {
  const normalized = normalizeText(value, fallback).toLowerCase();
  return Object.prototype.hasOwnProperty.call(VOICE_MAP, normalized) ? normalized : fallback;
}

function normalizeAssistantName(value = "") {
  return String(value || "").trim().slice(0, 40);
}

export function createVoiceProviderAdapter(deps = {}) {
  const readSettings = typeof deps.readSettings === "function"
    ? deps.readSettings
    : readVoiceUserSettings;
  const writeSettings = typeof deps.writeSettings === "function"
    ? deps.writeSettings
    : upsertVoiceUserSettings;
  const getActiveUserContextId = typeof deps.getActiveUserContextId === "function"
    ? deps.getActiveUserContextId
    : (() => "");
  const broadcastStateRef = typeof deps.broadcastState === "function"
    ? deps.broadcastState
    : (() => {});
  const setCurrentVoiceRef = typeof deps.setCurrentVoice === "function"
    ? deps.setCurrentVoice
    : setCurrentVoice;
  const setVoiceEnabledRef = typeof deps.setVoiceEnabled === "function"
    ? deps.setVoiceEnabled
    : setVoiceEnabled;
  const setMutedRef = typeof deps.setMuted === "function"
    ? deps.setMuted
    : setMuted;
  const wakeRuntime = deps.wakeWordRuntime && typeof deps.wakeWordRuntime === "object"
    ? deps.wakeWordRuntime
    : wakeWordRuntime;

  function syncRuntimeForUser(userContextId = "", options = {}) {
    const normalizedUserContextId = normalizeUserContextId(userContextId);
    if (!normalizedUserContextId) return readSettings("");
    const state = readSettings(normalizedUserContextId);
    const activeUserContextId = normalizeUserContextId(getActiveUserContextId());
    if (activeUserContextId !== normalizedUserContextId) return state;

    const scopedOptions = { userContextId: normalizedUserContextId };
    setCurrentVoiceRef(resolveVoiceId(state.ttsVoice), scopedOptions);
    setVoiceEnabledRef(Boolean(state.voiceEnabled), scopedOptions);
    setMutedRef(Boolean(state.muted), scopedOptions);
    if (typeof wakeRuntime?.setAssistantName === "function") {
      wakeRuntime.setAssistantName(normalizeAssistantName(state.assistantName));
    }
    if (options.broadcastRuntimeState === true) {
      broadcastStateRef(state.muted ? "muted" : "idle", normalizedUserContextId);
    }
    return state;
  }

  function updateUserState({
    userContextId = "",
    patch = {},
    syncRuntime = true,
    broadcastRuntimeState = false,
  } = {}) {
    const normalizedUserContextId = normalizeUserContextId(userContextId);
    if (!normalizedUserContextId) return readSettings("");
    const nextState = writeSettings({
      userContextId: normalizedUserContextId,
      ...(patch.ttsVoice == null ? null : { ttsVoice: resolveVoiceId(patch.ttsVoice) }),
      ...(typeof patch.voiceEnabled === "boolean" ? { voiceEnabled: patch.voiceEnabled } : null),
      ...(typeof patch.muted === "boolean" ? { muted: patch.muted } : null),
      ...(patch.assistantName == null ? null : { assistantName: normalizeAssistantName(patch.assistantName) }),
      updatedAt: Date.now(),
    });
    if (syncRuntime) {
      return syncRuntimeForUser(normalizedUserContextId, { broadcastRuntimeState });
    }
    return nextState;
  }

  return {
    id: "voice-runtime-provider-adapter",
    getScopedState(userContextId = "") {
      return readSettings(userContextId);
    },
    getActiveRuntimeState(userContextId = "") {
      const scopedOptions = {
        userContextId: normalizeUserContextId(userContextId || getActiveUserContextId()),
      };
      return {
        ttsVoice: resolveVoiceId(getCurrentVoice(scopedOptions)),
        voiceEnabled: getVoiceEnabled(scopedOptions) === true,
        muted: getMuted(scopedOptions) === true,
      };
    },
    updateUserState,
    syncRuntimeForUser,
    resolveVoiceId,
  };
}
