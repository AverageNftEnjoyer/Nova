// ===== Chat Handler =====
// handleInput dispatcher split into focused sub-handlers.
// Bug Fix 2: Tool loop errors are now caught, logged, and surfaced to HUD.

import {
  TOOL_LOOP_ENABLED,
  ROOT_WORKSPACE_DIR,
} from "../../../../core/constants/index.js";
import { sessionRuntime, toolRuntime, wakeWordRuntime } from "../../../infrastructure/config/index.js";
import { resolvePersonaWorkspaceDir, appendRawStream } from "../../../context/persona-context/index.js";
import {
  recordIdentitySkillPreferenceUpdate,
} from "../../../context/identity/engine/index.js";
import { isMemoryUpdateRequest } from "../../../../../memory/runtime-compat/index.js";
import { applySkillPreferenceUpdateFromMessage } from "../../../context/skill-preferences/index.js";
import { shouldBuildWorkflowFromPrompt, shouldConfirmWorkflowFromPrompt } from "../../routing/intent-router/index.js";
import { normalizeRuntimeTone } from "../../../audio/voice/index.js";
import {
  createAssistantStreamId,
  broadcastAssistantStreamStart,
  broadcastAssistantStreamDelta,
  broadcastAssistantStreamDone,
} from "../../../infrastructure/hud-gateway/index.js";
import { shouldSkipDuplicateInbound } from "../../routing/inbound-dedupe/index.js";
import { normalizeInboundUserText } from "../../quality/response-quality-guard/index.js";
import {
  buildLatencyTurnPolicy,
  resolveToolExecutionPolicy,
} from "../../telemetry/latency-policy/index.js";
import { createChatLatencyTelemetry } from "../../telemetry/latency-telemetry/index.js";
import { resolveConversationId } from "../chat-utils/index.js";
import {
  sendDirectAssistantReply,
} from "../../workers/shared/direct-assistant-reply/index.js";
import { handleMemoryWorker } from "../../workers/system/memory-agent/index.js";
import { handleShutdownWorker } from "../../workers/system/shutdown-agent/index.js";
import { handleMissionBuildWorker } from "../../workers/productivity/missions-agent/index.js";
import {
  isWeatherRequestText,
} from "../../workers/market/weather-service/index.js";
import {
  isCryptoRequestText,
  isExplicitCryptoReportRequest,
  runCryptoRequest,
} from "../../workers/finance/crypto-service/index.js";
import {
  handleDuplicateCryptoReportRequest,
} from "../crypto-report-dedupe/index.js";
import {
  applyShortTermContextTurnClassification,
  readShortTermContextState,
  summarizeShortTermContextForPrompt,
  upsertShortTermContextState,
  clearShortTermContextState,
} from "../short-term-context-engine/index.js";
import { getShortTermContextPolicy } from "../short-term-context-policies/index.js";
import {
  delegateToOrgChartWorker,
} from "./operator-delegation/index.js";
import {
  handleMissionBuildRouting,
  handleMissionContextRouting,
} from "./operator-mission-routing/index.js";
import { handleWeatherConfirmationRouting } from "./operator-weather-routing/index.js";
import {
  deriveHandleInputRuntimeContext,
  finalizeHandleInputTurn,
} from "./operator-finalization/index.js";
import { handleDuplicateInboundRouting } from "./operator-dedupe-routing/index.js";
import { preprocessInboundText } from "./operator-preprocess/index.js";
import { selectChatRuntimeForTurn } from "./operator-runtime-selection/index.js";
import { routeOperatorDispatch } from "./operator-dispatch-routing/index.js";
import { buildOperatorContextHints } from "./operator-context-hints/index.js";
import { buildOperatorRouteDecisions } from "./operator-route-decisions/index.js";
import { buildOperatorDispatchInput } from "./operator-dispatch-input/index.js";
import { buildOperatorLanePolicies } from "./operator-lane-policies/index.js";
import { hasFollowUpContinuationCue } from "./operator-followup-cue/index.js";
import {
  readOperatorLaneShortTermContextSnapshots,
  isMissionContextPrimary,
} from "./operator-lane-snapshots/index.js";
import {
  isSpotifyDirectIntent,
  isSpotifyContextualFollowUpIntent,
  isYouTubeDirectIntent,
  isYouTubeContextualFollowUpIntent,
  isPolymarketDirectIntent,
  isPolymarketContextualFollowUpIntent,
  isCoinbaseDirectIntent,
  isCoinbaseContextualFollowUpIntent,
  isGmailDirectIntent,
  isGmailContextualFollowUpIntent,
  isTelegramDirectIntent,
  isTelegramContextualFollowUpIntent,
  isDiscordDirectIntent,
  isDiscordContextualFollowUpIntent,
  isCalendarDirectIntent,
  isCalendarContextualFollowUpIntent,
  isReminderDirectIntent,
  isReminderContextualFollowUpIntent,
  isWebResearchDirectIntent,
  isWebResearchContextualFollowUpIntent,
  isCryptoDirectIntent,
  isCryptoContextualFollowUpIntent,
  isMarketDirectIntent,
  isMarketContextualFollowUpIntent,
  isFilesDirectIntent,
  isFilesContextualFollowUpIntent,
  isDiagnosticsDirectIntent,
  isDiagnosticsContextualFollowUpIntent,
  isVoiceDirectIntent,
  isVoiceContextualFollowUpIntent,
  isTtsDirectIntent,
  isTtsContextualFollowUpIntent,
} from "../../routing/operator-intent-signals/index.js";
import { executeChatRequest } from "./execute-chat-request/index.js";

