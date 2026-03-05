import {
  OPERATOR_LANE_SEQUENCE,
  resolveOperatorLaneKeyPrefix,
} from "../operator-lane-config/index.js";
import { resolveOperatorWorkerExecutor } from "../operator-worker-executors/index.js";

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
    handleSpotify,
    handleYouTube,
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

  for (const lane of OPERATOR_LANE_SEQUENCE) {
    const laneState = resolveLaneRuntimeState(input, lane);
    if (!laneState.enabled) continue;

    const runLaneExecutor = resolveOperatorWorkerExecutor({
      lane,
      text,
      ctx,
      llmCtx,
      requestHints,
      handleSpotify,
      handleYouTube,
      executeChatRequest,
    });

    const laneResult = await delegateToOrgChartWorker({
      routeHint: lane.routeHint,
      responseRoute: lane.responseRoute,
      text,
      toolCalls: lane.toolCalls,
      provider,
      providerSource: "chat-runtime-selected",
      userContextId,
      conversationId,
      sessionKey,
      run: runLaneExecutor,
    });

    if (laneResult?.ok !== false) {
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
          lastRoute: lane.resultRoute,
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
    run: async () => executeChatRequest(text, ctx, llmCtx, requestHints),
  });
}
