import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { ROOT_WORKSPACE_DIR, USER_CONTEXT_ROOT } from "../../../core/constants.js";
import { sessionRuntime } from "../../infrastructure/config.js";
import { describeUnknownError } from "../../llm/providers.js";

const DEV_CONVERSATION_LOG_ENABLED =
  String(process.env.NOVA_DEV_CONVERSATION_LOG_ENABLED || "1").trim() !== "0";
const DEV_CONVERSATION_LOG_REDACT =
  String(process.env.NOVA_DEV_CONVERSATION_LOG_REDACT || "0").trim() === "1";
const DEV_CONVERSATION_LOG_MAX_TEXT_CHARS = Math.max(
  120,
  Number.parseInt(process.env.NOVA_DEV_CONVERSATION_LOG_MAX_TEXT_CHARS || "2400", 10) || 2400,
);
const DEV_CONVERSATION_LOG_HASH_SALT = String(process.env.NOVA_DEV_CONVERSATION_LOG_HASH_SALT || "").trim();
const DEV_CONVERSATION_LOG_FILENAME = String(
  process.env.NOVA_DEV_CONVERSATION_LOG_FILENAME || "conversation-dev.jsonl",
).trim() || "conversation-dev.jsonl";
const DEV_CONVERSATION_GLOBAL_LOG_ENABLED =
  String(process.env.NOVA_DEV_CONVERSATION_GLOBAL_LOG_ENABLED || "1").trim() !== "0";
const DEV_CONVERSATION_GLOBAL_LOG_PATH = path.join(
  ROOT_WORKSPACE_DIR,
  ".agent",
  "logs",
  "conversation-dev-all.jsonl",
);
const DEV_CONVERSATION_GLOBAL_ARCHIVE_MIRROR_ENABLED =
  String(process.env.NOVA_DEV_CONVERSATION_GLOBAL_ARCHIVE_MIRROR_ENABLED || "1").trim() !== "0";
const DEV_CONVERSATION_SCAN_WARN_ENABLED =
  String(process.env.NOVA_DEV_CONVERSATION_SCAN_WARN_ENABLED || "1").trim() !== "0";
const DEV_CONVERSATION_SCAN_WARN_SCORE = Math.max(
  0,
  Math.min(100, Number.parseInt(process.env.NOVA_DEV_CONVERSATION_SCAN_WARN_SCORE || "75", 10) || 75),
);
const TOOL_LOOP_ALERT_WINDOW_MS = Math.max(
  60_000,
  Number.parseInt(process.env.NOVA_TOOL_LOOP_ALERT_WINDOW_MS || "900000", 10) || 900_000,
);
const TOOL_LOOP_ALERT_MIN_SAMPLES = Math.max(
  1,
  Number.parseInt(process.env.NOVA_TOOL_LOOP_ALERT_MIN_SAMPLES || "25", 10) || 25,
);
const TOOL_LOOP_ALERT_BUDGET_EXHAUSTED_RATE = Math.max(
  0,
  Math.min(1, Number.parseFloat(process.env.NOVA_TOOL_LOOP_ALERT_BUDGET_EXHAUSTED_RATE || "0.05") || 0.05),
);
const TOOL_LOOP_ALERT_STEP_TIMEOUT_RATE = Math.max(
  0,
  Math.min(1, Number.parseFloat(process.env.NOVA_TOOL_LOOP_ALERT_STEP_TIMEOUT_RATE || "0.10") || 0.1),
);
const TOOL_LOOP_ALERT_TOOL_TIMEOUT_RATE = Math.max(
  0,
  Math.min(1, Number.parseFloat(process.env.NOVA_TOOL_LOOP_ALERT_TOOL_TIMEOUT_RATE || "0.10") || 0.1),
);
const TOOL_LOOP_ALERT_CAP_RATE = Math.max(
  0,
  Math.min(1, Number.parseFloat(process.env.NOVA_TOOL_LOOP_ALERT_CAP_RATE || "0.20") || 0.2),
);
const TOOL_LOOP_ALERT_WARN_COOLDOWN_MS = Math.max(
  30_000,
  Number.parseInt(process.env.NOVA_TOOL_LOOP_ALERT_WARN_COOLDOWN_MS || "300000", 10) || 300_000,
);
const ANNOUNCED_LOG_PATHS = new Set();
const TOOL_LOOP_ALERT_WINDOW_BY_SCOPE = new Map();
const TOOL_LOOP_ALERT_LAST_WARN_BY_SCOPE = new Map();

