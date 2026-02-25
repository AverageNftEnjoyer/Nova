// ===== Chat Handler =====
// handleInput dispatcher split into focused sub-handlers.
// Bug Fix 2: Tool loop errors are now caught, logged, and surfaced to HUD.

import { createRequire } from "module";

// NLP preprocessing (compiled TS → dist/nlp/preprocess.js)
// Loaded lazily so a missing build does not crash the runtime.
let _preprocess = null;
function getPreprocess() {
  if (_preprocess) return _preprocess;
  try {
    const require = createRequire(import.meta.url);
    // Resolve relative to the project root dist output
    const mod = require("../../../../../dist/nlp/preprocess.js");
    _preprocess = mod.preprocess ?? mod.default?.preprocess ?? null;
  } catch {
    // Build not available yet — fall back to identity
    _preprocess = (text) => ({ raw_text: text, clean_text: text, corrections: [], confidence: 1.0 });
  }
  return _preprocess;
}
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GROK_MODEL,
  DEFAULT_GEMINI_MODEL,
  ENABLE_PROVIDER_FALLBACK,
  OPENAI_FALLBACK_MODEL,
  OPENAI_REQUEST_TIMEOUT_MS,
  TOOL_LOOP_REQUEST_TIMEOUT_MS,
  TOOL_LOOP_ENABLED,
  TOOL_LOOP_MAX_STEPS,
  TOOL_LOOP_MAX_DURATION_MS,
  TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS,
  TOOL_LOOP_RECOVERY_TIMEOUT_MS,
  TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP,
  CLAUDE_CHAT_MAX_TOKENS,
  OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
  MEMORY_LOOP_ENABLED,
  SESSION_MAX_TURNS,
  SESSION_MAX_HISTORY_TOKENS,
  MAX_PROMPT_TOKENS,
  PROMPT_RESPONSE_RESERVE_TOKENS,
  PROMPT_HISTORY_TARGET_TOKENS,
  PROMPT_MIN_HISTORY_TOKENS,
  PROMPT_CONTEXT_SECTION_MAX_TOKENS,
  PROMPT_BUDGET_DEBUG,
  AGENT_PROMPT_MODE,
  ROOT_WORKSPACE_DIR,
  ROUTING_PREFERENCE,
  ROUTING_ALLOW_ACTIVE_OVERRIDE,
  ROUTING_PREFERRED_PROVIDERS,
} from "../../../core/constants.js";
import { sessionRuntime, toolRuntime, wakeWordRuntime } from "../../infrastructure/config.js";
import { resolvePersonaWorkspaceDir, appendRawStream, trimHistoryMessagesByTokenBudget, cachedLoadIntegrationsRuntime } from "../../context/persona-context.js";
import { captureUserPreferencesFromMessage, buildUserPreferencePromptSection } from "../../context/user-preferences.js";
import {
  recordIdentitySkillPreferenceUpdate,
  recordIdentityToolUsage,
  syncIdentityIntelligenceFromTurn,
} from "../../context/identity/engine.js";
import { syncPersonalityFromTurn } from "../../context/personality/index.js";
import { isMemoryUpdateRequest, extractAutoMemoryFacts } from "../../context/memory.js";
import { applySkillPreferenceUpdateFromMessage } from "../../context/skill-preferences.js";
import { buildRuntimeSkillsPrompt } from "../../context/skills.js";
import { shouldBuildWorkflowFromPrompt, shouldConfirmWorkflowFromPrompt, shouldPreloadWebSearch, replyClaimsNoLiveAccess, buildWebSearchReadableReply, buildWeatherWebSummary } from "../routing/intent-router.js";
import { speak, playThinking, getBusy, setBusy, getCurrentVoice, normalizeRuntimeTone, runtimeToneDirective } from "../../audio/voice.js";
import {
  broadcast,
  broadcastState,
  broadcastThinkingStatus,
  broadcastMessage,
  createAssistantStreamId,
  broadcastAssistantStreamStart,
  broadcastAssistantStreamDelta,
  broadcastAssistantStreamDone,
  consumeHudOpTokenForSensitiveAction,
} from "../../infrastructure/hud-gateway.js";
import {
  claudeMessagesCreate,
  claudeMessagesStream,
  describeUnknownError,
  estimateTokenCostUsd,
  extractOpenAIChatText,
  getOpenAIClient,
  resolveConfiguredChatRuntime,
  streamOpenAiChatCompletion,
  toErrorDetails,
  withTimeout,
} from "../../llm/providers.js";
import { buildSystemPromptWithPersona, enforcePromptTokenBound } from "../../../core/context-prompt.js";
import { buildAgentSystemPrompt, PromptMode } from "../../context/system-prompt.js";
import { buildPersonaPrompt } from "../../context/bootstrap.js";
import { shouldSkipDuplicateInbound } from "../routing/inbound-dedupe.js";
import { normalizeAssistantReply, normalizeAssistantSpeechText } from "../quality/reply-normalizer.js";
import { normalizeInboundUserText } from "../quality/response-quality-guard.js";
import { appendDevConversationLog } from "../telemetry/dev-conversation-log.js";
import { runChatKitShadowEvaluation } from "../telemetry/chatkit-shadow.js";
import { runChatKitServeAttempt } from "../telemetry/chatkit-serving.js";
import { parseOutputConstraints, validateOutputConstraints } from "../quality/output-constraints.js";
import { runLinkUnderstanding, formatLinkUnderstandingForPrompt } from "../analysis/link-understanding.js";
import { appendBudgetedPromptSection, computeHistoryTokenBudget, resolveDynamicPromptBudget } from "../prompt/prompt-budget.js";
import {
  buildLatencyTurnPolicy,
  resolveToolExecutionPolicy,
} from "../telemetry/latency-policy.js";
import { createChatLatencyTelemetry } from "../telemetry/latency-telemetry.js";
import { detectSuspiciousPatterns, wrapWebContent } from "../../context/external-content.js";
import {
  applyMemoryFactsToWorkspace,
  buildMissionConfirmReply,
  clearPendingMissionConfirm,
  getPendingMissionConfirm,
  hashShadowPayload,
  isMissionConfirmNo,
  isMissionConfirmYes,
  resolveConversationId,
  setPendingMissionConfirm,
  stripAssistantInvocation,
  stripMissionConfirmPrefix,
  summarizeToolResultPreview,
} from "./chat-utils.js";
import { createToolLoopBudget, capToolCallsPerStep, isLikelyTimeoutError } from "./tool-loop-guardrails.js";
import {
  sendDirectAssistantReply,
  handleMemoryUpdate,
  handleShutdown,
  handleSpotify,
  handleWorkflowBuild,
} from "./chat-special-handlers.js";
import {
  isWeatherRequestText,
  tryWeatherFastPathReply,
  getPendingWeatherConfirm,
  setPendingWeatherConfirm,
  clearPendingWeatherConfirm,
  isWeatherConfirmYes,
  isWeatherConfirmNo,
} from "../fast-path/weather-fast-path.js";
import {
  isCryptoRequestText,
  isExplicitCryptoReportRequest,
  tryCryptoFastPathReply,
} from "../fast-path/crypto-fast-path.js";
import {
  cacheRecentCryptoReport,
  handleDuplicateCryptoReportRequest,
} from "./crypto-report-dedupe.js";
import {
  applyShortTermContextTurnClassification,
  readShortTermContextState,
  summarizeShortTermContextForPrompt,
  upsertShortTermContextState,
  clearShortTermContextState,
} from "./short-term-context-engine.js";
import { getShortTermContextPolicy } from "./short-term-context-policies.js";

const MEMORY_RECALL_TIMEOUT_MS = Number.parseInt(process.env.NOVA_MEMORY_RECALL_TIMEOUT_MS || "450", 10);
const WEB_PRELOAD_TIMEOUT_MS = Number.parseInt(process.env.NOVA_WEB_PRELOAD_TIMEOUT_MS || "900", 10);
const LINK_PRELOAD_TIMEOUT_MS = Number.parseInt(process.env.NOVA_LINK_PRELOAD_TIMEOUT_MS || "900", 10);
const HUD_API_BASE_URL = String(process.env.NOVA_HUD_API_BASE_URL || "http://localhost:3000").trim().replace(/\/+$/, "");
const INTEGRATIONS_SNAPSHOT_ENSURE_TTL_MS = Math.max(
  5_000,
  Number.parseInt(process.env.NOVA_INTEGRATIONS_SNAPSHOT_ENSURE_TTL_MS || "20000", 10) || 20_000,
);
const integrationsSnapshotEnsuredAtByUser = new Map();
const OPENAI_DEFAULT_MAX_COMPLETION_TOKENS = Number.parseInt(
  process.env.NOVA_OPENAI_DEFAULT_MAX_COMPLETION_TOKENS || "1200",
  10,
);
const OPENAI_FAST_LANE_MAX_COMPLETION_TOKENS = Number.parseInt(
  process.env.NOVA_OPENAI_FAST_LANE_MAX_COMPLETION_TOKENS || "700",
  10,
);
const OPENAI_STRICT_MAX_COMPLETION_TOKENS = Number.parseInt(
  process.env.NOVA_OPENAI_STRICT_MAX_COMPLETION_TOKENS || "900",
  10,
);

async function ensureRuntimeIntegrationsSnapshot(userContextId, supabaseAccessToken) {
  const userId = sessionRuntime.normalizeUserContextId(String(userContextId || ""));
  const token = String(supabaseAccessToken || "").trim();
  if (!userId || !token) return;
  const now = Date.now();
  const last = Number(integrationsSnapshotEnsuredAtByUser.get(userId) || 0);
  if (now - last < INTEGRATIONS_SNAPSHOT_ENSURE_TTL_MS) return;
  try {
    const res = await fetch(`${HUD_API_BASE_URL}/api/integrations/config/runtime-snapshot`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.ok) {
      integrationsSnapshotEnsuredAtByUser.set(userId, now);
      return;
    }
    console.warn(`[IntegrationsSnapshot] ensure failed status=${res.status} user=${userId}`);
  } catch (err) {
    console.warn(`[IntegrationsSnapshot] ensure failed user=${userId} error=${describeUnknownError(err)}`);
  }
}

function mergeMissionPrompt(basePrompt, incomingText) {
  const base = String(basePrompt || "").replace(/\s+/g, " ").trim();
  const incomingRaw = stripAssistantInvocation(incomingText);
  const incoming = String(incomingRaw || incomingText || "").replace(/\s+/g, " ").trim();
  if (!base) return incoming;
  if (!incoming) return base;
  const baseNorm = base.toLowerCase();
  const incomingNorm = incoming.toLowerCase();
  if (incomingNorm === baseNorm) return base;
  if (baseNorm.includes(incomingNorm)) return base;
  if (incomingNorm.includes(baseNorm)) return incoming;
  return `${base}. ${incoming}`.replace(/\s+/g, " ").trim();
}

