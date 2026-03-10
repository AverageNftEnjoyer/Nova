import {
  OPERATOR_LANE_SEQUENCE,
  resolveOperatorLaneKeyPrefix,
} from "../operator-lane-config/index.js";

export function buildOperatorDispatchInput(input = {}) {
  const {
    text,
    ctx,
    llmCtx,
    requestHints,
    routeDecisions = {},
    contextHints = {},
    lanePolicies = {},
    operatorLaneSnapshots = {},
    userContextId = "",
    conversationId = "",
    sessionKey = "",
    activeChatRuntime = null,
    delegateToOrgChartWorker,
    spotifyWorker,
    youtubeWorker,
    imageWorker,
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

  const dispatchInput = {
    text,
    ctx,
    llmCtx,
    requestHints,
    userContextId,
    conversationId,
    sessionKey,
    activeChatRuntime,
    delegateToOrgChartWorker,
    spotifyWorker,
    youtubeWorker,
    imageWorker,
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
  };

  for (const lane of OPERATOR_LANE_SEQUENCE) {
    const keyPrefix = resolveOperatorLaneKeyPrefix(lane);
    dispatchInput[lane.shouldRouteFlag] = routeDecisions[lane.shouldRouteFlag] === true;
    dispatchInput[lane.shortTermFollowUpFlag] = contextHints[lane.shortTermFollowUpFlag] === true;
    dispatchInput[`${keyPrefix}Policy`] = lanePolicies[`${keyPrefix}Policy`] || null;
    dispatchInput[`${keyPrefix}ShortTermContext`] = contextHints[`${keyPrefix}ShortTermContext`] || null;
    dispatchInput[`${keyPrefix}ShortTermContextSnapshot`] = operatorLaneSnapshots[`${keyPrefix}ShortTermContextSnapshot`] || null;
  }

  return dispatchInput;
}