function normalizeUserContextId(value) {
  return sessionRuntime.normalizeUserContextId(String(value || ""));
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function hashText(value) {
  const text = normalizeText(value);
  return createHash("sha256")
    .update(`${DEV_CONVERSATION_LOG_HASH_SALT}|${text}`, "utf8")
    .digest("hex");
}

function captureText(value) {
  const text = normalizeText(value);
  const chars = text.length;
  if (!text) {
    return {
      redacted: DEV_CONVERSATION_LOG_REDACT,
      chars: 0,
      text: "",
    };
  }

  if (DEV_CONVERSATION_LOG_REDACT) {
    return {
      redacted: true,
      chars,
      sha256: hashText(text),
      text: "[redacted]",
    };
  }

  const truncated = chars > DEV_CONVERSATION_LOG_MAX_TEXT_CHARS;
  return {
    redacted: false,
    chars,
    truncated,
    text: truncated ? `${text.slice(0, DEV_CONVERSATION_LOG_MAX_TEXT_CHARS)}...` : text,
  };
}

function resolveLogPath(userContextId) {
  const scopedUserContextId = normalizeUserContextId(userContextId);
  if (!scopedUserContextId) {
    return path.join(ROOT_WORKSPACE_DIR, "archive", "logs", "conversation-dev-anonymous.jsonl");
  }
  return path.join(USER_CONTEXT_ROOT, scopedUserContextId, "logs", DEV_CONVERSATION_LOG_FILENAME);
}

function resolveGlobalArchiveMirrorPath(tsIso) {
  const day = String(tsIso || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  return path.join(ROOT_WORKSPACE_DIR, ".agent", "logs", "archive", `conversation-dev-all-${day}.jsonl`);
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeToolExecutions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      return {
        name: String(item.name || "").trim().toLowerCase(),
        status: String(item.status || "").trim().toLowerCase() || "unknown",
        durationMs: Number.isFinite(Number(item.durationMs)) ? Number(item.durationMs) : 0,
        resultPreview: captureText(String(item.resultPreview || "")),
        ...(item.error ? { error: String(item.error) } : {}),
      };
    })
    .filter((item) => item && item.name);
}

function normalizeLatencyStages(value) {
  if (!value || typeof value !== "object") return {};
  const entries = Object.entries(value)
    .map(([key, rawMs]) => {
      const stage = String(key || "").trim().toLowerCase();
      const durationMs = Number(rawMs);
      if (!stage || !Number.isFinite(durationMs) || durationMs <= 0) return null;
      return [stage, Math.max(0, Math.floor(durationMs))];
    })
    .filter(Boolean)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  return Object.fromEntries(entries);
}

function normalizeMemoryDiagnostics(value) {
  if (!value || typeof value !== "object") return null;
  const mode = String(value.mode || "").trim().toLowerCase();
  const fallbackReason = String(value.fallbackReason || "").trim().toLowerCase();
  const out = {
    hasSearch: value.hasSearch === true,
    updatedAtMs: Number.isFinite(Number(value.updatedAtMs)) ? Number(value.updatedAtMs) : 0,
    mode: mode || "hybrid",
    staleSourcesBefore: Number.isFinite(Number(value.staleSourcesBefore)) ? Number(value.staleSourcesBefore) : 0,
    staleSourcesAfter: Number.isFinite(Number(value.staleSourcesAfter)) ? Number(value.staleSourcesAfter) : 0,
    staleReindexAttempted: value.staleReindexAttempted === true,
    staleReindexCompleted: value.staleReindexCompleted === true,
    staleReindexTimedOut: value.staleReindexTimedOut === true,
    fallbackUsed: value.fallbackUsed === true,
    indexFallbackUsed: value.indexFallbackUsed === true,
    latencyMs: Number.isFinite(Number(value.latencyMs)) ? Number(value.latencyMs) : 0,
    resultCount: Number.isFinite(Number(value.resultCount)) ? Number(value.resultCount) : 0,
  };
  if (fallbackReason) out.fallbackReason = fallbackReason;
  return out;
}

