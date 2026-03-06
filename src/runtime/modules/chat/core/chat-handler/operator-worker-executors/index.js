import { OPERATOR_LANE_SEQUENCE } from "../operator-lane-config/index.js";
import { DOMAIN_WORKER_RULES } from "../../../routing/org-chart-routing/registry.js";
import { handleSpotifyWorker } from "../../../workers/media/spotify-agent/index.js";
import { handleYouTubeWorker } from "../../../workers/media/youtube-agent/index.js";
import { handleVoiceWorker } from "../../../workers/media/voice-agent/index.js";
import { handleTtsWorker } from "../../../workers/media/tts-agent/index.js";
import { handleCoinbaseWorker } from "../../../workers/finance/coinbase-agent/index.js";
import { handlePolymarketWorker } from "../../../workers/finance/polymarket-agent/index.js";
import { handleCryptoWorker } from "../../../workers/finance/crypto-agent/index.js";
import { handleGmailWorker } from "../../../workers/comms/gmail-agent/index.js";
import { handleTelegramWorker } from "../../../workers/comms/telegram-agent/index.js";
import { handleDiscordWorker } from "../../../workers/comms/discord-agent/index.js";
import { handleCalendarWorker } from "../../../workers/productivity/calendar-agent/index.js";
import { handleRemindersWorker } from "../../../workers/productivity/reminders-agent/index.js";
import { handleMarketWorker } from "../../../workers/market/market-agent/index.js";
import { handleWeatherWorker } from "../../../workers/market/weather-agent/index.js";
import { handleWebResearchWorker } from "../../../workers/system/web-research-agent/index.js";
import { handleFilesWorker } from "../../../workers/system/files-agent/index.js";
import { handleMemoryWorker } from "../../../workers/system/memory-agent/index.js";
import { handleShutdownWorker } from "../../../workers/system/shutdown-agent/index.js";
import { handleDiagnosticsWorker } from "../../../workers/system/diagnostics-agent/index.js";

const DEFAULT_EXECUTOR_KIND = "default";
const EXECUTOR_KIND_CANDIDATES = OPERATOR_LANE_SEQUENCE.flatMap((lane) => [
  String(lane.id || "").trim().toLowerCase(),
  String(lane.executionMode || "").trim().toLowerCase(),
]).filter(Boolean);
const SUPPORTED_EXECUTOR_KINDS = new Set([DEFAULT_EXECUTOR_KIND, ...EXECUTOR_KIND_CANDIDATES]);

function isEnvEnabled(key, defaultValue = true) {
  const raw = process.env[key];
  if (raw == null || String(raw).trim() === "") return defaultValue;
  return String(raw).trim() !== "0";
}

const OPERATOR_EXECUTION_CONTROLS = Object.freeze({
  forceToolLoopAllowed: isEnvEnabled("NOVA_OPERATOR_FORCE_TOOL_LOOP", true),
  forceWebSearchPreloadAllowed: isEnvEnabled("NOVA_OPERATOR_FORCE_WEB_SEARCH_PRELOAD", true),
  forceWebFetchPreloadAllowed: isEnvEnabled("NOVA_OPERATOR_FORCE_WEB_FETCH_PRELOAD", true),
});

