import fs from "fs";
import path from "path";
import { USER_CONTEXT_ROOT } from "../../core/constants.js";

const PREFERENCE_SCHEMA_VERSION = 1;
const PREFERENCE_DIR_NAME = "profile";
const PREFERENCE_FILE_NAME = "preferences.json";
const PREFERENCE_CACHE = new Map();
const PREFERENCE_CACHE_TTL_MS = Math.max(
  500,
  Number.parseInt(process.env.NOVA_PREFERENCE_CACHE_TTL_MS || "2500", 10) || 2500,
);
const PREFERENCE_OVERRIDE_MIN_MARGIN = Math.max(
  0.02,
  Math.min(
    0.35,
    Number.parseFloat(process.env.NOVA_PREFERENCE_OVERRIDE_MIN_MARGIN || "0.08") || 0.08,
  ),
);
const PREFERENCE_EXPLICIT_OVERRIDE_MIN_CONFIDENCE = Math.max(
  0.55,
  Math.min(
    0.98,
    Number.parseFloat(process.env.NOVA_PREFERENCE_EXPLICIT_OVERRIDE_MIN_CONFIDENCE || "0.72") || 0.72,
  ),
);
const EXPLICIT_PREFERENCE_SOURCES = new Set([
  "call_me",
  "refer_to_me_as",
  "my_name_is",
  "i_go_by",
  "memory_update",
]);

const WEAK_NAME_VALUES = new Set([
  "it",
  "this",
  "that",
  "name",
  "myself",
  "me",
  "user",
  "someone",
  "friend",
  "past",
]);

