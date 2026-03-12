// Extracted from chat-handler.js to reduce file size and isolate LLM execution flow.

import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GROK_MODEL,
  DEFAULT_GEMINI_MODEL,
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
} from "../../../../../core/constants/index.js";
import { sessionRuntime, toolRuntime } from "../../../../infrastructure/config/index.js";
import { resolvePersonaWorkspaceDir, appendRawStream, trimHistoryMessagesByTokenBudget, cachedLoadIntegrationsRuntime } from "../../../../context/persona-context/index.js";
import { captureUserPreferencesFromMessage, buildUserPreferencePromptSection } from "../../../../context/user-preferences/index.js";
import {
  recordIdentitySkillPreferenceUpdate,
  recordIdentityToolUsage,
  syncIdentityIntelligenceFromTurn,
} from "../../../../context/identity/engine/index.js";
import { syncPersonalityFromTurn } from "../../../../context/personality/index.js";
import { extractAutoMemoryFacts } from "../../../../../../memory/runtime/index.js";
import { applySkillPreferenceUpdateFromMessage } from "../../../../context/skill-preferences/index.js";
import { buildRuntimeSkillsPrompt } from "../../../../context/skills/index.js";
import { shouldPreloadWebSearch, replyClaimsNoLiveAccess, buildWebSearchReadableReply } from "../../../routing/intent-router/index.js";
import { speak, playThinking, getBusy, setBusy, getCurrentVoice, normalizeRuntimeTone, runtimeToneDirective } from "../../../../audio/voice/index.js";
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
} from "../../../../infrastructure/hud-gateway/index.js";
import {
  claudeMessagesCreate,
  claudeMessagesStream,
  describeUnknownError,
  estimateTokenCostUsd,
  extractOpenAIChatText,
  streamOpenAiChatCompletion,
  toErrorDetails,
  withTimeout,
} from "../../../../llm/providers/index.js";
import { buildSystemPromptWithPersona, enforcePromptTokenBound } from "../../../../../core/context-prompt/index.js";
import { buildAgentSystemPrompt, PromptMode } from "../../../../context/system-prompt/index.js";
import { buildPersonaPrompt } from "../../../../context/bootstrap/index.js";
import { normalizeAssistantReply, normalizeAssistantSpeechText } from "../../../quality/reply-normalizer/index.js";
import { normalizeInboundUserText } from "../../../quality/response-quality-guard/index.js";
import { appendDevConversationLog } from "../../../telemetry/dev-conversation-log/index.js";
import { runChatKitShadowEvaluation } from "../../../telemetry/chatkit-shadow/index.js";
import { runChatKitServeAttempt } from "../../../telemetry/chatkit-serving/index.js";
import { parseOutputConstraints, validateOutputConstraints } from "../../../quality/output-constraints/index.js";
import { runLinkUnderstanding, formatLinkUnderstandingForPrompt } from "../../../analysis/link-understanding/index.js";
import { appendBudgetedPromptSection, computeHistoryTokenBudget, resolveDynamicPromptBudget } from "../../../prompt/prompt-budget/index.js";
import {
  buildLatencyTurnPolicy,
  resolveToolExecutionPolicy,
} from "../../../telemetry/latency-policy/index.js";
import { createChatLatencyTelemetry } from "../../../telemetry/latency-telemetry/index.js";
import { detectSuspiciousPatterns, wrapWebContent } from "../../../../context/external-content/index.js";
import {
  applyMemoryFactsToWorkspace,
  hashShadowPayload,
  resolveConversationId,
  stripAssistantInvocation,
  summarizeToolResultPreview,
} from "../../chat-utils/index.js";
import { createToolLoopBudget, capToolCallsPerStep, isLikelyTimeoutError } from "../../tool-loop-guardrails/index.js";
import {
  isWeatherRequestText,
} from "../../../workers/market/weather-service/index.js";
import {
  applyShortTermContextTurnClassification,
  readShortTermContextState,
  summarizeShortTermContextForPrompt,
  upsertShortTermContextState,
  clearShortTermContextState,
} from "../../short-term-context-engine/index.js";
import { getShortTermContextPolicy } from "../../short-term-context-policies/index.js";
import {
  OPENAI_DEFAULT_MAX_COMPLETION_TOKENS,
  OPENAI_FAST_LANE_MAX_COMPLETION_TOKENS,
  OPENAI_STRICT_MAX_COMPLETION_TOKENS,
  resolveAdaptiveOpenAiMaxCompletionTokens,
  resolveOpenAiRequestTuning,
} from "../prompt-recovery/index.js";
import { runToolLoop } from "../tool-loop-runner/index.js";
import { runClaudeDirectCompletion, runOpenAiDirectCompletion } from "../direct-completion/index.js";
import { buildPromptContextForTurn } from "../prompt-context-builder/index.js";
import { refineAssistantReply } from "../response-refinement/index.js";
import { resolveOrgChartRoutingEnvelope } from "../../../routing/org-chart-routing/index.js";




