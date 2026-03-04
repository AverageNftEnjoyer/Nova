export function buildOperatorContextHints(input = {}) {
  const {
    text = "",
    turnPolicy = {},
    userContextId = "",
    conversationId = "",
    isSpotifyDirectIntent,
    isSpotifyContextualFollowUpIntent,
    isYouTubeDirectIntent,
    isYouTubeContextualFollowUpIntent,
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
  const spotifyTurnClassification = applyShortTermContextTurnClassification({
    userContextId,
    conversationId,
    domainId: "spotify",
    text,
  });
  const spotifyShortTermContext = readShortTermContextState({
    userContextId,
    conversationId,
    domainId: "spotify",
  });
  const youtubeTurnClassification = applyShortTermContextTurnClassification({
    userContextId,
    conversationId,
    domainId: "youtube",
    text,
  });
  const youtubeShortTermContext = readShortTermContextState({
    userContextId,
    conversationId,
    domainId: "youtube",
  });
  const spotifyShortTermFollowUp =
    Boolean(spotifyShortTermContext)
    && !(typeof isSpotifyDirectIntent === "function" && isSpotifyDirectIntent(text))
    && (
      spotifyTurnClassification.isNonCriticalFollowUp
      || (typeof isSpotifyContextualFollowUpIntent === "function" && isSpotifyContextualFollowUpIntent(text))
    )
    && !spotifyTurnClassification.isCancel
    && !spotifyTurnClassification.isNewTopic;
  const youtubeShortTermFollowUp =
    Boolean(youtubeShortTermContext)
    && !(typeof isYouTubeDirectIntent === "function" && isYouTubeDirectIntent(text))
    && (
      youtubeTurnClassification.isNonCriticalFollowUp
      || (typeof isYouTubeContextualFollowUpIntent === "function" && isYouTubeContextualFollowUpIntent(text))
    )
    && !youtubeTurnClassification.isCancel
    && !youtubeTurnClassification.isNewTopic;

  const requestHints = {
    fastLaneSimpleChat: turnPolicy.fastLaneSimpleChat === true,
    assistantShortTermFollowUp: false,
    assistantShortTermContextSummary: "",
    spotifyShortTermFollowUp: false,
    spotifyShortTermContextSummary: "",
    youtubeShortTermFollowUp: false,
    youtubeShortTermContextSummary: "",
  };

  if (!turnPolicy.weatherIntent && !turnPolicy.cryptoIntent) {
    if ((assistantTurnClassification.isCancel || assistantTurnClassification.isNewTopic) && assistantShortTermContext) {
      clearShortTermContextState({ userContextId, conversationId, domainId: "assistant" });
    } else if (assistantTurnClassification.isNonCriticalFollowUp && assistantShortTermContext) {
      requestHints.assistantShortTermFollowUp = true;
      requestHints.assistantShortTermContextSummary = summarizeShortTermContextForPrompt(assistantShortTermContext, 520);
      requestHints.assistantTopicAffinityId = String(assistantShortTermContext.topicAffinityId || "");
    }
    if (spotifyShortTermFollowUp && spotifyShortTermContext) {
      requestHints.spotifyShortTermFollowUp = true;
      requestHints.spotifyShortTermContextSummary = summarizeShortTermContextForPrompt(spotifyShortTermContext, 320);
      requestHints.spotifyTopicAffinityId = String(spotifyShortTermContext.topicAffinityId || "");
    }
    if (youtubeShortTermFollowUp && youtubeShortTermContext) {
      requestHints.youtubeShortTermFollowUp = true;
      requestHints.youtubeShortTermContextSummary = summarizeShortTermContextForPrompt(youtubeShortTermContext, 320);
      requestHints.youtubeTopicAffinityId = String(youtubeShortTermContext.topicAffinityId || "");
    }
  }

  return {
    requestHints,
    spotifyShortTermFollowUp,
    spotifyShortTermContext,
    youtubeShortTermFollowUp,
    youtubeShortTermContext,
    assistantShortTermContext,
    assistantTurnClassification,
    spotifyTurnClassification,
    youtubeTurnClassification,
  };
}