const SIGNAL_PATTERNS = [
  {
    key: "preferredName",
    confidence: 0.99,
    source: "call_me",
    regex: /\b(?:you can\s+)?call me(?:\s+by)?\s+([a-z][a-z0-9' -]{1,40}?)(?=(?:\s+(?:and|but|so|then|because|while|if|when)\b|[,.!?;:]|$))/i,
  },
  {
    key: "preferredName",
    confidence: 0.97,
    source: "refer_to_me_as",
    regex: /\brefer to me as\s+([a-z][a-z0-9' -]{1,40}?)(?=(?:\s+(?:and|but|so|then|because|while|if|when)\b|[,.!?;:]|$))/i,
  },
  {
    key: "preferredName",
    confidence: 0.95,
    source: "my_name_is",
    regex: /\bmy name is\s+([a-z][a-z0-9' -]{1,40}?)(?=(?:\s+(?:and|but|so|then|because|while|if|when)\b|[,.!?;:]|$))/i,
  },
  {
    key: "preferredName",
    confidence: 0.95,
    source: "i_go_by",
    regex: /\bi go by\s+([a-z][a-z0-9' -]{1,40}?)(?=(?:\s+(?:and|but|so|then|because|while|if|when)\b|[,.!?;:]|$))/i,
  },
];

function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function normalizeUserContextId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeName(rawValue) {
  const cleaned = normalizeWhitespace(String(rawValue || "").replace(/^["']+|["']+$/g, ""))
    .replace(/[.?!,:;]+$/g, "")
    .trim();
  const scoped = cleaned
    .replace(/\s+(?:for|in)\s+this\s+(?:chat|conversation)\b.*$/i, "")
    .replace(/\s+(?:for\s+now|today|tonight)\b.*$/i, "")
    .trim();
  if (!scoped) return "";
  const lower = scoped.toLowerCase();
  if (WEAK_NAME_VALUES.has(lower)) return "";
  if (!/^[a-z][a-z0-9' -]{0,40}$/i.test(scoped)) return "";
  const tokens = scoped.split(/\s+/g).filter(Boolean);
  if (tokens.length > 4) return "";
  return scoped;
}

function normalizePreferences(raw) {
  const fields = raw && typeof raw === "object" && raw.fields && typeof raw.fields === "object"
    ? raw.fields
    : {};
  const normalizedFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!value || typeof value !== "object") continue;
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) continue;
    const normalizedValue = normalizeWhitespace(String(value.value || ""));
    if (!normalizedValue) continue;
    normalizedFields[normalizedKey] = {
      value: normalizedValue,
      confidence: clamp(value.confidence, 0, 1),
      source: normalizeWhitespace(String(value.source || "")) || "unknown",
      updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : Date.now(),
    };
  }
  return {
    schemaVersion: PREFERENCE_SCHEMA_VERSION,
    updatedAt: Number.isFinite(Number(raw?.updatedAt)) ? Number(raw.updatedAt) : Date.now(),
    fields: normalizedFields,
  };
}

function getPreferenceFilePath({ userContextId = "", workspaceDir = "" } = {}) {
  const normalizedUserContextId = normalizeUserContextId(userContextId);
  const baseDir = String(workspaceDir || "").trim()
    || (normalizedUserContextId
      ? path.join(USER_CONTEXT_ROOT, normalizedUserContextId)
      : path.join(USER_CONTEXT_ROOT, "anonymous"));
  return path.join(baseDir, PREFERENCE_DIR_NAME, PREFERENCE_FILE_NAME);
}

function readPreferencesFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return normalizePreferences({});
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizePreferences(parsed);
  } catch {
    return normalizePreferences({});
  }
}

function writePreferencesToFile(filePath, preferences) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
}

function getCachedPreferences(filePath) {
  const cached = PREFERENCE_CACHE.get(filePath);
  if (!cached) return null;
  if (Date.now() - Number(cached.at || 0) > PREFERENCE_CACHE_TTL_MS) {
    PREFERENCE_CACHE.delete(filePath);
    return null;
  }
  try {
    const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    const mtimeMs = Number(stat?.mtimeMs || 0);
    if (mtimeMs !== Number(cached.mtimeMs || 0)) {
      PREFERENCE_CACHE.delete(filePath);
      return null;
    }
  } catch {
    // Ignore stat failure and trust cached content.
  }
  return cached.preferences;
}

function setCachedPreferences(filePath, preferences) {
  if (!filePath) return;
  let mtimeMs = 0;
  try {
    mtimeMs = Number(fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : 0);
  } catch {}
  PREFERENCE_CACHE.set(filePath, {
    at: Date.now(),
    mtimeMs,
    preferences,
  });
}

function extractPreferenceSignals(text) {
  const input = normalizeWhitespace(text);
  if (!input) return [];
  const out = [];
  for (const pattern of SIGNAL_PATTERNS) {
    const match = input.match(pattern.regex);
    if (!match?.[1]) continue;
    const candidate = sanitizeName(match[1]);
    if (!candidate) continue;
    out.push({
      key: pattern.key,
      value: candidate,
      confidence: pattern.confidence,
      source: pattern.source,
    });
  }
  return out;
}

function shouldApplyPreferenceUpdate(existing, candidateConfidence, incomingSource = "") {
  if (!existing) return true;
  const existingConfidence = clamp(existing.confidence, 0, 1);
  const incomingConfidence = clamp(candidateConfidence, 0, 1);
  const normalizedIncomingSource = normalizeWhitespace(incomingSource).toLowerCase();
  if (
    EXPLICIT_PREFERENCE_SOURCES.has(normalizedIncomingSource)
    && incomingConfidence >= PREFERENCE_EXPLICIT_OVERRIDE_MIN_CONFIDENCE
  ) {
    return true;
  }
  return incomingConfidence + PREFERENCE_OVERRIDE_MIN_MARGIN >= existingConfidence;
}

function findPreferredNameFromMemory(workspaceDir) {
  const baseDir = String(workspaceDir || "").trim();
  if (!baseDir) return "";
  const memoryPath = path.join(baseDir, "MEMORY.md");
  if (!fs.existsSync(memoryPath)) return "";
  try {
    const raw = fs.readFileSync(memoryPath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      if (!/\[memory:preferred-name\]/i.test(line)) continue;
      const match = line.match(/\[memory:preferred-name\]\s*my preferred name is\s+(.+)$/i);
      if (!match?.[1]) continue;
      const candidate = sanitizeName(match[1]);
      if (candidate) return candidate;
    }
  } catch {
    return "";
  }
  return "";
}

export function loadUserPreferences(opts = {}) {
  const filePath = getPreferenceFilePath(opts);
  const cached = getCachedPreferences(filePath);
  if (cached) return { preferences: cached, filePath };
  const preferences = readPreferencesFromFile(filePath);
  setCachedPreferences(filePath, preferences);
  return { preferences, filePath };
}

function simplifyPreferences(preferences) {
  const fields = preferences?.fields && typeof preferences.fields === "object"
    ? preferences.fields
    : {};
  return {
    preferredName: normalizeWhitespace(String(fields.preferredName?.value || "")),
  };
}

export function captureUserPreferencesFromMessage({
  userContextId = "",
  workspaceDir = "",
  userInputText = "",
  nlpConfidence = 1,
  source = "",
  sessionKey = "",
} = {}) {
  const { preferences: loaded, filePath } = loadUserPreferences({ userContextId, workspaceDir });
  const preferences = normalizePreferences(loaded);
  const updatedKeys = [];
  const ignoredSignals = [];
  const normalizedNlpConfidence = clamp(
    Number.isFinite(Number(nlpConfidence)) ? Number(nlpConfidence) : 1,
    0.25,
    1,
  );

  if (!preferences.fields.preferredName?.value) {
    const memoryName = findPreferredNameFromMemory(workspaceDir);
    if (memoryName) {
      preferences.fields.preferredName = {
        value: memoryName,
        confidence: 0.82,
        source: "memory_sync",
        updatedAt: Date.now(),
      };
      updatedKeys.push("preferredName");
    }
  }

  const signals = extractPreferenceSignals(userInputText);
  for (const signal of signals) {
    if (signal.key !== "preferredName") continue;
    const existing = preferences.fields.preferredName || null;
    const adjustedConfidence = clamp(signal.confidence * normalizedNlpConfidence, 0, 1);
    if (existing && normalizeWhitespace(String(existing.value || "")).toLowerCase() === signal.value.toLowerCase()) {
      preferences.fields.preferredName = {
        ...existing,
        confidence: Math.max(clamp(existing.confidence, 0, 1), adjustedConfidence),
        updatedAt: Date.now(),
        source: signal.source,
      };
      if (!updatedKeys.includes("preferredName")) updatedKeys.push("preferredName");
      continue;
    }
    if (!shouldApplyPreferenceUpdate(existing, adjustedConfidence, signal.source)) {
      ignoredSignals.push({
        key: signal.key,
        value: signal.value,
        reason: "lower_confidence_than_existing",
      });
      continue;
    }
    preferences.fields.preferredName = {
      value: signal.value,
      confidence: adjustedConfidence,
      source: signal.source,
      updatedAt: Date.now(),
    };
    if (!updatedKeys.includes("preferredName")) updatedKeys.push("preferredName");
  }

  if (updatedKeys.length > 0) {
    preferences.updatedAt = Date.now();
    writePreferencesToFile(filePath, preferences);
    setCachedPreferences(filePath, preferences);
  }

  return {
    preferences: simplifyPreferences(preferences),
    updatedKeys,
    ignoredSignals,
    filePath,
    meta: {
      source: normalizeWhitespace(source) || "unknown",
      sessionKey: normalizeWhitespace(sessionKey),
      nlpConfidence: normalizedNlpConfidence,
    },
  };
}

export function buildUserPreferencePromptSection(preferences = {}) {
  const preferredName = normalizeWhitespace(preferences.preferredName || "");
  if (!preferredName) return "";
  return [
    "## Stable User Preferences",
    `- Preferred user name: ${preferredName}`,
    "- Address the user with this preferred name unless they explicitly ask to change it.",
    "- Do not replace this name with guessed, autocorrected, or inferred alternatives.",
  ].join("\n");
}