const EXECUTOR_HINT_STRATEGIES = Object.freeze({
  polymarket: {
    fastLaneSimpleChat: false,
    forceToolLoop: true,
    forceWebSearchPreload: true,
    worker: {
      reasoningMode: "probability-market-analysis",
      requiresFreshMarketContext: true,
    },
  },
  coinbase: {
    fastLaneSimpleChat: false,
    forceToolLoop: true,
    worker: {
      reasoningMode: "portfolio-and-account-analysis",
      requiresStructuredOutput: true,
    },
  },
  web_research: {
    fastLaneSimpleChat: false,
    forceToolLoop: true,
    forceWebSearchPreload: true,
    forceWebFetchPreload: true,
    worker: {
      reasoningMode: "evidence-synthesis",
      citationStyle: "source-linked",
    },
  },
  market: {
    fastLaneSimpleChat: false,
    forceWebSearchPreload: true,
    worker: {
      reasoningMode: "market-and-weather-briefing",
      freshnessPriority: "high",
    },
  },
  crypto: {
    fastLaneSimpleChat: false,
    forceToolLoop: true,
    worker: {
      reasoningMode: "crypto-monitoring",
      freshnessPriority: "high",
    },
  },
  gmail: {
    fastLaneSimpleChat: false,
    forceToolLoop: true,
    worker: {
      reasoningMode: "email-triage",
    },
  },
  telegram: {
    fastLaneSimpleChat: false,
    forceToolLoop: true,
    worker: {
      reasoningMode: "messaging-automation",
    },
  },
  discord: {
    fastLaneSimpleChat: false,
    forceToolLoop: true,
    worker: {
      reasoningMode: "community-ops",
    },
  },
  calendar: {
    fastLaneSimpleChat: false,
    forceToolLoop: true,
    worker: {
      reasoningMode: "calendar-scheduling",
    },
  },
  reminders: {
    fastLaneSimpleChat: false,
    forceToolLoop: true,
    worker: {
      reasoningMode: "task-reminders",
    },
  },
  files: {
    fastLaneSimpleChat: false,
    forceToolLoop: true,
    worker: {
      reasoningMode: "workspace-file-ops",
    },
  },
  diagnostics: {
    fastLaneSimpleChat: false,
    forceToolLoop: true,
    worker: {
      reasoningMode: "runtime-diagnostics",
    },
  },
  voice: {
    fastLaneSimpleChat: false,
    worker: {
      reasoningMode: "voice-runtime-control",
    },
  },
  tts: {
    fastLaneSimpleChat: false,
    worker: {
      reasoningMode: "tts-runtime-control",
    },
  },
  shutdown: {
    fastLaneSimpleChat: false,
    worker: {
      reasoningMode: "system-shutdown-control",
      requiresScopedContext: true,
    },
  },
});

function resolveExecutorKindForLane(lane = {}) {
  const laneId = String(lane.id || "").trim();
  if (!laneId) throw new Error("Operator lane is missing id");
  const requestedKind = String(lane.executionMode || "").trim().toLowerCase();
  if (!requestedKind) return DEFAULT_EXECUTOR_KIND;
  if (!SUPPORTED_EXECUTOR_KINDS.has(requestedKind)) {
    throw new Error(`Unsupported operator executionMode "${requestedKind}" for lane "${laneId}"`);
  }
  return requestedKind;
}

const EXECUTOR_KIND_BY_LANE_ID = Object.freeze(
  OPERATOR_LANE_SEQUENCE.reduce((acc, lane) => {
    acc[lane.id] = resolveExecutorKindForLane(lane);
    return acc;
  }, {}),
);

const WORKER_RULE_BY_ROUTE_HINT = Object.freeze(
  OPERATOR_LANE_SEQUENCE.reduce((acc, lane) => {
    const routeHint = String(lane.routeHint || "").trim();
    if (!routeHint || acc[routeHint]) return acc;
    const matchedRule = DOMAIN_WORKER_RULES.find((rule) => {
      const routeTokens = Array.isArray(rule?.routeTokens) ? rule.routeTokens : [];
      return routeTokens.includes(routeHint);
    });
    if (matchedRule) acc[routeHint] = matchedRule;
    return acc;
  }, {}),
);

function buildOperatorWorkerHints(lane, executorKind = DEFAULT_EXECUTOR_KIND) {
  const routeHint = String(lane?.routeHint || "").trim();
  const matchedRule = WORKER_RULE_BY_ROUTE_HINT[routeHint] || null;
  const strategy = EXECUTOR_HINT_STRATEGIES[executorKind] || null;
  return {
    agentId: String(matchedRule?.workerAgentId || `${String(lane?.id || "operator").trim()}-agent`),
    reason: String(matchedRule?.reason || ""),
    laneId: lane.id,
    routeHint: lane.routeHint,
    responseRoute: lane.responseRoute,
    domainId: lane.domainId,
    toolCalls: Array.isArray(lane.toolCalls) ? lane.toolCalls.slice(0, 4) : [],
    executorKind,
    ...(strategy?.worker && typeof strategy.worker === "object" ? strategy.worker : {}),
  };
}

