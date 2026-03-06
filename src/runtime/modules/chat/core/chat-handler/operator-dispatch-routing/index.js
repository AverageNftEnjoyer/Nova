import {
  OPERATOR_LANE_SEQUENCE,
  resolveOperatorLaneKeyPrefix,
} from "../operator-lane-config/index.js";
import { resolveOperatorWorkerExecutor } from "../operator-worker-executors/index.js";
import { consumePolicyApproval } from "../../../routing/policy-approval-store/index.js";

function resolveTopicAffinityId({
  policy = null,
  text = "",
  shortTermContext = null,
  shortTermContextSnapshot = null,
  defaultTopicAffinityId = "general",
}) {
  return (
    String(
      policy?.resolveTopicAffinityId?.(text, shortTermContext || shortTermContextSnapshot || {})
      || shortTermContext?.topicAffinityId
      || shortTermContextSnapshot?.topicAffinityId
      || defaultTopicAffinityId,
    ).trim()
    || defaultTopicAffinityId
  );
}

function resolveLaneRuntimeState(input, lane) {
  const followUpKeyPrefix = resolveOperatorLaneKeyPrefix(lane);
  return {
    enabled: input[lane.shouldRouteFlag] === true,
    shortTermFollowUp: input[lane.shortTermFollowUpFlag] === true,
    policy: input[`${followUpKeyPrefix}Policy`] || null,
    shortTermContext: input[`${followUpKeyPrefix}ShortTermContext`] || null,
    shortTermContextSnapshot: input[`${followUpKeyPrefix}ShortTermContextSnapshot`] || null,
  };
}

function resolvePolicyGateSettings(input = {}) {
  const requestHints = input.requestHints && typeof input.requestHints === "object"
    ? input.requestHints
    : {};
  const envEnforced = String(process.env.NOVA_POLICY_GATE_ENFORCED || "").trim() === "1";
  const gateEnabled = requestHints.enforcePolicyGate === true || envEnforced;
  const consumeApproval = typeof input.consumePolicyApprovalGrant === "function"
    ? input.consumePolicyApprovalGrant
    : consumePolicyApproval;
  const persistedApprovalGranted = gateEnabled
    ? consumeApproval({
      userContextId: input.userContextId,
      conversationId: input.conversationId,
      sessionKey: input.sessionKey,
    }) === true
    : false;
  const approvalGranted = requestHints.policyApprovalGranted === true
    || persistedApprovalGranted;
  return {
    enabled: gateEnabled,
    approvalGranted,
  };
}

function isWeatherExecutionForMarketLane(text = "", llmCtx = {}, laneState = null, requestHints = {}) {
  if (llmCtx?.turnPolicy?.weatherIntent === true) return true;
  if (String(requestHints?.marketTopicAffinityId || "").trim() === "market_weather") return true;
  if (String(laneState?.shortTermContext?.topicAffinityId || "").trim() === "market_weather") return true;
  return /\b(weather|forecast|temperature|rain|snow|precipitation)\b/i.test(String(text || ""));
}

function resolveLaneDispatchMeta({ lane, text, llmCtx, laneState, requestHints }) {
  if (lane?.id !== "market") {
    return {
      routeHint: lane.routeHint,
      responseRoute: lane.responseRoute,
      toolCalls: lane.toolCalls,
      resultRoute: lane.resultRoute,
    };
  }
  const weatherRoute = isWeatherExecutionForMarketLane(text, llmCtx, laneState, requestHints);
  return weatherRoute
    ? {
        routeHint: "weather",
        responseRoute: "weather",
        toolCalls: ["weather"],
        resultRoute: "weather",
      }
    : {
        routeHint: "market",
        responseRoute: "market",
        toolCalls: ["market"],
        resultRoute: "market",
      };
}

export async function routeOperatorDispatch(input = {}) {
  const {
    text,
    ctx,
    llmCtx,
    requestHints,
    userContextId = "",
    conversationId = "",
    sessionKey = "",
    activeChatRuntime = null,
    delegateToOrgChartWorker,
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
    upsertShortTermContextState,
  } = input;

  if (typeof delegateToOrgChartWorker !== "function") {
    throw new Error("routeOperatorDispatch requires delegateToOrgChartWorker");
  }
  if (typeof executeChatRequest !== "function") {
    throw new Error("routeOperatorDispatch requires executeChatRequest");
  }
  if (typeof upsertShortTermContextState !== "function") {
    throw new Error("routeOperatorDispatch requires upsertShortTermContextState");
  }

  const provider = String(activeChatRuntime?.provider || "");
  const policyGate = resolvePolicyGateSettings(input);

  for (const lane of OPERATOR_LANE_SEQUENCE) {
    const laneState = resolveLaneRuntimeState(input, lane);
    if (!laneState.enabled) continue;
    const laneDispatchMeta = resolveLaneDispatchMeta({
      lane,
      text,
      llmCtx,
      laneState,
      requestHints,
    });
    const laneRequestHints = {
      ...(requestHints && typeof requestHints === "object" ? requestHints : {}),
      operatorDispatchRouteHint: laneDispatchMeta.routeHint,
      operatorDispatchResponseRoute: laneDispatchMeta.responseRoute,
    };

    const runLaneExecutor = resolveOperatorWorkerExecutor({
      lane,
      text,
      ctx,
      llmCtx,
      requestHints: laneRequestHints,
      userContextId,
      conversationId,
      sessionKey,
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

    const laneResult = await delegateToOrgChartWorker({
      routeHint: laneDispatchMeta.routeHint,
      responseRoute: laneDispatchMeta.responseRoute,
      text,
      toolCalls: laneDispatchMeta.toolCalls,
      provider,
      providerSource: "chat-runtime-selected",
      userContextId,
      conversationId,
      sessionKey,
      policyGate,
      run: runLaneExecutor,
    });

    const shouldPersistLaneContext = lane.id === "discord"
      ? laneResult?.ok === true && String(laneResult?.route || "").trim().toLowerCase() === "discord"
      : lane.id === "telegram"
        ? laneResult?.ok === true && String(laneResult?.route || "").trim().toLowerCase() === "telegram"
        : laneResult?.ok !== false;
    if (shouldPersistLaneContext) {
      const resolvedTopicAffinityId = resolveTopicAffinityId({
        policy: laneState.policy,
        text,
        shortTermContext: laneState.shortTermContext,
        shortTermContextSnapshot: laneState.shortTermContextSnapshot,
        defaultTopicAffinityId: lane.defaultTopicAffinityId,
      });

      upsertShortTermContextState({
        userContextId,
        conversationId,
        domainId: lane.domainId,
        topicAffinityId: resolvedTopicAffinityId,
        slots: {
          lastUserText: String(text || "").trim().slice(0, 320),
          lastAssistantReply: String(laneResult?.reply || "").trim().slice(0, 320),
          lastRoute: String(laneResult?.route || laneDispatchMeta.resultRoute || lane.resultRoute || "").trim(),
          followUpResolved: laneState.shortTermFollowUp,
        },
      });
    }

    return laneResult;
  }

  return await delegateToOrgChartWorker({
    routeHint: "chat",
    responseRoute: "chat",
    text,
    toolCalls: [],
    provider,
    providerSource: "chat-runtime-selected",
    userContextId,
    conversationId,
    sessionKey,
    policyGate,
    run: async () => executeChatRequest(text, ctx, llmCtx, requestHints),
  });
}
