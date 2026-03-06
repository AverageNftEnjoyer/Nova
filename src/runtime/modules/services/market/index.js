import { createMarketProviderAdapter } from "./provider-adapter/index.js";

const TOPIC_QUERY_SUFFIX = Object.freeze({
  market_equities: "stock market index update",
  market_general: "market update",
  market_weather: "weather forecast",
});

function normalizeText(value = "") {
  return String(value || "").trim();
}

function compactWhitespace(value = "") {
  return normalizeText(value).replace(/\s+/g, " ");
}

function buildErrorResult(input = {}) {
  return {
    ok: false,
    route: "market",
    responseRoute: "market",
    action: "scan",
    code: String(input.code || "market.execution_failed"),
    message: String(input.message || "Market execution failed."),
    reply: String(input.reply || input.message || "Market execution failed."),
    provider: {
      providerId: String(input.providerId || ""),
      adapterId: String(input.adapterId || ""),
    },
    query: String(input.query || ""),
    results: [],
    telemetry: {
      latencyMs: Number(input.latencyMs || 0),
      attemptCount: Number(input.attemptCount || 0),
      resultCount: 0,
      provider: String(input.providerId || ""),
      userContextId: String(input.userContextId || ""),
      conversationId: String(input.conversationId || ""),
      sessionKey: String(input.sessionKey || ""),
    },
  };
}

function stripMarketPreamble(text = "") {
  return compactWhitespace(
    String(text || "")
      .replace(/^(show|scan|refresh|update|check|find|get|pull|give me|what(?:'s| is)|latest|current)\b[:\s-]*/i, " ")
      .replace(/\s+/g, " "),
  );
}

function isTooGeneric(query = "") {
  const normalized = normalizeText(query).toLowerCase();
  return normalized.length < 4 || /^(refresh|update|scan|again|latest|current|market)$/i.test(normalized);
}

function buildQuery(text = "", requestHints = {}) {
  const explicitQuery = compactWhitespace(
    requestHints?.market?.query
    || requestHints?.marketQuery
    || "",
  );
  const contextSummary = compactWhitespace(requestHints?.marketShortTermContextSummary || "");
  const topicAffinityId = normalizeText(requestHints?.marketTopicAffinityId || "market_general");
  const topicSuffix = TOPIC_QUERY_SUFFIX[topicAffinityId] || TOPIC_QUERY_SUFFIX.market_general;
  const strippedText = stripMarketPreamble(text);
  const baseQuery = explicitQuery || (!isTooGeneric(strippedText) ? strippedText : contextSummary || strippedText);
  return compactWhitespace([baseQuery, topicSuffix].filter(Boolean).join(" ")) || "stock market update";
}

function formatReply(query = "", results = []) {
  const topResults = Array.isArray(results) ? results.slice(0, 3) : [];
  if (topResults.length === 0) {
    return `I couldn't find live market results for "${query}". Name the index, stock set, or market topic more specifically and retry.`;
  }
  const lines = [`Market scan for "${query}":`];
  for (const entry of topResults) {
    const title = normalizeText(entry?.title || "Untitled result");
    const snippet = compactWhitespace(entry?.snippet || "");
    const url = normalizeText(entry?.url || "");
    lines.push(`- ${title}`);
    if (snippet) lines.push(`  ${snippet}`);
    if (url) lines.push(`  ${url}`);
  }
  lines.push("If you want a tighter scan, send the exact index, ticker set, or market segment.");
  return lines.join("\n");
}

export async function runMarketDomainService(input = {}, deps = {}) {
  const startedAt = Date.now();
  const text = normalizeText(input.text);
  const requestHints = input.requestHints && typeof input.requestHints === "object"
    ? input.requestHints
    : {};
  const userContextId = normalizeText(input.userContextId);
  const conversationId = normalizeText(input.conversationId);
  const sessionKey = normalizeText(input.sessionKey);
  const query = buildQuery(text, requestHints);

  if (!userContextId || !conversationId || !sessionKey) {
    return buildErrorResult({
      code: "market.context_missing",
      message: "Market worker requires userContextId, conversationId, and sessionKey.",
      userContextId,
      conversationId,
      sessionKey,
      query,
      latencyMs: Date.now() - startedAt,
    });
  }

  const adapter = deps.providerAdapter && typeof deps.providerAdapter === "object"
    ? deps.providerAdapter
    : createMarketProviderAdapter({
      runtimeTools: input.runtimeTools,
      availableTools: input.availableTools,
    });

  const searchResult = await adapter.searchMarket({
    query,
    runtimeTools: input.runtimeTools,
    availableTools: input.availableTools,
    userContextId,
    conversationId,
    sessionKey,
  });

  const latencyMs = Date.now() - startedAt;
  if (searchResult?.ok !== true) {
    return buildErrorResult({
      code: String(searchResult?.code || "market.search_failed"),
      message: String(searchResult?.message || "Market search failed."),
      reply: String(searchResult?.message || "I couldn't scan market conditions right now. Retry in a moment."),
      providerId: String(searchResult?.providerId || ""),
      adapterId: String(searchResult?.adapterId || ""),
      userContextId,
      conversationId,
      sessionKey,
      query,
      attemptCount: Number(searchResult?.attempts || 0),
      latencyMs,
    });
  }

  const results = Array.isArray(searchResult?.results) ? searchResult.results : [];
  return {
    ok: true,
    route: "market",
    responseRoute: "market",
    action: "scan",
    code: "market.scan_ok",
    message: "Market scan completed.",
    reply: formatReply(query, results),
    provider: {
      providerId: String(searchResult?.providerId || ""),
      adapterId: String(searchResult?.adapterId || ""),
    },
    query,
    results,
    telemetry: {
      latencyMs,
      attemptCount: Number(searchResult?.attempts || 0),
      resultCount: results.length,
      provider: String(searchResult?.providerId || ""),
      userContextId,
      conversationId,
      sessionKey,
    },
  };
}