function buildLaneRequestHints(requestHints, lane, executorKind = DEFAULT_EXECUTOR_KIND) {
  const strategy = EXECUTOR_HINT_STRATEGIES[executorKind] || null;
  return {
    ...(requestHints && typeof requestHints === "object" ? requestHints : {}),
    ...(strategy?.fastLaneSimpleChat === false ? { fastLaneSimpleChat: false } : {}),
    ...(strategy?.forceToolLoop === true && OPERATOR_EXECUTION_CONTROLS.forceToolLoopAllowed
      ? { forceToolLoop: true }
      : {}),
    ...(strategy?.forceWebSearchPreload === true && OPERATOR_EXECUTION_CONTROLS.forceWebSearchPreloadAllowed
      ? { forceWebSearchPreload: true }
      : {}),
    ...(strategy?.forceWebFetchPreload === true && OPERATOR_EXECUTION_CONTROLS.forceWebFetchPreloadAllowed
      ? { forceWebFetchPreload: true }
      : {}),
    operatorLane: {
      id: lane.id,
      routeHint: lane.routeHint,
      responseRoute: lane.responseRoute,
      domainId: lane.domainId,
      resultRoute: lane.resultRoute,
      executorKind,
    },
    operatorWorker: buildOperatorWorkerHints(lane, executorKind),
    operatorExecutionControls: { ...OPERATOR_EXECUTION_CONTROLS },
  };
}

function isWeatherExecutionForMarketLane(text, llmCtx = {}, requestHints = {}) {
  const dispatchRouteHint = String(requestHints?.operatorDispatchRouteHint || "").trim().toLowerCase();
  if (dispatchRouteHint === "weather") return true;
  if (dispatchRouteHint === "market") return false;
  if (llmCtx?.turnPolicy?.weatherIntent === true) return true;
  if (String(requestHints?.marketTopicAffinityId || "").trim() === "market_weather") return true;
  return /\b(weather|forecast|temperature|rain|snow|precipitation)\b/i.test(String(text || ""));
}

