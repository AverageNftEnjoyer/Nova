import {
  OPERATOR_LANE_SEQUENCE,
  resolveOperatorLaneKeyPrefix,
} from "../operator-lane-config/index.js";

function matchesIntent(intentFn, text) {
  return typeof intentFn === "function" && intentFn(text) === true;
}

function buildLaneState({
  lane,
  input,
  text,
  userContextId,
  conversationId,
  applyShortTermContextTurnClassification,
  readShortTermContextState,
}) {
  const keyPrefix = resolveOperatorLaneKeyPrefix(lane);
  const turnClassification = applyShortTermContextTurnClassification({
    userContextId,
    conversationId,
    domainId: lane.domainId,
    text,
  });
  const shortTermContext = readShortTermContextState({
    userContextId,
    conversationId,
    domainId: lane.domainId,
  });
  const directIntent = matchesIntent(input[lane.directIntentFnKey], text);
  const contextualFollowUpIntent = matchesIntent(input[lane.contextualFollowUpIntentFnKey], text);
  const shortTermFollowUp =
    Boolean(shortTermContext)
    && !directIntent
    && (turnClassification.isNonCriticalFollowUp || contextualFollowUpIntent)
    && !turnClassification.isCancel
    && !turnClassification.isNewTopic;

  return {
    lane,
    keyPrefix,
    turnClassification,
    shortTermContext,
    shortTermFollowUp,
  };
}

function buildLaneRequestHintsTemplate() {
  const hints = {};
  for (const lane of OPERATOR_LANE_SEQUENCE) {
    const keyPrefix = resolveOperatorLaneKeyPrefix(lane);
    hints[`${keyPrefix}ShortTermFollowUp`] = false;
    hints[`${keyPrefix}ShortTermContextSummary`] = "";
  }
  return hints;
}

export function buildOperatorContextHints(input = {}) {
  const {
    text = "",
    turnPolicy = {},
    userContextId = "",
    conversationId = "",
    applyShortTermContextTurnClassification,
    readShortTermContextState,
    clearShortTermContextState,
    summarizeShortTermContextForPrompt,
  } = input;

  if (typeof applyShortTermContextTurnClassification !== "function") {
    throw new Error("buildOperatorContextHints requires applyShortTermContextTurnClassification");
  }
  if (typeof readShortTermContextState !== "function") {
    throw new Error("buildOperatorContextHints requires readShortTermContextState");
  }
  if (typeof clearShortTermContextState !== "function") {
    throw new Error("buildOperatorContextHints requires clearShortTermContextState");
  }
  if (typeof summarizeShortTermContextForPrompt !== "function") {
    throw new Error("buildOperatorContextHints requires summarizeShortTermContextForPrompt");
  }

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

  const laneStates = OPERATOR_LANE_SEQUENCE.map((lane) => buildLaneState({
    lane,
    input,
    text,
    userContextId,
    conversationId,
    applyShortTermContextTurnClassification,
    readShortTermContextState,
  }));

  const requestHints = {
    fastLaneSimpleChat: turnPolicy.fastLaneSimpleChat === true,
    assistantShortTermFollowUp: false,
    assistantShortTermContextSummary: "",
    ...buildLaneRequestHintsTemplate(),
  };

  if (!turnPolicy.weatherIntent && !turnPolicy.cryptoIntent) {
    if ((assistantTurnClassification.isCancel || assistantTurnClassification.isNewTopic) && assistantShortTermContext) {
      clearShortTermContextState({ userContextId, conversationId, domainId: "assistant" });
    } else if (assistantTurnClassification.isNonCriticalFollowUp && assistantShortTermContext) {
      requestHints.assistantShortTermFollowUp = true;
      requestHints.assistantShortTermContextSummary = summarizeShortTermContextForPrompt(assistantShortTermContext, 520);
      requestHints.assistantTopicAffinityId = String(assistantShortTermContext.topicAffinityId || "");
    }

    for (const laneState of laneStates) {
      if (!(laneState.shortTermFollowUp && laneState.shortTermContext)) continue;
      requestHints[`${laneState.keyPrefix}ShortTermFollowUp`] = true;
      requestHints[`${laneState.keyPrefix}ShortTermContextSummary`] = summarizeShortTermContextForPrompt(
        laneState.shortTermContext,
        320,
      );
      requestHints[`${laneState.keyPrefix}TopicAffinityId`] = String(
        laneState.shortTermContext.topicAffinityId || "",
      );
    }
  }

  const output = {
    requestHints,
    assistantShortTermContext,
    assistantTurnClassification,
  };
  for (const laneState of laneStates) {
    output[`${laneState.keyPrefix}ShortTermFollowUp`] = laneState.shortTermFollowUp;
    output[`${laneState.keyPrefix}ShortTermContext`] = laneState.shortTermContext;
    output[`${laneState.keyPrefix}TurnClassification`] = laneState.turnClassification;
  }
  return output;
}
