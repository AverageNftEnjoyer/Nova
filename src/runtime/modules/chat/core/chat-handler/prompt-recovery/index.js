import { OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS } from "../../../../../core/constants/index.js";
import { extractOpenAIChatText, withTimeout } from "../../../../llm/providers/index.js";

function readIntEnv(name, defaultValue, minValue, maxValue) {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
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

export function resolveGmailToolErrorReply(content) {
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