function normalizeToolLoopGuardrails(value) {
  if (!value || typeof value !== "object") return null;
  return {
    maxDurationMs: Number.isFinite(Number(value.maxDurationMs)) ? Number(value.maxDurationMs) : 0,
    requestTimeoutMs: Number.isFinite(Number(value.requestTimeoutMs)) ? Number(value.requestTimeoutMs) : 0,
    toolExecTimeoutMs: Number.isFinite(Number(value.toolExecTimeoutMs)) ? Number(value.toolExecTimeoutMs) : 0,
    recoveryTimeoutMs: Number.isFinite(Number(value.recoveryTimeoutMs)) ? Number(value.recoveryTimeoutMs) : 0,
    maxToolCallsPerStep: Number.isFinite(Number(value.maxToolCallsPerStep)) ? Number(value.maxToolCallsPerStep) : 0,
    budgetExhausted: value.budgetExhausted === true,
    stepTimeouts: Number.isFinite(Number(value.stepTimeouts)) ? Number(value.stepTimeouts) : 0,
    toolExecutionTimeouts: Number.isFinite(Number(value.toolExecutionTimeouts)) ? Number(value.toolExecutionTimeouts) : 0,
    recoveryBudgetExhausted: value.recoveryBudgetExhausted === true,
    cappedToolCalls: Number.isFinite(Number(value.cappedToolCalls)) ? Number(value.cappedToolCalls) : 0,
  };
}

