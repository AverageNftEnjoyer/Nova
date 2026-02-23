const CRYPTO_REPORT_REPLAY_TTL_MS = Number.parseInt(
  process.env.NOVA_CRYPTO_REPORT_REPLAY_TTL_MS || "600000",
  10,
);

const recentCryptoReportByConversation = new Map();

function buildScopedConversationKey(userContextId, conversationId) {
  const user = String(userContextId || "").trim().toLowerCase();
  const convo = String(conversationId || "").trim().toLowerCase() || "_default";
  return `${user}::${convo}`;
}

function pruneRecentCryptoReportCache(nowMs = Date.now()) {
  for (const [key, entry] of recentCryptoReportByConversation.entries()) {
    if (!entry || nowMs - Number(entry.ts || 0) > CRYPTO_REPORT_REPLAY_TTL_MS) {
      recentCryptoReportByConversation.delete(key);
    }
  }
}

export function readRecentCryptoReport(userContextId, conversationId) {
  const key = buildScopedConversationKey(userContextId, conversationId);
  if (!key) return "";
  pruneRecentCryptoReportCache();
  const entry = recentCryptoReportByConversation.get(key);
  const reply = String(entry?.reply || "").trim();
  return reply || "";
}

export function cacheRecentCryptoReport(userContextId, conversationId, reply) {
  const value = String(reply || "").trim();
  if (!value) return;
  const key = buildScopedConversationKey(userContextId, conversationId);
  if (!key) return;
  pruneRecentCryptoReportCache();
  recentCryptoReportByConversation.set(key, {
    ts: Date.now(),
    reply: value,
  });
}

function buildFastPathSummary(route, reply, toolCalls = []) {
  return {
    route,
    ok: true,
    reply: String(reply || ""),
    error: "",
    provider: "",
    model: "",
    toolCalls,
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

export async function handleDuplicateCryptoReportRequest({
  duplicateMayBeCryptoReport,
  userContextId,
  conversationId,
  source,
  sessionKey,
  text,
  appendRawStream,
  rerenderReport,
}) {
  if (!duplicateMayBeCryptoReport) return null;

  const cachedReportReply = readRecentCryptoReport(userContextId, conversationId);
  if (cachedReportReply) {
    appendRawStream({
      event: "request_duplicate_report_replayed",
      source,
      sessionKey,
      userContextId: userContextId || undefined,
      chars: String(text || "").length,
    });
    return buildFastPathSummary("duplicate_report_replayed", cachedReportReply, []);
  }

  let rerenderedReply = "";
  let rerenderedToolCall = "";
  try {
    const rerendered = await rerenderReport();
    rerenderedReply = String(rerendered?.reply || "").trim();
    rerenderedToolCall = String(rerendered?.toolCall || "").trim();
  } catch {
    rerenderedReply = "";
  }

  if (rerenderedReply) {
    if (rerenderedToolCall === "coinbase_portfolio_report") {
      cacheRecentCryptoReport(userContextId, conversationId, rerenderedReply);
    }
    appendRawStream({
      event: "request_duplicate_report_rerendered",
      source,
      sessionKey,
      userContextId: userContextId || undefined,
      chars: String(text || "").length,
    });
    return buildFastPathSummary(
      "duplicate_report_rerendered",
      rerenderedReply,
      rerenderedToolCall ? [rerenderedToolCall] : [],
    );
  }

  return buildFastPathSummary(
    "duplicate_report_fallback",
    "I could not replay your last crypto report yet. Retrying now usually resolves this.",
    [],
  );
}

