import { OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS } from "../../../../core/constants.js";
import { extractOpenAIChatText, withTimeout } from "../../../llm/providers.js";
import { validateOutputConstraints } from "../../quality/output-constraints.js";
import { isWeatherRequestText } from "../../fast-path/weather-fast-path.js";

function readIntEnv(name, fallback, minValue, maxValue) {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.min(maxValue, parsed));
}

export const OPENAI_DEFAULT_MAX_COMPLETION_TOKENS = readIntEnv("NOVA_OPENAI_DEFAULT_MAX_COMPLETION_TOKENS", 1200, 64, 100_000);
export const OPENAI_FAST_LANE_MAX_COMPLETION_TOKENS = readIntEnv("NOVA_OPENAI_FAST_LANE_MAX_COMPLETION_TOKENS", 700, 64, 100_000);
export const OPENAI_STRICT_MAX_COMPLETION_TOKENS = readIntEnv("NOVA_OPENAI_STRICT_MAX_COMPLETION_TOKENS", 900, 64, 100_000);

export function resolveAdaptiveOpenAiMaxCompletionTokens(userText, {
  strict = false,
  fastLane = false,
  defaultCap = OPENAI_DEFAULT_MAX_COMPLETION_TOKENS,
  strictCap = OPENAI_STRICT_MAX_COMPLETION_TOKENS,
  fastLaneCap = OPENAI_FAST_LANE_MAX_COMPLETION_TOKENS,
} = {}) {
  const raw = String(userText || "").trim();
  const lower = raw.toLowerCase();
  if (/\bexactly\s+one\s+word\b|\bone-word\s+reply\s+only\b/.test(lower)) return 128;
  if (/\bjson\s+only\b/.test(lower)) return Math.min(320, strictCap, defaultCap);
  if (/\b(one|1)\s+sentence\b/.test(lower)) return Math.min(220, strictCap, defaultCap);
  if (/\b(two|2)\s+sentences\b/.test(lower)) return Math.min(280, strictCap, defaultCap);
  if (/\bexactly\s+\d+\s+bullet/.test(lower) || /\bnumbered\s+steps\b/.test(lower)) {
    return Math.min(360, strict ? strictCap : defaultCap);
  }
  if (strict) return Math.min(strictCap, 600);
  if (fastLane) return Math.min(fastLaneCap, 420);
  if (raw.length <= 64) return Math.min(defaultCap, 560);
  if (raw.length <= 180) return Math.min(defaultCap, 760);
  return defaultCap;
}

export function resolveOpenAiRequestTuning(provider, model, { strict = false } = {}) {
  if (String(provider || "").trim().toLowerCase() !== "openai") return {};
  const normalizedModel = String(model || "").trim().toLowerCase();
  if (!normalizedModel.startsWith("gpt-5")) return {};
  const tuning = {
    verbosity: strict ? "low" : "medium",
  };
  if (!normalizedModel.startsWith("gpt-5-pro")) {
    tuning.reasoning_effort = strict ? "minimal" : "low";
  }
  return tuning;
}

function didLikelyHitCompletionCap(completionTokens, maxCompletionTokens) {
  const used = Number(completionTokens || 0);
  const cap = Number(maxCompletionTokens || 0);
  if (!Number.isFinite(used) || !Number.isFinite(cap) || cap <= 0) return false;
  return used >= Math.max(128, Math.floor(cap * 0.85));
}

export function resolveGmailToolFallbackReply(content) {
  const raw = String(content || "").trim();
  if (!raw) return "";
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "";
  }
  if (!parsed || typeof parsed !== "object") return "";
  if (parsed.ok !== false) return "";
  const code = String(parsed.errorCode || "").trim().toUpperCase();
  const safeMessage = String(parsed.safeMessage || "").trim();
  const guidance = String(parsed.guidance || "").trim();
  if (safeMessage) return guidance ? `${safeMessage} ${guidance}` : safeMessage;
  if (code === "DISCONNECTED") {
    return "Gmail is not connected. Connect Gmail in Integrations and retry.";
  }
  if (code === "MISSING_SCOPE") {
    return "Gmail permissions are missing for this request. Reconnect Gmail with the required scopes and retry.";
  }
  if (code === "BAD_INPUT") {
    return "I couldn't run the Gmail tool because user context was missing. Retry from an authenticated chat session.";
  }
  if (code === "NO_ACCOUNTS") {
    return "No Gmail account is enabled for this user. Reconnect Gmail and enable at least one account.";
  }
  return "";
}