function normalizeOperatorLaneHint(value) {
  if (!value || typeof value !== "object") return null;
  const laneId = String(value.id || "").trim().toLowerCase();
  if (!laneId) return null;
  return {
    id: laneId,
    routeHint: String(value.routeHint || "").trim().toLowerCase(),
    responseRoute: String(value.responseRoute || "").trim().toLowerCase(),
    domainId: String(value.domainId || "").trim().toLowerCase(),
    resultRoute: String(value.resultRoute || "").trim().toLowerCase(),
    executorKind: String(value.executorKind || "").trim().toLowerCase(),
  };
}

function buildRecentUserFacts(previousAssistantContext, userText) {
  const previousFacts = Array.isArray(previousAssistantContext?.slots?.recentUserFacts)
    ? previousAssistantContext.slots.recentUserFacts
        .map((fact) => String(fact || "").trim().slice(0, 160))
        .filter(Boolean)
    : [];
  const nextFacts = extractAutoMemoryFacts(userText)
    .map((candidate) => String(candidate?.fact || "").trim().slice(0, 160))
    .filter(Boolean);
  const mergedFacts = [];
  for (const fact of [...previousFacts, ...nextFacts]) {
    const normalized = fact.toLowerCase();
    const existingIndex = mergedFacts.findIndex((entry) => entry.toLowerCase() === normalized);
    if (existingIndex >= 0) mergedFacts.splice(existingIndex, 1);
    mergedFacts.push(fact);
  }
  return mergedFacts.slice(-4);
}

function normalizeOperatorWorkerHint(value) {
  if (!value || typeof value !== "object") return null;
  const agentId = String(value.agentId || "").trim().toLowerCase();
  if (!agentId) return null;
  return {
    agentId,
    laneId: String(value.laneId || "").trim().toLowerCase(),
    routeHint: String(value.routeHint || "").trim().toLowerCase(),
    domainId: String(value.domainId || "").trim().toLowerCase(),
    executorKind: String(value.executorKind || "").trim().toLowerCase(),
    reasoningMode: String(value.reasoningMode || "").trim().toLowerCase(),
  };
}

function normalizeOperatorExecutionControls(value) {
  if (!value || typeof value !== "object") return null;
  return {
    forceToolLoopAllowed: value.forceToolLoopAllowed === true,
    forceWebSearchPreloadAllowed: value.forceWebSearchPreloadAllowed === true,
    forceWebFetchPreloadAllowed: value.forceWebFetchPreloadAllowed === true,
  };
}

