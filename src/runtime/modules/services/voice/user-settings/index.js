import fs from "node:fs";
import path from "node:path";

import { USER_CONTEXT_ROOT } from "../../../../core/constants/index.js";

const STORE_FILE_NAME = "voice-user-settings.json";
const STORE_VERSION = 1;

function normalizeUserContextId(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value = "", fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function resolveUserStateDir(userContextId = "") {
  const normalizedUserContextId = normalizeUserContextId(userContextId);
  if (!normalizedUserContextId) return "";
  return path.join(USER_CONTEXT_ROOT, normalizedUserContextId, "state");
}

export function resolveVoiceUserSettingsStorePath(userContextId = "") {
  const stateDir = resolveUserStateDir(userContextId);
  if (!stateDir) return "";
  return path.join(stateDir, STORE_FILE_NAME);
}

function ensureStoreFile(storePath = "") {
  if (!storePath) return false;
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    if (!fs.existsSync(storePath)) {
      fs.writeFileSync(
        storePath,
        JSON.stringify({ version: STORE_VERSION, settings: {} }, null, 2),
        "utf8",
      );
    }
    return true;
  } catch {
    return false;
  }
}

function normalizeSettings(rawSettings = {}, userContextId = "") {
  const source = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  const normalizedUserContextId = normalizeUserContextId(source.userContextId || userContextId);
  return {
    userContextId: normalizedUserContextId,
    ttsVoice: normalizeText(source.ttsVoice, "default"),
    voiceEnabled: normalizeBoolean(source.voiceEnabled, false),
    muted: normalizeBoolean(source.muted, true),
    assistantName: normalizeText(source.assistantName, ""),
    updatedAt: Math.max(0, Number(source.updatedAt || 0)),
  };
}

function loadStore(storePath = "") {
  if (!storePath || !ensureStoreFile(storePath)) {
    return { version: STORE_VERSION, settings: {} };
  }
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? {
          version: STORE_VERSION,
          settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {},
        }
      : { version: STORE_VERSION, settings: {} };
  } catch {
    return { version: STORE_VERSION, settings: {} };
  }
}

function saveStore(storePath = "", store = {}) {
  if (!storePath || !ensureStoreFile(storePath)) return false;
  try {
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          version: STORE_VERSION,
          settings: store?.settings && typeof store.settings === "object" ? store.settings : {},
        },
        null,
        2,
      ),
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

export function readVoiceUserSettings(userContextId = "") {
  const normalizedUserContextId = normalizeUserContextId(userContextId);
  if (!normalizedUserContextId) {
    return normalizeSettings({}, "");
  }
  const storePath = resolveVoiceUserSettingsStorePath(normalizedUserContextId);
  const store = loadStore(storePath);
  return normalizeSettings(store.settings, normalizedUserContextId);
}

export function upsertVoiceUserSettings({
  userContextId = "",
  ttsVoice,
  voiceEnabled,
  muted,
  assistantName,
  updatedAt = Date.now(),
} = {}) {
  const normalizedUserContextId = normalizeUserContextId(userContextId);
  if (!normalizedUserContextId) {
    return normalizeSettings({}, "");
  }
  const storePath = resolveVoiceUserSettingsStorePath(normalizedUserContextId);
  const existing = readVoiceUserSettings(normalizedUserContextId);
  const next = normalizeSettings(
    {
      ...existing,
      ...(ttsVoice == null ? null : { ttsVoice }),
      ...(typeof voiceEnabled === "boolean" ? { voiceEnabled } : null),
      ...(typeof muted === "boolean" ? { muted } : null),
      ...(assistantName == null ? null : { assistantName }),
      updatedAt,
    },
    normalizedUserContextId,
  );
  saveStore(storePath, { version: STORE_VERSION, settings: next });
  return next;
}