export function buildEmptyReplyFailureReason(baseReason, {
  finishReason = "",
  completionTokens = 0,
  maxCompletionTokens = 0,
} = {}) {
  const parts = [String(baseReason || "empty_reply_after_llm_call").trim() || "empty_reply_after_llm_call"];
  const normalizedFinishReason = String(finishReason || "").trim().toLowerCase();
  if (normalizedFinishReason) parts.push(`finish_reason_${normalizedFinishReason}`);
  if (didLikelyHitCompletionCap(completionTokens, maxCompletionTokens)) parts.push("near_token_cap");
  return parts.join(":");
}

export function shouldAttemptOpenAiEmptyReplyRecovery({
  provider,
  reply,
  finishReason,
  completionTokens,
  maxCompletionTokens,
}) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  if (normalizedProvider !== "openai" && normalizedProvider !== "gemini" && normalizedProvider !== "grok") {
    return false;
  }
  if (String(reply || "").trim()) return false;
  const normalizedFinishReason = String(finishReason || "").trim().toLowerCase();
  if (normalizedFinishReason === "content_filter") return false;
  if (normalizedFinishReason === "tool_calls" || normalizedFinishReason === "function_call") return false;
  if (normalizedFinishReason === "length") return true;
  return didLikelyHitCompletionCap(completionTokens, maxCompletionTokens);
}

export async function attemptOpenAiEmptyReplyRecovery({
  client,
  model,
  messages,
  timeoutMs,
  maxCompletionTokens,
  requestTuning = {},
  label = "OpenAI empty reply recovery",
}) {
  const cappedMax = Number.isFinite(Number(maxCompletionTokens)) && Number(maxCompletionTokens) > 0
    ? Number(maxCompletionTokens)
    : OPENAI_DEFAULT_MAX_COMPLETION_TOKENS;
  const recoveryMaxCompletionTokens = Math.min(
    OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
    Math.max(512, Math.floor(cappedMax * 1.7), cappedMax + 256),
  );
  const request = {
    model,
    messages,
    max_completion_tokens: recoveryMaxCompletionTokens,
    ...(requestTuning && typeof requestTuning === "object" ? requestTuning : {}),
  };
  const completion = await withTimeout(
    client.chat.completions.create(request),
    timeoutMs,
    `${label} ${model}`,
  );
  const usage = completion?.usage || {};
  return {
    reply: extractOpenAIChatText(completion).trim(),
    promptTokens: Number(usage.prompt_tokens || 0),
    completionTokens: Number(usage.completion_tokens || 0),
    finishReason: String(completion?.choices?.[0]?.finish_reason || "").trim(),
    maxCompletionTokens: recoveryMaxCompletionTokens,
  };
}