function resolveAdaptiveOpenAiMaxCompletionTokens(userText, {
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

function resolveOpenAiRequestTuning(provider, model, { strict = false } = {}) {
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

function resolveGmailToolFallbackReply(content) {
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

function buildEmptyReplyFailureReason(baseReason, {
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

function shouldAttemptOpenAiEmptyReplyRecovery({
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

async function attemptOpenAiEmptyReplyRecovery({
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

function buildConstraintSafeFallback(outputConstraints, userText, { strict = false } = {}) {
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


// ===== Core chat request =====
async function executeChatRequest(text, ctx, llmCtx, requestHints = {}) {
  const { source, sender, sessionContext, sessionKey, useVoice, ttsVoice, userContextId, conversationId,
    runtimeTone, runtimeCommunicationStyle, runtimeAssistantName, runtimeCustomInstructions,
    runtimeProactivity, runtimeHumorLevel, runtimeRiskTolerance, runtimeStructurePreference, runtimeChallengeLevel,
    raw_text: displayText, hudOpToken } = ctx;
  // displayText: original user text for UI/transcript; text: clean_text for LLM/tools
  const uiText = displayText || text;
  const {
    activeChatRuntime,
    activeOpenAiCompatibleClient,
    selectedChatModel,
    runtimeTools,
    availableTools,
    canRunToolLoop,
    canRunWebSearch,
    canRunWebFetch,
    turnPolicy,
    executionPolicy,
    latencyTelemetry: inboundLatencyTelemetry,
  } = llmCtx;
  const fastLaneSimpleChat = requestHints.fastLaneSimpleChat === true;
  const shouldPreloadWebSearchForTurn = executionPolicy?.shouldPreloadWebSearch === true;
  const shouldPreloadWebFetchForTurn = executionPolicy?.shouldPreloadWebFetch === true;
  const shouldAttemptMemoryRecallForTurn = executionPolicy?.shouldAttemptMemoryRecall === true;
  const outputConstraints = parseOutputConstraints(text);
  const hasStrictOutputRequirements = outputConstraints.enabled === true && Boolean(outputConstraints.instructions);
  const requestedOpenAiMaxCompletionTokens = resolveAdaptiveOpenAiMaxCompletionTokens(text, {
    strict: hasStrictOutputRequirements,
    fastLane: fastLaneSimpleChat,
    defaultCap: OPENAI_DEFAULT_MAX_COMPLETION_TOKENS,
    strictCap: OPENAI_STRICT_MAX_COMPLETION_TOKENS,
    fastLaneCap: OPENAI_FAST_LANE_MAX_COMPLETION_TOKENS,
  });
  const openAiMaxCompletionTokens = Math.max(
    256,
    Math.min(
      OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
      Number.isFinite(Number(requestedOpenAiMaxCompletionTokens))
        ? Number(requestedOpenAiMaxCompletionTokens)
        : OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
    ),
  );
  const openAiRequestTuningForModel = (modelName) =>
    resolveOpenAiRequestTuning(activeChatRuntime.provider, modelName, {
      strict: hasStrictOutputRequirements,
    });
  const startedAt = Date.now();
  const latencyTelemetry = inboundLatencyTelemetry || createChatLatencyTelemetry(startedAt);
  const observedToolCalls = [];
  const toolExecutions = [];
  const retries = [];
  let usedMemoryRecall = false;
  let usedWebSearchPreload = false;
  let usedLinkUnderstanding = false;
  let responseRoute = "llm";
  let memoryAutoCaptured = 0;
  let preparedPromptHash = "";
  let emittedAssistantDelta = false;
  let preferredNamePinned = false;
  let preferenceProfileUpdated = 0;
  let identityAppliedSignals = 0;
  let identityRejectedSignals = 0;
  let identityPromptIncluded = false;
  let outputConstraintCorrectionPasses = 0;
  let fallbackReason = "";
  let fallbackStage = "";
  let hadCandidateBeforeFallback = false;
  const markFallback = (stage, reason, candidateReply = "") => {
    fallbackStage = String(stage || "").trim();
    fallbackReason = String(reason || "").trim();
    if (String(candidateReply || "").trim()) hadCandidateBeforeFallback = true;
    if (fallbackStage && !String(responseRoute || "").includes(fallbackStage)) {
      responseRoute = `${responseRoute}_${fallbackStage}`;
    }
  };
  const runSummary = {
    route: "chat",
    ok: false,
    source,
    sessionKey,
    userContextId: userContextId || "",
    provider: activeChatRuntime.provider,
    model: selectedChatModel,
    reply: "",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    latencyMs: 0,
    toolCalls: [],
    toolExecutions: [],
    retries: [],
    requestHints: {
      fastLaneSimpleChat,
      strictOutputConstraints: hasStrictOutputRequirements,
      preferredNamePinned: false,
      identityProfileActive: false,
      identityAppliedSignals: 0,
      identityRejectedSignals: 0,
      identityPromptIncluded: false,
      identityToolAffinityUpdated: 0,
      latencyPolicy: turnPolicy?.fastLaneSimpleChat === true ? "fast_lane" : "default",
      openAiMaxCompletionTokens: openAiMaxCompletionTokens,
    },
    canRunToolLoop,
    canRunWebSearch,
    canRunWebFetch,
    responseRoute,
    memoryAutoCaptured: 0,
    preferenceProfileUpdated: 0,
    memoryRecallUsed: false,
    memorySearchDiagnostics: null,
    webSearchPreloadUsed: false,
    linkUnderstandingUsed: false,
    correctionPassCount: 0,
    latencyStages: {},
    latencyHotPath: "",
    promptHash: "",
    error: "",
    fallbackReason: "",
    fallbackStage: "",
    hadCandidateBeforeFallback: false,
    toolLoopGuardrails: null,
  };
  const personaWorkspaceDir = resolvePersonaWorkspaceDir(userContextId);
  if (turnPolicy && typeof turnPolicy === "object") {
    runSummary.requestHints.weatherIntent = turnPolicy.weatherIntent === true;
    runSummary.requestHints.cryptoIntent = turnPolicy.cryptoIntent === true;
    runSummary.requestHints.toolLoopCandidate = turnPolicy.toolLoopCandidate === true;
    runSummary.requestHints.memoryRecallCandidate = turnPolicy.memoryRecallCandidate === true;
  }
  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Analyzing request", userContextId);
  const nlpCorrectionCount = Array.isArray(ctx.nlpCorrections) ? ctx.nlpCorrections.length : 0;
  broadcastMessage("user", uiText, source, conversationId, userContextId, {
    nlpCleanText: text !== uiText ? text : undefined,
    nlpConfidence: Number.isFinite(Number(ctx.nlpConfidence)) ? Number(ctx.nlpConfidence) : undefined,
    nlpCorrectionCount,
    nlpBypass: ctx.nlpBypass === true,
  });
  if (useVoice) playThinking();

  let systemPrompt = "";
  let historyMessages = [];
  let messages = [];
  let promptContextPrepared = false;

  const preparePromptContext = async () => {
    if (promptContextPrepared) return;
    const promptAssemblyStartedAt = Date.now();
    const preferenceCapture = captureUserPreferencesFromMessage({
      userContextId,
      workspaceDir: personaWorkspaceDir,
      userInputText: uiText,
      nlpConfidence: Number.isFinite(Number(ctx?.nlpConfidence)) ? Number(ctx.nlpConfidence) : 1,
      source,
      sessionKey,
    });
    preferenceProfileUpdated = Array.isArray(preferenceCapture?.updatedKeys) ? preferenceCapture.updatedKeys.length : 0;
    const preferencePrompt = buildUserPreferencePromptSection(preferenceCapture?.preferences || {});
    preferredNamePinned = Boolean(preferenceCapture?.preferences?.preferredName);
    runSummary.requestHints.preferredNamePinned = preferredNamePinned;
    if (preferenceProfileUpdated > 0) {
      console.log(
        `[Preference] Updated ${preferenceProfileUpdated} field(s) for ${userContextId || "anonymous"} at ${String(preferenceCapture?.filePath || "unknown")}.`,
      );
    }

    const runtimeSkillsPrompt = fastLaneSimpleChat ? "" : buildRuntimeSkillsPrompt(personaWorkspaceDir, text);
    const { systemPrompt: baseSystemPrompt, tokenBreakdown } = buildSystemPromptWithPersona({
      buildAgentSystemPrompt,
      buildPersonaPrompt,
      workspaceDir: personaWorkspaceDir,
      promptArgs: {
        workspaceDir: ROOT_WORKSPACE_DIR,
        promptMode:
          AGENT_PROMPT_MODE === PromptMode.MINIMAL || AGENT_PROMPT_MODE === PromptMode.NONE
            ? AGENT_PROMPT_MODE : PromptMode.FULL,
        memoryCitationsMode: String(process.env.NOVA_MEMORY_CITATIONS_MODE || "off").trim().toLowerCase() === "on" ? "on" : "off",
        userTimezone: process.env.NOVA_USER_TIMEZONE || "America/New_York",
        skillsPrompt: runtimeSkillsPrompt || process.env.NOVA_SKILLS_PROMPT || "",
        heartbeatPrompt: process.env.NOVA_HEARTBEAT_PROMPT || "",
        docsPath: process.env.NOVA_DOCS_PATH || "",
        ttsHint: "Keep voice responses concise, clear, and natural.",
        reasoningLevel: "off",
        runtimeInfo: {
          agentId: "nova-agent",
          host: process.env.COMPUTERNAME || "",
          os: process.platform,
          arch: process.arch,
          node: process.version,
          model: selectedChatModel,
          defaultModel: selectedChatModel,
          shell: process.env.ComSpec || process.env.SHELL || "",
          channel: source,
          capabilities: ["voice", "websocket"],
          repoRoot: process.env.ROOT_WORKSPACE_DIR || "",
        },
        workspaceNotes: [],
      },
    });

    systemPrompt = baseSystemPrompt;
    const personaOverlay = [
      "## Runtime Persona (HUD)",
      runtimeAssistantName ? `- Assistant name: ${runtimeAssistantName}` : "",
      runtimeCommunicationStyle ? `- Communication style: ${runtimeCommunicationStyle}` : "",
      `- Tone: ${runtimeTone}`,
      `- Tone behavior: ${runtimeToneDirective(runtimeTone)}`,
      runtimeCustomInstructions ? `- Custom instructions: ${runtimeCustomInstructions}` : "",
    ].filter(Boolean).join("\n");
    if (personaOverlay) systemPrompt += `\n\n${personaOverlay}`;

    const promptBudgetProfile = resolveDynamicPromptBudget({
      maxPromptTokens: MAX_PROMPT_TOKENS,
      responseReserveTokens: PROMPT_RESPONSE_RESERVE_TOKENS,
      historyTargetTokens: PROMPT_HISTORY_TARGET_TOKENS,
      sectionMaxTokens: PROMPT_CONTEXT_SECTION_MAX_TOKENS,
      fastLaneSimpleChat,
      strictOutputConstraints: hasStrictOutputRequirements,
    });
    runSummary.requestHints.latencyPolicy = promptBudgetProfile.profile;

    const promptBudgetOptions = {
      userMessage: text,
      maxPromptTokens: promptBudgetProfile.maxPromptTokens,
      responseReserveTokens: promptBudgetProfile.responseReserveTokens,
      historyTargetTokens: promptBudgetProfile.historyTargetTokens,
      sectionMaxTokens: promptBudgetProfile.sectionMaxTokens,
      debug: PROMPT_BUDGET_DEBUG,
    };

    if (preferencePrompt) {
      const appended = appendBudgetedPromptSection({
        ...promptBudgetOptions,
        prompt: systemPrompt,
        sectionTitle: "User Preference Memory",
        sectionBody: preferencePrompt,
      });
      if (appended.included) {
        systemPrompt = appended.prompt;
      } else {
        systemPrompt = `${systemPrompt}\n\n## User Preference Memory\n${preferencePrompt}`;
      }
    }

    const identitySync = syncIdentityIntelligenceFromTurn({
      userContextId,
      workspaceDir: personaWorkspaceDir,
      conversationId,
      sessionKey,
      source,
      userInputText: uiText,
      nlpConfidence: Number.isFinite(Number(ctx?.nlpConfidence)) ? Number(ctx.nlpConfidence) : 1,
      runtimeAssistantName,
      runtimeCommunicationStyle,
      runtimeTone,
      preferenceCapture,
      maxPromptTokens: Math.max(120, Math.floor(promptBudgetProfile.sectionMaxTokens * 0.9)),
    });
    const identityPrompt = String(identitySync?.promptSection || "").trim();
    identityAppliedSignals = Array.isArray(identitySync?.appliedSignals) ? identitySync.appliedSignals.length : 0;
    identityRejectedSignals = Array.isArray(identitySync?.rejectedSignals) ? identitySync.rejectedSignals.length : 0;
    if (identityPrompt) {
      const appended = appendBudgetedPromptSection({
        ...promptBudgetOptions,
        prompt: systemPrompt,
        sectionTitle: "Identity Intelligence",
        sectionBody: identityPrompt,
      });
      if (appended.included) {
        systemPrompt = appended.prompt;
        identityPromptIncluded = true;
      } else {
        systemPrompt = `${systemPrompt}\n\n## Identity Intelligence\n${identityPrompt}`;
        identityPromptIncluded = true;
      }
    }
    runSummary.requestHints.identityProfileActive = Boolean(identityPromptIncluded || identityAppliedSignals > 0);
    runSummary.requestHints.identityAppliedSignals = identityAppliedSignals;
    runSummary.requestHints.identityRejectedSignals = identityRejectedSignals;
    runSummary.requestHints.identityPromptIncluded = identityPromptIncluded;

    // ── Personality calibration ──────────────────────────────────────────────
    const personalitySync = syncPersonalityFromTurn({
      userContextId,
      workspaceDir: personaWorkspaceDir,
      userText: uiText,
      sessionIntent: identitySync?.snapshot?.temporalSessionIntent?.currentIntent,
      seedData: {
        proactivity: runtimeProactivity,
        humor_level: runtimeHumorLevel,
        risk_tolerance: runtimeRiskTolerance,
        structure_preference: runtimeStructurePreference,
        challenge_level: runtimeChallengeLevel,
      },
      conversationId,
      maxPromptTokens: Math.max(80, Math.floor(promptBudgetProfile.sectionMaxTokens * 0.6)),
    });
    const personalityPrompt = String(personalitySync?.promptSection || "").trim();
    if (personalityPrompt) {
      const appended = appendBudgetedPromptSection({
        ...promptBudgetOptions,
        prompt: systemPrompt,
        sectionTitle: "Personality Calibration",
        sectionBody: personalityPrompt,
      });
      systemPrompt = appended.included
        ? appended.prompt
        : `${systemPrompt}\n\n## Personality Calibration\n${personalityPrompt}`;
    }
    runSummary.requestHints.personalityAppliedSignals = personalitySync?.appliedSignals || 0;

    const shortTermContextSummary = String(requestHints?.assistantShortTermContextSummary || "").trim();
    if (shortTermContextSummary) {
      const sectionBody = [
        `follow_up: ${requestHints?.assistantShortTermFollowUp === true ? "true" : "false"}`,
        requestHints?.assistantTopicAffinityId ? `topic_affinity_id: ${String(requestHints.assistantTopicAffinityId)}` : "",
        shortTermContextSummary,
      ].filter(Boolean).join("\n");
      const appended = appendBudgetedPromptSection({
        ...promptBudgetOptions,
        prompt: systemPrompt,
        sectionTitle: "Short-Term Context",
        sectionBody,
      });
      if (appended.included) {
        systemPrompt = appended.prompt;
      } else {
        systemPrompt = `${systemPrompt}\n\n## Short-Term Context\n${sectionBody}`;
      }
    }

    const enrichmentTasks = [];
    if (shouldPreloadWebSearchForTurn && shouldPreloadWebSearch(text)) {
      enrichmentTasks.push(
        withTimeout(
          (async () => {
            const preloadResult = await runtimeTools.executeToolUse(
              { id: `tool_preload_${Date.now()}`, name: "web_search", input: { query: text }, type: "tool_use" },
              availableTools,
            );
            const preloadContent = String(preloadResult?.content || "").trim();
            if (!preloadContent || /^web_search error/i.test(preloadContent)) return null;
            const suspiciousPatterns = detectSuspiciousPatterns(preloadContent);
            if (suspiciousPatterns.length > 0) {
              console.warn(
                `[Security] suspicious web_search preload patterns=${suspiciousPatterns.length} session=${sessionKey}`,
              );
            }
            return {
              kind: "web_search",
              body: `Use these current results when answering:\n${wrapWebContent(preloadContent, "web_search")}`,
            };
          })(),
          Math.max(250, WEB_PRELOAD_TIMEOUT_MS),
          "Web search preload",
        ),
      );
    }

    if (shouldPreloadWebFetchForTurn) {
      enrichmentTasks.push(
        withTimeout(
          (async () => {
            const linkResult = await runLinkUnderstanding({
              text,
              runtimeTools,
              availableTools,
              maxLinks: 2,
              maxCharsPerLink: 1800,
            });
            const formatted = formatLinkUnderstandingForPrompt(linkResult.outputs, 3600);
            if (!formatted) return null;
            const suspiciousPatterns = detectSuspiciousPatterns(formatted);
            if (suspiciousPatterns.length > 0) {
              console.warn(
                `[Security] suspicious link context patterns=${suspiciousPatterns.length} session=${sessionKey}`,
              );
            }
            return {
              kind: "web_fetch",
              body: `Use this fetched URL context when relevant:\n${wrapWebContent(formatted, "web_fetch")}`,
            };
          })(),
          Math.max(250, LINK_PRELOAD_TIMEOUT_MS),
          "Link preload",
        ),
      );
    }

    if (shouldAttemptMemoryRecallForTurn && runtimeTools?.memoryManager && MEMORY_LOOP_ENABLED) {
      enrichmentTasks.push(
        (async () => {
          runtimeTools.memoryManager.warmSession();
          const memorySearchId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const recalled = await withTimeout(
            runtimeTools.memoryManager.searchWithDiagnostics
              ? runtimeTools.memoryManager.searchWithDiagnostics(text, 3, memorySearchId)
              : runtimeTools.memoryManager.search(text, 3),
            Math.max(150, MEMORY_RECALL_TIMEOUT_MS),
            "Memory recall search",
          );
          const recalledResults = Array.isArray(recalled?.results) ? recalled.results : Array.isArray(recalled) ? recalled : [];
          const diagnostics = recalled?.diagnostics
            || (runtimeTools.memoryManager.getSearchDiagnostics
              ? runtimeTools.memoryManager.getSearchDiagnostics(memorySearchId)
              : runtimeTools.memoryManager.getLastSearchDiagnostics?.());
          if (diagnostics) {
            runSummary.memorySearchDiagnostics = diagnostics;
          }
          if (!Array.isArray(recalledResults) || recalledResults.length === 0) return null;
          const memoryContext = recalledResults
            .map((item, idx) => `[${idx + 1}] ${String(item.source || "unknown")}\n${String(item.content || "").slice(0, 600)}`)
            .join("\n\n");
          return {
            kind: "memory",
            body: `Use this indexed context when relevant:\n${memoryContext}`,
          };
        })(),
      );
    }

    if (enrichmentTasks.length > 0) {
      const enrichmentStartedAt = Date.now();
      broadcastThinkingStatus("Gathering context", userContextId);
      const enrichmentResults = await Promise.allSettled(enrichmentTasks);
      for (const taskResult of enrichmentResults) {
        if (taskResult.status === "rejected") {
          const msg = describeUnknownError(taskResult.reason);
          if (/memory/i.test(msg)) console.warn(`[MemoryLoop] Search failed: ${msg}`);
          else if (/link/i.test(msg)) console.warn(`[ToolLoop] link understanding preload failed: ${msg}`);
          else console.warn(`[ToolLoop] web_search preload failed: ${msg}`);
          continue;
        }

        const taskValue = taskResult.value;
        if (!taskValue || !taskValue.kind || !taskValue.body) continue;
        if (taskValue.kind === "web_search") {
          const appended = appendBudgetedPromptSection({
            ...promptBudgetOptions,
            prompt: systemPrompt,
            sectionTitle: "Live Web Search Context",
            sectionBody: taskValue.body,
          });
          if (appended.included) {
            systemPrompt = appended.prompt;
            usedWebSearchPreload = true;
            latencyTelemetry.incrementCounter("web_search_preload_hits");
          }
          continue;
        }
        if (taskValue.kind === "web_fetch") {
          const appended = appendBudgetedPromptSection({
            ...promptBudgetOptions,
            prompt: systemPrompt,
            sectionTitle: "Link Context",
            sectionBody: taskValue.body,
          });
          if (appended.included) {
            systemPrompt = appended.prompt;
            usedLinkUnderstanding = true;
            observedToolCalls.push("web_fetch");
            latencyTelemetry.incrementCounter("web_fetch_preload_hits");
          }
          continue;
        }
        if (taskValue.kind === "memory") {
          const appended = appendBudgetedPromptSection({
            ...promptBudgetOptions,
            prompt: systemPrompt,
            sectionTitle: "Live Memory Recall",
            sectionBody: taskValue.body,
          });
          if (appended.included) {
            systemPrompt = appended.prompt;
            usedMemoryRecall = true;
            latencyTelemetry.incrementCounter("memory_recall_hits");
          }
        }
      }
      latencyTelemetry.addStage("context_enrichment", Date.now() - enrichmentStartedAt);
    }

    if (hasStrictOutputRequirements) {
      const appended = appendBudgetedPromptSection({
        ...promptBudgetOptions,
        prompt: systemPrompt,
        sectionTitle: "Strict Output Requirements",
        sectionBody: outputConstraints.instructions,
      });
      if (appended.included) {
        systemPrompt = appended.prompt;
      } else {
        systemPrompt = `${systemPrompt}\n\n## Strict Output Requirements\n${outputConstraints.instructions}`;
      }
    }

    const tokenInfo = enforcePromptTokenBound(systemPrompt, text, MAX_PROMPT_TOKENS);
    broadcastThinkingStatus("Planning response", userContextId);
    console.log(`[Prompt] Tokens - persona: ${tokenBreakdown.persona}, user: ${tokenInfo.userTokens}`);

    const priorTurns = sessionRuntime.limitTranscriptTurns(sessionContext.transcript, SESSION_MAX_TURNS);
    const rawHistoryMessages = sessionRuntime.transcriptToChatMessages(priorTurns);
    const computedHistoryTokenBudget = computeHistoryTokenBudget({
      maxPromptTokens: promptBudgetProfile.maxPromptTokens,
      responseReserveTokens: promptBudgetProfile.responseReserveTokens,
      userMessage: text,
      systemPrompt,
      maxHistoryTokens: SESSION_MAX_HISTORY_TOKENS,
      minHistoryTokens: PROMPT_MIN_HISTORY_TOKENS,
      targetHistoryTokens: promptBudgetProfile.historyTargetTokens,
    });
    const historyBudget = trimHistoryMessagesByTokenBudget(rawHistoryMessages, computedHistoryTokenBudget);
    historyMessages = historyBudget.messages;
    console.log(
      `[Session] key=${sessionKey} sender=${sender || "unknown"} prior_turns=${priorTurns.length} injected_messages=${historyMessages.length} trimmed_messages=${historyBudget.trimmed} history_tokens=${historyBudget.tokens} history_budget=${computedHistoryTokenBudget}`,
    );

    messages = [
      { role: "system", content: systemPrompt },
      ...historyMessages,
      { role: "user", content: text },
    ];
    preparedPromptHash = hashShadowPayload(JSON.stringify(messages));
    latencyTelemetry.addStage("prompt_assembly", Date.now() - promptAssemblyStartedAt);
    promptContextPrepared = true;
  };

  const assistantStreamId = createAssistantStreamId();
  broadcastAssistantStreamStart(assistantStreamId, source, undefined, conversationId, userContextId);

  let reply = "";
  try {
    let promptTokens = 0;
    let completionTokens = 0;
    let modelUsed = selectedChatModel;
    let providerUsed = activeChatRuntime.provider;
    const fastPathStartedAt = Date.now();
    let weatherFastResult = { reply: "", suggestedLocation: "", needsConfirmation: false, toolCall: "" };
    let cryptoFastResult = { reply: "", source: "", toolCall: "" };
    if (!hasStrictOutputRequirements) {
      weatherFastResult = await tryWeatherFastPathReply({
        text,
        runtimeTools,
        availableTools,
        canRunWebSearch,
      });
      if (!String(weatherFastResult?.reply || "").trim()) {
        cryptoFastResult = await tryCryptoFastPathReply({
          text,
          runtimeTools,
          availableTools,
          userContextId,
          conversationId,
          workspaceDir: personaWorkspaceDir,
        });
      }
    }
    latencyTelemetry.addStage("fast_path", Date.now() - fastPathStartedAt);
    let llmStartedAt = 0;

    if (String(weatherFastResult?.reply || "").trim()) {
      responseRoute = "weather_fast_path";
      const suggestedLocation = String(weatherFastResult?.suggestedLocation || "").trim();
      if (weatherFastResult?.needsConfirmation && suggestedLocation) {
        setPendingWeatherConfirm(sessionKey, text, suggestedLocation);
        broadcastThinkingStatus("Confirming location", userContextId);
      } else {
        clearPendingWeatherConfirm(sessionKey);
        broadcastThinkingStatus("Summarizing weather", userContextId);
      }
      reply = String(weatherFastResult.reply || "").trim();
      if (weatherFastResult?.toolCall) observedToolCalls.push(String(weatherFastResult.toolCall));
    } else if (String(cryptoFastResult?.reply || "").trim()) {
      responseRoute = "crypto_fast_path";
      clearPendingWeatherConfirm(sessionKey);
      broadcastThinkingStatus("Checking Coinbase", userContextId);
      reply = String(cryptoFastResult.reply || "").trim();
      if (cryptoFastResult?.toolCall) observedToolCalls.push(String(cryptoFastResult.toolCall));
      if (String(cryptoFastResult?.toolCall || "").trim() === "coinbase_portfolio_report" && reply) {
        cacheRecentCryptoReport(userContextId, conversationId, reply);
      }
    } else {
      const serveIntentClass = !hasStrictOutputRequirements
        && turnPolicy?.weatherIntent !== true
        && turnPolicy?.cryptoIntent !== true
        ? "chat"
        : "other";
      const serveAttempt = await runChatKitServeAttempt({
        prompt: text,
        userContextId,
        conversationId,
        missionRunId: "",
        intentClass: serveIntentClass,
        turnId: preparedPromptHash || `${Date.now()}`,
      });
      if (serveAttempt.used === true) {
        responseRoute = "chatkit_served";
        broadcastThinkingStatus("Drafting response", userContextId);
        reply = String(serveAttempt.reply || "").trim();
        providerUsed = "openai-chatkit";
        modelUsed = String(serveAttempt.model || selectedChatModel);
        promptTokens = Number(serveAttempt?.usage?.promptTokens || 0);
        completionTokens = Number(serveAttempt?.usage?.completionTokens || 0);
      } else {
      await preparePromptContext();
      if (activeChatRuntime.provider === "claude") {
      llmStartedAt = Date.now();
      responseRoute = "claude_direct";
      broadcastThinkingStatus("Drafting response", userContextId);
      const claudeMessages = [...historyMessages, { role: "user", content: text }];
      const claudeCompletion = hasStrictOutputRequirements
        ? await withTimeout(
            claudeMessagesCreate({
              apiKey: activeChatRuntime.apiKey,
              baseURL: activeChatRuntime.baseURL,
              model: selectedChatModel,
              system: systemPrompt,
              messages: claudeMessages,
              userText: text,
              maxTokens: CLAUDE_CHAT_MAX_TOKENS,
            }),
            OPENAI_REQUEST_TIMEOUT_MS,
            `Claude model ${selectedChatModel}`,
          )
        : await claudeMessagesStream({
            apiKey: activeChatRuntime.apiKey,
            baseURL: activeChatRuntime.baseURL,
            model: selectedChatModel,
            system: systemPrompt,
            messages: claudeMessages,
            userText: text,
            maxTokens: CLAUDE_CHAT_MAX_TOKENS,
            timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
            onDelta: (delta) => {
              emittedAssistantDelta = true;
              broadcastAssistantStreamDelta(assistantStreamId, delta, source, undefined, conversationId, userContextId);
            },
          });
      reply = claudeCompletion.text;
      promptTokens = claudeCompletion.usage.promptTokens;
      completionTokens = claudeCompletion.usage.completionTokens;
      } else if (canRunToolLoop) {
      llmStartedAt = Date.now();
      responseRoute = "tool_loop";
      const openAiToolDefs = toolRuntime.toOpenAiToolDefinitions(availableTools);
      const loopMessages = [...messages];
      const toolOutputsForRecovery = [];
      let forcedToolFallbackReply = "";
      let usedFallback = false;
      const toolLoopBudget = createToolLoopBudget({
        maxDurationMs: Math.max(5000, Number(TOOL_LOOP_MAX_DURATION_MS || 0)),
        minTimeoutMs: 1000,
      });
      const toolLoopGuardrails = {
        maxDurationMs: Math.max(5000, Number(TOOL_LOOP_MAX_DURATION_MS || 0)),
        requestTimeoutMs: Math.max(1000, Number(TOOL_LOOP_REQUEST_TIMEOUT_MS || 0)),
        toolExecTimeoutMs: Math.max(1000, Number(TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS || 0)),
        recoveryTimeoutMs: Math.max(1000, Number(TOOL_LOOP_RECOVERY_TIMEOUT_MS || 0)),
        maxToolCallsPerStep: Math.max(1, Number(TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP || 1)),
        budgetExhausted: false,
        stepTimeouts: 0,
        toolExecutionTimeouts: 0,
        recoveryBudgetExhausted: false,
        cappedToolCalls: 0,
      };

      for (let step = 0; step < Math.max(1, TOOL_LOOP_MAX_STEPS); step += 1) {
        if (toolLoopBudget.isExhausted()) {
          toolLoopGuardrails.budgetExhausted = true;
          latencyTelemetry.incrementCounter("tool_loop_budget_exhausted");
          forcedToolFallbackReply =
            "I hit the tool execution time budget before finalizing the response. Please retry with a narrower request.";
          break;
        }
        broadcastThinkingStatus("Reasoning", userContextId);
        let completion = null;
        const stepTimeoutMs = toolLoopBudget.resolveTimeoutMs(TOOL_LOOP_REQUEST_TIMEOUT_MS, 3000);
        if (stepTimeoutMs <= 0) {
          toolLoopGuardrails.budgetExhausted = true;
          latencyTelemetry.incrementCounter("tool_loop_budget_exhausted");
          forcedToolFallbackReply =
            "I hit the tool execution time budget before finalizing the response. Please retry with a narrower request.";
          break;
        }
        try {
              completion = await withTimeout(
                activeOpenAiCompatibleClient.chat.completions.create({
                  model: modelUsed,
                  messages: loopMessages,
                  max_completion_tokens: openAiMaxCompletionTokens,
                  ...openAiRequestTuningForModel(modelUsed),
                  tools: openAiToolDefs,
                  tool_choice: "auto",
                }),
            stepTimeoutMs,
            `Tool loop model ${modelUsed}`,
          );
        } catch (err) {
          if (!usedFallback && OPENAI_FALLBACK_MODEL) {
            usedFallback = true;
            modelUsed = OPENAI_FALLBACK_MODEL;
            retries.push({
              stage: "tool_loop_completion",
              fromModel: selectedChatModel,
              toModel: modelUsed,
              reason: "primary_failed",
            });
            console.warn(`[ToolLoop] Primary model failed; retrying with fallback model ${modelUsed}.`);
            completion = await withTimeout(
              activeOpenAiCompatibleClient.chat.completions.create({
                model: modelUsed,
                messages: loopMessages,
                max_completion_tokens: openAiMaxCompletionTokens,
                ...openAiRequestTuningForModel(modelUsed),
                tools: openAiToolDefs,
                tool_choice: "auto",
              }),
              toolLoopBudget.resolveTimeoutMs(TOOL_LOOP_REQUEST_TIMEOUT_MS, 3000),
              `Tool loop fallback model ${modelUsed}`,
            );
          } else {
            if (isLikelyTimeoutError(err)) {
              toolLoopGuardrails.stepTimeouts += 1;
              latencyTelemetry.incrementCounter("tool_loop_step_timeouts");
            }
            throw err;
          }
        }

        const usage = completion?.usage || {};
        promptTokens += Number(usage.prompt_tokens || 0);
        completionTokens += Number(usage.completion_tokens || 0);

        const choice = completion?.choices?.[0]?.message || {};
        const assistantText = extractOpenAIChatText(completion);
        const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];

        if (toolCalls.length === 0) {
          reply = assistantText.trim();
          break;
        }

        const toolCallCap = capToolCallsPerStep(toolCalls, TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP);
        const cappedToolCalls = toolCallCap.capped;
        if (toolCallCap.wasCapped) {
          toolLoopGuardrails.cappedToolCalls += toolCallCap.requestedCount - toolCallCap.cappedCount;
          latencyTelemetry.incrementCounter("tool_loop_tool_call_caps");
          console.warn(
            `[ToolLoop] Capped tool calls for step ${step + 1}: requested=${toolCalls.length} cap=${cappedToolCalls.length}`,
          );
          toolOutputsForRecovery.push({
            name: "tool_loop_guardrail",
            content: `Tool call count capped at ${cappedToolCalls.length} for this step.`,
          });
        }

        loopMessages.push({ role: "assistant", content: assistantText || "", tool_calls: cappedToolCalls });

        // Bug Fix 2: tool errors are caught, logged, and surfaced instead of swallowed
        for (const toolCall of cappedToolCalls) {
          if (toolLoopBudget.isExhausted()) {
            toolLoopGuardrails.budgetExhausted = true;
            latencyTelemetry.incrementCounter("tool_loop_budget_exhausted");
            forcedToolFallbackReply =
              "I ran out of time while executing tools. Please retry with a narrower request.";
            break;
          }
          const toolName = String(toolCall?.function?.name || toolCall?.id || "").trim();
          const normalizedToolName = toolName.toLowerCase();
          if (normalizedToolName === "web_search") broadcastThinkingStatus("Searching web", userContextId);
          else if (normalizedToolName === "web_fetch") broadcastThinkingStatus("Reviewing sources", userContextId);
          else if (normalizedToolName.startsWith("coinbase_")) broadcastThinkingStatus("Querying Coinbase", userContextId);
          else if (normalizedToolName.startsWith("gmail_")) broadcastThinkingStatus("Checking Gmail", userContextId);
          else broadcastThinkingStatus("Running tools", userContextId);
          if (toolName) observedToolCalls.push(toolName);
          const toolUse = toolRuntime.toOpenAiToolUseBlock(toolCall);
          if (
            String(toolUse?.name || "").toLowerCase().startsWith("coinbase_")
            || String(toolUse?.name || "").toLowerCase().startsWith("gmail_")
          ) {
            toolUse.input = {
              ...(toolUse.input && typeof toolUse.input === "object" ? toolUse.input : {}),
              userContextId,
              conversationId,
            };
          }
          if (
            normalizedToolName === "gmail_forward_message"
            || normalizedToolName === "gmail_reply_draft"
          ) {
            toolUse.input = {
              ...(toolUse.input && typeof toolUse.input === "object" ? toolUse.input : {}),
              requireExplicitUserConfirm: true,
            };
            const confirmState = consumeHudOpTokenForSensitiveAction({
              userContextId,
              opToken: hudOpToken,
              conversationId,
              action: normalizedToolName,
            });
            if (!confirmState.ok) {
              const safeBlockedMessage =
                "I need an explicit confirmation action before sending Gmail content. Please confirm and retry.";
              forcedToolFallbackReply = safeBlockedMessage;
              toolExecutions.push({
                name: normalizedToolName,
                status: "blocked",
                durationMs: 0,
                error: `sensitive_action_blocked:${confirmState.reason}`,
                resultPreview: "",
              });
              loopMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  ok: false,
                  kind: normalizedToolName,
                  errorCode: "CONFIRM_REQUIRED",
                  safeMessage: safeBlockedMessage,
                  guidance: "Use the UI confirmation and retry.",
                  retryable: true,
                }),
              });
              break;
            }
          }
          let toolResult;
          const toolStartedAt = Date.now();
          try {
            const toolExecTimeoutMs = toolLoopBudget.resolveTimeoutMs(TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS, 1000);
            if (toolExecTimeoutMs <= 0) {
              throw new Error("tool loop execution budget exhausted");
            }
            toolResult = await withTimeout(
              runtimeTools.executeToolUse(toolUse, availableTools),
              toolExecTimeoutMs,
              `Tool ${normalizedToolName || "unknown"}`,
            );
            toolExecutions.push({
              name: normalizedToolName || "unknown",
              status: "ok",
              durationMs: Date.now() - toolStartedAt,
              resultPreview: summarizeToolResultPreview(toolResult?.content || ""),
            });
          } catch (toolErr) {
            const errMsg = describeUnknownError(toolErr);
            if (isLikelyTimeoutError(toolErr)) {
              toolLoopGuardrails.toolExecutionTimeouts += 1;
              latencyTelemetry.incrementCounter("tool_loop_tool_exec_timeouts");
            }
            console.error(`[ToolLoop] Tool "${toolCall.function?.name ?? toolCall.id}" failed: ${errMsg}`);
            broadcastAssistantStreamDelta(
              assistantStreamId,
              `[Tool error: ${toolCall.function?.name ?? "unknown"} - ${errMsg}]`,
              source,
              undefined,
              conversationId,
              userContextId,
            );
            toolExecutions.push({
              name: normalizedToolName || "unknown",
              status: "error",
              durationMs: Date.now() - toolStartedAt,
              error: errMsg,
              resultPreview: "",
            });
            toolResult = { content: `Tool execution failed: ${errMsg}` };
          }
          loopMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: (() => {
              const content = String(toolResult?.content || "");
              const normalizedName = String(toolName || "").toLowerCase();
              if (content.trim()) {
                toolOutputsForRecovery.push({ name: normalizedName, content });
                if (normalizedName === "web_search" && /^web_search error:/i.test(content)) {
                  if (/missing brave api key/i.test(content)) {
                    forcedToolFallbackReply =
                      "Live web search is unavailable because the Brave API key is missing. Add Brave in Integrations and retry.";
                  } else if (/rate limited/i.test(content)) {
                    forcedToolFallbackReply =
                      "Live web search is currently rate-limited. Please retry in a moment.";
                  } else {
                    forcedToolFallbackReply =
                      `Live web search failed: ${content.replace(/^web_search error:\s*/i, "").trim()}`;
                  }
                }
                if (normalizedName.startsWith("gmail_")) {
                  const gmailFallback = resolveGmailToolFallbackReply(content);
                  if (gmailFallback) {
                    forcedToolFallbackReply = gmailFallback;
                  }
                }
              }
              if (normalizedName !== "web_search" && normalizedName !== "web_fetch") {
                return content;
              }
              const suspiciousPatterns = detectSuspiciousPatterns(content);
              if (suspiciousPatterns.length > 0) {
                console.warn(
                  `[Security] suspicious ${normalizedName} tool output patterns=${suspiciousPatterns.length} session=${sessionKey}`,
                );
              }
              return wrapWebContent(content, normalizedName === "web_fetch" ? "web_fetch" : "web_search");
            })(),
          });
        }

        if (forcedToolFallbackReply) {
          reply = forcedToolFallbackReply;
          break;
        }
      }

      if (!reply || !reply.trim()) {
        broadcastThinkingStatus("Recovering final answer", userContextId);
        // Some OpenAI-compatible providers can end tool loops without a terminal text message.
        // Try one no-tools recovery completion first, then fall back to the latest tool output.
        try {
          const recoveryTimeoutMs = toolLoopBudget.resolveTimeoutMs(TOOL_LOOP_RECOVERY_TIMEOUT_MS, 1000);
          if (recoveryTimeoutMs <= 0) {
            toolLoopGuardrails.recoveryBudgetExhausted = true;
            latencyTelemetry.incrementCounter("tool_loop_recovery_budget_exhausted");
            throw new Error("tool loop recovery budget exhausted");
          }
          const recovery = await withTimeout(
            activeOpenAiCompatibleClient.chat.completions.create({
              model: modelUsed,
              messages: [
                ...loopMessages,
                {
                  role: "user",
                  content: "Provide the final answer to the user using the tool results above. Keep it concise and actionable.",
                },
              ],
              max_completion_tokens: openAiMaxCompletionTokens,
              ...openAiRequestTuningForModel(modelUsed),
            }),
            recoveryTimeoutMs,
            `Tool loop recovery model ${modelUsed}`,
          );
          reply = extractOpenAIChatText(recovery).trim();
        } catch (recoveryErr) {
          console.warn(`[ToolLoop] recovery completion failed: ${describeUnknownError(recoveryErr)}`);
        }
      }
      runSummary.toolLoopGuardrails = toolLoopGuardrails;

      if (!reply || !reply.trim()) {
        const latestUsefulTool = [...toolOutputsForRecovery]
          .reverse()
          .find((entry) => {
            const content = String(entry?.content || "").trim();
            if (!content) return false;
            if (entry.name === "web_search" && /^web_search error/i.test(content)) return false;
            if (entry.name === "web_fetch" && /^web_fetch error/i.test(content)) return false;
            return true;
          });

        if (latestUsefulTool) {
          if (latestUsefulTool.name === "web_search") {
            if (isWeatherRequestText(text)) {
              const weatherReadable = buildWeatherWebSummary(text, latestUsefulTool.content);
              reply = weatherReadable
                || "I checked live weather sources, but couldn't extract a reliable forecast summary yet. Please retry with city and state (for example: Pittsburgh, PA).";
            } else {
              const readable = buildWebSearchReadableReply(text, latestUsefulTool.content);
              reply = readable || `Live web results:\n\n${latestUsefulTool.content.slice(0, 2200)}`;
            }
          } else if (latestUsefulTool.name === "web_fetch") {
            reply = `I fetched the page content but the model did not finalize the answer. Here is the extracted content:\n\n${latestUsefulTool.content.slice(0, 2200)}`;
          } else {
            reply = `I ran tools but the model returned no final text. Tool output:\n\n${latestUsefulTool.content.slice(0, 2200)}`;
          }
        } else {
          const latestToolError = [...toolOutputsForRecovery]
            .reverse()
            .find((entry) => {
              const content = String(entry?.content || "").trim().toLowerCase();
              return content.startsWith("web_search error") || content.startsWith("web_fetch error");
            });
          if (latestToolError) {
            if (latestToolError.name === "web_search") {
              const detail = String(latestToolError.content || "")
                .replace(/^web_search error:\s*/i, "")
                .trim();
              reply = detail
                ? `I couldn't complete a live web lookup: ${detail}`
                : "I couldn't complete a live web lookup right now.";
            } else {
              const detail = String(latestToolError.content || "")
                .replace(/^web_fetch error:\s*/i, "")
                .trim();
              reply = detail
                ? `I couldn't fetch the web source: ${detail}`
                : "I couldn't fetch the web source right now.";
            }
          }
        }
      }

      if (!reply || !reply.trim()) {
        const fallbackReply = buildConstraintSafeFallback(outputConstraints, text, {
          strict: hasStrictOutputRequirements,
        });
        markFallback("tool_loop_empty_reply_fallback", "empty_reply_after_tool_loop", reply);
        retries.push({
          stage: "tool_loop_empty_reply_fallback",
          fromModel: modelUsed,
          toModel: modelUsed,
          reason: "empty_reply",
        });
        reply = fallbackReply;
      }
      } else {
      llmStartedAt = Date.now();
      broadcastThinkingStatus("Drafting response", userContextId);
      let llmFinishReason = "";
      if (hasStrictOutputRequirements) {
        responseRoute = "openai_direct_constraints";
        let completion = null;
        try {
          completion = await withTimeout(
            activeOpenAiCompatibleClient.chat.completions.create({
              model: modelUsed,
              messages,
              max_completion_tokens: openAiMaxCompletionTokens,
              ...openAiRequestTuningForModel(modelUsed),
            }),
            OPENAI_REQUEST_TIMEOUT_MS,
            `OpenAI model ${modelUsed}`,
          );
        } catch (primaryError) {
          if (!OPENAI_FALLBACK_MODEL) throw primaryError;
          const fallbackModel = OPENAI_FALLBACK_MODEL;
          retries.push({
            stage: "direct_completion",
            fromModel: modelUsed,
            toModel: fallbackModel,
            reason: "primary_failed",
          });
          const primaryDetails = toErrorDetails(primaryError);
          console.warn(
            `[LLM] Primary model failed provider=${activeChatRuntime.provider} model=${modelUsed}` +
            ` status=${primaryDetails.status ?? "n/a"} message=${primaryDetails.message}. Retrying with fallback ${fallbackModel}.`,
          );
          completion = await withTimeout(
            activeOpenAiCompatibleClient.chat.completions.create({
              model: fallbackModel,
              messages,
              max_completion_tokens: openAiMaxCompletionTokens,
              ...openAiRequestTuningForModel(fallbackModel),
            }),
            OPENAI_REQUEST_TIMEOUT_MS,
            `OpenAI fallback model ${fallbackModel}`,
          );
          modelUsed = fallbackModel;
        }
        const usage = completion?.usage || {};
        promptTokens = Number(usage.prompt_tokens || 0);
        completionTokens = Number(usage.completion_tokens || 0);
        llmFinishReason = String(completion?.choices?.[0]?.finish_reason || "").trim().toLowerCase();
        reply = extractOpenAIChatText(completion).trim();
      } else {
        responseRoute = "openai_stream";
        let streamed = null;
        let sawPrimaryDelta = false;
        try {
          streamed = await streamOpenAiChatCompletion({
            client: activeOpenAiCompatibleClient,
            model: modelUsed,
            messages,
            maxCompletionTokens: openAiMaxCompletionTokens,
            timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
            requestOverrides: openAiRequestTuningForModel(modelUsed),
            onDelta: (delta) => {
              sawPrimaryDelta = true;
              emittedAssistantDelta = true;
              broadcastAssistantStreamDelta(assistantStreamId, delta, source, undefined, conversationId, userContextId);
            },
          });
        } catch (primaryError) {
          if (!OPENAI_FALLBACK_MODEL || sawPrimaryDelta) throw primaryError;
          const fallbackModel = OPENAI_FALLBACK_MODEL;
          retries.push({
            stage: "stream_completion",
            fromModel: modelUsed,
            toModel: fallbackModel,
            reason: "primary_failed",
          });
          const primaryDetails = toErrorDetails(primaryError);
          console.warn(
            `[LLM] Primary model failed provider=${activeChatRuntime.provider} model=${modelUsed}` +
            ` status=${primaryDetails.status ?? "n/a"} message=${primaryDetails.message}. Retrying with fallback ${fallbackModel}.`,
          );
          streamed = await streamOpenAiChatCompletion({
            client: activeOpenAiCompatibleClient,
            model: fallbackModel,
            messages,
            maxCompletionTokens: openAiMaxCompletionTokens,
            timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
            requestOverrides: openAiRequestTuningForModel(fallbackModel),
            onDelta: (delta) => {
              emittedAssistantDelta = true;
              broadcastAssistantStreamDelta(assistantStreamId, delta, source, undefined, conversationId, userContextId);
            },
          });
          modelUsed = fallbackModel;
        }
        reply = streamed.reply;
        promptTokens = streamed.promptTokens || 0;
        completionTokens = streamed.completionTokens || 0;
        llmFinishReason = String(streamed?.finishReason || "").trim().toLowerCase();
      }
      if (!reply || !reply.trim()) {
        if (shouldAttemptOpenAiEmptyReplyRecovery({
          provider: activeChatRuntime.provider,
          reply,
          finishReason: llmFinishReason,
          completionTokens,
          maxCompletionTokens: openAiMaxCompletionTokens,
        })) {
          broadcastThinkingStatus("Recovering final answer", userContextId);
          retries.push({
            stage: "empty_reply_recovery",
            fromModel: modelUsed,
            toModel: modelUsed,
            reason: buildEmptyReplyFailureReason("empty_reply_after_llm_call", {
              finishReason: llmFinishReason,
              completionTokens,
              maxCompletionTokens: openAiMaxCompletionTokens,
            }),
          });
          try {
            const recovered = await attemptOpenAiEmptyReplyRecovery({
              client: activeOpenAiCompatibleClient,
              model: modelUsed,
              messages,
              timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
              maxCompletionTokens: openAiMaxCompletionTokens,
              requestTuning: openAiRequestTuningForModel(modelUsed),
              label: "OpenAI empty-reply recovery",
            });
            llmFinishReason = String(recovered.finishReason || llmFinishReason || "").trim().toLowerCase();
            promptTokens += Number(recovered.promptTokens || 0);
            completionTokens += Number(recovered.completionTokens || 0);
            if (recovered.reply) {
              reply = recovered.reply;
              responseRoute = `${responseRoute}_empty_reply_recovered`;
            }
          } catch (emptyRecoveryErr) {
            console.warn(`[LLM] empty reply recovery failed: ${describeUnknownError(emptyRecoveryErr)}`);
          }
        }
      }
      if (!reply || !reply.trim()) {
        const fallbackReply = buildConstraintSafeFallback(outputConstraints, text, {
          strict: hasStrictOutputRequirements,
        });
        const fallbackReason = buildEmptyReplyFailureReason("empty_reply_after_llm_call", {
          finishReason: llmFinishReason,
          completionTokens,
          maxCompletionTokens: openAiMaxCompletionTokens,
        });
        markFallback("direct_empty_reply_fallback", fallbackReason, reply);
        retries.push({
          stage: "direct_empty_reply_fallback",
          fromModel: modelUsed,
          toModel: modelUsed,
          reason: fallbackReason,
        });
        reply = fallbackReply;
      }
      }
      }
    }
    if (llmStartedAt > 0) {
      latencyTelemetry.addStage("llm_generation", Date.now() - llmStartedAt);
    }

    // Refusal recovery: if model claimed no web access, do a search and append results
    if (replyClaimsNoLiveAccess(reply) && canRunWebSearch) {
      const refusalRecoveryStartedAt = Date.now();
      broadcastThinkingStatus("Verifying live web access", userContextId);
      try {
        const refusalRecoverStartedAt = Date.now();
        const fallbackResult = await runtimeTools.executeToolUse(
          { id: `tool_refusal_recover_${Date.now()}`, name: "web_search", input: { query: text }, type: "tool_use" },
          availableTools,
        );
        toolExecutions.push({
          name: "web_search",
          status: "ok",
          durationMs: Date.now() - refusalRecoverStartedAt,
          resultPreview: summarizeToolResultPreview(fallbackResult?.content || ""),
        });
        const fallbackContent = String(fallbackResult?.content || "").trim();
        if (fallbackContent && !/^web_search error/i.test(fallbackContent)) {
          const weatherReadable = isWeatherRequestText(text) ? buildWeatherWebSummary(text, fallbackContent) : "";
          const readable = weatherReadable || buildWebSearchReadableReply(text, fallbackContent);
          const correction = readable
            ? `I do have live web access in this runtime.\n\n${readable}`
            : `I do have live web access in this runtime. Current web results:\n\n${fallbackContent.slice(0, 2200)}`;
          reply = reply ? `${reply}\n\n${correction}` : correction;
          if (!hasStrictOutputRequirements) {
            emittedAssistantDelta = true;
            broadcastAssistantStreamDelta(assistantStreamId, correction, source, undefined, conversationId, userContextId);
          }
          observedToolCalls.push("web_search");
        }
      } catch (err) {
        toolExecutions.push({
          name: "web_search",
          status: "error",
          durationMs: 0,
          error: describeUnknownError(err),
          resultPreview: "",
        });
        console.warn(`[ToolLoop] refusal recovery search failed: ${describeUnknownError(err)}`);
      } finally {
        latencyTelemetry.addStage("refusal_recovery", Date.now() - refusalRecoveryStartedAt);
      }
    }

    if (hasStrictOutputRequirements) {
      const initialConstraintCheck = validateOutputConstraints(reply, outputConstraints);
      if (!initialConstraintCheck.ok) {
        const correctionStartedAt = Date.now();
        broadcastThinkingStatus("Applying response format", userContextId);
        retries.push({
          stage: "output_constraint_correction",
          fromModel: modelUsed,
          toModel: modelUsed,
          reason: initialConstraintCheck.reason,
        });

        const correctionInstruction = [
          "Rewrite your previous answer to the same user request.",
          `Violation: ${initialConstraintCheck.reason}.`,
          "Strict requirements:",
          outputConstraints.instructions,
          "Return only the corrected answer.",
        ].join("\n");

        let correctedReply = "";
        try {
          if (activeChatRuntime.provider === "claude") {
            const correctionMessages = [
              ...historyMessages,
              { role: "user", content: text },
              { role: "assistant", content: reply },
              { role: "user", content: correctionInstruction },
            ];
            const claudeCorrection = await withTimeout(
              claudeMessagesCreate({
                apiKey: activeChatRuntime.apiKey,
                baseURL: activeChatRuntime.baseURL,
                model: selectedChatModel,
                system: systemPrompt,
                messages: correctionMessages,
                userText: correctionInstruction,
                maxTokens: CLAUDE_CHAT_MAX_TOKENS,
              }),
              OPENAI_REQUEST_TIMEOUT_MS,
              `Claude correction ${selectedChatModel}`,
            );
            correctedReply = String(claudeCorrection?.text || "").trim();
            promptTokens += Number(claudeCorrection?.usage?.promptTokens || 0);
            completionTokens += Number(claudeCorrection?.usage?.completionTokens || 0);
          } else {
            const correctionCompletion = await withTimeout(
              activeOpenAiCompatibleClient.chat.completions.create({
                model: modelUsed,
                messages: [
                  ...messages,
                  { role: "assistant", content: reply },
                  { role: "user", content: correctionInstruction },
                ],
                max_completion_tokens: openAiMaxCompletionTokens,
                ...openAiRequestTuningForModel(modelUsed),
              }),
              OPENAI_REQUEST_TIMEOUT_MS,
              `OpenAI correction ${modelUsed}`,
            );
            correctedReply = extractOpenAIChatText(correctionCompletion).trim();
            const correctionUsage = correctionCompletion?.usage || {};
            promptTokens += Number(correctionUsage.prompt_tokens || 0);
            completionTokens += Number(correctionUsage.completion_tokens || 0);
          }
        } catch (correctionErr) {
          console.warn(`[OutputConstraints] correction pass failed: ${describeUnknownError(correctionErr)}`);
        } finally {
          outputConstraintCorrectionPasses += 1;
          latencyTelemetry.incrementCounter("output_constraint_correction_passes");
          latencyTelemetry.addStage("output_constraint_correction", Date.now() - correctionStartedAt);
        }

        if (correctedReply) {
          reply = correctedReply;
          const correctedCheck = validateOutputConstraints(reply, outputConstraints);
          if (correctedCheck.ok) {
            responseRoute = `${responseRoute}_constraint_corrected`;
          }
        }
      }
    }

    const normalizedReply = normalizeAssistantReply(reply);
    broadcastThinkingStatus("Finalizing response", userContextId);
    if (normalizedReply.skip) {
      reply = "";
    } else {
      reply = normalizedReply.text;
    }
    if (!reply || !reply.trim()) {
      const fallbackReply = buildConstraintSafeFallback(outputConstraints, text, {
        strict: hasStrictOutputRequirements,
      });
      markFallback("post_normalize_empty_reply_fallback", "empty_reply_after_normalization", reply);
      retries.push({
        stage: "post_normalize_empty_reply_fallback",
        fromModel: modelUsed,
        toModel: modelUsed,
        reason: "empty_reply",
      });
      reply = fallbackReply;
    }

    if (reply && !turnPolicy?.cryptoIntent && !turnPolicy?.weatherIntent) {
      const assistantPolicy = getShortTermContextPolicy("assistant");
      const previousAssistantContext = readShortTermContextState({
        userContextId,
        conversationId,
        domainId: "assistant",
      });
      const nextTopicAffinityId = String(
        assistantPolicy.resolveTopicAffinityId?.(uiText, previousAssistantContext || {}) || previousAssistantContext?.topicAffinityId || "general_assistant",
      ).trim();
      upsertShortTermContextState({
        userContextId,
        conversationId,
        domainId: "assistant",
        topicAffinityId: nextTopicAffinityId,
        slots: {
          lastUserText: String(uiText || "").slice(0, 400),
          lastAssistantReply: String(reply || "").slice(0, 500),
          lastResponseRoute: String(responseRoute || "").trim(),
          followUpActive: requestHints?.assistantShortTermFollowUp === true,
        },
      });
    }

    if (reply && !emittedAssistantDelta) {
      emittedAssistantDelta = true;
      broadcastAssistantStreamDelta(assistantStreamId, reply, source, undefined, conversationId, userContextId);
    }

    const modelForUsage = providerUsed === "openai-chatkit"
      ? (modelUsed || selectedChatModel)
      : (activeChatRuntime.provider === "claude" ? selectedChatModel : (modelUsed || selectedChatModel));
    const totalTokens = promptTokens + completionTokens;
    const estimatedCostUsd = estimateTokenCostUsd(modelForUsage, promptTokens, completionTokens);

    appendRawStream({ event: "request_done", source, sessionKey, provider: providerUsed, model: modelForUsage, promptTokens, completionTokens, totalTokens, estimatedCostUsd });
    console.log(`[LLM] provider=${providerUsed} model=${modelForUsage} prompt_tokens=${promptTokens} completion_tokens=${completionTokens} total_tokens=${totalTokens}${estimatedCostUsd !== null ? ` estimated_usd=$${estimatedCostUsd}` : ""}`);
    broadcast(
      {
        type: "usage",
        provider: providerUsed,
        model: modelForUsage,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd,
        userContextId: userContextId || undefined,
        ts: Date.now(),
      },
      { userContextId },
    );

    const nlpCorrections = Array.isArray(ctx.nlpCorrections)
      ? ctx.nlpCorrections
          .map((c) => ({
            reason: String(c?.reason || ""),
            confidence: Number(c?.confidence || 0),
            offsets: Array.isArray(c?.offsets) ? c.offsets.slice(0, 2) : undefined,
          }))
          .filter((c) => c.reason)
      : [];
    const transcriptStartedAt = Date.now();
    sessionRuntime.appendTranscriptTurn(sessionContext.sessionEntry.sessionId, "user", uiText, {
      source,
      sender: ctx.sender,
      provider: providerUsed,
      model: modelForUsage,
      sessionKey,
      conversationId: conversationId || undefined,
      nlpCleanText: text !== uiText ? text : undefined,
      nlpConfidence: Number.isFinite(Number(ctx.nlpConfidence)) ? Number(ctx.nlpConfidence) : undefined,
      nlpCorrectionCount: nlpCorrections.length,
      nlpCorrections: nlpCorrections.length > 0 ? nlpCorrections : undefined,
    });
    if (reply) {
      sessionRuntime.appendTranscriptTurn(sessionContext.sessionEntry.sessionId, "assistant", reply, { source, sender: "nova", provider: providerUsed, model: modelForUsage, sessionKey, conversationId: conversationId || undefined, promptTokens, completionTokens, totalTokens });
    }
    sessionContext.persistUsage({ model: modelForUsage, promptTokens, completionTokens });
    latencyTelemetry.addStage("transcript_persistence", Date.now() - transcriptStartedAt);

    const memoryCaptureStartedAt = Date.now();
    try {
      const autoFacts = extractAutoMemoryFacts(text);
      const autoCaptured = applyMemoryFactsToWorkspace(personaWorkspaceDir, autoFacts);
      memoryAutoCaptured = autoCaptured;
      if (autoCaptured > 0) {
        appendRawStream({
          event: "memory_auto_upsert",
          source,
          sessionKey,
          userContextId: userContextId || undefined,
          captured: autoCaptured,
        });
        console.log(
          `[Memory] Auto-upserted ${autoCaptured} fact(s) for ${userContextId || "anonymous"} in MEMORY.md.`,
        );
      }
    } catch (memoryErr) {
      console.warn(`[Memory] Auto-upsert failed: ${describeUnknownError(memoryErr)}`);
    } finally {
      latencyTelemetry.addStage("memory_autocapture", Date.now() - memoryCaptureStartedAt);
    }
    const identityToolUsage = recordIdentityToolUsage({
      userContextId,
      workspaceDir: personaWorkspaceDir,
      conversationId,
      sessionKey,
      source,
      toolCalls: observedToolCalls,
      maxPromptTokens: PROMPT_CONTEXT_SECTION_MAX_TOKENS,
    });
    const identityToolAffinityUpdated = Array.isArray(identityToolUsage?.toolUpdates)
      ? identityToolUsage.toolUpdates.length
      : 0;
    runSummary.requestHints.identityToolAffinityUpdated = identityToolAffinityUpdated;

    runSummary.ok = true;
    runSummary.provider = providerUsed;
    runSummary.model = modelForUsage;
    runSummary.reply = reply;
    runSummary.promptTokens = promptTokens;
    runSummary.completionTokens = completionTokens;
    runSummary.totalTokens = totalTokens;
    runSummary.toolCalls = Array.from(new Set(observedToolCalls.filter(Boolean)));
    runSummary.toolExecutions = toolExecutions;
    runSummary.retries = retries;
    runSummary.responseRoute = responseRoute;
    runSummary.memoryAutoCaptured = memoryAutoCaptured;
    runSummary.preferenceProfileUpdated = preferenceProfileUpdated;
    runSummary.nlpConfidence = Number.isFinite(Number(ctx.nlpConfidence)) ? Number(ctx.nlpConfidence) : null;
    runSummary.nlpCorrectionCount = Array.isArray(ctx.nlpCorrections) ? ctx.nlpCorrections.length : 0;
    runSummary.memoryRecallUsed = usedMemoryRecall;
    runSummary.memorySearchDiagnostics = runSummary.memorySearchDiagnostics || null;
    runSummary.webSearchPreloadUsed = usedWebSearchPreload;
    runSummary.linkUnderstandingUsed = usedLinkUnderstanding;
    runSummary.correctionPassCount = outputConstraintCorrectionPasses;
    runSummary.promptHash = preparedPromptHash;
    runSummary.fallbackReason = fallbackReason;
    runSummary.fallbackStage = fallbackStage;
    runSummary.hadCandidateBeforeFallback = hadCandidateBeforeFallback;

    if (useVoice && reply) {
      const voiceStartedAt = Date.now();
      await speak(normalizeAssistantSpeechText(reply) || reply, ttsVoice);
      latencyTelemetry.addStage("voice_output", Date.now() - voiceStartedAt);
    }
  } catch (err) {
    broadcastThinkingStatus("Handling error", userContextId);
    const details = toErrorDetails(err);
    const msg = details.message || "Unknown model error.";
    appendRawStream({ event: "request_error", source, sessionKey, provider: activeChatRuntime.provider, model: selectedChatModel, status: details.status, code: details.code, type: details.type, requestId: details.requestId, message: msg });
    console.error(`[LLM] Chat request failed provider=${activeChatRuntime.provider} model=${selectedChatModel} status=${details.status ?? "n/a"} code=${details.code ?? "n/a"} message=${msg}`);
    const fallbackReply = buildConstraintSafeFallback(outputConstraints, text, {
      strict: hasStrictOutputRequirements,
    });
    markFallback("exception_empty_reply_fallback", details.code || details.message || "request_error", "");
    retries.push({
      stage: "exception_empty_reply_fallback",
      fromModel: selectedChatModel,
      toModel: selectedChatModel,
      reason: "request_error",
    });
    responseRoute = `${responseRoute}_error_recovered`;
    broadcastAssistantStreamDelta(
      assistantStreamId,
      fallbackReply,
      source,
      undefined,
      conversationId,
      userContextId,
    );
    runSummary.error = msg;
    runSummary.ok = true;
    runSummary.reply = fallbackReply;
    runSummary.toolCalls = Array.from(new Set(observedToolCalls.filter(Boolean)));
    runSummary.toolExecutions = toolExecutions;
    runSummary.retries = retries;
    runSummary.responseRoute = responseRoute;
    runSummary.memoryAutoCaptured = memoryAutoCaptured;
    runSummary.preferenceProfileUpdated = preferenceProfileUpdated;
    runSummary.nlpConfidence = Number.isFinite(Number(ctx.nlpConfidence)) ? Number(ctx.nlpConfidence) : null;
    runSummary.nlpCorrectionCount = Array.isArray(ctx.nlpCorrections) ? ctx.nlpCorrections.length : 0;
    runSummary.memoryRecallUsed = usedMemoryRecall;
    runSummary.memorySearchDiagnostics = runSummary.memorySearchDiagnostics || null;
    runSummary.webSearchPreloadUsed = usedWebSearchPreload;
    runSummary.linkUnderstandingUsed = usedLinkUnderstanding;
    runSummary.correctionPassCount = outputConstraintCorrectionPasses;
    runSummary.promptHash = preparedPromptHash;
    runSummary.responseRoute = responseRoute;
    runSummary.fallbackReason = fallbackReason;
    runSummary.fallbackStage = fallbackStage;
    runSummary.hadCandidateBeforeFallback = hadCandidateBeforeFallback;
  } finally {
    broadcastThinkingStatus("", userContextId);
    const latencySnapshot = latencyTelemetry.snapshot();
    runSummary.latencyMs = Number.isFinite(Number(latencySnapshot.totalMs)) && Number(latencySnapshot.totalMs) > 0
      ? Number(latencySnapshot.totalMs)
      : Date.now() - startedAt;
    runSummary.latencyStages = latencySnapshot.stageMs || {};
    runSummary.latencyHotPath = String(latencySnapshot.hotPath || latencySnapshot.hotStage || "");
    runSummary.correctionPassCount = Number.isFinite(Number(latencySnapshot.counters?.output_constraint_correction_passes))
      ? Number(latencySnapshot.counters.output_constraint_correction_passes)
      : runSummary.correctionPassCount;
    runSummary.requestHints.identityProfileActive = Boolean(
      runSummary.requestHints.identityProfileActive || identityPromptIncluded || identityAppliedSignals > 0,
    );
    runSummary.requestHints.identityAppliedSignals = Number(
      runSummary.requestHints.identityAppliedSignals || identityAppliedSignals || 0,
    );
    runSummary.requestHints.identityRejectedSignals = Number(
      runSummary.requestHints.identityRejectedSignals || identityRejectedSignals || 0,
    );
    runSummary.requestHints.identityPromptIncluded = Boolean(
      runSummary.requestHints.identityPromptIncluded || identityPromptIncluded,
    );
    runSummary.fallbackReason = fallbackReason;
    runSummary.fallbackStage = fallbackStage;
    runSummary.hadCandidateBeforeFallback = hadCandidateBeforeFallback;
    broadcastAssistantStreamDone(assistantStreamId, source, undefined, conversationId, userContextId);
    broadcastState("idle", userContextId);
  }

  return runSummary;
}

// ===== Main dispatcher =====
async function handleInputCore(text, opts = {}) {
  const latencyTelemetry = createChatLatencyTelemetry();
  text = normalizeInboundUserText(text);
  if (!text) return;
  const source = opts.source || "hud";
  const userContextId = sessionRuntime.resolveUserContextId(opts);
  if (source === "hud" && !userContextId) throw new Error("Missing user context id for HUD request.");
  const sessionContext = sessionRuntime.resolveSessionContext({
    ...opts,
    userContextId: userContextId || opts.userContextId,
  });
  const sessionKey = sessionContext.sessionKey;
  const useVoice = opts.voice !== false;
  const ttsVoice = opts.ttsVoice || "default";
  const conversationId = resolveConversationId(opts, sessionKey, source);

  const sender = String(opts.sender || "").trim();
  const runtimeTone = normalizeRuntimeTone(opts.tone);
  const runtimeCommunicationStyle = String(opts.communicationStyle || "").trim();
  const runtimeAssistantName = String(opts.assistantName || "").trim();
  const runtimeCustomInstructions = String(opts.customInstructions || "").trim();
  const runtimeProactivity = String(opts.proactivity || "").trim();
  const runtimeHumorLevel = String(opts.humor_level || "").trim();
  const runtimeRiskTolerance = String(opts.risk_tolerance || "").trim();
  const runtimeStructurePreference = String(opts.structure_preference || "").trim();
  const runtimeChallengeLevel = String(opts.challenge_level || "").trim();
  const inboundMessageId = String(opts.inboundMessageId || "").trim();
  const hudOpToken = String(opts.hudOpToken || "").trim();
  const normalizedTextForRouting = String(text || "").trim().toLowerCase();
  const missionPolicy = getShortTermContextPolicy("mission_task");
  const cryptoPolicy = getShortTermContextPolicy("crypto");
  const assistantPolicyForDedupe = getShortTermContextPolicy("assistant");
  const followUpContinuationCue = [missionPolicy, cryptoPolicy, assistantPolicyForDedupe].some((policy) => {
    if (!policy) return false;
    return policy.isNonCriticalFollowUp(normalizedTextForRouting)
      && !policy.isCancel(normalizedTextForRouting)
      && !policy.isNewTopic(normalizedTextForRouting);
  });
  const duplicateMayBeCryptoReport = isExplicitCryptoReportRequest(text)
    || (isCryptoRequestText(text) && /\b(report|summary|pnl|daily|weekly)\b/i.test(text));
  const duplicateMayBeMissionRequest = shouldBuildWorkflowFromPrompt(text)
    || shouldConfirmWorkflowFromPrompt(text);
  const n = text.toLowerCase().trim();
  if (n === "nova shutdown" || n === "nova shut down" || n === "shutdown nova") {
    await handleShutdown({ ttsVoice });
    return {
      route: "shutdown",
      ok: true,
      reply: "Shutting down now. If you need me again, just restart the system.",
      latencyMs: 0,
    };
  }

  const explicitCryptoReportRequest = isExplicitCryptoReportRequest(text);
  const skipDuplicateInbound = !explicitCryptoReportRequest
    && !duplicateMayBeMissionRequest
    && !followUpContinuationCue
    && shouldSkipDuplicateInbound({
    text,
    source,
    sender,
    userContextId,
    sessionKey,
    inboundMessageId,
  });
  if (skipDuplicateInbound) {
    const duplicateRecovery = await handleDuplicateCryptoReportRequest({
      duplicateMayBeCryptoReport,
      userContextId,
      conversationId,
      source,
      sessionKey,
      text,
      appendRawStream,
      rerenderReport: async () => {
        const runtimeTools = await toolRuntime.initToolRuntimeIfNeeded({ userContextId });
        const availableTools = Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : [];
        return await tryCryptoFastPathReply({
          text,
          runtimeTools,
          availableTools,
          userContextId,
          conversationId,
          workspaceDir: personaWorkspaceDir,
        });
      },
    });
    if (duplicateRecovery) return duplicateRecovery;
    const duplicateReply =
      "I got that same request again and skipped the duplicate. Say 'run it again' if you want me to execute it again.";
    broadcastMessage("assistant", duplicateReply, source, conversationId, userContextId);
    appendRawStream({
      event: "request_duplicate_skipped",
      source,
      sessionKey,
      userContextId: userContextId || undefined,
      chars: String(text || "").length,
    });
    return {
      route: "duplicate_skipped",
      ok: true,
      reply: duplicateReply,
      error: "",
      provider: "",
      model: "",
      toolCalls: [],
      toolExecutions: [],
      retries: [],
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: null,
      memoryRecallUsed: false,
      memoryAutoCaptured: 0,
      webSearchPreloadUsed: false,
      linkUnderstandingUsed: false,
      requestHints: {},
      canRunToolLoop: false,
      canRunWebSearch: false,
      canRunWebFetch: false,
      latencyMs: 0,
    };
  }

  appendRawStream({ event: "request_start", source, sessionKey, userContextId: userContextId || undefined, chars: String(text || "").length });

  // ── NLP preprocessing ────────────────────────────────────────────────────
  // raw_text is used for UI display and transcript persistence.
  // clean_text is used for routing, tool selection, memory recall, and LLM.
  const raw_text = text;
  let clean_text = text;
  let nlpCorrections = [];
  let nlpConfidence = 1.0;
  const nlpBypass = opts?.nlpBypass === true;
  const nlpPreprocessStartedAt = Date.now();
  if (!nlpBypass) {
    try {
      const preprocessFn = getPreprocess();
      if (preprocessFn) {
        // preprocess() is async (spell checker loads on first call)
        const nlpResult = await preprocessFn(text);
        clean_text = nlpResult.clean_text || text;
        nlpCorrections = nlpResult.corrections || [];
        nlpConfidence = Number.isFinite(Number(nlpResult.confidence)) ? Number(nlpResult.confidence) : 1.0;
        if (nlpCorrections.length > 0) {
          const summary = nlpCorrections.map((c) => `${c.reason}(${c.confidence.toFixed(2)})`).join(", ");
          console.log(`[NLP] ${nlpCorrections.length} correction(s) session=${sessionKey}: ${summary}`);
        }
      }
    } catch {
      // Preprocessing failure is non-fatal; continue with original text
      clean_text = text;
      nlpConfidence = 1.0;
    }
  }
  latencyTelemetry.addStage("nlp_preprocess", Date.now() - nlpPreprocessStartedAt);
  // Use clean_text for all downstream routing and LLM calls.
  // raw_text is preserved for UI messages and transcript writes.
  text = clean_text;
  // ─────────────────────────────────────────────────────────────────────────

  if (runtimeAssistantName && typeof wakeWordRuntime?.setAssistantName === "function") {
    wakeWordRuntime.setAssistantName(runtimeAssistantName);
  }

  const ctx = {
    source, sender, sessionContext, sessionKey, userContextId,
    useVoice, ttsVoice, runtimeTone, runtimeCommunicationStyle,
    runtimeAssistantName, runtimeCustomInstructions,
    runtimeProactivity, runtimeHumorLevel, runtimeRiskTolerance, runtimeStructurePreference, runtimeChallengeLevel,
    conversationId,
    hudOpToken,
    supabaseAccessToken: String(opts.supabaseAccessToken || "").trim(),
    sessionId: sessionContext.sessionEntry?.sessionId,
    // NLP: raw_text for display/persistence; clean_text already in `text`
    raw_text,
    nlpCorrections,
    nlpConfidence,
    nlpBypass,
  };

  // Memory update — short-circuit before any LLM call
  if (isMemoryUpdateRequest(text)) {
    return await handleMemoryUpdate(text, ctx);
  }

  const personaWorkspaceDir = resolvePersonaWorkspaceDir(userContextId);
  const skillPreferenceUpdate = applySkillPreferenceUpdateFromMessage({
    userContextId,
    workspaceDir: personaWorkspaceDir,
    userInputText: text,
  });
  if (skillPreferenceUpdate?.handled) {
    if (skillPreferenceUpdate.updated && String(skillPreferenceUpdate.skillName || "").trim()) {
      recordIdentitySkillPreferenceUpdate({
        userContextId,
        workspaceDir: personaWorkspaceDir,
        conversationId,
        sessionKey,
        source,
        skillName: skillPreferenceUpdate.skillName,
        directive: skillPreferenceUpdate.directive || "",
      });
    }
    const reply = await sendDirectAssistantReply(
      text,
      String(skillPreferenceUpdate.reply || "I couldn't save that skill preference yet. Retry once."),
      ctx,
      skillPreferenceUpdate.updated ? "Updating skill preferences" : "Clarifying skill update",
    );
    appendRawStream({
      event: "skill_preference_update",
      source,
      sessionKey,
      userContextId: userContextId || undefined,
      skillName: String(skillPreferenceUpdate.skillName || ""),
      updated: skillPreferenceUpdate.updated === true,
      filePath: String(skillPreferenceUpdate.filePath || ""),
    });
    if (skillPreferenceUpdate.updated && skillPreferenceUpdate.filePath) {
      console.log(
        `[SkillPreference] Updated ${String(skillPreferenceUpdate.skillName || "unknown")} for ${userContextId || "anonymous"} at ${String(skillPreferenceUpdate.filePath)}.`,
      );
    }
    return {
      route: skillPreferenceUpdate.updated ? "skill_preference_update" : "skill_preference_clarify",
      ok: !String(skillPreferenceUpdate.error || "").trim(),
      reply: String(reply || ""),
      error: String(skillPreferenceUpdate.error || ""),
      latencyMs: 0,
    };
  }

  const missionShortTermContext = readShortTermContextState({
    userContextId,
    conversationId,
    domainId: "mission_task",
  });
  const cryptoShortTermContext = readShortTermContextState({
    userContextId,
    conversationId,
    domainId: "crypto",
  });
  const missionContextIsPrimary =
    missionShortTermContext
    && Number(missionShortTermContext.ts || 0) >= Number(cryptoShortTermContext?.ts || 0);
  if (missionContextIsPrimary && missionPolicy.isCancel(normalizedTextForRouting)) {
    clearPendingMissionConfirm(sessionKey);
    clearShortTermContextState({ userContextId, conversationId, domainId: "mission_task" });
    const reply = await sendDirectAssistantReply(
      text,
      "Okay. I canceled the mission follow-up context.",
      ctx,
      "Clearing mission context",
    );
    return {
      route: "mission_context_canceled",
      ok: true,
      reply,
    };
  }

  const missionIsFollowUpRefine =
    missionContextIsPrimary
    && missionPolicy.isNonCriticalFollowUp(normalizedTextForRouting)
    && !missionPolicy.isNewTopic(normalizedTextForRouting)
    && !missionPolicy.isCancel(normalizedTextForRouting);
  if (missionIsFollowUpRefine && !getPendingMissionConfirm(sessionKey)) {
    const basePrompt = String(missionShortTermContext?.slots?.pendingPrompt || "").trim();
    const mergedPrompt = mergeMissionPrompt(basePrompt, text);
    if (mergedPrompt) {
      setPendingMissionConfirm(sessionKey, mergedPrompt);
      upsertShortTermContextState({
        userContextId,
        conversationId,
        domainId: "mission_task",
        topicAffinityId: "mission_task",
        slots: {
          pendingPrompt: mergedPrompt,
          phase: "confirm_refine",
          lastUserText: String(text || "").trim(),
        },
      });
      const reply = await sendDirectAssistantReply(
        text,
        buildMissionConfirmReply(mergedPrompt),
        ctx,
        "Refining mission",
      );
      return {
        route: "mission_context_refine",
        ok: true,
        reply,
      };
    }
  }

  const pendingWeather = getPendingWeatherConfirm(sessionKey);
  if (pendingWeather) {
    if (isWeatherConfirmNo(text)) {
      clearPendingWeatherConfirm(sessionKey);
      const reply = await sendDirectAssistantReply(
        text,
        "Okay. I will not run that location. Share the correct city and I will fetch weather immediately.",
        ctx,
        "Waiting for location",
      );
      return {
        route: "weather_confirm_declined",
        ok: true,
        reply,
      };
    }

    if (isWeatherConfirmYes(text)) {
      const runtimeTools = await toolRuntime.initToolRuntimeIfNeeded({ userContextId });
      const availableTools = Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : [];
      const canRunToolLoop = TOOL_LOOP_ENABLED
        && availableTools.length > 0
        && typeof runtimeTools?.executeToolUse === "function";
      const canRunWebSearch = canRunToolLoop && availableTools.some((t) => String(t?.name || "") === "web_search");
      clearPendingWeatherConfirm(sessionKey);
      const confirmedWeatherResult = await tryWeatherFastPathReply({
        text: pendingWeather.prompt,
        runtimeTools,
        availableTools,
        canRunWebSearch,
        forcedLocation: pendingWeather.suggestedLocation,
        bypassConfirmation: true,
      });
      const confirmedReply = String(confirmedWeatherResult?.reply || "").trim()
        || `I could not fetch weather for ${pendingWeather.suggestedLocation} yet. Please retry.`;
      const reply = await sendDirectAssistantReply(text, confirmedReply, ctx, "Fetching weather");
      return {
        route: "weather_confirm_accepted",
        ok: true,
        reply,
        toolCalls: confirmedWeatherResult?.toolCall ? [String(confirmedWeatherResult.toolCall)] : [],
        canRunToolLoop,
        canRunWebSearch,
      };
    }

    // If the user moved on or asked a fresh weather question, do not trap the
    // session in a yes/no loop. Clear stale confirmation and continue routing.
    clearPendingWeatherConfirm(sessionKey);
  }

  // Mission confirmation/build routing before LLM/provider selection.
  const pendingMission = getPendingMissionConfirm(sessionKey);
  if (pendingMission) {
    if (isMissionConfirmNo(text)) {
      clearPendingMissionConfirm(sessionKey);
      clearShortTermContextState({ userContextId, conversationId, domainId: "mission_task" });
      const reply = await sendDirectAssistantReply(
        text,
        "No problem. I will not create a mission. If you want one later, say: create a mission for ...",
        ctx,
      );
      return {
        route: "mission_confirm_declined",
        ok: true,
        reply,
      };
    }

    if (isMissionConfirmYes(text)) {
      const details = stripMissionConfirmPrefix(text);
      const mergedPrompt = mergeMissionPrompt(pendingMission.prompt, details);
      clearPendingMissionConfirm(sessionKey);
      clearShortTermContextState({ userContextId, conversationId, domainId: "mission_task" });
      return await handleWorkflowBuild(mergedPrompt, ctx, { engine: "src" });
    }

    const detailLikeFollowUp = /\b(at|am|pm|est|et|pst|pt|cst|ct|telegram|discord|novachat|daily|every|morning|night|tomorrow)\b/i.test(text);
    if (detailLikeFollowUp) {
      const mergedPrompt = mergeMissionPrompt(pendingMission.prompt, text);
      setPendingMissionConfirm(sessionKey, mergedPrompt);
      upsertShortTermContextState({
        userContextId,
        conversationId,
        domainId: "mission_task",
        topicAffinityId: "mission_task",
        slots: {
          pendingPrompt: mergedPrompt,
          phase: "confirm_refine",
          lastUserText: String(text || "").trim(),
        },
      });
      const reply = await sendDirectAssistantReply(text, buildMissionConfirmReply(mergedPrompt), ctx);
      return {
        route: "mission_confirm_refine",
        ok: true,
        reply,
      };
    }
  }

  if (shouldBuildWorkflowFromPrompt(text)) {
    clearPendingMissionConfirm(sessionKey);
    upsertShortTermContextState({
      userContextId,
      conversationId,
      domainId: "mission_task",
      topicAffinityId: "mission_task",
      slots: {
        pendingPrompt: String(text || "").trim(),
        phase: "build_attempt",
        lastUserText: String(text || "").trim(),
      },
    });
    return await handleWorkflowBuild(text, ctx, { engine: "src" });
  }

  if (shouldConfirmWorkflowFromPrompt(text)) {
    const candidatePrompt = stripAssistantInvocation(text) || text;
    setPendingMissionConfirm(sessionKey, candidatePrompt);
    upsertShortTermContextState({
      userContextId,
      conversationId,
      domainId: "mission_task",
      topicAffinityId: "mission_task",
      slots: {
        pendingPrompt: candidatePrompt,
        phase: "confirm_prompt",
        lastUserText: String(text || "").trim(),
      },
    });
    const reply = await sendDirectAssistantReply(text, buildMissionConfirmReply(candidatePrompt), ctx);
    return {
      route: "mission_confirm_prompt",
      ok: true,
      reply,
    };
  }

  const turnPolicy = buildLatencyTurnPolicy(text, {
    weatherIntent: isWeatherRequestText(text),
    cryptoIntent: isCryptoRequestText(text),
    canRunWebSearchHint: true,
    canRunWebFetchHint: true,
  });
  const assistantTurnClassification = applyShortTermContextTurnClassification({
    userContextId,
    conversationId,
    domainId: "assistant",
    text,
  });
  const assistantShortTermContext = readShortTermContextState({
    userContextId,
    conversationId,
    domainId: "assistant",
  });
  const requestHints = {
    fastLaneSimpleChat: turnPolicy.fastLaneSimpleChat === true,
    assistantShortTermFollowUp: false,
    assistantShortTermContextSummary: "",
  };
  if (!turnPolicy.weatherIntent && !turnPolicy.cryptoIntent) {
    if ((assistantTurnClassification.isCancel || assistantTurnClassification.isNewTopic) && assistantShortTermContext) {
      clearShortTermContextState({ userContextId, conversationId, domainId: "assistant" });
    } else if (assistantTurnClassification.isNonCriticalFollowUp && assistantShortTermContext) {
      requestHints.assistantShortTermFollowUp = true;
      requestHints.assistantShortTermContextSummary = summarizeShortTermContextForPrompt(assistantShortTermContext, 520);
      requestHints.assistantTopicAffinityId = String(assistantShortTermContext.topicAffinityId || "");
    }
  }

  let runtimeTools = null;
  let availableTools = [];
  if (turnPolicy.likelyNeedsToolRuntime) {
    const runtimeToolInitStartedAt = Date.now();
    runtimeTools = await toolRuntime.initToolRuntimeIfNeeded({ userContextId });
    availableTools = Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : [];
    latencyTelemetry.addStage("runtime_tool_init", Date.now() - runtimeToolInitStartedAt);
  }

  const executionPolicy = resolveToolExecutionPolicy(turnPolicy, {
    text,
    availableTools,
    toolLoopEnabled: TOOL_LOOP_ENABLED,
    executeToolUse: runtimeTools?.executeToolUse,
  });
  const canRunWebSearch = executionPolicy.canRunWebSearch;
  const canRunWebFetch = executionPolicy.canRunWebFetch;
  const canRunToolLoop = executionPolicy.canRunToolLoop;

  // Resolve provider (Bug Fix 4: uses cached loader) + routing arbitration
  const providerResolutionStartedAt = Date.now();
  await ensureRuntimeIntegrationsSnapshot(userContextId, ctx.supabaseAccessToken);
  const integrationsRuntime = cachedLoadIntegrationsRuntime({ userContextId });
  const activeChatRuntime = resolveConfiguredChatRuntime(integrationsRuntime, {
    strictActiveProvider: !ENABLE_PROVIDER_FALLBACK,
    preference: ROUTING_PREFERENCE,
    requiresToolCalling: canRunToolLoop,
    allowActiveProviderOverride: ENABLE_PROVIDER_FALLBACK && ROUTING_ALLOW_ACTIVE_OVERRIDE,
    preferredProviders: ROUTING_PREFERRED_PROVIDERS,
  });
  latencyTelemetry.addStage("provider_resolution", Date.now() - providerResolutionStartedAt);

  if (!activeChatRuntime.apiKey) {
    const providerName = activeChatRuntime.provider === "claude" ? "Claude" : activeChatRuntime.provider === "grok" ? "Grok" : activeChatRuntime.provider === "gemini" ? "Gemini" : "OpenAI";
    throw new Error(`Missing ${providerName} API key for active provider "${activeChatRuntime.provider}". Configure Integrations first.`);
  }
  if (!activeChatRuntime.connected) {
    throw new Error(`Active provider "${activeChatRuntime.provider}" is not enabled. Enable it or switch activeLlmProvider.`);
  }

  const activeOpenAiCompatibleClient = activeChatRuntime.provider === "claude"
    ? null
    : getOpenAIClient({ apiKey: activeChatRuntime.apiKey, baseURL: activeChatRuntime.baseURL });
  const selectedChatModel = activeChatRuntime.model
    || (activeChatRuntime.provider === "claude" ? DEFAULT_CLAUDE_MODEL
      : activeChatRuntime.provider === "grok" ? DEFAULT_GROK_MODEL
      : activeChatRuntime.provider === "gemini" ? DEFAULT_GEMINI_MODEL
      : DEFAULT_CHAT_MODEL);

  console.log(
    `[RuntimeSelection] session=${sessionKey} provider=${activeChatRuntime.provider}` +
    ` model=${selectedChatModel} source=${source}` +
    ` route=${String(activeChatRuntime.routeReason || "n/a")}` +
    ` candidates=${Array.isArray(activeChatRuntime.rankedCandidates) ? activeChatRuntime.rankedCandidates.join(">") : activeChatRuntime.provider}`,
  );

  const llmCtx = {
    activeChatRuntime,
    activeOpenAiCompatibleClient,
    selectedChatModel,
    runtimeTools,
    availableTools,
    canRunToolLoop,
    canRunWebSearch,
    canRunWebFetch,
    turnPolicy,
    executionPolicy,
    latencyTelemetry,
  };

  // Route to sub-handler
  if (n.includes("spotify") || n.includes("play music") || n.includes("play some") || n.includes("put on ")) {
    return await handleSpotify(text, ctx, llmCtx);
  }

  return await executeChatRequest(text, ctx, llmCtx, requestHints);
}

export async function handleInput(text, opts = {}) {
  const startedAt = Date.now();
  const userInputText = String(text || "");
  const source = String(opts?.source || "hud");
  const sender = String(opts?.sender || "");
  let sessionKey = "";
  let userContextId = "";
  let conversationId = "";
  let nlpBypass = opts?.nlpBypass === true;
  let result = null;
  let caughtError = null;

  try {
    userContextId = String(sessionRuntime.resolveUserContextId(opts) || "");
    sessionKey = String(opts?.sessionKeyHint || "");
    conversationId = resolveConversationId(opts, sessionKey, source);
  } catch {
    // Best effort logging; allow main handler to throw normally.
  }

  try {
    result = await handleInputCore(text, opts);
    return result;
  } catch (err) {
    caughtError = err;
    throw err;
  } finally {
    const summary = result && typeof result === "object"
      ? result
      : {
          route: "unclassified",
          ok: caughtError ? false : true,
          reply: typeof result === "string" ? result : "",
          error: caughtError ? describeUnknownError(caughtError) : "",
        };

    appendDevConversationLog({
      source,
      sender,
      userContextId,
      conversationId,
      sessionKey,
      route: String(summary.route || "unclassified"),
      userInputText,
      cleanedInputText: normalizeInboundUserText(userInputText),
      assistantReplyText: String(summary.reply || ""),
      provider: String(summary.provider || ""),
      model: String(summary.model || ""),
      requestHints: summary.requestHints && typeof summary.requestHints === "object" ? summary.requestHints : {},
      canRunToolLoop: summary.canRunToolLoop === true,
      canRunWebSearch: summary.canRunWebSearch === true,
      canRunWebFetch: summary.canRunWebFetch === true,
      toolCalls: Array.isArray(summary.toolCalls) ? summary.toolCalls : [],
      toolExecutions: Array.isArray(summary.toolExecutions) ? summary.toolExecutions : [],
      retries: Array.isArray(summary.retries) ? summary.retries : [],
      memoryRecallUsed: summary.memoryRecallUsed === true,
      memorySearchDiagnostics: summary.memorySearchDiagnostics && typeof summary.memorySearchDiagnostics === "object"
        ? summary.memorySearchDiagnostics
        : null,
      memoryAutoCaptured: Number.isFinite(Number(summary.memoryAutoCaptured))
        ? Number(summary.memoryAutoCaptured)
        : 0,
      webSearchPreloadUsed: summary.webSearchPreloadUsed === true,
      linkUnderstandingUsed: summary.linkUnderstandingUsed === true,
      promptTokens: Number.isFinite(Number(summary.promptTokens)) ? Number(summary.promptTokens) : 0,
      completionTokens: Number.isFinite(Number(summary.completionTokens)) ? Number(summary.completionTokens) : 0,
      totalTokens: Number.isFinite(Number(summary.totalTokens)) ? Number(summary.totalTokens) : 0,
      estimatedCostUsd: Number.isFinite(Number(summary.estimatedCostUsd))
        ? Number(summary.estimatedCostUsd)
        : null,
      latencyMs: Number.isFinite(Number(summary.latencyMs)) && Number(summary.latencyMs) > 0
        ? Number(summary.latencyMs)
        : Date.now() - startedAt,
      latencyStages: summary.latencyStages && typeof summary.latencyStages === "object"
        ? summary.latencyStages
        : {},
      latencyHotPath: String(summary.latencyHotPath || ""),
      correctionPassCount: Number.isFinite(Number(summary.correctionPassCount))
        ? Number(summary.correctionPassCount)
        : 0,
      fallbackReason: String(summary.fallbackReason || ""),
      fallbackStage: String(summary.fallbackStage || ""),
      hadCandidateBeforeFallback: summary.hadCandidateBeforeFallback === true,
      toolLoopGuardrails: summary.toolLoopGuardrails && typeof summary.toolLoopGuardrails === "object"
        ? summary.toolLoopGuardrails
        : null,
      ok: summary.ok !== false && !caughtError,
      error: String(summary.error || (caughtError ? describeUnknownError(caughtError) : "")),
      nlpBypass,
      nlpConfidence: Number.isFinite(Number(summary.nlpConfidence))
        ? Number(summary.nlpConfidence)
        : null,
      nlpCorrectionCount: Number.isFinite(Number(summary.nlpCorrectionCount))
        ? Number(summary.nlpCorrectionCount)
        : 0,
    });

    // Phase 2: ChatKit shadow-mode evaluation (non-blocking, never affects user-visible output).
    void runChatKitShadowEvaluation({
      userContextId,
      conversationId,
      missionRunId: String(summary.missionRunId || ""),
      prompt: userInputText,
      route: String(summary.route || "unclassified"),
      baselineProvider: String(summary.provider || ""),
      baselineModel: String(summary.model || ""),
      baselineLatencyMs: Number.isFinite(Number(summary.latencyMs))
        ? Number(summary.latencyMs)
        : Date.now() - startedAt,
      baselineOk: summary.ok !== false && !caughtError,
      turnId: String(summary.turnId || ""),
    }).catch(() => {});
  }
}