function evaluateToolLoopGuardrailAlerts({ userContextId, toolLoopGuardrails, route, tsMs }) {
  if (!toolLoopGuardrails || typeof toolLoopGuardrails !== "object") {
    return {
      triggered: false,
      sampleCount: 0,
      rates: null,
      thresholds: null,
      reasons: [],
      scope: userContextId || "anonymous",
    };
  }

  const routeText = String(route || "").toLowerCase();
  if (!routeText.includes("tool_loop")) {
    return {
      triggered: false,
      sampleCount: 0,
      rates: null,
      thresholds: null,
      reasons: [],
      scope: userContextId || "anonymous",
    };
  }

  const scope = String(userContextId || "anonymous").trim() || "anonymous";
  const nowMs = Number.isFinite(Number(tsMs)) ? Number(tsMs) : Date.now();
  const thresholdWindowMs = TOOL_LOOP_ALERT_WINDOW_MS;
  const minTs = nowMs - thresholdWindowMs;
  const currentEntry = {
    tsMs: nowMs,
    budgetExhausted: toolLoopGuardrails.budgetExhausted === true,
    stepTimeout: Number(toolLoopGuardrails.stepTimeouts || 0) > 0,
    toolExecTimeout: Number(toolLoopGuardrails.toolExecutionTimeouts || 0) > 0,
    callCapped: Number(toolLoopGuardrails.cappedToolCalls || 0) > 0,
  };

  const previous = Array.isArray(TOOL_LOOP_ALERT_WINDOW_BY_SCOPE.get(scope))
    ? TOOL_LOOP_ALERT_WINDOW_BY_SCOPE.get(scope)
    : [];
  const windowed = [...previous.filter((entry) => Number(entry?.tsMs || 0) >= minTs), currentEntry];
  TOOL_LOOP_ALERT_WINDOW_BY_SCOPE.set(scope, windowed);

  const sampleCount = windowed.length;
  if (sampleCount < TOOL_LOOP_ALERT_MIN_SAMPLES) {
    return {
      triggered: false,
      sampleCount,
      rates: null,
      thresholds: null,
      reasons: [],
      scope,
    };
  }

  const countWhere = (predicate) => windowed.reduce((acc, entry) => (predicate(entry) ? acc + 1 : acc), 0);
  const rates = {
    budgetExhausted: countWhere((entry) => entry.budgetExhausted) / sampleCount,
    stepTimeout: countWhere((entry) => entry.stepTimeout) / sampleCount,
    toolExecTimeout: countWhere((entry) => entry.toolExecTimeout) / sampleCount,
    callCapped: countWhere((entry) => entry.callCapped) / sampleCount,
  };
  const thresholds = {
    budgetExhausted: TOOL_LOOP_ALERT_BUDGET_EXHAUSTED_RATE,
    stepTimeout: TOOL_LOOP_ALERT_STEP_TIMEOUT_RATE,
    toolExecTimeout: TOOL_LOOP_ALERT_TOOL_TIMEOUT_RATE,
    callCapped: TOOL_LOOP_ALERT_CAP_RATE,
  };
  const reasons = [];
  if (rates.budgetExhausted > thresholds.budgetExhausted) reasons.push("budget_exhausted_rate");
  if (rates.stepTimeout > thresholds.stepTimeout) reasons.push("step_timeout_rate");
  if (rates.toolExecTimeout > thresholds.toolExecTimeout) reasons.push("tool_exec_timeout_rate");
  if (rates.callCapped > thresholds.callCapped) reasons.push("tool_call_cap_rate");
  const triggered = reasons.length > 0;

  if (triggered) {
    const lastWarnAt = Number(TOOL_LOOP_ALERT_LAST_WARN_BY_SCOPE.get(scope) || 0);
    if (!Number.isFinite(lastWarnAt) || nowMs - lastWarnAt >= TOOL_LOOP_ALERT_WARN_COOLDOWN_MS) {
      TOOL_LOOP_ALERT_LAST_WARN_BY_SCOPE.set(scope, nowMs);
      console.warn(
        `[ToolLoopAlert] scope=${scope} samples=${sampleCount}` +
          ` rates=${JSON.stringify({
            budgetExhausted: Number(rates.budgetExhausted.toFixed(4)),
            stepTimeout: Number(rates.stepTimeout.toFixed(4)),
            toolExecTimeout: Number(rates.toolExecTimeout.toFixed(4)),
            callCapped: Number(rates.callCapped.toFixed(4)),
          })}` +
          ` thresholds=${JSON.stringify(thresholds)}` +
          ` reasons=${reasons.join(",")}`,
      );
    }
  }

  return {
    triggered,
    sampleCount,
    rates: {
      budgetExhausted: Number(rates.budgetExhausted.toFixed(4)),
      stepTimeout: Number(rates.stepTimeout.toFixed(4)),
      toolExecTimeout: Number(rates.toolExecTimeout.toFixed(4)),
      callCapped: Number(rates.callCapped.toFixed(4)),
    },
    thresholds,
    reasons,
    scope,
  };
}

function inferHotLatencyStage(latencyStages, latencyMs) {
  const entries = Object.entries(latencyStages || {});
  if (entries.length === 0) return { hotPath: "", hotPathRatio: 0 };
  const [hotPath = "", hotMsRaw = 0] = entries[0] || [];
  const hotMs = Number(hotMsRaw || 0);
  const total = Number(latencyMs || 0);
  const ratio = total > 0 ? hotMs / total : 0;
  return {
    hotPath,
    hotPathRatio: Number.isFinite(ratio) ? Number(ratio.toFixed(4)) : 0,
  };
}