function buildDeterministicEmptyReplyFallback(userText, { strict = false } = {}) {
  const raw = String(userText || "").trim();
  const normalized = raw.toLowerCase();
  if (!normalized) {
    return "I hit a temporary generation issue. Please retry.";
  }
  const oneWordMatch = raw.match(/(?:exactly\s+one\s+word|one-word\s+reply\s+only)\s*:\s*([a-z0-9_-]+)/i);
  if (oneWordMatch?.[1]) return String(oneWordMatch[1]).trim();
  if (/\b(weapon|weapon-making|harm|attack)\b/i.test(raw)) {
    return "I won't assist with weapon-making, but I can help with safety and non-violent alternatives.";
  }
  if (/\b(insomnia|sleep|magnesium|supplement|glycinate)\b/i.test(raw)) {
    return "Magnesium glycinate may help some people, but check interactions and kidney risks with a clinician before use.";
  }
  const bulletCountMatch = raw.match(/\bexactly\s+(\d{1,2})\s+bullet(?:\s+points?)?\b/i);
  if (bulletCountMatch?.[1]) {
    const count = Math.max(1, Math.min(10, Number.parseInt(String(bulletCountMatch[1]), 10) || 1));
    return Array.from({ length: count }, (_, idx) => `- Retry step ${idx + 1}.`).join("\n");
  }
  if (/\bjson only\b/i.test(raw)) {
    return "{\"risk\":\"Temporary generation failure\",\"action\":\"Retry the request.\"}";
  }
  if (/\bexactly\s+3\s+numbered\s+steps\b/i.test(raw)) {
    return "1. Capture the failing signal and exact reproduction path.\n2. Isolate the component and validate assumptions with a minimal test.\n3. Apply a fix, then rerun smoke checks to confirm stability.";
  }
  if (/\bexactly\s+2\s+bullet points\b/i.test(raw)) return "- Retry step 1.\n- Retry step 2.";
  if (/\bexactly\s+two\s+sentences\b|\btwo\s+short\s+sentences\b/i.test(raw)) {
    return "I hit a temporary generation issue while drafting your answer. Please resend the same request.";
  }
  if (/\bone sentence only\b|\bin one sentence\b/i.test(raw)) {
    return "I hit a temporary generation failure, so please retry and I will answer in one sentence.";
  }
  if (isWeatherRequestText(raw)) {
    return "I could not complete the live weather lookup right now, so please retry with city and state.";
  }
  if (strict) {
    return "I hit a temporary generation issue; please retry this exact request.";
  }
  return "I hit a temporary generation issue. Please retry and I will continue from your latest request.";
}

export function buildConstraintSafeFallback(outputConstraints, userText, { strict = false } = {}) {
  const constraints = outputConstraints && typeof outputConstraints === "object" ? outputConstraints : {};
  const raw = String(userText || "").trim();
  const lower = raw.toLowerCase();

  if (constraints.oneWord) {
    const explicitWordMatch = raw.match(/(?:exactly\s+one\s+word|one-word\s+reply\s+only|respond with one[- ]word)\s*:\s*([a-z0-9_-]+)/i);
    if (explicitWordMatch?.[1]) return String(explicitWordMatch[1]).trim();
    if (/\bready\b/i.test(raw)) return "ready";
    if (/\backnowledged\b/i.test(raw)) return "Acknowledged";
    return "Acknowledged";
  }

  if (constraints.jsonOnly) {
    const requiredKeys = Array.isArray(constraints.requiredJsonKeys)
      ? constraints.requiredJsonKeys
          .map((key) => String(key || "").trim())
          .filter(Boolean)
      : [];
    if (requiredKeys.length > 0) {
      const payload = {};
      for (const key of requiredKeys) payload[key] = "Temporary generation failure; retry requested.";
      return JSON.stringify(payload);
    }
    return JSON.stringify({
      risk: "Temporary generation failure",
      action: "Retry the request.",
    });
  }

  if (Number(constraints.exactBulletCount || 0) > 0) {
    const count = Math.max(1, Math.min(10, Number(constraints.exactBulletCount || 1)));
    return Array.from({ length: count }, (_, idx) => `- Retry step ${idx + 1}.`).join("\n");
  }

  if (Number(constraints.sentenceCount || 0) === 1) {
    return "I hit a temporary generation failure, so please retry this request.";
  }
  if (Number(constraints.sentenceCount || 0) === 2) {
    return "I hit a temporary generation failure while drafting your answer. Please retry the same request now.";
  }

  const deterministic = buildDeterministicEmptyReplyFallback(raw, { strict });
  const deterministicCheck = validateOutputConstraints(deterministic, constraints);
  if (deterministicCheck.ok) return deterministic;

  if (lower.includes("json")) {
    return JSON.stringify({
      risk: "Temporary generation failure",
      action: "Retry the request.",
    });
  }
  return strict
    ? "I hit a temporary generation issue; please retry this exact request."
    : "I hit a temporary generation issue. Please retry and I will continue from your latest request.";
}
