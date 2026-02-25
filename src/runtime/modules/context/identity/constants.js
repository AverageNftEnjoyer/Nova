import { USER_CONTEXT_ROOT } from "../../../core/constants.js";

export const IDENTITY_SCHEMA_VERSION = 1;
export const IDENTITY_SEED_SCHEMA_VERSION = 1;
export const IDENTITY_FILE_NAME = "identity-intelligence.json";
export const IDENTITY_SEED_FILE_NAME = "identity-seed.json";
export const IDENTITY_AUDIT_FILE_NAME = "identity-intelligence.jsonl";
export const IDENTITY_MAX_AUDIT_DECISIONS = 24;
export const IDENTITY_MAX_AUDIT_SIGNALS = 32;
export const IDENTITY_MAX_CANDIDATES_PER_FIELD = 12;
export const IDENTITY_MAX_EVIDENCE_PER_CANDIDATE = 8;
export const IDENTITY_PROMPT_MAX_TOKENS = Math.max(
  120,
  Number.parseInt(process.env.NOVA_IDENTITY_PROMPT_MAX_TOKENS || "240", 10) || 240,
);
export const IDENTITY_FIELD_DEFAULT_MIN_ACTIVATION = 0.34;
export const IDENTITY_FIELD_DEFAULT_MIN_MARGIN = 0.08;
export const IDENTITY_INTENT_TTL_MS = Math.max(
  15 * 60 * 1000,
  Number.parseInt(process.env.NOVA_IDENTITY_INTENT_TTL_MS || String(8 * 60 * 60 * 1000), 10) || 8 * 60 * 60 * 1000,
);

export const IDENTITY_ALLOWED_FIELD_KEYS = new Set([
  "stableTraits.preferredName",
  "stableTraits.preferredLanguage",
  "stableTraits.communicationStyle",
  "stableTraits.responseTone",
  "stableTraits.assistantName",
  "stableTraits.occupationContext",
  "dynamicPreferences.responseVerbosity",
  "dynamicPreferences.explanationDepth",
  "dynamicPreferences.citationPreference",
  "dynamicPreferences.skillFocus",
  "temporalSessionIntent.currentIntent",
]);

export const IDENTITY_FIELD_CONFIG = {
  "stableTraits.preferredName": {
    halfLifeDays: 365,
    minActivation: 0.28,
    minMargin: 0.06,
    maxChars: 48,
  },
  "stableTraits.preferredLanguage": {
    halfLifeDays: 240,
    minActivation: 0.32,
    minMargin: 0.08,
    maxChars: 48,
  },
  "stableTraits.communicationStyle": {
    halfLifeDays: 180,
    minActivation: 0.35,
    minMargin: 0.08,
    maxChars: 40,
  },
  "stableTraits.responseTone": {
    halfLifeDays: 180,
    minActivation: 0.35,
    minMargin: 0.08,
    maxChars: 32,
  },
  "stableTraits.assistantName": {
    halfLifeDays: 240,
    minActivation: 0.34,
    minMargin: 0.07,
    maxChars: 40,
  },
  "stableTraits.occupationContext": {
    halfLifeDays: 180,
    minActivation: 0.35,
    minMargin: 0.1,
    maxChars: 80,
  },
  "dynamicPreferences.responseVerbosity": {
    halfLifeDays: 45,
    minActivation: 0.36,
    minMargin: 0.08,
    maxChars: 24,
  },
  "dynamicPreferences.explanationDepth": {
    halfLifeDays: 60,
    minActivation: 0.36,
    minMargin: 0.08,
    maxChars: 24,
  },
  "dynamicPreferences.citationPreference": {
    halfLifeDays: 60,
    minActivation: 0.36,
    minMargin: 0.09,
    maxChars: 32,
  },
  "dynamicPreferences.skillFocus": {
    halfLifeDays: 35,
    minActivation: 0.37,
    minMargin: 0.1,
    maxChars: 48,
  },
  "temporalSessionIntent.currentIntent": {
    halfLifeDays: 7,
    minActivation: 0.4,
    minMargin: 0.12,
    maxChars: 48,
  },
};

export const IDENTITY_SIGNAL_SOURCE_WEIGHTS = {
  settings_sync: 1,
  explicit_user_preference: 1.08,
  memory_update: 0.9,
  skill_preference_update: 0.88,
  user_message_inference: 0.56,
  nlp_correction_signal: 0.4,
  tool_usage_observation: 0.45,
  transcript_observation: 0.52,
  unknown: 0.45,
};

const IDENTITY_ALLOW_SENSITIVE_EXPLICIT =
  String(process.env.NOVA_IDENTITY_ALLOW_SENSITIVE_EXPLICIT || "0").trim() === "1";

