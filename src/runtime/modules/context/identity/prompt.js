import { IDENTITY_PROMPT_MAX_TOKENS } from "./constants.js";

function countApproxTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 3.5);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toIsoDate(ts) {
  const ms = Number(ts || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "unknown";
  return new Date(ms).toISOString();
}

function compactForPrompt(lines, maxTokens) {
  const filtered = lines.map((line) => String(line || "").trim()).filter(Boolean);
  if (filtered.length === 0) return "";
  const budget = Math.max(60, Number(maxTokens || IDENTITY_PROMPT_MAX_TOKENS));
  const out = [];
  for (const line of filtered) {
    const candidate = [...out, line].join("\n");
    if (countApproxTokens(candidate) > budget) break;
    out.push(line);
  }
  return out.join("\n");
}

function renderField(label, fieldState, minConfidence = 0.55) {
  const state = fieldState && typeof fieldState === "object" ? fieldState : {};
  const value = String(state.selectedValue || "").trim();
  const confidence = clamp(Number(state.selectedConfidence || 0), 0, 1);
  if (!value || confidence < minConfidence) return "";
  const source = String(state.selectedSource || "unknown").trim();
  return `- ${label}: ${value} (confidence=${confidence.toFixed(2)}, source=${source}, updated=${toIsoDate(state.selectedUpdatedAt)})`;
}

function renderToolAffinity(toolAffinity) {
  const entries = Object.entries(toolAffinity && typeof toolAffinity === "object" ? toolAffinity : {})
    .map(([name, state]) => ({
      name: String(name || "").trim(),
      score: Number(state?.score || 0),
      confidence: clamp(Number(state?.confidence || 0), 0, 1),
      lastUsedAt: Number(state?.lastUsedAt || 0),
    }))
    .filter((entry) => entry.name && entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.lastUsedAt - a.lastUsedAt;
    })
    .slice(0, 3);
  if (entries.length === 0) return "";
  return `- Tool affinity: ${entries.map((entry) => `${entry.name}(${entry.confidence.toFixed(2)})`).join(", ")}`;
}

export function buildIdentityPromptSection(snapshot, opts = {}) {
  const identity = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!identity || !identity.userContextId) return "";
  const nowMs = Number(opts.nowMs || Date.now());
  const intentExpiresAt = Number(identity.temporalSessionIntent?.expiresAt || 0);
  const intentIsFresh = Number.isFinite(intentExpiresAt) && intentExpiresAt > nowMs;
  const lines = [
    "Identity intelligence layer (user-scoped, auditable, confidence-gated):",
    renderField("Preferred user name", identity.stableTraits?.preferredName, 0.58),
    renderField("Preferred language", identity.stableTraits?.preferredLanguage, 0.56),
    renderField("Communication style", identity.stableTraits?.communicationStyle, 0.58),
    renderField("Response tone", identity.stableTraits?.responseTone, 0.58),
    renderField("Assistant display name", identity.stableTraits?.assistantName, 0.56),
    renderField("Occupation context", identity.stableTraits?.occupationContext, 0.6),
    renderField("Verbosity preference", identity.dynamicPreferences?.responseVerbosity, 0.62),
    renderField("Explanation depth", identity.dynamicPreferences?.explanationDepth, 0.62),
    renderField("Citation preference", identity.dynamicPreferences?.citationPreference, 0.62),
    renderField("Current skill focus", identity.dynamicPreferences?.skillFocus, 0.62),
    intentIsFresh
      ? renderField("Current session intent", identity.temporalSessionIntent?.currentIntent, 0.6)
      : "",
    renderToolAffinity(identity.toolAffinity),
    "- Guardrails: ignore low-confidence traits; never infer sensitive attributes; never mix data across user contexts.",
  ];

  const maxTokens = clamp(
    Number(opts.maxTokens || IDENTITY_PROMPT_MAX_TOKENS),
    80,
    800,
  );
  return compactForPrompt(lines, maxTokens);
}