const EXECUTOR_KIND_HANDLERS = {
  spotify: ({ text, ctx, llmCtx, spotifyWorker }) => {
    const runSpotifyWorker = typeof spotifyWorker === "function" ? spotifyWorker : handleSpotifyWorker;
    return async () => runSpotifyWorker(text, ctx, llmCtx);
  },
  youtube: ({ text, ctx, youtubeWorker }) => {
    const runYouTubeWorker = typeof youtubeWorker === "function" ? youtubeWorker : handleYouTubeWorker;
    return async () => runYouTubeWorker(text, ctx);
  },
  polymarket: ({ text, ctx, llmCtx, requestHints, lane, executorKind, polymarketWorker }) => {
    const laneRequestHints = buildLaneRequestHints(requestHints, lane, executorKind);
    const runPolymarketWorker = typeof polymarketWorker === "function" ? polymarketWorker : handlePolymarketWorker;
    return async () => runPolymarketWorker(text, ctx, llmCtx, laneRequestHints);
  },
  coinbase: ({ text, ctx, llmCtx, coinbaseWorker }) => {
    const runCoinbaseWorker = typeof coinbaseWorker === "function" ? coinbaseWorker : handleCoinbaseWorker;
    return async () => runCoinbaseWorker(text, ctx, llmCtx);
  },
  crypto: ({ text, ctx, llmCtx, cryptoWorker }) => {
    const runCryptoWorker = typeof cryptoWorker === "function" ? cryptoWorker : handleCryptoWorker;
    return async () => runCryptoWorker(text, ctx, llmCtx);
  },
  gmail: ({ text, ctx, llmCtx, requestHints, lane, executorKind, executeChatRequest }) => {
    const laneRequestHints = buildLaneRequestHints(requestHints, lane, executorKind);
    return async () => handleGmailWorker(text, ctx, llmCtx, laneRequestHints, executeChatRequest);
  },
  telegram: ({ text, ctx, llmCtx, requestHints, lane, executorKind, telegramWorker }) => {
    const laneRequestHints = buildLaneRequestHints(requestHints, lane, executorKind);
    const runTelegramWorker = typeof telegramWorker === "function" ? telegramWorker : handleTelegramWorker;
    return async () => runTelegramWorker(text, ctx, llmCtx, laneRequestHints);
  },
  discord: ({ text, ctx, llmCtx, requestHints, lane, executorKind, discordWorker }) => {
    const laneRequestHints = buildLaneRequestHints(requestHints, lane, executorKind);
    const runDiscordWorker = typeof discordWorker === "function" ? discordWorker : handleDiscordWorker;
    return async () => runDiscordWorker(text, ctx, llmCtx, laneRequestHints);
  },
  calendar: ({ text, ctx, llmCtx, requestHints, lane, executorKind, executeChatRequest, calendarWorker }) => {
    const laneRequestHints = buildLaneRequestHints(requestHints, lane, executorKind);
    const runCalendarWorker = typeof calendarWorker === "function" ? calendarWorker : handleCalendarWorker;
    return async () => runCalendarWorker(text, ctx, llmCtx, laneRequestHints, executeChatRequest);
  },
  reminders: ({ text, ctx, llmCtx, requestHints, lane, executorKind, executeChatRequest, remindersWorker }) => {
    const laneRequestHints = buildLaneRequestHints(requestHints, lane, executorKind);
    const runRemindersWorker = typeof remindersWorker === "function" ? remindersWorker : handleRemindersWorker;
    return async () => runRemindersWorker(text, ctx, llmCtx, laneRequestHints, executeChatRequest);
  },
  web_research: ({ text, ctx, llmCtx, requestHints, lane, executorKind, executeChatRequest }) => {
    const laneRequestHints = buildLaneRequestHints(requestHints, lane, executorKind);
    return async () => handleWebResearchWorker(text, ctx, llmCtx, laneRequestHints, executeChatRequest);
  },
  market: ({ text, ctx, llmCtx, weatherWorker, marketWorker, requestHints, lane, executorKind }) => {
    if (isWeatherExecutionForMarketLane(text, llmCtx, requestHints)) {
      const runWeatherWorker = typeof weatherWorker === "function" ? weatherWorker : handleWeatherWorker;
      return async () => runWeatherWorker(text, ctx, llmCtx);
    }
    const laneRequestHints = buildLaneRequestHints(requestHints, lane, executorKind);
    laneRequestHints.operatorLane = {
      ...(laneRequestHints.operatorLane || {}),
      routeHint: "market",
      responseRoute: "market",
      resultRoute: "market",
    };
    laneRequestHints.operatorWorker = {
      ...(laneRequestHints.operatorWorker || {}),
      routeHint: "market",
    };
    const runMarketWorker = typeof marketWorker === "function" ? marketWorker : handleMarketWorker;
    return async () => runMarketWorker(text, ctx, llmCtx, laneRequestHints);
  },
  files: ({ text, ctx, llmCtx, requestHints, lane, executorKind, executeChatRequest }) => {
    const laneRequestHints = buildLaneRequestHints(requestHints, lane, executorKind);
    return async () => handleFilesWorker(text, ctx, llmCtx, laneRequestHints, executeChatRequest);
  },
  memory: ({ text, ctx, memoryWorker }) => {
    const runMemoryWorker = typeof memoryWorker === "function" ? memoryWorker : handleMemoryWorker;
    return async () => runMemoryWorker(text, ctx);
  },
  shutdown: ({ text, ctx, llmCtx, requestHints, lane, executorKind, shutdownWorker }) => {
    const laneRequestHints = buildLaneRequestHints(requestHints, lane, executorKind);
    const runShutdownWorker = typeof shutdownWorker === "function" ? shutdownWorker : handleShutdownWorker;
    return async () => runShutdownWorker(text, ctx, llmCtx, laneRequestHints);
  },
  diagnostics: ({ text, ctx, llmCtx, requestHints, lane, executorKind, executeChatRequest }) => {
    const laneRequestHints = buildLaneRequestHints(requestHints, lane, executorKind);
    return async () => handleDiagnosticsWorker(text, ctx, llmCtx, laneRequestHints, executeChatRequest);
  },
  voice: ({ text, ctx, llmCtx, requestHints, lane, executorKind, executeChatRequest, voiceWorker }) => {
    const laneRequestHints = buildLaneRequestHints(requestHints, lane, executorKind);
    const runVoiceWorker = typeof voiceWorker === "function" ? voiceWorker : handleVoiceWorker;
    return async () => runVoiceWorker(text, ctx, llmCtx, laneRequestHints, executeChatRequest);
  },
  tts: ({ text, ctx, llmCtx, requestHints, lane, executorKind, executeChatRequest, ttsWorker }) => {
    const laneRequestHints = buildLaneRequestHints(requestHints, lane, executorKind);
    const runTtsWorker = typeof ttsWorker === "function" ? ttsWorker : handleTtsWorker;
    return async () => runTtsWorker(text, ctx, llmCtx, laneRequestHints, executeChatRequest);
  },
  default: ({ text, ctx, llmCtx, requestHints, lane, executorKind, executeChatRequest }) => {
    const laneRequestHints = buildLaneRequestHints(requestHints, lane, executorKind);
    return async () => executeChatRequest(text, ctx, llmCtx, laneRequestHints);
  },
};