function emitSingleChunkAssistantStream(replyText, source, conversationId, userContextId) {
  const normalizedReply = String(replyText || "").trim();
  if (!normalizedReply) return;
  const streamId = createAssistantStreamId();
  broadcastAssistantStreamStart(streamId, source, undefined, conversationId, userContextId);
  broadcastAssistantStreamDelta(streamId, normalizedReply, source, undefined, conversationId, userContextId);
  broadcastAssistantStreamDone(streamId, source, undefined, conversationId, userContextId);
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
  const assistantPolicyForDedupe = getShortTermContextPolicy("assistant");
  const lanePolicies = buildOperatorLanePolicies(getShortTermContextPolicy);
  const followUpContinuationCue = hasFollowUpContinuationCue({
    normalizedTextForRouting,
    policies: [
      missionPolicy,
      assistantPolicyForDedupe,
      ...Object.values(lanePolicies),
    ],
  });
  const duplicateMayBeCryptoReport = isExplicitCryptoReportRequest(text)
    || (isCryptoRequestText(text) && /\b(report|summary|pnl|daily|weekly)\b/i.test(text));
  const duplicateMayBeMissionRequest = shouldBuildWorkflowFromPrompt(text)
    || shouldConfirmWorkflowFromPrompt(text);
  const rawRoutingText = text.toLowerCase().trim();

  const explicitCryptoReportRequest = isExplicitCryptoReportRequest(text);
  const duplicateInboundRouteResult = await handleDuplicateInboundRouting({
    text,
    source,
    sender,
    userContextId,
    sessionKey,
    inboundMessageId,
    conversationId,
    explicitCryptoReportRequest,
    duplicateMayMissionRequest: duplicateMayBeMissionRequest,
    followUpContinuationCue,
    duplicateMayBeCryptoReport,
    shouldSkipDuplicateInbound,
    handleDuplicateCryptoReportRequest,
    appendRawStream,
    rerenderDuplicateReport: async () => {
      const runtimeTools = await toolRuntime.initToolRuntimeIfNeeded({ userContextId });
      const availableTools = Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : [];
      return await runCryptoRequest({
        text,
        runtimeTools,
        availableTools,
        userContextId,
        conversationId,
        workspaceDir: ROOT_WORKSPACE_DIR,
      });
    },
    emitSingleChunkAssistantStream,
  });
  if (duplicateInboundRouteResult) return duplicateInboundRouteResult;

  appendRawStream({ event: "request_start", source, sessionKey, userContextId: userContextId || undefined, chars: String(text || "").length });

  // â”€â”€ NLP preprocessing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // raw_text is used for UI display and transcript persistence.
  // clean_text is used for routing, tool selection, memory recall, and LLM.
  const nlpBypass = opts?.nlpBypass === true;
  const nlpResult = await preprocessInboundText({
    text,
    sessionKey,
    nlpBypass,
    latencyTelemetry,
  });
  const raw_text = nlpResult.rawText;
  const nlpCorrections = nlpResult.nlpCorrections;
  const nlpConfidence = nlpResult.nlpConfidence;
  text = nlpResult.cleanText;


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

  // System workers short-circuit before any LLM call.
  const runShutdownWorker = typeof opts.shutdownWorker === "function"
    ? opts.shutdownWorker
    : handleShutdownWorker;
  if (rawRoutingText === "nova shutdown" || rawRoutingText === "nova shut down" || rawRoutingText === "shutdown nova") {
    return await delegateToOrgChartWorker({
      routeHint: "shutdown",
      responseRoute: "shutdown",
      text,
      toolCalls: ["shutdown"],
      provider: "",
      providerSource: "chat-runtime-fallback",
      userContextId,
      conversationId,
      sessionKey,
      run: async () => runShutdownWorker(text, ctx),
    });
  }

  const runMemoryWorker = typeof opts.memoryWorker === "function"
    ? opts.memoryWorker
    : handleMemoryWorker;
  if (isMemoryUpdateRequest(text)) {
    return await delegateToOrgChartWorker({
      routeHint: "memory",
      responseRoute: "memory",
      text,
      toolCalls: ["memory"],
      provider: "",
      providerSource: "chat-runtime-fallback",
      userContextId,
      conversationId,
      sessionKey,
      run: async () => runMemoryWorker(text, ctx),
    });
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
  const operatorLaneSnapshots = readOperatorLaneShortTermContextSnapshots({
    userContextId,
    conversationId,
    readShortTermContextState,
  });
  const missionContextIsPrimary = isMissionContextPrimary({
    missionShortTermContext,
    operatorLaneSnapshots,
  });
  const missionContextRouteResult = await handleMissionContextRouting({
    text,
    normalizedTextForRouting,
    missionContextIsPrimary,
    missionShortTermContext,
    missionPolicy,
    userContextId,
    conversationId,
    sessionKey,
    ctx,
    sendDirectAssistantReply,
    upsertShortTermContextState,
    clearShortTermContextState,
  });
  if (missionContextRouteResult) return missionContextRouteResult;

  const weatherConfirmationRouteResult = await handleWeatherConfirmationRouting({
    text,
    sessionKey,
    userContextId,
    ctx,
    sendDirectAssistantReply,
  });
  if (weatherConfirmationRouteResult) return weatherConfirmationRouteResult;

  const missionBuildRouteResult = await handleMissionBuildRouting({
    text,
    userContextId,
    conversationId,
    sessionKey,
    ctx,
    delegateToOrgChartWorker,
    sendDirectAssistantReply,
    missionWorker: typeof opts.missionWorker === "function" ? opts.missionWorker : handleMissionBuildWorker,
    upsertShortTermContextState,
    clearShortTermContextState,
  });
  if (missionBuildRouteResult) return missionBuildRouteResult;

  const turnPolicy = buildLatencyTurnPolicy(text, {
    weatherIntent: isWeatherRequestText(text),
    cryptoIntent: isCryptoRequestText(text),
    canRunWebSearchHint: true,
    canRunWebFetchHint: true,
  });
  const contextHints = buildOperatorContextHints({
    text,
    turnPolicy,
    userContextId,
    conversationId,
    isSpotifyDirectIntent,
    isSpotifyContextualFollowUpIntent,
    isYouTubeDirectIntent,
    isYouTubeContextualFollowUpIntent,
    isPolymarketDirectIntent,
    isPolymarketContextualFollowUpIntent,
    isCoinbaseDirectIntent,
    isCoinbaseContextualFollowUpIntent,
    isGmailDirectIntent,
    isGmailContextualFollowUpIntent,
    isTelegramDirectIntent,
    isTelegramContextualFollowUpIntent,
    isDiscordDirectIntent,
    isDiscordContextualFollowUpIntent,
    isCalendarDirectIntent,
    isCalendarContextualFollowUpIntent,
    isReminderDirectIntent,
    isReminderContextualFollowUpIntent,
    isWebResearchDirectIntent,
    isWebResearchContextualFollowUpIntent,
    isCryptoDirectIntent,
    isCryptoContextualFollowUpIntent,
    isMarketDirectIntent,
    isMarketContextualFollowUpIntent,
    isFilesDirectIntent,
    isFilesContextualFollowUpIntent,
    isDiagnosticsDirectIntent,
    isDiagnosticsContextualFollowUpIntent,
    isVoiceDirectIntent,
    isVoiceContextualFollowUpIntent,
    isTtsDirectIntent,
    isTtsContextualFollowUpIntent,
    applyShortTermContextTurnClassification,
    readShortTermContextState,
    clearShortTermContextState,
    summarizeShortTermContextForPrompt,
  });
  const requestHints = contextHints.requestHints;
  const spotifyShortTermFollowUp = contextHints.spotifyShortTermFollowUp;
  const youtubeShortTermFollowUp = contextHints.youtubeShortTermFollowUp;
  const polymarketShortTermFollowUp = contextHints.polymarketShortTermFollowUp;
  const coinbaseShortTermFollowUp = contextHints.coinbaseShortTermFollowUp;
  const gmailShortTermFollowUp = contextHints.gmailShortTermFollowUp;
  const telegramShortTermFollowUp = contextHints.telegramShortTermFollowUp;
  const discordShortTermFollowUp = contextHints.discordShortTermFollowUp;
  const calendarShortTermFollowUp = contextHints.calendarShortTermFollowUp;
  const remindersShortTermFollowUp = contextHints.remindersShortTermFollowUp;
  const webResearchShortTermFollowUp = contextHints.webResearchShortTermFollowUp;
  const cryptoShortTermFollowUp = contextHints.cryptoShortTermFollowUp;
  const marketShortTermFollowUp = contextHints.marketShortTermFollowUp;
  const filesShortTermFollowUp = contextHints.filesShortTermFollowUp;
  const diagnosticsShortTermFollowUp = contextHints.diagnosticsShortTermFollowUp;
  const voiceShortTermFollowUp = contextHints.voiceShortTermFollowUp;
  const ttsShortTermFollowUp = contextHints.ttsShortTermFollowUp;

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

  // Resolve provider + model + client for this turn.
  const {
    activeChatRuntime,
    activeOpenAiCompatibleClient,
    selectedChatModel,
  } = await selectChatRuntimeForTurn({
    userContextId,
    supabaseAccessToken: ctx.supabaseAccessToken,
    canRunToolLoop,
    sessionKey,
    source,
    latencyTelemetry,
  });

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
  const routeDecisions = buildOperatorRouteDecisions({
    text,
    spotifyShortTermFollowUp,
    youtubeShortTermFollowUp,
    polymarketShortTermFollowUp,
    coinbaseShortTermFollowUp,
    gmailShortTermFollowUp,
    telegramShortTermFollowUp,
    discordShortTermFollowUp,
    calendarShortTermFollowUp,
    remindersShortTermFollowUp,
    webResearchShortTermFollowUp,
    cryptoShortTermFollowUp,
    marketShortTermFollowUp,
    filesShortTermFollowUp,
    diagnosticsShortTermFollowUp,
    voiceShortTermFollowUp,
    ttsShortTermFollowUp,
    isSpotifyDirectIntent,
    isYouTubeDirectIntent,
    isPolymarketDirectIntent,
    isCoinbaseDirectIntent,
    isGmailDirectIntent,
    isTelegramDirectIntent,
    isDiscordDirectIntent,
    isCalendarDirectIntent,
    isReminderDirectIntent,
    isWebResearchDirectIntent,
    isCryptoDirectIntent,
    isMarketDirectIntent,
    isFilesDirectIntent,
    isDiagnosticsDirectIntent,
    isVoiceDirectIntent,
    isTtsDirectIntent,
  });
  const shouldRouteToSpotify = routeDecisions.shouldRouteToSpotify;
  const shouldRouteToYouTube = routeDecisions.shouldRouteToYouTube;
  const shouldRouteToPolymarket = routeDecisions.shouldRouteToPolymarket;
  const shouldRouteToCoinbase = routeDecisions.shouldRouteToCoinbase;
  const shouldRouteToGmail = routeDecisions.shouldRouteToGmail;
  const shouldRouteToTelegram = routeDecisions.shouldRouteToTelegram;
  const shouldRouteToDiscord = routeDecisions.shouldRouteToDiscord;
  const shouldRouteToCalendar = routeDecisions.shouldRouteToCalendar;
  const shouldRouteToReminders = routeDecisions.shouldRouteToReminders;
  const shouldRouteToWebResearch = routeDecisions.shouldRouteToWebResearch;
  const shouldRouteToCrypto = routeDecisions.shouldRouteToCrypto;
  const shouldRouteToMarket = routeDecisions.shouldRouteToMarket;
  const shouldRouteToFiles = routeDecisions.shouldRouteToFiles;
  const shouldRouteToDiagnostics = routeDecisions.shouldRouteToDiagnostics;
  const shouldRouteToVoice = routeDecisions.shouldRouteToVoice;
  const shouldRouteToTts = routeDecisions.shouldRouteToTts;

  return await routeOperatorDispatch(buildOperatorDispatchInput({
    text,
    ctx,
    llmCtx,
    requestHints,
    routeDecisions,
    contextHints,
    lanePolicies,
    operatorLaneSnapshots,
    userContextId,
    conversationId,
    sessionKey,
    activeChatRuntime,
    delegateToOrgChartWorker,
    executeChatRequest,
    upsertShortTermContextState,
  }));
}

export async function handleInput(text, opts = {}) {
  const startedAt = Date.now();
  const userInputText = String(text || "");
  const source = String(opts?.source || "hud");
  const sender = String(opts?.sender || "");
  const runtimeContext = deriveHandleInputRuntimeContext({ opts, source });
  let result = null;
  let caughtError = null;

  try {
    result = await handleInputCore(text, opts);
    return result;
  } catch (err) {
    caughtError = err;
    throw err;
  } finally {
    finalizeHandleInputTurn({
      startedAt,
      userInputText,
      source,
      sender,
      runtimeContext,
      result,
      caughtError,
    });
  }
}







