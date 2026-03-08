const POLYMARKET_GAMMA_API_URL = "https://gamma-api.polymarket.com";
const REQUEST_TIMEOUT_MS = 8000;

const TOPIC_QUERY_SUFFIX = Object.freeze({
  polymarket_politics: "politics election odds",
  polymarket_crypto: "crypto market odds",
  polymarket_sports: "sports market odds",
  polymarket_resolution: "resolution criteria settlement",
  polymarket_general: "",
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
      providerId: "polymarket-gamma",
      adapterId: "direct-api",
    },
    query: String(input.query || ""),
    results: [],
    telemetry: {
      latencyMs: Number(input.latencyMs || 0),
      attemptCount: 1,
      resultCount: 0,
      provider: "polymarket-gamma",
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
      .replace(/\b(odds|lines|markets?)\b/gi, " ")
      .replace(/\s+/g, " "),
  );
}

function isTooGeneric(query = "") {
  const normalized = normalizeText(query).toLowerCase();
  return normalized.length < 3 || /^(refresh|update|scan|again|latest|current|more)$/i.test(normalized);
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
  return compactWhitespace([baseQuery, topicSuffix].filter(Boolean).join(" "));
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Polymarket upstream ${response.status}`);
    }
    return await response.json().catch(() => ({}));
  } finally {
    clearTimeout(timer);
  }
}

function parseStringArray(value) {
  if (Array.isArray(value)) return value.map((entry) => normalizeText(entry)).filter(Boolean);
  const raw = normalizeText(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((entry) => normalizeText(entry)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeMarketResult(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const title = normalizeText(source.question || source.title || source.slug);
  const slug = normalizeText(source.slug);
  if (!title || !slug) return null;
  const outcomes = parseStringArray(source.outcomes);
  const prices = parseStringArray(source.outcomePrices);
  const outcomeSummary = outcomes.slice(0, 2).map((label, index) => {
    const price = Number.parseFloat(String(prices[index] || "0"));
    if (!Number.isFinite(price) || price <= 0) return label;
    return `${label} ${Math.round(price * 100)}c`;
  }).join(" | ");
  const snippetParts = [
    outcomeSummary,
    Number.isFinite(Number(source.volume24hr)) ? `24h $${Math.round(Number(source.volume24hr)).toLocaleString("en-US")}` : "",
    source.acceptingOrders === true ? "accepting orders" : "",
  ].filter(Boolean);
  return {
    id: normalizeText(source.id),
    slug,
    title,
    snippet: snippetParts.join(" • "),
    url: `https://polymarket.com/event/${encodeURIComponent(slug)}`,
    volume24hr: Number.isFinite(Number(source.volume24hr)) ? Number(source.volume24hr) : 0,
    acceptingOrders: source.acceptingOrders === true,
  };
}

async function fetchMarketsForQuery(query = "", deps = {}) {
  const adapter = deps?.providerAdapter && typeof deps.providerAdapter.searchMarkets === "function"
    ? deps.providerAdapter
    : null;
  if (adapter) {
    const scopedQuery = query ? `site:polymarket.com ${query}` : "site:polymarket.com market odds";
    const response = await adapter.searchMarkets({ query: scopedQuery });
    const rows = Array.isArray(response?.results) ? response.results : [];
    return rows.map((entry) => {
      const source = entry && typeof entry === "object" ? entry : {};
      return {
        id: normalizeText(source.id),
        slug: normalizeText(source.slug),
        title: normalizeText(source.title),
        snippet: normalizeText(source.snippet),
        url: normalizeText(source.url),
        volume24hr: Number.isFinite(Number(source.volume24hr)) ? Number(source.volume24hr) : 0,
        acceptingOrders: source.acceptingOrders === true,
      };
    }).filter((entry) => entry.title || entry.url).slice(0, 6);
  }

  if (query) {
    const url = new URL(`${POLYMARKET_GAMMA_API_URL}/public-search`);
    url.searchParams.set("q", query);
    const payload = await fetchJson(url.toString());
    const rows = Array.isArray(payload?.markets) ? payload.markets : [];
    return rows.map((entry) => normalizeMarketResult(entry)).filter(Boolean).slice(0, 6);
  }

  const url = new URL(`${POLYMARKET_GAMMA_API_URL}/markets`);
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", "6");
  const payload = await fetchJson(url.toString());
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((entry) => normalizeMarketResult(entry)).filter(Boolean).slice(0, 6);
}

function formatReply(query = "", results = []) {
  const topResults = Array.isArray(results) ? results.slice(0, 4) : [];
  if (topResults.length === 0) {
    return `I couldn't find live Polymarket markets for "${query || "that prompt"}". Name the market more specifically and retry.`;
  }
  const lines = [query ? `Polymarket markets for "${query}":` : "Live Polymarket markets:"];
  for (const entry of topResults) {
    lines.push(`- ${normalizeText(entry.title || "Untitled market")}`);
    if (entry.snippet) lines.push(`  ${normalizeText(entry.snippet)}`);
    if (entry.url) lines.push(`  ${normalizeText(entry.url)}`);
  }
  lines.push("For live trading, use Nova's Polymarket workspace with a connected Phantom EVM wallet.");
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

  try {
    const results = await fetchMarketsForQuery(query, deps);
    const latencyMs = Date.now() - startedAt;
    return {
      ok: true,
      route: "polymarket",
      responseRoute: "polymarket",
      action: "scan",
      code: "polymarket.scan_ok",
      message: "Polymarket scan completed.",
      reply: formatReply(query, results),
      provider: {
        providerId: "polymarket-gamma",
        adapterId: "direct-api",
      },
      query,
      results,
      telemetry: {
        latencyMs,
        attemptCount: 1,
        resultCount: results.length,
        provider: "polymarket-gamma",
        userContextId,
        conversationId,
        sessionKey,
      },
    };
  } catch (error) {
    return buildErrorResult({
      code: "polymarket.fetch_failed",
      message: error instanceof Error ? error.message : "Polymarket fetch failed.",
      reply: "I couldn't reach Polymarket right now. Retry in a moment.",
      userContextId,
      conversationId,
      sessionKey,
      query,
      latencyMs: Date.now() - startedAt,
    });
  }
}
