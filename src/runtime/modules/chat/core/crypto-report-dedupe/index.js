import {
  readPersistentFollowUpState,
  upsertPersistentFollowUpState,
} from "../../../services/follow-up-state/index.js";

const CRYPTO_REPORT_REPLAY_TTL_MS = Number.parseInt(
  process.env.NOVA_CRYPTO_REPORT_REPLAY_TTL_MS || "600000",
  10,
);

const CRYPTO_REPORT_REPLAY_DOMAIN_ID = "crypto_report_replay";

export function readRecentCryptoReport(userContextId, conversationId) {
  const record = readPersistentFollowUpState({
    userContextId,
    conversationId,
    domainId: CRYPTO_REPORT_REPLAY_DOMAIN_ID,
  });
  const reply = String(record?.slots?.reply || "").trim();
  return reply || "";
}

export function cacheRecentCryptoReport(userContextId, conversationId, reply) {
  const value = String(reply || "").trim();
  if (!value) return;
  upsertPersistentFollowUpState({
    userContextId,
    conversationId,
    domainId: CRYPTO_REPORT_REPLAY_DOMAIN_ID,
    topicAffinityId: CRYPTO_REPORT_REPLAY_DOMAIN_ID,
    slots: {
      reply: value,
    },
    ttlMs: CRYPTO_REPORT_REPLAY_TTL_MS,
  });
}

function buildCryptoReplaySummary(route, reply, toolCalls = []) {
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
    return buildCryptoReplaySummary("duplicate_report_replayed", cachedReportReply, []);
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
    return buildCryptoReplaySummary(
      "duplicate_report_rerendered",
      rerenderedReply,
      rerenderedToolCall ? [rerenderedToolCall] : [],
    );
  }

  return buildCryptoReplaySummary(
    "duplicate_report_fallback",
    "I could not replay your last crypto report yet. Retrying now usually resolves this.",
    [],
  );
}
