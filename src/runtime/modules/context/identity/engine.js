import {
  IDENTITY_ALLOWED_FIELD_KEYS,
  IDENTITY_FIELD_CONFIG,
  IDENTITY_FIELD_DEFAULT_MIN_ACTIVATION,
  IDENTITY_FIELD_DEFAULT_MIN_MARGIN,
  IDENTITY_INTENT_TTL_MS,
  IDENTITY_MAX_AUDIT_DECISIONS,
  IDENTITY_MAX_AUDIT_SIGNALS,
  IDENTITY_MAX_CANDIDATES_PER_FIELD,
  IDENTITY_MAX_EVIDENCE_PER_CANDIDATE,
  IDENTITY_PROMPT_MAX_TOKENS,
  IDENTITY_SENSITIVE_INFERENCE_CLASSIFIERS,
  IDENTITY_SENSITIVE_INFERENCE_POLICY,
  IDENTITY_SIGNAL_SOURCE_WEIGHTS,
  createEmptyIdentitySnapshot,
} from "./constants.js";
import {
  appendIdentityAuditEvent,
  loadIdentitySeed,
  persistIdentitySnapshot,
  recoverOrCreateIdentitySnapshot,
  resolveIdentityPaths,
} from "./storage.js";
import { buildIdentityPromptSection } from "./prompt.js";

const HALF_LIFE_DAY_MS = 24 * 60 * 60 * 1000;

