import { sessionRuntime } from "../../../../infrastructure/config/index.js";
import { describeUnknownError } from "../../../../llm/providers/index.js";
import { resolveConversationId } from "../../chat-utils/index.js";
import { normalizeInboundUserText } from "../../../quality/response-quality-guard/index.js";
import { appendDevConversationLog } from "../../../telemetry/dev-conversation-log/index.js";
import { runChatKitShadowEvaluation } from "../../../telemetry/chatkit-shadow/index.js";
import { ensureSummaryRequestHintsWithOrgChart } from "../operator-delegation/index.js";

export function deriveHandleInputRuntimeContext(input = {}, deps = {}) {
  const { opts = {}, source = "hud" } = input;
  const sessionRuntimeRef = deps.sessionRuntime || sessionRuntime;
  const resolveConversationIdRef = deps.resolveConversationId || resolveConversationId;
  let sessionKey = "";
  let userContextId = "";
  let conversationId = "";
  const nlpBypass = opts?.nlpBypass === true;
  try {
    userContextId = String(sessionRuntimeRef.resolveUserContextId(opts) || "");
    sessionKey = String(opts?.sessionKeyHint || "");
    conversationId = resolveConversationIdRef(opts, sessionKey, source);
  } catch {
    // Best effort logging; allow main handler to throw normally.
  }
  return { userContextId, sessionKey, conversationId, nlpBypass };
}

function buildResultSummary(result, caughtError, describeUnknownErrorRef) {
  if (result && typeof result === "object") return result;
  return {
    route: "unclassified",
    ok: caughtError ? false : true,
    reply: typeof result === "string" ? result : "",
    error: caughtError ? describeUnknownErrorRef(caughtError) : "",
  };
}

export function finalizeHandleInputTurn(input = {}, deps = {}) {
  const {
    startedAt = Date.now(),
    userInputText = "",
    source = "hud",
    sender = "",
    runtimeContext = {},
    result = null,
    caughtError = null,
  } = input;
  const {
    userContextId = "",
    conversationId = "",
    sessionKey = "",
    nlpBypass = false,
  } = runtimeContext || {};

  const describeUnknownErrorRef = deps.describeUnknownError || describeUnknownError;
  const ensureSummaryRequestHintsWithOrgChartRef =
    deps.ensureSummaryRequestHintsWithOrgChart || ensureSummaryRequestHintsWithOrgChart;
  const appendDevConversationLogRef = deps.appendDevConversationLog || appendDevConversationLog;
  const normalizeInboundUserTextRef = deps.normalizeInboundUserText || normalizeInboundUserText;
  const runChatKitShadowEvaluationRef = deps.runChatKitShadowEvaluation || runChatKitShadowEvaluation;

  const summary = buildResultSummary(result, caughtError, describeUnknownErrorRef);
  const summaryRequestHints = ensureSummaryRequestHintsWithOrgChartRef(summary, {
    route: String(summary.route || "unclassified"),
    responseRoute: String(summary.responseRoute || ""),
    text: userInputText,
    toolCalls: Array.isArray(summary.toolCalls) ? summary.toolCalls : [],
    provider: String(summary.provider || ""),
    providerSource: String(summary.providerSource || (summary.provider ? "chat-runtime-selected" : "worker-runtime-selected")),
    userContextId,
    conversationId,
    sessionKey,
  });
  if (result && typeof result === "object") {
    result.requestHints = summaryRequestHints;
  }

  appendDevConversationLogRef({
    source,
    sender,
    userContextId,
    conversationId,
    sessionKey,
    route: String(summary.route || "unclassified"),
    userInputText,
    cleanedInputText: normalizeInboundUserTextRef(userInputText),
    assistantReplyText: String(summary.reply || ""),
    provider: String(summary.provider || ""),
    model: String(summary.model || ""),
    requestHints: summaryRequestHints,
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
    recoveryReason: String(summary.recoveryReason || ""),
    recoveryStage: String(summary.recoveryStage || ""),
    hadCandidateBeforeRecovery: summary.hadCandidateBeforeRecovery === true,
    toolLoopGuardrails: summary.toolLoopGuardrails && typeof summary.toolLoopGuardrails === "object"
      ? summary.toolLoopGuardrails
      : null,
    ok: summary.ok !== false && !caughtError,
    error: String(summary.error || (caughtError ? describeUnknownErrorRef(caughtError) : "")),
    nlpBypass,
    nlpConfidence: Number.isFinite(Number(summary.nlpConfidence))
      ? Number(summary.nlpConfidence)
      : null,
    nlpCorrectionCount: Number.isFinite(Number(summary.nlpCorrectionCount))
      ? Number(summary.nlpCorrectionCount)
      : 0,
  });

  // Phase 2: ChatKit shadow-mode evaluation (non-blocking, never affects user-visible output).
  void runChatKitShadowEvaluationRef({
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