// ===== Core chat request =====
export async function executeChatRequest(text, ctx, llmCtx, requestHints = {}) {
  const { source, sender, sessionContext, sessionKey, useVoice, ttsVoice, userContextId, conversationId,
    runtimeTone, runtimeCommunicationStyle, runtimeAssistantName, runtimeCustomInstructions,
    runtimeProactivity, runtimeHumorLevel, runtimeRiskTolerance, runtimeStructurePreference, runtimeChallengeLevel,
    raw_text: displayText, hudOpToken } = ctx;
  const scopedUserLabel = String(userContextId || "").trim() || "missing-user-context";
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
  const forceWebSearchPreload = requestHints?.forceWebSearchPreload === true;
  const forceWebFetchPreload = requestHints?.forceWebFetchPreload === true;
  const forceToolLoop = requestHints?.forceToolLoop === true;
  const operatorLaneHint = normalizeOperatorLaneHint(requestHints?.operatorLane);
  const operatorWorkerHint = normalizeOperatorWorkerHint(requestHints?.operatorWorker);
  const operatorExecutionControls = normalizeOperatorExecutionControls(requestHints?.operatorExecutionControls);
  const shouldPreloadWebSearchForTurn = executionPolicy?.shouldPreloadWebSearch === true || forceWebSearchPreload;
  const shouldPreloadWebFetchForTurn = executionPolicy?.shouldPreloadWebFetch === true || forceWebFetchPreload;
  const shouldAttemptMemoryRecallForTurn = executionPolicy?.shouldAttemptMemoryRecall === true;
  const shouldRunToolLoop = Boolean(
    canRunToolLoop
    || (
      forceToolLoop
      && TOOL_LOOP_ENABLED
      && typeof runtimeTools?.executeToolUse === "function"
      && Array.isArray(availableTools)
      && availableTools.length > 0
    ),
  );
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
  let recoveryReason = "";
  let recoveryStage = "";
  let hadCandidateBeforeRecovery = false;
  const markRecovery = (stage, reason, candidateReply = "") => {
    recoveryStage = String(stage || "").trim();
    recoveryReason = String(reason || "").trim();
    if (String(candidateReply || "").trim()) hadCandidateBeforeRecovery = true;
    if (recoveryStage && !String(responseRoute || "").includes(recoveryStage)) {
      responseRoute = `${responseRoute}_${recoveryStage}`;
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
      forceWebSearchPreload,
      forceWebFetchPreload,
      forceToolLoop,
      ...(operatorLaneHint ? { operatorLane: operatorLaneHint } : {}),
      ...(operatorWorkerHint ? { operatorWorker: operatorWorkerHint } : {}),
      ...(operatorExecutionControls ? { operatorExecutionControls } : {}),
    },
    canRunToolLoop: shouldRunToolLoop,
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
    recoveryReason: "",
    recoveryStage: "",
    hadCandidateBeforeRecovery: false,
    toolLoopGuardrails: null,
    voiceOutputError: "",
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
  }, ctx.imageData);
  if (useVoice) playThinking();

  let systemPrompt = "";
  let historyMessages = [];
  let messages = [];

  const assistantStreamId = createAssistantStreamId();
  broadcastAssistantStreamStart(assistantStreamId, source, undefined, conversationId, userContextId);

  let reply = "";
  try {
    let promptTokens = 0;
    let completionTokens = 0;
    let modelUsed = selectedChatModel;
    let providerUsed = activeChatRuntime.provider;
    const fastPathStartedAt = Date.now();
    latencyTelemetry.addStage("fast_path", Date.now() - fastPathStartedAt);
    let llmStartedAt = 0;

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
    const shouldFailClosedOnServeError = serveAttempt.failClosed === true
      && serveIntentClass === "chat"
      && (
        serveAttempt.reason === "chatkit_module_unavailable"
        || serveAttempt.reason === "serve_not_usable"
        || serveAttempt.reason === "serve_failed"
      );
    if (serveAttempt.used === true) {
      responseRoute = "chatkit_served";
      broadcastThinkingStatus("Drafting response", userContextId);
      reply = String(serveAttempt.reply || "").trim();
      providerUsed = "openai-chatkit";
      modelUsed = String(serveAttempt.model || selectedChatModel);
      promptTokens = Number(serveAttempt?.usage?.promptTokens || 0);
      completionTokens = Number(serveAttempt?.usage?.completionTokens || 0);
    } else if (shouldFailClosedOnServeError) {
      responseRoute = "chatkit_fail_closed";
      providerUsed = "openai-chatkit";
      modelUsed = selectedChatModel;
      const chatkitFailureReason = String(serveAttempt.reason || "chatkit_unavailable");
      markRecovery("chatkit_fail_closed_error", chatkitFailureReason, "");
      throw new Error(`ChatKit serve attempt failed closed (${chatkitFailureReason}).`);
    } else {
      const promptContext = await buildPromptContextForTurn({
        text,
        uiText,
        ctx,
        source,
        sender,
        sessionKey,
        sessionContext,
        userContextId,
        conversationId,
        personaWorkspaceDir,
        runtimeAssistantName,
        runtimeCommunicationStyle,
        runtimeTone,
        runtimeCustomInstructions,
        runtimeProactivity,
        runtimeHumorLevel,
        runtimeRiskTolerance,
        runtimeStructurePreference,
        runtimeChallengeLevel,
        requestHints,
        fastLaneSimpleChat,
        hasStrictOutputRequirements,
        outputConstraints,
        selectedChatModel,
        runtimeTools,
        availableTools,
        shouldPreloadWebSearchForTurn,
        shouldPreloadWebFetchForTurn,
        shouldAttemptMemoryRecallForTurn,
        observedToolCalls,
        runSummary,
        latencyTelemetry,
        broadcastThinkingStatus,
      });
      systemPrompt = promptContext.systemPrompt;
      historyMessages = promptContext.historyMessages;
      messages = promptContext.messages;
      preparedPromptHash = promptContext.preparedPromptHash;
      preferenceProfileUpdated = promptContext.preferenceProfileUpdated;
      identityAppliedSignals = promptContext.identityAppliedSignals;
      identityRejectedSignals = promptContext.identityRejectedSignals;
      identityPromptIncluded = promptContext.identityPromptIncluded;
      usedMemoryRecall = promptContext.usedMemoryRecall;
      usedWebSearchPreload = promptContext.usedWebSearchPreload;
      usedLinkUnderstanding = promptContext.usedLinkUnderstanding;
      if (activeChatRuntime.provider === "claude") {
        llmStartedAt = Date.now();
        responseRoute = "claude_direct";
        broadcastThinkingStatus("Drafting response", userContextId);
        const claudeDirect = await runClaudeDirectCompletion({
          activeChatRuntime,
          selectedChatModel,
          systemPrompt,
          historyMessages,
          text,
          hasStrictOutputRequirements,
          assistantStreamId,
          source,
          conversationId,
          userContextId,
          broadcastAssistantStreamDelta,
        });
        reply = claudeDirect.reply;
        promptTokens = claudeDirect.promptTokens;
        completionTokens = claudeDirect.completionTokens;
        emittedAssistantDelta = emittedAssistantDelta || claudeDirect.emittedAssistantDelta === true;
      } else if (shouldRunToolLoop) {
        llmStartedAt = Date.now();
        responseRoute = "tool_loop";
        const openAiToolDefs = toolRuntime.toOpenAiToolDefinitions(availableTools);
        const toolLoopResult = await runToolLoop({
          activeOpenAiCompatibleClient,
          modelUsed,
          messages,
          openAiToolDefs,
          openAiMaxCompletionTokens,
          openAiRequestTuningForModel,
          runtimeTools,
          toolRuntime,
          availableTools,
          assistantStreamId,
          source,
          conversationId,
          userContextId,
          hudOpToken,
          sessionKey,
          text,
          latencyTelemetry,
          observedToolCalls,
          toolExecutions,
          retries,
          markRecovery,
        });
        reply = toolLoopResult.reply;
        promptTokens += Number(toolLoopResult.promptTokens || 0);
        completionTokens += Number(toolLoopResult.completionTokens || 0);
        modelUsed = toolLoopResult.modelUsed || modelUsed;
        runSummary.toolLoopGuardrails = toolLoopResult.toolLoopGuardrails || null;
      } else {
        llmStartedAt = Date.now();
        broadcastThinkingStatus("Drafting response", userContextId);
        responseRoute = hasStrictOutputRequirements ? "openai_direct_constraints" : "openai_stream";
        const directResult = await runOpenAiDirectCompletion({
          activeChatRuntime,
          activeOpenAiCompatibleClient,
          modelUsed,
          messages,
          openAiMaxCompletionTokens,
          openAiRequestTuningForModel,
          hasStrictOutputRequirements,
          text,
          assistantStreamId,
          source,
          conversationId,
          userContextId,
          broadcastAssistantStreamDelta,
          broadcastThinkingStatus,
          retries,
          markRecovery,
        });
        reply = directResult.reply;
        promptTokens += Number(directResult.promptTokens || 0);
        completionTokens += Number(directResult.completionTokens || 0);
        modelUsed = directResult.modelUsed || modelUsed;
        emittedAssistantDelta = emittedAssistantDelta || directResult.emittedAssistantDelta === true;
      }
    }
    if (llmStartedAt > 0) {
      latencyTelemetry.addStage("llm_generation", Date.now() - llmStartedAt);
    }

    const refinement = await refineAssistantReply({
      reply,
      hasStrictOutputRequirements,
      canRunWebSearch,
      text,
      runtimeTools,
      availableTools,
      toolExecutions,
      observedToolCalls,
      emittedAssistantDelta,
      assistantStreamId,
      source,
      conversationId,
      userContextId,
      broadcastThinkingStatus,
      broadcastAssistantStreamDelta,
      latencyTelemetry,
      outputConstraints,
      retries,
      modelUsed,
      activeChatRuntime,
      selectedChatModel,
      systemPrompt,
      historyMessages,
      messages,
      activeOpenAiCompatibleClient,
      openAiMaxCompletionTokens,
      openAiRequestTuningForModel,
      responseRoute,
      markRecovery,
    });
    reply = refinement.reply;
    responseRoute = refinement.responseRoute;
    emittedAssistantDelta = emittedAssistantDelta || refinement.emittedAssistantDelta === true;
    promptTokens += Number(refinement.promptTokensDelta || 0);
    completionTokens += Number(refinement.completionTokensDelta || 0);
    outputConstraintCorrectionPasses += Number(refinement.correctionPassesDelta || 0);

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
          recentUserFacts: buildRecentUserFacts(previousAssistantContext, uiText),
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
          `[Memory] Auto-upserted ${autoCaptured} fact(s) for ${scopedUserLabel} in MEMORY.md.`,
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
    runSummary.recoveryReason = recoveryReason;
    runSummary.recoveryStage = recoveryStage;
    runSummary.hadCandidateBeforeRecovery = hadCandidateBeforeRecovery;

    if (useVoice && reply) {
      const voiceStartedAt = Date.now();
      try {
        await speak(normalizeAssistantSpeechText(reply) || reply, ttsVoice);
        latencyTelemetry.addStage("voice_output", Date.now() - voiceStartedAt);
      } catch (voiceErr) {
        const voiceErrorMessage = describeUnknownError(voiceErr);
        runSummary.voiceOutputError = voiceErrorMessage;
        appendRawStream({
          event: "voice_output_error",
          source,
          sessionKey,
          userContextId: userContextId || undefined,
          message: voiceErrorMessage,
        });
        console.warn(`[TTS] Voice output failed: ${voiceErrorMessage}`);
      }
    }
  } catch (err) {
    broadcastThinkingStatus("Handling error", userContextId);
    const details = toErrorDetails(err);
    const msg = details.message || "Unknown model error.";
    const errorReply = "I hit a runtime error while processing your request. Please retry.";
    appendRawStream({ event: "request_error", source, sessionKey, provider: activeChatRuntime.provider, model: selectedChatModel, status: details.status, code: details.code, type: details.type, requestId: details.requestId, message: msg });
    console.error(`[LLM] Chat request failed provider=${activeChatRuntime.provider} model=${selectedChatModel} status=${details.status ?? "n/a"} code=${details.code ?? "n/a"} message=${msg}`);
    markRecovery("request_error", details.code || details.message || "request_error", "");
    retries.push({
      stage: "request_error",
      fromModel: selectedChatModel,
      toModel: selectedChatModel,
      reason: "request_error",
    });
    responseRoute = `${responseRoute}_error`;
    broadcastAssistantStreamDelta(
      assistantStreamId,
      errorReply,
      source,
      undefined,
      conversationId,
      userContextId,
    );
    runSummary.error = msg;
    runSummary.ok = false;
    runSummary.reply = errorReply;
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
    runSummary.recoveryReason = recoveryReason;
    runSummary.recoveryStage = recoveryStage;
    runSummary.hadCandidateBeforeRecovery = hadCandidateBeforeRecovery;
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
    runSummary.recoveryReason = recoveryReason;
    runSummary.recoveryStage = recoveryStage;
    runSummary.hadCandidateBeforeRecovery = hadCandidateBeforeRecovery;
    runSummary.requestHints.orgChartPath = resolveOrgChartRoutingEnvelope({
      route: runSummary.route,
      responseRoute: runSummary.responseRoute || responseRoute,
      text,
      toolCalls: runSummary.toolCalls,
      provider: runSummary.provider || activeChatRuntime.provider,
      providerSource: "chat-runtime-selected",
      userContextId,
      conversationId,
      sessionKey,
    });
    broadcastAssistantStreamDone(assistantStreamId, source, undefined, conversationId, userContextId);
    broadcastState("idle", userContextId);
  }

  return runSummary;
}

// ===== Main dispatcher =====
