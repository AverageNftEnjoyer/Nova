import { kvGet, kvSet } from "../../../../../db/index.js";

const NAMESPACE = "voice-user-settings";
const KEY = "settings";

function normalizeUserContextId(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeSettings(rawSettings = {}, userContextId = "") {
  const source = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  return {
    userContextId: normalizeUserContextId(source.userContextId || userContextId),
    ttsVoice: String(source.ttsVoice || "").trim() || "default",
    voiceEnabled: typeof source.voiceEnabled === "boolean" ? source.voiceEnabled : false,
    muted: typeof source.muted === "boolean" ? source.muted : true,
    assistantName: String(source.assistantName || "").trim(),
    updatedAt: Math.max(0, Number(source.updatedAt || 0)),
  };
}

export function resolveVoiceUserSettingsStorePath(userContextId = "") {
  const uid = normalizeUserContextId(userContextId);
  return uid ? `sqlite:kv_state/${uid}/${NAMESPACE}/${KEY}` : "";
}

export function readVoiceUserSettings(userContextId = "") {
  const uid = normalizeUserContextId(userContextId);
  if (!uid) return normalizeSettings({}, "");
  return normalizeSettings(kvGet(uid, NAMESPACE, KEY) || {}, uid);
}

export function upsertVoiceUserSettings({
  userContextId = "",
  ttsVoice,
  voiceEnabled,
  muted,
  assistantName,
  updatedAt = Date.now(),
} = {}) {
  const uid = normalizeUserContextId(userContextId);
  if (!uid) return normalizeSettings({}, "");
  const existing = readVoiceUserSettings(uid);
  const next = normalizeSettings({
    ...existing,
    ...(ttsVoice == null ? null : { ttsVoice }),
    ...(typeof voiceEnabled === "boolean" ? { voiceEnabled } : null),
    ...(typeof muted === "boolean" ? { muted } : null),
    ...(assistantName == null ? null : { assistantName }),
    updatedAt,
  }, uid);
  kvSet(uid, NAMESPACE, KEY, next);
  return next;
}
