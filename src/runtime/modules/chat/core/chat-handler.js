// ===== Chat Handler =====
// handleInput dispatcher split into focused sub-handlers.
// Bug Fix 2: Tool loop errors are now caught, logged, and surfaced to HUD.

import { createRequire } from "module";

// NLP preprocessing (compiled TS â†’ dist/nlp/preprocess.js)
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
    // Build not available yet â€” fall back to identity
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
import { executeChatRequest } from "./chat-handler/execute-chat-request.js";

function readIntEnv(name, fallback, minValue, maxValue) {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.min(maxValue, parsed));
}

const MEMORY_RECALL_TIMEOUT_MS = readIntEnv("NOVA_MEMORY_RECALL_TIMEOUT_MS", 450, 50, 10_000);
const WEB_PRELOAD_TIMEOUT_MS = readIntEnv("NOVA_WEB_PRELOAD_TIMEOUT_MS", 900, 50, 30_000);
const LINK_PRELOAD_TIMEOUT_MS = readIntEnv("NOVA_LINK_PRELOAD_TIMEOUT_MS", 900, 50, 30_000);
const HUD_API_BASE_URL = String(process.env.NOVA_HUD_API_BASE_URL || "http://localhost:3000").trim().replace(/\/+$/, "");
const INTEGRATIONS_SNAPSHOT_ENSURE_TTL_MS = Math.max(
  5_000,
  readIntEnv("NOVA_INTEGRATIONS_SNAPSHOT_ENSURE_TTL_MS", 20_000, 1_000, 300_000),
);
const integrationsSnapshotEnsuredAtByUser = new Map();
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
          workspaceDir: ROOT_WORKSPACE_DIR,
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

  // â”€â”€ NLP preprocessing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // Memory update â€” short-circuit before any LLM call
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

  // Route to sub-handler — catch any music/playback intent so it never leaks to general chat
  if (
    n.includes("spotify") ||
    n.includes("play music") ||
    n.includes("play some") ||
    n.includes("put on ") ||
    /\bplay\s+(my |one of my |a |the )?(favorite|liked|saved|default|playlist|song|track|album|artist)/i.test(n) ||
    /\b(skip|next track|previous track|next song|last song|go back a song|pause|resume|now playing|what.?s playing|what is playing|shuffle|repeat|queue)\b/i.test(n) ||
    /\bplay\s+.+\s+by\s+/i.test(n) ||
    /\bplay\s+[a-z].{2,}/i.test(n) && !/\bplay\s+(a |the )?(game|video|clip|movie|film|role|part)\b/i.test(n)
  ) {
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