export const IDENTITY_SENSITIVE_INFERENCE_CLASSIFIERS = [
  {
    classId: "credential_secret",
    patterns: [
      /\b(api[_ -]?key|secret(?: key)?|private key|password|passphrase|auth token|bearer token)\b/i,
      /\bsk-[a-z0-9]{12,}\b/i,
    ],
  },
  {
    classId: "account_secret",
    patterns: [
      /\b(account number|routing number|iban|swift|credit card|debit card|cvv|cvc|security code)\b/i,
      /\b\d{13,19}\b/,
    ],
  },
  {
    classId: "government_id",
    patterns: [
      /\b(ssn|social security|passport number|driver'?s license|tax id)\b/i,
      /\b\d{3}-\d{2}-\d{4}\b/,
    ],
  },
  {
    classId: "health_condition",
    patterns: [
      /\b(diabetes|diabetic|cancer|hiv|aids|bipolar|depression|anxiety disorder|autism)\b/i,
    ],
  },
  {
    classId: "religion_belief",
    patterns: [
      /\b(christian|muslim|jewish|hindu|buddhist|sikh|atheist)\b/i,
    ],
  },
  {
    classId: "sexual_orientation_or_gender",
    patterns: [
      /\b(gay|lesbian|bisexual|transgender|queer|straight|non-binary)\b/i,
    ],
  },
  {
    classId: "political_affiliation",
    patterns: [
      /\b(republican|democrat|conservative|liberal|socialist|communist)\b/i,
    ],
  },
  {
    classId: "race_ethnicity",
    patterns: [
      /\b(black|white|asian|latino|hispanic|arab|native american)\b/i,
    ],
  },
];

export const IDENTITY_SENSITIVE_INFERENCE_POLICY = {
  mode: "deny_by_default",
  allowExplicitSources: IDENTITY_ALLOW_SENSITIVE_EXPLICIT
    ? ["explicit_user_preference", "memory_update", "settings_sync"]
    : [],
  inferredSources: ["user_message_inference", "transcript_observation", "nlp_correction_signal", "unknown"],
  alwaysDeniedClasses: ["credential_secret", "account_secret", "government_id"],
  allowedClassesByField: {
    "stableTraits.preferredName": [],
    "stableTraits.preferredLanguage": [],
    "stableTraits.communicationStyle": [],
    "stableTraits.responseTone": [],
    "stableTraits.assistantName": [],
    "stableTraits.occupationContext": [],
    "dynamicPreferences.responseVerbosity": [],
    "dynamicPreferences.explanationDepth": [],
    "dynamicPreferences.citationPreference": [],
    "dynamicPreferences.skillFocus": [],
    "temporalSessionIntent.currentIntent": [],
  },
};

function createEmptyFieldState() {
  return {
    selectedValue: "",
    selectedConfidence: 0,
    selectedSource: "",
    selectedUpdatedAt: 0,
    candidates: {},
  };
}

function createEmptyTraitGroup() {
  return {
    preferredName: createEmptyFieldState(),
    preferredLanguage: createEmptyFieldState(),
    communicationStyle: createEmptyFieldState(),
    responseTone: createEmptyFieldState(),
    assistantName: createEmptyFieldState(),
    occupationContext: createEmptyFieldState(),
  };
}

function createEmptyDynamicGroup() {
  return {
    responseVerbosity: createEmptyFieldState(),
    explanationDepth: createEmptyFieldState(),
    citationPreference: createEmptyFieldState(),
    skillFocus: createEmptyFieldState(),
  };
}

export function createEmptyIdentitySnapshot({ userContextId = "", nowMs = Date.now() } = {}) {
  return {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    userContextId,
    createdAt: nowMs,
    updatedAt: nowMs,
    stableTraits: createEmptyTraitGroup(),
    dynamicPreferences: createEmptyDynamicGroup(),
    temporalSessionIntent: {
      currentIntent: createEmptyFieldState(),
      lastConversationId: "",
      expiresAt: 0,
    },
    toolAffinity: {},
    metrics: {
      appliedSignals: 0,
      rejectedSignals: 0,
      blockedSignals: 0,
      contradictionResolutions: 0,
      lastDecisionAt: 0,
    },
  };
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

function normalizeFieldState(rawField) {
  const raw = rawField && typeof rawField === "object" ? rawField : {};
  const candidatesRaw = raw.candidates && typeof raw.candidates === "object" ? raw.candidates : {};
  const normalizedCandidates = {};
  for (const [candidateKey, candidateValue] of Object.entries(candidatesRaw)) {
    if (!candidateValue || typeof candidateValue !== "object") continue;
    const value = String(candidateValue.value || "").trim();
    if (!value) continue;
    const key = String(candidateKey || "").trim() || value.toLowerCase();
    normalizedCandidates[key] = {
      value,
      score: Number.isFinite(Number(candidateValue.score)) ? Number(candidateValue.score) : 0,
      confidence: Number.isFinite(Number(candidateValue.confidence)) ? Number(candidateValue.confidence) : 0,
      source: String(candidateValue.source || "").trim(),
      firstSeenAt: Number.isFinite(Number(candidateValue.firstSeenAt)) ? Number(candidateValue.firstSeenAt) : 0,
      lastSeenAt: Number.isFinite(Number(candidateValue.lastSeenAt)) ? Number(candidateValue.lastSeenAt) : 0,
      supportCount: Number.isFinite(Number(candidateValue.supportCount)) ? Number(candidateValue.supportCount) : 0,
      contradictionCount: Number.isFinite(Number(candidateValue.contradictionCount)) ? Number(candidateValue.contradictionCount) : 0,
      evidence: Array.isArray(candidateValue.evidence)
        ? candidateValue.evidence
            .map((item) => ({
              source: String(item?.source || "").trim(),
              confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0,
              timestampMs: Number.isFinite(Number(item?.timestampMs)) ? Number(item.timestampMs) : 0,
              reason: String(item?.reason || "").trim(),
            }))
            .filter((item) => item.source || item.reason)
            .slice(0, IDENTITY_MAX_EVIDENCE_PER_CANDIDATE)
        : [],
    };
  }
  return {
    selectedValue: String(raw.selectedValue || "").trim(),
    selectedConfidence: Number.isFinite(Number(raw.selectedConfidence)) ? Number(raw.selectedConfidence) : 0,
    selectedSource: String(raw.selectedSource || "").trim(),
    selectedUpdatedAt: Number.isFinite(Number(raw.selectedUpdatedAt)) ? Number(raw.selectedUpdatedAt) : 0,
    candidates: normalizedCandidates,
  };
}

function normalizeTraitGroup(rawGroup, template) {
  const raw = rawGroup && typeof rawGroup === "object" ? rawGroup : {};
  const next = {};
  for (const key of Object.keys(template)) {
    next[key] = normalizeFieldState(raw[key]);
  }
  return next;
}

function normalizeToolAffinity(rawAffinity) {
  const raw = rawAffinity && typeof rawAffinity === "object" ? rawAffinity : {};
  const out = {};
  for (const [toolName, toolState] of Object.entries(raw)) {
    const normalizedToolName = String(toolName || "").trim().toLowerCase();
    if (!normalizedToolName || !toolState || typeof toolState !== "object") continue;
    out[normalizedToolName] = {
      score: Number.isFinite(Number(toolState.score)) ? Number(toolState.score) : 0,
      count: Number.isFinite(Number(toolState.count)) ? Number(toolState.count) : 0,
      confidence: Number.isFinite(Number(toolState.confidence)) ? Number(toolState.confidence) : 0,
      lastUsedAt: Number.isFinite(Number(toolState.lastUsedAt)) ? Number(toolState.lastUsedAt) : 0,
    };
  }
  return out;
}

export function normalizeIdentitySnapshot(rawSnapshot, { userContextId = "", nowMs = Date.now() } = {}) {
  const fallback = createEmptyIdentitySnapshot({ userContextId, nowMs });
  const raw = rawSnapshot && typeof rawSnapshot === "object" ? rawSnapshot : {};
  const normalizedUserContextId = normalizeUserContextId(raw.userContextId || userContextId);
  const stableTemplate = fallback.stableTraits;
  const dynamicTemplate = fallback.dynamicPreferences;
  return {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    userContextId: normalizedUserContextId || userContextId,
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : fallback.createdAt,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : fallback.updatedAt,
    stableTraits: normalizeTraitGroup(raw.stableTraits, stableTemplate),
    dynamicPreferences: normalizeTraitGroup(raw.dynamicPreferences, dynamicTemplate),
    temporalSessionIntent: {
      currentIntent: normalizeFieldState(raw.temporalSessionIntent?.currentIntent),
      lastConversationId: String(raw.temporalSessionIntent?.lastConversationId || "").trim(),
      expiresAt: Number.isFinite(Number(raw.temporalSessionIntent?.expiresAt))
        ? Number(raw.temporalSessionIntent.expiresAt)
        : 0,
    },
    toolAffinity: normalizeToolAffinity(raw.toolAffinity),
    metrics: {
      appliedSignals: Number.isFinite(Number(raw.metrics?.appliedSignals)) ? Number(raw.metrics.appliedSignals) : 0,
      rejectedSignals: Number.isFinite(Number(raw.metrics?.rejectedSignals)) ? Number(raw.metrics.rejectedSignals) : 0,
      blockedSignals: Number.isFinite(Number(raw.metrics?.blockedSignals)) ? Number(raw.metrics.blockedSignals) : 0,
      contradictionResolutions: Number.isFinite(Number(raw.metrics?.contradictionResolutions))
        ? Number(raw.metrics.contradictionResolutions)
        : 0,
      lastDecisionAt: Number.isFinite(Number(raw.metrics?.lastDecisionAt)) ? Number(raw.metrics.lastDecisionAt) : 0,
    },
  };
}

export function resolveDefaultIdentityRoot() {
  return USER_CONTEXT_ROOT;
}