export function resolveOperatorWorkerExecutor(input = {}) {
  const {
    lane = null,
    text,
    ctx,
    llmCtx,
    requestHints,
    spotifyWorker,
    youtubeWorker,
    polymarketWorker,
    calendarWorker,
    remindersWorker,
    memoryWorker,
    shutdownWorker,
    coinbaseWorker,
    cryptoWorker,
    telegramWorker,
    marketWorker,
    weatherWorker,
    discordWorker,
    voiceWorker,
    ttsWorker,
    executeChatRequest,
  } = input;

  if (!lane || typeof lane !== "object" || !lane.id) {
    throw new Error("resolveOperatorWorkerExecutor requires lane");
  }
  if (typeof executeChatRequest !== "function") {
    throw new Error("resolveOperatorWorkerExecutor requires executeChatRequest");
  }

  const executorKind = EXECUTOR_KIND_BY_LANE_ID[lane.id];
  const handler = EXECUTOR_KIND_HANDLERS[executorKind] || EXECUTOR_KIND_HANDLERS.default;
  const normalizedCtx = {
    ...(ctx && typeof ctx === "object" ? ctx : {}),
    userContextId: String(ctx?.userContextId || input.userContextId || ""),
    conversationId: String(ctx?.conversationId || input.conversationId || ""),
    sessionKey: String(ctx?.sessionKey || input.sessionKey || ""),
  };
  return handler({
    lane,
    executorKind: executorKind || DEFAULT_EXECUTOR_KIND,
    text,
    ctx: normalizedCtx,
    llmCtx,
    requestHints,
    spotifyWorker,
    youtubeWorker,
    polymarketWorker,
    calendarWorker,
    remindersWorker,
    memoryWorker,
    shutdownWorker,
    coinbaseWorker,
    cryptoWorker,
    telegramWorker,
    marketWorker,
    weatherWorker,
    discordWorker,
    voiceWorker,
    ttsWorker,
    executeChatRequest,
  });
}

export function getOperatorWorkerExecutorKindMap() {
  return { ...EXECUTOR_KIND_BY_LANE_ID };
}

export function getOperatorExecutionControls() {
  return { ...OPERATOR_EXECUTION_CONTROLS };
}