function inferQuality(payload) {
  const tags = [];
  const latencyMs = Number(payload.latencyMs || 0);
  const latencyStages = normalizeLatencyStages(payload.latencyStages);
  const assistantReply = normalizeText(payload.assistantReplyText);
  const userInput = normalizeText(payload.userInputText || payload.cleanedInputText);
  const promptTokens = Number(payload.promptTokens || 0);
  const completionTokens = Number(payload.completionTokens || 0);
  const totalTokens = Number(payload.totalTokens || promptTokens + completionTokens);
  const toolCalls = normalizeList(payload.toolCalls);
  const errorText = normalizeText(payload.error);
  const correctionPassCount = Number(payload.correctionPassCount || 0);
  const fallbackStage = String(payload.fallbackStage || "").trim().toLowerCase();
  const fallbackReason = String(payload.fallbackReason || "").trim().toLowerCase();
  const { hotPath, hotPathRatio } = inferHotLatencyStage(latencyStages, latencyMs);
  const runtimeToolInitMs = Number(latencyStages.runtime_tool_init || 0);
  const enrichmentMs = Number(latencyStages.context_enrichment || 0);
  const llmGenerationMs = Number(latencyStages.llm_generation || 0);

  if (errorText) tags.push("runtime_error");
  if (!assistantReply) tags.push("empty_reply");
  if (latencyMs > 20000) tags.push("slow_response");
  if (runtimeToolInitMs > 1400) tags.push("slow_tool_runtime_init");
  if (enrichmentMs > 2200) tags.push("slow_context_enrichment");
  if (llmGenerationMs > 0 && latencyMs > 0 && llmGenerationMs / latencyMs >= 0.7) tags.push("llm_dominant_latency");
  if (hotPath && hotPathRatio >= 0.6) tags.push(`hot_path_${hotPath}`);
  if (correctionPassCount > 0) tags.push("constraint_correction_pass");
  if (toolCalls.length > 0 && !errorText) tags.push("tool_augmented");
  if (payload.memoryRecallUsed) tags.push("memory_recall_used");
  if (payload.webSearchPreloadUsed) tags.push("web_preload_used");
  if (payload.linkUnderstandingUsed) tags.push("link_context_used");
  if (/\b(i can'?t|i could(n't)?|not sure|unsure|unable)\b/i.test(assistantReply)) tags.push("uncertain_reply");
  if (assistantReply && assistantReply.length < 24) tags.push("brief_reply");
  if (promptTokens > 5500) tags.push("high_prompt_tokens");
  if (totalTokens > 9000) tags.push("high_total_tokens");
  if (userInput.length < 4) tags.push("very_short_input");
  if (Number(payload.nlpCorrectionCount || 0) >= 2) tags.push("noisy_input");
  if (fallbackStage) tags.push("degraded_fallback");
  const toolLoopGuardrails = payload.toolLoopGuardrails && typeof payload.toolLoopGuardrails === "object"
    ? payload.toolLoopGuardrails
    : null;
  if (toolLoopGuardrails) {
    if (toolLoopGuardrails.budgetExhausted === true) tags.push("tool_loop_budget_exhausted");
    if (Number(toolLoopGuardrails.stepTimeouts || 0) > 0) tags.push("tool_loop_step_timeout");
    if (Number(toolLoopGuardrails.toolExecutionTimeouts || 0) > 0) tags.push("tool_exec_timeout");
    if (Number(toolLoopGuardrails.cappedToolCalls || 0) > 0) tags.push("tool_call_cap_applied");
  }

  let score = 100;
  if (tags.includes("runtime_error")) score -= 50;
  if (tags.includes("empty_reply")) score -= 25;
  if (tags.includes("slow_response")) score -= 10;
  if (tags.includes("slow_tool_runtime_init")) score -= 6;
  if (tags.includes("slow_context_enrichment")) score -= 6;
  if (tags.includes("llm_dominant_latency")) score -= 3;
  if (tags.includes("high_prompt_tokens")) score -= 6;
  if (tags.includes("high_total_tokens")) score -= 4;
  if (tags.includes("brief_reply") && !tags.includes("tool_augmented")) score -= 4;
  if (tags.includes("uncertain_reply")) score -= 5;
  if (tags.includes("degraded_fallback")) score -= 20;
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    tags,
    fallback: {
      stage: fallbackStage,
      reason: fallbackReason,
      hadCandidateBeforeFallback: payload.hadCandidateBeforeFallback === true,
    },
  };
}

