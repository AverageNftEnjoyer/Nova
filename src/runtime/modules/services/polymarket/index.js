import { createPolymarketProviderAdapter } from "./provider-adapter/index.js";

const TOPIC_QUERY_SUFFIX = Object.freeze({
  polymarket_politics: "politics election odds",
  polymarket_crypto: "crypto market odds",
  polymarket_sports: "sports market odds",
  polymarket_resolution: "resolution criteria settlement",
  polymarket_general: "market odds",
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
    route: "polymarket",
    responseRoute: "polymarket",
    action: "scan",
    code: String(input.code || "polymarket.execution_failed"),
    message: String(input.message || "Polymarket execution failed."),
    reply: String(input.reply || input.message || "Polymarket execution failed."),
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

function stripLanePreamble(text = "") {
  return compactWhitespace(
    String(text || "")
      .replace(/\b(polymarket|prediction markets?|prediction market|event contracts?|yes\/no markets?)\b/gi, " ")
      .replace(/^(show|scan|refresh|update|check|find|get|pull|give me|what(?:'s| is)|latest|current)\b[:\s-]*/i, " ")
      .replace(/\b(odds|lines)\b/gi, " ")
      .replace(/\s+/g, " "),
  );
}

function isTooGeneric(query = "") {
  const normalized = normalizeText(query).toLowerCase();
  return normalized.length < 4 || /^(refresh|update|scan|again|latest|current)$/i.test(normalized);
}

function buildQuery(text = "", requestHints = {}) {
  const explicitQuery = compactWhitespace(
    requestHints?.polymarket?.query
    || requestHints?.polymarketQuery
    || "",
  );
  const contextSummary = compactWhitespace(requestHints?.polymarketShortTermContextSummary || "");
  const topicAffinityId = normalizeText(requestHints?.polymarketTopicAffinityId || "polymarket_general");
  const topicSuffix = TOPIC_QUERY_SUFFIX[topicAffinityId] || TOPIC_QUERY_SUFFIX.polymarket_general;
  const strippedText = stripLanePreamble(text);
  const baseQuery = explicitQuery || (!isTooGeneric(strippedText) ? strippedText : contextSummary || strippedText);
  const queryBody = compactWhitespace([baseQuery, topicSuffix].filter(Boolean).join(" "));
  if (!queryBody) return "site:polymarket.com market odds";
  if (/\bsite:polymarket\.com\b/i.test(queryBody)) return queryBody;
  return `site:polymarket.com ${queryBody}`;
}

function formatReply(query = "", results = []) {
  const topResults = Array.isArray(results) ? results.slice(0, 3) : [];
  if (topResults.length === 0) {
    return `I couldn't find live Polymarket results for "${query}". Name the market more specifically and retry.`;
  }
  const lines = [`Polymarket scan for "${query}":`];
  for (const entry of topResults) {
    const title = normalizeText(entry?.title || "Untitled market");
    const snippet = compactWhitespace(entry?.snippet || "");
    const url = normalizeText(entry?.url || "");
    lines.push(`- ${title}`);
    if (snippet) lines.push(`  ${snippet}`);
    if (url) lines.push(`  ${url}`);
  }
  lines.push("If you want a tighter scan, send the exact market or resolution criteria.");
  return lines.join("\n");
}

export async function runPolymarketDomainService(input = {}, deps = {}) {
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
      code: "polymarket.context_missing",
      message: "Polymarket worker requires userContextId, conversationId, and sessionKey.",
      userContextId,
      conversationId,
      sessionKey,
      query,
      latencyMs: Date.now() - startedAt,
    });
  }

  const adapter = deps.providerAdapter && typeof deps.providerAdapter === "object"
    ? deps.providerAdapter
    : createPolymarketProviderAdapter({
      runtimeTools: input.runtimeTools,
      availableTools: input.availableTools,
    });

  const searchResult = await adapter.searchMarkets({
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
      code: String(searchResult?.code || "polymarket.search_failed"),
      message: String(searchResult?.message || "Polymarket search failed."),
      reply: String(searchResult?.message || "I couldn't scan Polymarket right now. Retry in a moment."),
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
    route: "polymarket",
    responseRoute: "polymarket",
    action: "scan",
    code: "polymarket.scan_ok",
    message: "Polymarket scan completed.",
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