const PROMPT_POISONING_PATTERNS = [
  /ignore\s+all\s+previous\s+instructions/i,
  /ignore\s+the\s+system\s+prompt/i,
  /you\s+are\s+now\s+/i,
  /\bdeveloper\s+mode\b/i,
  /reveal\s+the\s+system\s+prompt/i,
  /do\s+anything\s+now/i,
  /```/i,
];

const INTENT_PATTERNS = [
  { value: "coding", confidence: 0.72, regex: /\b(code|coding|bug|typescript|javascript|python|compile|build|test|refactor|repo|git|stack trace)\b/i },
  { value: "research", confidence: 0.7, regex: /\b(research|sources|cite|citation|look up|find out|latest|compare|summary)\b/i },
  { value: "planning", confidence: 0.68, regex: /\b(plan|roadmap|milestone|phase|timeline|scope|tasks)\b/i },
  { value: "operations", confidence: 0.64, regex: /\b(runbook|deploy|incident|outage|monitor|uptime|logs)\b/i },
  { value: "finance", confidence: 0.65, regex: /\b(coinbase|portfolio|pnl|profit|loss|asset|balance|crypto)\b/i },
  { value: "personal", confidence: 0.62, regex: /\b(remind me|my girlfriend|family|birthday|personal)\b/i },
];

function normalizePolicyValue(value) {
  return String(value || "").trim().toLowerCase();
}

function toPolicyList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizePolicyValue(entry))
    .filter(Boolean);
}

const SENSITIVE_POLICY_MODE = normalizePolicyValue(IDENTITY_SENSITIVE_INFERENCE_POLICY?.mode || "deny_by_default");
const SENSITIVE_ALWAYS_DENIED_CLASSES = new Set(
  toPolicyList(IDENTITY_SENSITIVE_INFERENCE_POLICY?.alwaysDeniedClasses),
);
const SENSITIVE_INFERRED_SOURCES = new Set(
  toPolicyList(IDENTITY_SENSITIVE_INFERENCE_POLICY?.inferredSources),
);
const SENSITIVE_ALLOW_EXPLICIT_SOURCES = new Set(
  toPolicyList(IDENTITY_SENSITIVE_INFERENCE_POLICY?.allowExplicitSources),
);

function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCandidateKey(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function resolveFieldConfig(fieldKey) {
  const config = IDENTITY_FIELD_CONFIG[fieldKey] || {};
  return {
    halfLifeDays: clamp(config.halfLifeDays || 90, 3, 720),
    minActivation: clamp(config.minActivation || IDENTITY_FIELD_DEFAULT_MIN_ACTIVATION, 0.05, 1),
    minMargin: clamp(config.minMargin || IDENTITY_FIELD_DEFAULT_MIN_MARGIN, 0.02, 0.5),
    maxChars: clamp(config.maxChars || 80, 8, 320),
  };
}

function isPromptPoisoningContent(value) {
  const text = String(value || "");
  return PROMPT_POISONING_PATTERNS.some((pattern) => pattern.test(text));
}

function sanitizeName(value, maxChars = 48) {
  const cleaned = normalizeWhitespace(String(value || "").replace(/^["']+|["']+$/g, ""))
    .replace(/[.?!,:;]+$/g, "")
    .slice(0, maxChars);
  if (!cleaned) return "";
  if (!/^[a-z][a-z0-9' -]{0,47}$/i.test(cleaned)) return "";
  return cleaned;
}

function sanitizeFieldValue(fieldKey, rawValue, maxChars) {
  const value = normalizeWhitespace(rawValue).slice(0, maxChars);
  if (!value) return "";
  if (isPromptPoisoningContent(value)) return "";

  if (fieldKey === "stableTraits.preferredName") return sanitizeName(value, maxChars);
  if (fieldKey === "stableTraits.assistantName") return sanitizeName(value, Math.min(40, maxChars));
  if (fieldKey === "stableTraits.preferredLanguage") {
    const normalized = value.replace(/[^a-z -]/gi, "").trim();
    return normalized.slice(0, maxChars);
  }
  if (fieldKey === "stableTraits.communicationStyle") {
    const normalized = value.toLowerCase();
    if (["formal", "casual", "friendly", "professional", "direct"].includes(normalized)) return normalized;
    return "";
  }
  if (fieldKey === "stableTraits.responseTone") {
    const normalized = value.toLowerCase();
    if (["neutral", "enthusiastic", "calm", "direct", "relaxed"].includes(normalized)) return normalized;
    return "";
  }
  if (fieldKey === "dynamicPreferences.responseVerbosity") {
    const normalized = value.toLowerCase();
    if (["concise", "balanced", "detailed"].includes(normalized)) return normalized;
    return "";
  }
  if (fieldKey === "dynamicPreferences.explanationDepth") {
    const normalized = value.toLowerCase();
    if (["shallow", "standard", "deep"].includes(normalized)) return normalized;
    return "";
  }
  if (fieldKey === "dynamicPreferences.citationPreference") {
    const normalized = value.toLowerCase();
    if (["none", "on_request", "always"].includes(normalized)) return normalized;
    return "";
  }
  if (fieldKey === "dynamicPreferences.skillFocus") {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9 _-]/g, "")
      .replace(/[_\s]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, maxChars);
  }
  if (fieldKey === "temporalSessionIntent.currentIntent") {
    const normalized = value.toLowerCase();
    if (["coding", "research", "planning", "operations", "finance", "personal", "general"].includes(normalized)) {
      return normalized;
    }
    return "";
  }
  return value;
}

function classifySensitiveInference(value) {
  const text = normalizeWhitespace(value);
  if (!text) return "";
  for (const classifier of IDENTITY_SENSITIVE_INFERENCE_CLASSIFIERS) {
    const classId = normalizeWhitespace(classifier?.classId || "").toLowerCase();
    if (!classId) continue;
    const patterns = Array.isArray(classifier?.patterns) ? classifier.patterns : [];
    if (patterns.some((pattern) => pattern instanceof RegExp && pattern.test(text))) {
      return classId;
    }
  }
  return "";
}

function resolveSensitivePolicy(signalSource, fieldKey, sensitiveClassId) {
  const source = normalizeWhitespace(signalSource || "unknown").toLowerCase() || "unknown";
  const classId = normalizeWhitespace(sensitiveClassId || "").toLowerCase();
  if (!classId) {
    return {
      allowed: true,
      reason: "",
    };
  }

  if (SENSITIVE_ALWAYS_DENIED_CLASSES.has(classId)) {
    return {
      allowed: false,
      reason: `sensitive_class_always_denied:${classId}`,
    };
  }

  const fieldAllowMap =
    IDENTITY_SENSITIVE_INFERENCE_POLICY?.allowedClassesByField
    && typeof IDENTITY_SENSITIVE_INFERENCE_POLICY.allowedClassesByField === "object"
      ? IDENTITY_SENSITIVE_INFERENCE_POLICY.allowedClassesByField
      : {};
  const allowedByField = new Set(
    Array.isArray(fieldAllowMap[fieldKey])
      ? fieldAllowMap[fieldKey].map((value) => normalizeWhitespace(value).toLowerCase())
      : [],
  );
  if (allowedByField.has(classId)) {
    return {
      allowed: true,
      reason: "",
    };
  }

  if (SENSITIVE_INFERRED_SOURCES.has(source)) {
    return {
      allowed: false,
      reason: `sensitive_inference_denied:${classId}`,
    };
  }

  if (SENSITIVE_ALLOW_EXPLICIT_SOURCES.has(source)) {
    return {
      allowed: true,
      reason: "",
    };
  }

  if (SENSITIVE_POLICY_MODE === "deny_by_default") {
    return {
      allowed: false,
      reason: `sensitive_default_deny:${classId}`,
    };
  }

  return {
    allowed: false,
    reason: `sensitive_policy_denied:${classId}`,
  };
}

function parseFieldPath(fieldKey) {
  const [group, field] = String(fieldKey || "").split(".");
  if (!group || !field) return null;
  return { group, field };
}

function getFieldState(snapshot, fieldKey) {
  const parsed = parseFieldPath(fieldKey);
  if (!parsed) return null;
  if (!snapshot?.[parsed.group] || typeof snapshot[parsed.group] !== "object") return null;
  if (!snapshot[parsed.group][parsed.field] || typeof snapshot[parsed.group][parsed.field] !== "object") return null;
  return snapshot[parsed.group][parsed.field];
}

function computeDecayedScore(score, lastSeenAt, halfLifeDays, nowMs) {
  const safeScore = Math.max(0, Number(score || 0));
  if (safeScore <= 0) return 0;
  const seenAt = Number(lastSeenAt || 0);
  if (!Number.isFinite(seenAt) || seenAt <= 0) return safeScore;
  const ageMs = Math.max(0, nowMs - seenAt);
  const halfLifeMs = Math.max(HALF_LIFE_DAY_MS, halfLifeDays * HALF_LIFE_DAY_MS);
  if (halfLifeMs <= 0) return safeScore;
  const decay = Math.pow(0.5, ageMs / halfLifeMs);
  return safeScore * decay;
}

function listFieldCandidates(fieldState, fieldKey, nowMs) {
  const config = resolveFieldConfig(fieldKey);
  const candidates = fieldState?.candidates && typeof fieldState.candidates === "object" ? fieldState.candidates : {};
  return Object.entries(candidates)
    .map(([candidateKey, candidateValue]) => {
      const score = computeDecayedScore(candidateValue?.score, candidateValue?.lastSeenAt, config.halfLifeDays, nowMs);
      return {
        candidateKey,
        candidate: candidateValue,
        score,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Number(b.candidate?.lastSeenAt || 0) - Number(a.candidate?.lastSeenAt || 0);
    });
}

function pruneFieldCandidates(fieldState, fieldKey, nowMs) {
  const entries = listFieldCandidates(fieldState, fieldKey, nowMs);
  if (entries.length <= IDENTITY_MAX_CANDIDATES_PER_FIELD) return;
  const keep = new Set(entries.slice(0, IDENTITY_MAX_CANDIDATES_PER_FIELD).map((entry) => entry.candidateKey));
  for (const candidateKey of Object.keys(fieldState.candidates || {})) {
    if (!keep.has(candidateKey)) delete fieldState.candidates[candidateKey];
  }
}

function selectFieldCandidate(fieldState, fieldKey, nowMs) {
  const config = resolveFieldConfig(fieldKey);
  const ranked = listFieldCandidates(fieldState, fieldKey, nowMs);
  const top = ranked[0];
  const second = ranked[1];

  if (!top) {
    fieldState.selectedValue = "";
    fieldState.selectedConfidence = 0;
    fieldState.selectedSource = "";
    fieldState.selectedUpdatedAt = 0;
    return {
      changed: false,
      selectedValue: "",
      selectedConfidence: 0,
      topScore: 0,
      secondScore: 0,
      reason: "no_candidates",
    };
  }

  const topScore = Number(top.score || 0);
  const secondScore = Number(second?.score || 0);
  const margin = topScore - secondScore;
  const priorKey = normalizeCandidateKey(fieldState.selectedValue || "");
  const topKey = normalizeCandidateKey(top.candidate?.value || top.candidateKey || "");
  const keepCurrent = priorKey && priorKey === topKey;
  const canActivate = topScore >= config.minActivation && (margin >= config.minMargin || keepCurrent);
  if (!canActivate && fieldState.selectedValue) {
    return {
      changed: false,
      selectedValue: String(fieldState.selectedValue || ""),
      selectedConfidence: clamp(fieldState.selectedConfidence || 0, 0, 1),
      topScore,
      secondScore,
      reason: "insufficient_margin",
    };
  }

  const nextValue = String(top.candidate?.value || "").trim();
  if (!nextValue) {
    return {
      changed: false,
      selectedValue: String(fieldState.selectedValue || ""),
      selectedConfidence: clamp(fieldState.selectedConfidence || 0, 0, 1),
      topScore,
      secondScore,
      reason: "empty_top_value",
    };
  }
  const dominance = clamp(margin / Math.max(0.0001, topScore + secondScore), 0, 1);
  const activationStrength = clamp(topScore / Math.max(0.0001, config.minActivation * 2.5), 0, 1);
  const candidateConfidence = clamp(Number(top.candidate?.confidence || 0), 0, 1);
  const nextConfidence = clamp(
    candidateConfidence * (0.35 + 0.4 * activationStrength) + dominance * 0.15,
    0,
    1,
  );

  const changed =
    normalizeCandidateKey(fieldState.selectedValue || "") !== normalizeCandidateKey(nextValue) ||
    Math.abs(Number(fieldState.selectedConfidence || 0) - nextConfidence) >= 0.015;
  fieldState.selectedValue = nextValue;
  fieldState.selectedConfidence = nextConfidence;
  fieldState.selectedSource = String(top.candidate?.source || "").trim();
  fieldState.selectedUpdatedAt = Number(top.candidate?.lastSeenAt || nowMs);
  return {
    changed,
    selectedValue: nextValue,
    selectedConfidence: nextConfidence,
    topScore,
    secondScore,
    reason: changed ? "updated" : "stable",
  };
}

function appendCandidateEvidence(candidate, signal) {
  const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
  evidence.unshift({
    source: signal.source,
    confidence: signal.confidence,
    timestampMs: signal.timestampMs,
    reason: signal.reason || "",
  });
  candidate.evidence = evidence.slice(0, IDENTITY_MAX_EVIDENCE_PER_CANDIDATE);
}

function applySignalToField(snapshot, signal, nowMs) {
  if (!IDENTITY_ALLOWED_FIELD_KEYS.has(signal.fieldKey)) {
    return {
      applied: false,
      rejected: true,
      blocked: false,
      reason: "unknown_field",
    };
  }
  const fieldState = getFieldState(snapshot, signal.fieldKey);
  if (!fieldState) {
    return {
      applied: false,
      rejected: true,
      blocked: false,
      reason: "missing_field_state",
    };
  }

  const config = resolveFieldConfig(signal.fieldKey);
  const sanitizedValue = sanitizeFieldValue(signal.fieldKey, signal.value, config.maxChars);
  if (!sanitizedValue) {
    return {
      applied: false,
      rejected: true,
      blocked: true,
      reason: "invalid_or_blocked_value",
    };
  }
  const sensitiveClassId = classifySensitiveInference(sanitizedValue);
  if (sensitiveClassId) {
    const sensitivePolicy = resolveSensitivePolicy(signal.source, signal.fieldKey, sensitiveClassId);
    if (!sensitivePolicy.allowed) {
      return {
        applied: false,
        rejected: true,
        blocked: true,
        reason: sensitivePolicy.reason,
      };
    }
  }

  const sourceWeight = clamp(IDENTITY_SIGNAL_SOURCE_WEIGHTS[signal.source] ?? IDENTITY_SIGNAL_SOURCE_WEIGHTS.unknown, 0.15, 1.2);
  const confidence = clamp(signal.confidence, 0.05, 1);
  const weightedScore = sourceWeight * confidence;
  const candidateKey = normalizeCandidateKey(sanitizedValue);
  if (!fieldState.candidates || typeof fieldState.candidates !== "object") {
    fieldState.candidates = {};
  }
  const existingCandidate = fieldState.candidates[candidateKey] || {
    value: sanitizedValue,
    score: 0,
    confidence: 0,
    source: signal.source,
    firstSeenAt: signal.timestampMs,
    lastSeenAt: signal.timestampMs,
    supportCount: 0,
    contradictionCount: 0,
    evidence: [],
  };
  const priorSelectedKey = normalizeCandidateKey(fieldState.selectedValue || "");
  if (priorSelectedKey && priorSelectedKey !== candidateKey && weightedScore >= config.minMargin) {
    const prior = fieldState.candidates[priorSelectedKey];
    if (prior && typeof prior === "object") {
      prior.contradictionCount = Number(prior.contradictionCount || 0) + 1;
    }
  }

  existingCandidate.value = sanitizedValue;
  existingCandidate.score = Math.max(0, Number(existingCandidate.score || 0)) + weightedScore;
  existingCandidate.confidence = clamp(Math.max(Number(existingCandidate.confidence || 0) * 0.9, confidence), 0, 1);
  existingCandidate.source = signal.source;
  existingCandidate.firstSeenAt = Number(existingCandidate.firstSeenAt || signal.timestampMs);
  existingCandidate.lastSeenAt = signal.timestampMs;
  existingCandidate.supportCount = Number(existingCandidate.supportCount || 0) + 1;
  appendCandidateEvidence(existingCandidate, signal);
  fieldState.candidates[candidateKey] = existingCandidate;
  pruneFieldCandidates(fieldState, signal.fieldKey, nowMs);
  const selected = selectFieldCandidate(fieldState, signal.fieldKey, nowMs);
  return {
    applied: true,
    rejected: false,
    blocked: false,
    reason: selected.reason,
    selected,
    signalValue: sanitizedValue,
  };
}

function classifyTurnIntent(userInputText = "") {
  const text = normalizeWhitespace(userInputText);
  if (!text) return null;
  for (const pattern of INTENT_PATTERNS) {
    if (!pattern.regex.test(text)) continue;
    return {
      fieldKey: "temporalSessionIntent.currentIntent",
      value: pattern.value,
      confidence: pattern.confidence,
      source: "transcript_observation",
      reason: "keyword_intent_match",
    };
  }
  return null;
}

function buildSignalsFromSettingsSeed(seed) {
  if (!seed || typeof seed !== "object") return [];
  const data = seed.data && typeof seed.data === "object" ? seed.data : {};
  return [
    { fieldKey: "stableTraits.assistantName", value: data.assistantName, confidence: 0.98, source: "settings_sync", reason: "seed_assistant_name" },
    { fieldKey: "stableTraits.preferredName", value: data.userName, confidence: 0.94, source: "settings_sync", reason: "seed_user_name" },
    { fieldKey: "stableTraits.occupationContext", value: data.occupation, confidence: 0.82, source: "settings_sync", reason: "seed_occupation" },
    { fieldKey: "stableTraits.preferredLanguage", value: data.preferredLanguage, confidence: 0.86, source: "settings_sync", reason: "seed_language" },
    { fieldKey: "stableTraits.communicationStyle", value: data.communicationStyle, confidence: 0.87, source: "settings_sync", reason: "seed_communication_style" },
    { fieldKey: "stableTraits.responseTone", value: data.tone, confidence: 0.87, source: "settings_sync", reason: "seed_tone" },
  ].filter((signal) => normalizeWhitespace(signal.value));
}

function buildSignalsFromPreferenceCapture(preferenceCapture) {
  const preferredName = normalizeWhitespace(preferenceCapture?.preferences?.preferredName || "");
  if (!preferredName) return [];
  return [{
    fieldKey: "stableTraits.preferredName",
    value: preferredName,
    confidence: 0.95,
    source: "explicit_user_preference",
    reason: "preferred_name_capture",
  }];
}

function buildSignalsFromRuntimeOverrides(params) {
  return [
    {
      fieldKey: "stableTraits.assistantName",
      value: params.runtimeAssistantName,
      confidence: 0.9,
      source: "explicit_user_preference",
      reason: "runtime_override_assistant_name",
    },
    {
      fieldKey: "stableTraits.communicationStyle",
      value: params.runtimeCommunicationStyle,
      confidence: 0.9,
      source: "explicit_user_preference",
      reason: "runtime_override_communication_style",
    },
    {
      fieldKey: "stableTraits.responseTone",
      value: params.runtimeTone,
      confidence: 0.9,
      source: "explicit_user_preference",
      reason: "runtime_override_tone",
    },
  ].filter((signal) => normalizeWhitespace(signal.value));
}

function buildSignalsFromUserText(userInputText, nlpConfidence = 1) {
  const text = normalizeWhitespace(userInputText);
  if (!text) return [];
  const lowered = text.toLowerCase();
  const confidenceFactor = clamp(nlpConfidence, 0.35, 1);
  const signals = [];
  if (/\b(brief|concise|short answer|keep it short)\b/i.test(lowered)) {
    signals.push({
      fieldKey: "dynamicPreferences.responseVerbosity",
      value: "concise",
      confidence: 0.74 * confidenceFactor,
      source: "user_message_inference",
      reason: "brevity_hint",
    });
  }
  if (/\b(detailed|deep dive|in depth|step by step|thorough)\b/i.test(lowered)) {
    signals.push({
      fieldKey: "dynamicPreferences.responseVerbosity",
      value: "detailed",
      confidence: 0.76 * confidenceFactor,
      source: "user_message_inference",
      reason: "detail_hint",
    });
    signals.push({
      fieldKey: "dynamicPreferences.explanationDepth",
      value: "deep",
      confidence: 0.72 * confidenceFactor,
      source: "user_message_inference",
      reason: "depth_hint",
    });
  }
  if (/\b(source|sources|citations?|links?)\b/i.test(lowered) && /\b(include|add|show|give|with)\b/i.test(lowered)) {
    signals.push({
      fieldKey: "dynamicPreferences.citationPreference",
      value: "always",
      confidence: 0.7 * confidenceFactor,
      source: "user_message_inference",
      reason: "citation_request",
    });
  }
  if (/\b(no source|without sources|no citations)\b/i.test(lowered)) {
    signals.push({
      fieldKey: "dynamicPreferences.citationPreference",
      value: "none",
      confidence: 0.68 * confidenceFactor,
      source: "user_message_inference",
      reason: "citation_avoidance",
    });
  }
  const intentSignal = classifyTurnIntent(text);
  if (intentSignal) {
    signals.push({
      ...intentSignal,
      confidence: clamp(intentSignal.confidence * confidenceFactor, 0.15, 1),
    });
  }
  return signals;
}

function buildSignalsFromSkillPreference({ skillName = "", directive = "" } = {}) {
  const normalizedSkill = normalizeWhitespace(skillName)
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!normalizedSkill) return [];
  const normalizedDirective = normalizeWhitespace(directive).toLowerCase();
  const signals = [{
    fieldKey: "dynamicPreferences.skillFocus",
    value: normalizedSkill,
    confidence: 0.8,
    source: "skill_preference_update",
    reason: "skill_override_saved",
  }];
  if (/\b(concise|brief|short)\b/.test(normalizedDirective)) {
    signals.push({
      fieldKey: "dynamicPreferences.responseVerbosity",
      value: "concise",
      confidence: 0.7,
      source: "skill_preference_update",
      reason: "skill_directive_brevity",
    });
  }
  if (/\b(detail|detailed|deep|thorough)\b/.test(normalizedDirective)) {
    signals.push({
      fieldKey: "dynamicPreferences.responseVerbosity",
      value: "detailed",
      confidence: 0.72,
      source: "skill_preference_update",
      reason: "skill_directive_detail",
    });
  }
  if (/\b(source|sources|citation|link)\b/.test(normalizedDirective)) {
    signals.push({
      fieldKey: "dynamicPreferences.citationPreference",
      value: "always",
      confidence: 0.71,
      source: "skill_preference_update",
      reason: "skill_directive_citations",
    });
  }
  return signals;
}

function buildSignalsFromMemoryFact(memoryFact) {
  const fact = normalizeWhitespace(memoryFact);
  if (!fact) return [];
  const out = [];
  const preferredNameMatch = fact.match(/\b(?:my\s+preferred\s+name\s+is|call me)\s+([a-z][a-z0-9' -]{1,40})$/i);
  if (preferredNameMatch?.[1]) {
    out.push({
      fieldKey: "stableTraits.preferredName",
      value: preferredNameMatch[1],
      confidence: 0.95,
      source: "memory_update",
      reason: "memory_fact_preferred_name",
    });
  }
  const languageMatch = fact.match(/\bmy\s+(?:language|preferred language)\s+is\s+([a-z -]{2,40})$/i);
  if (languageMatch?.[1]) {
    out.push({
      fieldKey: "stableTraits.preferredLanguage",
      value: languageMatch[1],
      confidence: 0.9,
      source: "memory_update",
      reason: "memory_fact_language",
    });
  }
  const occupationMatch = fact.match(/\bmy\s+occupation\s+is\s+(.+)$/i);
  if (occupationMatch?.[1]) {
    out.push({
      fieldKey: "stableTraits.occupationContext",
      value: occupationMatch[1],
      confidence: 0.84,
      source: "memory_update",
      reason: "memory_fact_occupation",
    });
  }
  if (/\bshort answer|concise|brief\b/i.test(fact)) {
    out.push({
      fieldKey: "dynamicPreferences.responseVerbosity",
      value: "concise",
      confidence: 0.7,
      source: "memory_update",
      reason: "memory_fact_brevity",
    });
  }
  if (/\bdetailed|in depth|step by step\b/i.test(fact)) {
    out.push({
      fieldKey: "dynamicPreferences.responseVerbosity",
      value: "detailed",
      confidence: 0.7,
      source: "memory_update",
      reason: "memory_fact_detail",
    });
  }
  return out;
}

function toSignalRecord(signal, nowMs) {
  return {
    fieldKey: String(signal.fieldKey || "").trim(),
    value: normalizeWhitespace(signal.value),
    confidence: clamp(Number(signal.confidence || 0), 0, 1),
    source: normalizeWhitespace(signal.source || "unknown").toLowerCase() || "unknown",
    reason: normalizeWhitespace(signal.reason || ""),
    timestampMs: Number.isFinite(Number(signal.timestampMs)) ? Number(signal.timestampMs) : nowMs,
  };
}

function applySignals(snapshot, rawSignals, nowMs) {
  const signals = Array.isArray(rawSignals) ? rawSignals.map((signal) => toSignalRecord(signal, nowMs)) : [];
  const appliedSignals = [];
  const rejectedSignals = [];
  const decisions = [];

  for (const signal of signals) {
    if (!signal.fieldKey || !signal.value) {
      rejectedSignals.push({
        ...signal,
        rejectedReason: "missing_field_or_value",
      });
      continue;
    }
    const outcome = applySignalToField(snapshot, signal, nowMs);
    if (!outcome.applied) {
      rejectedSignals.push({
        ...signal,
        rejectedReason: outcome.reason,
        blocked: outcome.blocked === true,
      });
      continue;
    }
    appliedSignals.push({
      ...signal,
      sanitizedValue: outcome.signalValue,
      applyReason: outcome.reason,
    });
    const selected = outcome.selected || {};
    decisions.push({
      fieldKey: signal.fieldKey,
      selectedValue: selected.selectedValue || "",
      selectedConfidence: clamp(Number(selected.selectedConfidence || 0), 0, 1),
      topScore: Number(selected.topScore || 0),
      secondScore: Number(selected.secondScore || 0),
      changed: selected.changed === true,
      reason: selected.reason || outcome.reason || "",
    });
  }

  const contradictionResolutions = decisions.filter((decision) => decision.changed && decision.secondScore > 0).length;
  return {
    appliedSignals,
    rejectedSignals,
    decisions,
    contradictionResolutions,
  };
}

function updateTemporalIntent(snapshot, conversationId, nowMs) {
  const intentState = snapshot.temporalSessionIntent?.currentIntent;
  const intentValue = normalizeWhitespace(intentState?.selectedValue || "");
  const intentConfidence = clamp(Number(intentState?.selectedConfidence || 0), 0, 1);
  if (intentValue && intentConfidence >= 0.55) {
    snapshot.temporalSessionIntent.lastConversationId = normalizeWhitespace(conversationId || "");
    snapshot.temporalSessionIntent.expiresAt = nowMs + IDENTITY_INTENT_TTL_MS;
  } else {
    snapshot.temporalSessionIntent.expiresAt = 0;
  }
}

function computeToolAffinityConfidence(score) {
  const safe = Math.max(0, Number(score || 0));
  if (safe <= 0) return 0;
  return clamp(0.25 + Math.log1p(safe) / 2.2, 0, 0.95);
}

function updateToolAffinity(snapshot, toolCalls, nowMs) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return [];
  if (!snapshot.toolAffinity || typeof snapshot.toolAffinity !== "object") snapshot.toolAffinity = {};
  const updates = [];
  for (const rawToolName of toolCalls) {
    const toolName = normalizeWhitespace(rawToolName).toLowerCase();
    if (!toolName) continue;
    const current = snapshot.toolAffinity[toolName] || {
      score: 0,
      count: 0,
      confidence: 0,
      lastUsedAt: 0,
    };
    const lastUsedAt = Number(current.lastUsedAt || 0);
    const ageMs = lastUsedAt > 0 ? Math.max(0, nowMs - lastUsedAt) : 0;
    const decay = Math.pow(0.5, ageMs / (21 * HALF_LIFE_DAY_MS));
    const nextScore = Number(current.score || 0) * decay + 1;
    const nextCount = Number(current.count || 0) + 1;
    snapshot.toolAffinity[toolName] = {
      score: nextScore,
      count: nextCount,
      confidence: computeToolAffinityConfidence(nextScore),
      lastUsedAt: nowMs,
    };
    updates.push({
      toolName,
      score: nextScore,
      count: nextCount,
      confidence: snapshot.toolAffinity[toolName].confidence,
    });
  }
  return updates;
}

function buildAuditBase(params, nowMs, paths) {
  return {
    ts: new Date(nowMs).toISOString(),
    timestampMs: nowMs,
    userContextId: paths.userContextId,
    conversationId: normalizeWhitespace(params.conversationId || ""),
    sessionKey: normalizeWhitespace(params.sessionKey || ""),
    source: normalizeWhitespace(params.source || "runtime").toLowerCase() || "runtime",
  };
}

function resolvePromptSection(snapshot, nowMs, maxPromptTokens) {
  return buildIdentityPromptSection(snapshot, {
    nowMs,
    maxTokens: clamp(Number(maxPromptTokens || IDENTITY_PROMPT_MAX_TOKENS), 80, 800),
  });
}

function applySignalBatch(params, signals, { eventType = "identity_signal_batch" } = {}) {
  const nowMs = Number(params.nowMs || Date.now());
  const paths = resolveIdentityPaths({
    userContextId: params.userContextId,
    workspaceDir: params.workspaceDir,
  });
  if (!paths.userContextId || !paths.snapshotPath) {
    return {
      snapshot: createEmptyIdentitySnapshot({ userContextId: "", nowMs }),
      promptSection: "",
      paths,
      appliedSignals: [],
      rejectedSignals: [],
      decisions: [],
      persisted: false,
      disabledReason: "missing_user_context",
    };
  }

  const loaded = recoverOrCreateIdentitySnapshot(paths, nowMs);
  const snapshot = loaded.snapshot;
  const outcome = applySignals(snapshot, signals, nowMs);
  updateTemporalIntent(snapshot, params.conversationId, nowMs);
  snapshot.updatedAt = nowMs;
  snapshot.metrics.appliedSignals = Number(snapshot.metrics?.appliedSignals || 0) + outcome.appliedSignals.length;
  snapshot.metrics.rejectedSignals = Number(snapshot.metrics?.rejectedSignals || 0) + outcome.rejectedSignals.length;
  snapshot.metrics.blockedSignals =
    Number(snapshot.metrics?.blockedSignals || 0) +
    outcome.rejectedSignals.filter((signal) => signal.blocked === true).length;
  snapshot.metrics.contradictionResolutions =
    Number(snapshot.metrics?.contradictionResolutions || 0) + Number(outcome.contradictionResolutions || 0);
  snapshot.metrics.lastDecisionAt = nowMs;

  persistIdentitySnapshot(paths, snapshot);

  const auditBase = buildAuditBase(params, nowMs, paths);
  appendIdentityAuditEvent(paths, {
    ...auditBase,
    eventType,
    appliedSignals: outcome.appliedSignals.slice(0, IDENTITY_MAX_AUDIT_SIGNALS),
    rejectedSignals: outcome.rejectedSignals.slice(0, IDENTITY_MAX_AUDIT_SIGNALS),
    decisions: outcome.decisions.slice(0, IDENTITY_MAX_AUDIT_DECISIONS),
    recoveredCorruptPath: loaded.recoveredCorruptPath || "",
  });

  return {
    snapshot,
    promptSection: resolvePromptSection(snapshot, nowMs, params.maxPromptTokens),
    paths,
    appliedSignals: outcome.appliedSignals,
    rejectedSignals: outcome.rejectedSignals,
    decisions: outcome.decisions,
    persisted: true,
    recoveredCorruptPath: loaded.recoveredCorruptPath || "",
  };
}

export function syncIdentityIntelligenceFromTurn(params = {}) {
  const nowMs = Number(params.nowMs || Date.now());
  const paths = resolveIdentityPaths({
    userContextId: params.userContextId,
    workspaceDir: params.workspaceDir,
  });
  if (!paths.userContextId) {
    return {
      snapshot: createEmptyIdentitySnapshot({ userContextId: "", nowMs }),
      promptSection: "",
      paths,
      appliedSignals: [],
      rejectedSignals: [],
      decisions: [],
      persisted: false,
      disabledReason: "missing_user_context",
    };
  }

  const seed = loadIdentitySeed(paths);
  const signals = [
    ...buildSignalsFromSettingsSeed(seed),
    ...buildSignalsFromRuntimeOverrides(params),
    ...buildSignalsFromPreferenceCapture(params.preferenceCapture),
    ...buildSignalsFromUserText(params.userInputText, params.nlpConfidence),
  ];
  return applySignalBatch(
    {
      ...params,
      nowMs,
    },
    signals,
    { eventType: "identity_turn_sync" },
  );
}

export function recordIdentityMemoryUpdate(params = {}) {
  const nowMs = Number(params.nowMs || Date.now());
  const signals = buildSignalsFromMemoryFact(params.memoryFact);
  if (signals.length === 0) {
    return {
      snapshot: null,
      promptSection: "",
      appliedSignals: [],
      rejectedSignals: [],
      decisions: [],
      persisted: false,
      skipped: true,
    };
  }
  return applySignalBatch(
    {
      ...params,
      nowMs,
    },
    signals,
    { eventType: "identity_memory_update" },
  );
}

export function recordIdentitySkillPreferenceUpdate(params = {}) {
  const nowMs = Number(params.nowMs || Date.now());
  const signals = buildSignalsFromSkillPreference({
    skillName: params.skillName,
    directive: params.directive,
  });
  if (signals.length === 0) {
    return {
      snapshot: null,
      promptSection: "",
      appliedSignals: [],
      rejectedSignals: [],
      decisions: [],
      persisted: false,
      skipped: true,
    };
  }
  return applySignalBatch(
    {
      ...params,
      nowMs,
    },
    signals,
    { eventType: "identity_skill_preference_update" },
  );
}

export function recordIdentityToolUsage(params = {}) {
  const nowMs = Number(params.nowMs || Date.now());
  const paths = resolveIdentityPaths({
    userContextId: params.userContextId,
    workspaceDir: params.workspaceDir,
  });
  if (!paths.userContextId || !paths.snapshotPath) {
    return {
      snapshot: createEmptyIdentitySnapshot({ userContextId: "", nowMs }),
      promptSection: "",
      paths,
      persisted: false,
      disabledReason: "missing_user_context",
      toolUpdates: [],
    };
  }
  const loaded = recoverOrCreateIdentitySnapshot(paths, nowMs);
  const snapshot = loaded.snapshot;
  const toolUpdates = updateToolAffinity(snapshot, params.toolCalls, nowMs);
  if (toolUpdates.length === 0) {
    return {
      snapshot,
      promptSection: resolvePromptSection(snapshot, nowMs, params.maxPromptTokens),
      paths,
      persisted: false,
      toolUpdates,
    };
  }
  snapshot.updatedAt = nowMs;
  snapshot.metrics.lastDecisionAt = nowMs;
  persistIdentitySnapshot(paths, snapshot);
  const auditBase = buildAuditBase(params, nowMs, paths);
  appendIdentityAuditEvent(paths, {
    ...auditBase,
    eventType: "identity_tool_usage",
    toolUpdates,
    recoveredCorruptPath: loaded.recoveredCorruptPath || "",
  });
  return {
    snapshot,
    promptSection: resolvePromptSection(snapshot, nowMs, params.maxPromptTokens),
    paths,
    persisted: true,
    toolUpdates,
  };
}

export function loadIdentityIntelligenceSnapshot(params = {}) {
  const nowMs = Number(params.nowMs || Date.now());
  const paths = resolveIdentityPaths({
    userContextId: params.userContextId,
    workspaceDir: params.workspaceDir,
  });
  if (!paths.userContextId || !paths.snapshotPath) {
    return {
      snapshot: createEmptyIdentitySnapshot({ userContextId: "", nowMs }),
      promptSection: "",
      paths,
      createdFresh: true,
      disabledReason: "missing_user_context",
    };
  }
  const loaded = recoverOrCreateIdentitySnapshot(paths, nowMs);
  return {
    snapshot: loaded.snapshot,
    promptSection: resolvePromptSection(
      loaded.snapshot,
      nowMs,
      params.maxPromptTokens,
    ),
    paths,
    createdFresh: loaded.createdFresh,
    recoveredCorruptPath: loaded.recoveredCorruptPath || "",
  };
}