export function appendDevConversationLog(event = {}) {
  if (!DEV_CONVERSATION_LOG_ENABLED) return;
  try {
    const ts = new Date().toISOString();
    const userContextId = normalizeUserContextId(event.userContextId || "");
    const conversationId = String(event.conversationId || "").trim();
    const sessionKey = String(event.sessionKey || "").trim();
    const source = String(event.source || "").trim().toLowerCase() || "unknown";
    const sender = String(event.sender || "").trim();
    const route = String(event.route || "unclassified").trim().toLowerCase();
    const provider = String(event.provider || "").trim().toLowerCase();
    const model = String(event.model || "").trim();
    const requestHints =
      event.requestHints && typeof event.requestHints === "object" ? event.requestHints : {};
    const retries = Array.isArray(event.retries) ? event.retries : [];
    const latencyMs = Number.isFinite(Number(event.latencyMs)) ? Number(event.latencyMs) : 0;
    const latencyStages = normalizeLatencyStages(event.latencyStages);
    const inferredHotPath = inferHotLatencyStage(latencyStages, latencyMs).hotPath;
    const latencyHotPath = String(event.latencyHotPath || inferredHotPath || "").trim().toLowerCase();
    const correctionPassCount = Number.isFinite(Number(event.correctionPassCount))
      ? Number(event.correctionPassCount)
      : 0;

    const payload = {
      turnId: randomUUID(),
      ts,
      source,
      sender,
      userContextId,
      conversationId,
      sessionKey,
      route,
      input: {
        user: captureText(event.userInputText),
        cleaned: captureText(event.cleanedInputText),
      },
      output: {
        assistant: captureText(event.assistantReplyText),
      },
      routing: {
        provider,
        model,
        requestHints,
        canRunToolLoop: event.canRunToolLoop === true,
        canRunWebSearch: event.canRunWebSearch === true,
        canRunWebFetch: event.canRunWebFetch === true,
      },
      tools: {
        calls: normalizeList(event.toolCalls),
        executions: normalizeToolExecutions(event.toolExecutions),
      },
      memory: {
        recallUsed: event.memoryRecallUsed === true,
        diagnostics: normalizeMemoryDiagnostics(event.memorySearchDiagnostics),
        autoCaptured: Number.isFinite(Number(event.memoryAutoCaptured))
          ? Number(event.memoryAutoCaptured)
          : 0,
      },
      usage: {
        promptTokens: Number.isFinite(Number(event.promptTokens)) ? Number(event.promptTokens) : 0,
        completionTokens: Number.isFinite(Number(event.completionTokens))
          ? Number(event.completionTokens)
          : 0,
        totalTokens: Number.isFinite(Number(event.totalTokens)) ? Number(event.totalTokens) : 0,
        estimatedCostUsd:
          Number.isFinite(Number(event.estimatedCostUsd)) ? Number(event.estimatedCostUsd) : null,
      },
      timing: {
        latencyMs,
        stages: latencyStages,
        hotPath: latencyHotPath,
        correctionPassCount,
      },
      retries,
      status: {
        ok: event.ok !== false,
        error: String(event.error || "").trim(),
        fallbackReason: String(event.fallbackReason || "").trim().toLowerCase(),
        fallbackStage: String(event.fallbackStage || "").trim().toLowerCase(),
        hadCandidateBeforeFallback: event.hadCandidateBeforeFallback === true,
      },
      toolLoopGuardrails: normalizeToolLoopGuardrails(event.toolLoopGuardrails),
      ops: {
        toolLoopAlerts: null,
      },
      nlp: {
        bypass: event.nlpBypass === true,
        confidence: Number.isFinite(Number(event.nlpConfidence)) ? Number(event.nlpConfidence) : null,
        correctionCount: Number.isFinite(Number(event.nlpCorrectionCount))
          ? Number(event.nlpCorrectionCount)
          : 0,
      },
    };

    payload.quality = inferQuality({
      userInputText: event.userInputText,
      cleanedInputText: event.cleanedInputText,
      assistantReplyText: event.assistantReplyText,
      latencyMs: payload.timing.latencyMs,
      latencyStages: payload.timing.stages,
      correctionPassCount: payload.timing.correctionPassCount,
      fallbackReason: payload.status.fallbackReason,
      fallbackStage: payload.status.fallbackStage,
      hadCandidateBeforeFallback: payload.status.hadCandidateBeforeFallback,
      promptTokens: payload.usage.promptTokens,
      completionTokens: payload.usage.completionTokens,
      totalTokens: payload.usage.totalTokens,
      toolCalls: payload.tools.calls,
      memoryRecallUsed: payload.memory.recallUsed,
      webSearchPreloadUsed: event.webSearchPreloadUsed === true,
      linkUnderstandingUsed: event.linkUnderstandingUsed === true,
      nlpCorrectionCount: payload.nlp.correctionCount,
      error: payload.status.error,
      toolLoopGuardrails: payload.toolLoopGuardrails,
    });

    payload.ops.toolLoopAlerts = evaluateToolLoopGuardrailAlerts({
      userContextId,
      toolLoopGuardrails: payload.toolLoopGuardrails,
      route,
      tsMs: Date.parse(ts),
    });

    const targetPath = resolveLogPath(userContextId);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.appendFileSync(targetPath, `${JSON.stringify(payload)}\n`, "utf8");
    if (!ANNOUNCED_LOG_PATHS.has(targetPath)) {
      ANNOUNCED_LOG_PATHS.add(targetPath);
      console.log(`[DevConversationLog] writing logs to ${targetPath}`);
    }

    if (DEV_CONVERSATION_GLOBAL_LOG_ENABLED) {
      fs.mkdirSync(path.dirname(DEV_CONVERSATION_GLOBAL_LOG_PATH), { recursive: true });
      fs.appendFileSync(DEV_CONVERSATION_GLOBAL_LOG_PATH, `${JSON.stringify(payload)}\n`, "utf8");
      if (!ANNOUNCED_LOG_PATHS.has(DEV_CONVERSATION_GLOBAL_LOG_PATH)) {
        ANNOUNCED_LOG_PATHS.add(DEV_CONVERSATION_GLOBAL_LOG_PATH);
        console.log(`[DevConversationLog] writing aggregate logs to ${DEV_CONVERSATION_GLOBAL_LOG_PATH}`);
      }
      if (DEV_CONVERSATION_GLOBAL_ARCHIVE_MIRROR_ENABLED) {
        const mirrorPath = resolveGlobalArchiveMirrorPath(ts);
        fs.mkdirSync(path.dirname(mirrorPath), { recursive: true });
        fs.appendFileSync(mirrorPath, `${JSON.stringify(payload)}\n`, "utf8");
        if (!ANNOUNCED_LOG_PATHS.has(mirrorPath)) {
          ANNOUNCED_LOG_PATHS.add(mirrorPath);
          console.log(`[DevConversationLog] writing aggregate archive mirror to ${mirrorPath}`);
        }
      }
    }

    if (DEV_CONVERSATION_SCAN_WARN_ENABLED) {
      const tags = Array.isArray(payload.quality?.tags) ? payload.quality.tags : [];
      const score = Number.isFinite(Number(payload.quality?.score)) ? Number(payload.quality.score) : 100;
      const shouldWarn =
        score <= DEV_CONVERSATION_SCAN_WARN_SCORE || tags.includes("runtime_error") || tags.includes("empty_reply");
      if (shouldWarn) {
        console.warn(
          `[DevConversationScan] score=${score}` +
            ` tags=${tags.join(",") || "none"}` +
            ` route=${route}` +
            ` conversation=${conversationId || "unknown"}` +
            ` user=${userContextId || "anonymous"}`,
        );
      }
    }
  } catch (err) {
    console.error(`[DevConversationLog] Failed to append log: ${describeUnknownError(err)}`);
  }
}
