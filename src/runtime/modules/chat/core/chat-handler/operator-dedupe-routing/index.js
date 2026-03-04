export async function handleDuplicateInboundRouting(input = {}) {
  const {
    text = "",
    source = "hud",
    sender = "",
    userContextId = "",
    sessionKey = "",
    inboundMessageId = "",
    conversationId = "",
    explicitCryptoReportRequest = false,
    duplicateMayMissionRequest = false,
    followUpContinuationCue = false,
    duplicateMayBeCryptoReport = false,
    shouldSkipDuplicateInbound,
    handleDuplicateCryptoReportRequest,
    appendRawStream,
    rerenderDuplicateReport,
    emitSingleChunkAssistantStream,
  } = input;

  if (typeof shouldSkipDuplicateInbound !== "function") return null;
  if (typeof handleDuplicateCryptoReportRequest !== "function") return null;
  if (typeof appendRawStream !== "function") return null;
  if (typeof emitSingleChunkAssistantStream !== "function") return null;

  const skipDuplicateInbound = !explicitCryptoReportRequest
    && !duplicateMayMissionRequest
    && !followUpContinuationCue
    && shouldSkipDuplicateInbound({
      text,
      source,
      sender,
      userContextId,
      sessionKey,
      inboundMessageId,
    });

  if (!skipDuplicateInbound) return null;

  const duplicateRecovery = await handleDuplicateCryptoReportRequest({
    duplicateMayBeCryptoReport,
    userContextId,
    conversationId,
    source,
    sessionKey,
    text,
    appendRawStream,
    rerenderReport: async () => (typeof rerenderDuplicateReport === "function"
      ? await rerenderDuplicateReport()
      : null),
  });
  if (duplicateRecovery) return duplicateRecovery;

  const duplicateReply =
    "I got that same request again and skipped the duplicate. Say 'run it again' if you want me to execute it again.";
  emitSingleChunkAssistantStream(duplicateReply, source, conversationId, userContextId);
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

