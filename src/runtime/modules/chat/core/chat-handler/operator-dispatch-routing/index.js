export async function routeOperatorDispatch(input = {}) {
  const {
    text,
    ctx,
    llmCtx,
    requestHints,
    shouldRouteToSpotify = false,
    spotifyShortTermFollowUp = false,
    spotifyPolicy = null,
    spotifyShortTermContext = null,
    spotifyShortTermContextSnapshot = null,
    shouldRouteToYouTube = false,
    youtubeShortTermFollowUp = false,
    youtubePolicy = null,
    youtubeShortTermContext = null,
    youtubeShortTermContextSnapshot = null,
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
  if (typeof handleSpotify !== "function") {
    throw new Error("routeOperatorDispatch requires handleSpotify");
  }
  if (shouldRouteToYouTube && typeof handleYouTube !== "function") {
    throw new Error("routeOperatorDispatch requires handleYouTube");
  }
  if (typeof executeChatRequest !== "function") {
    throw new Error("routeOperatorDispatch requires executeChatRequest");
  }
  if (typeof upsertShortTermContextState !== "function") {
    throw new Error("routeOperatorDispatch requires upsertShortTermContextState");
  }

  if (shouldRouteToSpotify) {
    const spotifyResult = await delegateToOrgChartWorker({
      routeHint: "spotify",
      responseRoute: "spotify",
      text,
      toolCalls: ["spotify"],
      provider: String(activeChatRuntime?.provider || ""),
      providerSource: "chat-runtime-selected",
      userContextId,
      conversationId,
      sessionKey,
      run: async () => handleSpotify(text, ctx, llmCtx),
    });
    if (spotifyResult?.ok !== false) {
      const resolvedTopicAffinityId = String(
        spotifyPolicy?.resolveTopicAffinityId?.(text, spotifyShortTermContext || spotifyShortTermContextSnapshot || {})
        || spotifyShortTermContext?.topicAffinityId
        || spotifyShortTermContextSnapshot?.topicAffinityId
        || "spotify_general",
      ).trim() || "spotify_general";
      upsertShortTermContextState({
        userContextId,
        conversationId,
        domainId: "spotify",
        topicAffinityId: resolvedTopicAffinityId,
        slots: {
          lastUserText: String(text || "").trim().slice(0, 320),
          lastAssistantReply: String(spotifyResult?.reply || "").trim().slice(0, 320),
          lastRoute: "spotify",
          followUpResolved: spotifyShortTermFollowUp === true,
        },
      });
    }
    return spotifyResult;
  }

  if (shouldRouteToYouTube) {
    const youtubeResult = await delegateToOrgChartWorker({
      routeHint: "youtube",
      responseRoute: "youtube",
      text,
      toolCalls: ["youtube_home_control"],
      provider: String(activeChatRuntime?.provider || ""),
      providerSource: "chat-runtime-selected",
      userContextId,
      conversationId,
      sessionKey,
      run: async () => handleYouTube(text, ctx, llmCtx),
    });
    if (youtubeResult?.ok !== false) {
      const resolvedTopicAffinityId = String(
        youtubePolicy?.resolveTopicAffinityId?.(text, youtubeShortTermContext || youtubeShortTermContextSnapshot || {})
        || youtubeShortTermContext?.topicAffinityId
        || youtubeShortTermContextSnapshot?.topicAffinityId
        || "youtube_general",
      ).trim() || "youtube_general";
      upsertShortTermContextState({
        userContextId,
        conversationId,
        domainId: "youtube",
        topicAffinityId: resolvedTopicAffinityId,
        slots: {
          lastUserText: String(text || "").trim().slice(0, 320),
          lastAssistantReply: String(youtubeResult?.reply || "").trim().slice(0, 320),
          lastRoute: "youtube",
          followUpResolved: youtubeShortTermFollowUp === true,
        },
      });
    }
    return youtubeResult;
  }

  return await delegateToOrgChartWorker({
    routeHint: "chat",
    responseRoute: "chat",
    text,
    toolCalls: [],
    provider: String(activeChatRuntime?.provider || ""),
    providerSource: "chat-runtime-selected",
    userContextId,
    conversationId,
    sessionKey,
    run: async () => executeChatRequest(text, ctx, llmCtx, requestHints),
  });
}
