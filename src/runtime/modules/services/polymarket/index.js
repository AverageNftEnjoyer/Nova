import { runMissionsDomainService } from "../missions/index.js";

const POLYMARKET_GAMMA_API_URL = "https://gamma-api.polymarket.com";
const POLYMARKET_CLOB_API_URL = "https://clob.polymarket.com";
const POLYMARKET_DATA_API_URL = "https://data-api.polymarket.com";
const REQUEST_TIMEOUT_MS = 8000;

const TOPIC_QUERY_SUFFIX = Object.freeze({
  polymarket_politics: "politics election odds",
  polymarket_crypto: "crypto market odds",
  polymarket_sports: "sports market odds",
  polymarket_resolution: "resolution criteria settlement",
  polymarket_general: "",
});

const ACTION = Object.freeze({
  SCAN: "scan",
  TRENDING: "trending",
  PRICE: "price",
  ORDERBOOK: "orderbook",
  LEADERBOARD: "leaderboard",
  COMPARE: "compare",
  ALERT_CREATE: "alert_create",
});

function normalizeText(value = "") {
  return String(value || "").trim();
}

function compactWhitespace(value = "") {
  return normalizeText(value).replace(/\s+/g, " ");
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp01(value) {
  const n = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  const raw = normalizeText(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toUsd(value) {
  const numeric = toFiniteNumber(value, 0);
  if (numeric <= 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: numeric >= 100 ? 0 : 2,
  }).format(numeric);
}

function toPercent(value, digits = 1) {
  return `${(clamp01(value) * 100).toFixed(digits)}%`;
}

function buildMarketUrl(slug = "") {
  const normalized = normalizeText(slug);
  return normalized ? `https://polymarket.com/event/${encodeURIComponent(normalized)}` : "https://polymarket.com";
}

function extractSlugFromUrl(value = "") {
  const raw = normalizeText(value);
  const match = raw.match(/polymarket\.com\/event\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function normalizeOutcomeRows(source = {}) {
  const rawOutcomes = parseJsonArray(source.outcomes);
  const objectRows = rawOutcomes
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry;
      const label = normalizeText(row.label || row.name || row.title || row.outcome);
      const tokenId = normalizeText(row.tokenId || row.token_id || row.asset_id);
      const price = toFiniteNumber(row.price || row.mid || row.lastTradePrice, Number.NaN);
      if (!label && !tokenId) return null;
      return {
        index,
        label: label || `Outcome ${index + 1}`,
        tokenId,
        price: Number.isFinite(price) ? clamp01(price) : 0,
      };
    })
    .filter(Boolean);

  if (objectRows.length > 0) return objectRows;

  const labels = parseJsonArray(source.outcomes).map((entry) => normalizeText(entry)).filter(Boolean);
  const prices = parseJsonArray(source.outcomePrices).map((entry) => toFiniteNumber(entry, Number.NaN));
  const tokenIds = parseJsonArray(source.clobTokenIds).map((entry) => normalizeText(entry));
  return labels.map((label, index) => ({
    index,
    label,
    tokenId: tokenIds[index] || "",
    price: Number.isFinite(prices[index]) ? clamp01(prices[index]) : 0,
  }));
}

function normalizeMarket(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const slug = normalizeText(source.slug) || extractSlugFromUrl(source.url);
  const title = normalizeText(source.question || source.title || slug);
  if (!title && !slug) return null;
  const outcomes = normalizeOutcomeRows(source);
  return {
    id: normalizeText(source.id),
    slug,
    title,
    question: title,
    url: normalizeText(source.url) || buildMarketUrl(slug),
    volume24hr: toFiniteNumber(source.volume24hr || source.volume24hrClob, 0),
    acceptingOrders: source.acceptingOrders === true || source.accepting_orders === true,
    outcomes,
  };
}

function pickPrimaryOutcome(market) {
  if (!market || !Array.isArray(market.outcomes) || market.outcomes.length === 0) return null;
  return market.outcomes.find((entry) => /\byes\b/i.test(String(entry.label || "")))
    || market.outcomes.find((entry) => normalizeText(entry.tokenId))
    || market.outcomes[0];
}

function pickCompanionOutcome(market, primary) {
  if (!market || !Array.isArray(market.outcomes) || market.outcomes.length < 2) return null;
  return market.outcomes.find((entry) => entry !== primary) || null;
}

function buildErrorResult(input = {}) {
  return {
    ok: false,
    route: "polymarket",
    responseRoute: "polymarket",
    action: String(input.action || ACTION.SCAN),
    code: String(input.code || "polymarket.execution_failed"),
    message: String(input.message || "Polymarket execution failed."),
    reply: String(input.reply || input.message || "Polymarket execution failed."),
    provider: {
      providerId: String(input.providerId || "polymarket-gamma"),
      adapterId: String(input.adapterId || "direct-api"),
    },
    query: String(input.query || ""),
    results: Array.isArray(input.results) ? input.results : [],
    toolCalls: Array.isArray(input.toolCalls) ? input.toolCalls : [],
    telemetry: {
      latencyMs: Number(input.latencyMs || 0),
      attemptCount: Number(input.attemptCount || 1),
      resultCount: Array.isArray(input.results) ? input.results.length : 0,
      provider: String(input.providerId || "polymarket-gamma"),
      userContextId: String(input.userContextId || ""),
      conversationId: String(input.conversationId || ""),
      sessionKey: String(input.sessionKey || ""),
    },
    ...(input.data && typeof input.data === "object" ? { data: input.data } : {}),
  };
}

function buildSuccessResult(input = {}) {
  const results = Array.isArray(input.results) ? input.results : [];
  return {
    ok: true,
    route: "polymarket",
    responseRoute: "polymarket",
    action: String(input.action || ACTION.SCAN),
    code: String(input.code || `polymarket.${String(input.action || ACTION.SCAN)}_ok`),
    message: String(input.message || "Polymarket action completed."),
    reply: String(input.reply || "Polymarket action completed."),
    provider: {
      providerId: String(input.providerId || "polymarket-gamma"),
      adapterId: String(input.adapterId || "direct-api"),
    },
    query: String(input.query || ""),
    results,
    toolCalls: Array.isArray(input.toolCalls) ? input.toolCalls : [],
    telemetry: {
      latencyMs: Number(input.latencyMs || 0),
      attemptCount: Number(input.attemptCount || 1),
      resultCount: results.length,
      provider: String(input.providerId || "polymarket-gamma"),
      userContextId: String(input.userContextId || ""),
      conversationId: String(input.conversationId || ""),
      sessionKey: String(input.sessionKey || ""),
    },
    ...(input.data && typeof input.data === "object" ? { data: input.data } : {}),
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
  return normalized.length < 3 || /^(refresh|update|scan|again|latest|current|more|that|it)$/i.test(normalized);
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

function buildFocusedQuery(text = "", requestHints = {}) {
  const explicitQuery = compactWhitespace(requestHints?.polymarket?.query || requestHints?.polymarketQuery || "");
  const contextSummary = compactWhitespace(requestHints?.polymarketShortTermContextSummary || "");
  const stripped = compactWhitespace(
    stripLanePreamble(text)
      .replace(/\b(price|odds|probability|trading at|orderbook|order book|depth|spread|leaderboard|top traders?|compare|versus|vs)\b/gi, " "),
  );
  const candidate = explicitQuery || (!isTooGeneric(stripped) ? stripped : "");
  return compactWhitespace(candidate || contextSummary || stripped);
}

function detectAction(text = "", requestHints = {}) {
  const explicit = normalizeText(requestHints?.polymarket?.action || requestHints?.polymarketAction).toLowerCase();
  if (explicit === "scan") return ACTION.SCAN;
  if (explicit === "trending") return ACTION.TRENDING;
  if (explicit === "price") return ACTION.PRICE;
  if (explicit === "orderbook") return ACTION.ORDERBOOK;
  if (explicit === "leaderboard") return ACTION.LEADERBOARD;
  if (explicit === "compare") return ACTION.COMPARE;
  if (explicit === "alert" || explicit === "alert_create") return ACTION.ALERT_CREATE;

  const n = normalizeText(text).toLowerCase();
  if (!n) return ACTION.SCAN;
  if (/(alert|notify me|notification|ping me|let me know|watch for|watch when|set up an? alert|create an? alert)/.test(n)
    && /(above|over|below|under|greater than|less than|at least|at most|>=|<=|>|<)\s*\d/.test(n)) {
    return ACTION.ALERT_CREATE;
  }
  if (/\b(compare|versus|\bvs\.?\b)\b/.test(n)) return ACTION.COMPARE;
  if (/\b(orderbook|order book|depth|bid\/ask|spread)\b/.test(n)) return ACTION.ORDERBOOK;
  if (/\b(leaderboard|top traders?|pnl leaders?|best traders?)\b/.test(n)) return ACTION.LEADERBOARD;
  if (/\b(trending|top markets?|popular markets?|hot markets?|most active)\b/.test(n)) return ACTION.TRENDING;
  if (/\b(price of|odds on|trading at|current odds|current price|current probability|what(?:'s| is).*(price|odds|probability|trading at))\b/.test(n)) {
    return ACTION.PRICE;
  }
  return ACTION.SCAN;
}

function parseCompareQueries(text = "") {
  const cleaned = compactWhitespace(
    String(text || "")
      .replace(/\b(compare|comparison|polymarket|odds|markets?)\b/gi, " "),
  );
  if (!cleaned) return [];
  const vsSplit = cleaned.split(/\s+(?:vs\.?|versus)\s+/i).map((part) => compactWhitespace(part));
  if (vsSplit.length >= 2) return [vsSplit[0], vsSplit.slice(1).join(" ")].filter(Boolean).slice(0, 2);
  const andMatch = cleaned.match(/^(.+?)\s+and\s+(.+)$/i);
  if (andMatch) return [compactWhitespace(andMatch[1]), compactWhitespace(andMatch[2])].filter(Boolean).slice(0, 2);
  return [];
}

function parseAlertThreshold(text = "") {
  const n = normalizeText(text).toLowerCase();
  const above = n.match(/(?:above|over|greater than|at least|>=|>)\s*(\d{1,3}(?:\.\d+)?)\s*%?/i);
  if (above) {
    const raw = Number.parseFloat(above[1]);
    if (Number.isFinite(raw)) return { direction: "above", threshold: clamp01(raw > 1 ? raw / 100 : raw) };
  }
  const below = n.match(/(?:below|under|less than|at most|<=|<)\s*(\d{1,3}(?:\.\d+)?)\s*%?/i);
  if (below) {
    const raw = Number.parseFloat(below[1]);
    if (Number.isFinite(raw)) return { direction: "below", threshold: clamp01(raw > 1 ? raw / 100 : raw) };
  }
  return null;
}

function parseLeaderboardWindow(text = "", requestHints = {}) {
  const explicit = normalizeText(requestHints?.polymarket?.window || requestHints?.polymarketWindow).toLowerCase();
  if (explicit === "day" || explicit === "daily" || explicit === "1d") return "day";
  if (explicit === "week" || explicit === "weekly" || explicit === "7d") return "week";
  if (explicit === "month" || explicit === "monthly" || explicit === "30d") return "month";
  if (explicit === "all" || explicit === "all-time" || explicit === "alltime") return "all";

  const n = normalizeText(text).toLowerCase();
  if (/\b(today|24h|daily|day)\b/.test(n)) return "day";
  if (/\b(week|weekly|7d)\b/.test(n)) return "week";
  if (/\b(month|monthly|30d)\b/.test(n)) return "month";
  return "all";
}

function parseLeaderboardLimit(text = "", requestHints = {}) {
  const explicit = Number.parseInt(String(requestHints?.polymarket?.limit || requestHints?.polymarketLimit || ""), 10);
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(10, Math.max(3, explicit));
  const inline = normalizeText(text).match(/\btop\s+(\d{1,2})\b/i);
  if (inline) {
    const parsed = Number.parseInt(inline[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(10, Math.max(3, parsed));
  }
  return 5;
}

function detectDeliveryChannel(text = "") {
  const n = normalizeText(text).toLowerCase();
  if (/\bslack\b/.test(n)) return "slack";
  if (/\bdiscord\b/.test(n)) return "discord";
  if (/\btelegram\b/.test(n)) return "telegram";
  if (/\bemail\b/.test(n)) return "email";
  if (/\bwebhook\b/.test(n)) return "webhook";
  return "";
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
    if (!response.ok) throw new Error(`Polymarket upstream ${response.status}`);
    return await response.json().catch(() => ({}));
  } finally {
    clearTimeout(timer);
  }
}

function normalizeSearchPayload(payload) {
  if (Array.isArray(payload)) return payload;
  const source = payload && typeof payload === "object" ? payload : {};
  if (Array.isArray(source.markets)) return source.markets;
  if (Array.isArray(source.data)) return source.data;
  return [];
}

function dedupeMarkets(markets = [], limit = 6) {
  const map = new Map();
  for (const market of markets) {
    const key = normalizeText(market?.slug || market?.title || market?.id || "");
    if (!key) continue;
    if (!map.has(key)) map.set(key, market);
    if (map.size >= limit) break;
  }
  return [...map.values()].slice(0, limit);
}

async function fetchStructuredMarkets(query = "", limit = 6) {
  const safeLimit = Math.max(1, Math.min(12, Number.parseInt(String(limit || "6"), 10) || 6));

  if (query) {
    const urls = [];
    const qUrl = new URL(`${POLYMARKET_GAMMA_API_URL}/public-search`);
    qUrl.searchParams.set("q", query);
    qUrl.searchParams.set("limit", String(Math.max(6, safeLimit)));
    urls.push(qUrl.toString());

    const queryUrl = new URL(`${POLYMARKET_GAMMA_API_URL}/public-search`);
    queryUrl.searchParams.set("query", query);
    queryUrl.searchParams.set("limit", String(Math.max(6, safeLimit)));
    urls.push(queryUrl.toString());

    for (const url of urls) {
      try {
        const payload = await fetchJson(url);
        const markets = normalizeSearchPayload(payload)
          .map((entry) => normalizeMarket(entry))
          .filter(Boolean);
        if (markets.length > 0) return dedupeMarkets(markets, safeLimit);
      } catch {
        // Try next search variant.
      }
    }
  }

  const marketsUrl = new URL(`${POLYMARKET_GAMMA_API_URL}/markets`);
  marketsUrl.searchParams.set("active", "true");
  marketsUrl.searchParams.set("closed", "false");
  marketsUrl.searchParams.set("limit", String(Math.max(8, safeLimit)));
  const payload = await fetchJson(marketsUrl.toString());
  return dedupeMarkets(normalizeSearchPayload(payload).map((entry) => normalizeMarket(entry)).filter(Boolean), safeLimit);
}

async function fetchMarketsForScan(query = "", deps = {}) {
  const adapter = deps?.providerAdapter && typeof deps.providerAdapter === "object"
    ? deps.providerAdapter
    : null;

  if (adapter && typeof adapter.searchMarkets === "function") {
    const scopedQuery = query ? `site:polymarket.com ${query}` : "site:polymarket.com market odds";
    const response = await adapter.searchMarkets({ query: scopedQuery });
    const rows = Array.isArray(response?.results) ? response.results : [];
    return {
      providerId: normalizeText(response?.providerId || "polymarket-gamma") || "polymarket-gamma",
      adapterId: normalizeText(response?.adapterId || "web-search-tool-adapter") || "web-search-tool-adapter",
      attemptCount: Number(response?.attempts || 1) || 1,
      query: scopedQuery,
      results: rows.map((entry) => {
        const source = entry && typeof entry === "object" ? entry : {};
        const title = normalizeText(source.title || source.name || "");
        const url = normalizeText(source.url);
        return {
          id: normalizeText(source.id),
          slug: normalizeText(source.slug) || extractSlugFromUrl(url),
          title,
          question: title,
          snippet: normalizeText(source.snippet || source.description || ""),
          url,
          volume24hr: toFiniteNumber(source.volume24hr, 0),
          acceptingOrders: source.acceptingOrders === true,
          outcomes: [],
        };
      }).filter((entry) => entry.title || entry.url).slice(0, 6),
    };
  }

  const results = await fetchStructuredMarkets(query, 6);
  return {
    providerId: "polymarket-gamma",
    adapterId: "direct-api",
    attemptCount: 1,
    query,
    results,
  };
}

async function fetchTokenPrice(tokenId = "") {
  const normalizedTokenId = normalizeText(tokenId);
  if (!normalizedTokenId) return null;
  const payload = await fetchJson(`${POLYMARKET_CLOB_API_URL}/price?token_id=${encodeURIComponent(normalizedTokenId)}`);
  const source = payload && typeof payload === "object" ? payload : {};
  const price = toFiniteNumber(source.price || source.mid || source.midpoint || source.lastTradePrice || source.last_trade_price, Number.NaN);
  if (!Number.isFinite(price)) return null;
  return { tokenId: normalizedTokenId, price: clamp01(price) };
}

async function fetchOrderBook(tokenId = "") {
  const normalizedTokenId = normalizeText(tokenId);
  if (!normalizedTokenId) return null;
  const payload = await fetchJson(`${POLYMARKET_CLOB_API_URL}/book?token_id=${encodeURIComponent(normalizedTokenId)}`);
  const source = payload && typeof payload === "object" ? payload : {};
  const normalizeLevels = (rows = [], side = "bids") => (Array.isArray(rows) ? rows : [])
    .map((entry) => {
      if (Array.isArray(entry) && entry.length >= 2) {
        const price = toFiniteNumber(entry[0], Number.NaN);
        const size = toFiniteNumber(entry[1], 0);
        if (!Number.isFinite(price)) return null;
        return { price: clamp01(price), size: Math.max(0, size) };
      }
      const row = entry && typeof entry === "object" ? entry : {};
      const price = toFiniteNumber(row.price || row.p, Number.NaN);
      const size = toFiniteNumber(row.size || row.s, 0);
      if (!Number.isFinite(price)) return null;
      return { price: clamp01(price), size: Math.max(0, size) };
    })
    .filter(Boolean)
    .sort((a, b) => (side === "asks" ? a.price - b.price : b.price - a.price));

  const bids = normalizeLevels(source.bids, "bids");
  const asks = normalizeLevels(source.asks, "asks");
  const bestBid = bids[0]?.price || 0;
  const bestAsk = asks[0]?.price || 0;
  return {
    tokenId: normalizedTokenId,
    bids,
    asks,
    bestBid,
    bestAsk,
    spread: bestBid > 0 && bestAsk > 0 ? Math.max(0, bestAsk - bestBid) : 0,
  };
}

async function fetchLeaderboard(window = "all", limit = 5) {
  const safeWindow = ["day", "week", "month"].includes(window) ? window : "all";
  const safeLimit = Math.max(3, Math.min(10, Number.parseInt(String(limit || "5"), 10) || 5));
  const url = new URL(`${POLYMARKET_DATA_API_URL}/leaderboard`);
  url.searchParams.set("window", safeWindow);
  url.searchParams.set("limit", String(safeLimit));
  const payload = await fetchJson(url.toString());
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.leaderboard)
      ? payload.leaderboard
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
  return rows.slice(0, safeLimit).map((entry, index) => {
    const source = entry && typeof entry === "object" ? entry : {};
    return {
      rank: Number.parseInt(String(source.rank || index + 1), 10) || (index + 1),
      username: normalizeText(source.username || source.name || source.alias),
      walletAddress: normalizeText(source.walletAddress || source.wallet_address || source.address),
      pnl: toFiniteNumber(source.pnl || source.profit || source.totalPnl || source.total_profit, 0),
      volume: toFiniteNumber(source.volume || source.totalVolume || source.tradingVolume, 0),
    };
  });
}

function formatScanReply(query = "", results = []) {
  const top = Array.isArray(results) ? results.slice(0, 4) : [];
  if (top.length === 0) {
    return `I couldn't find live Polymarket markets for "${query || "that prompt"}". Name the market more specifically and retry.`;
  }
  const lines = [query ? `Polymarket markets for "${query}":` : "Live Polymarket markets:"];
  for (const entry of top) {
    lines.push(`- ${normalizeText(entry.title || "Untitled market")}`);
    if (entry.snippet) lines.push(`  ${normalizeText(entry.snippet)}`);
    if (entry.url) lines.push(`  ${normalizeText(entry.url)}`);
  }
  lines.push("For live trading, use Nova's Polymarket workspace with a connected Phantom EVM wallet.");
  return lines.join("\n");
}

function buildAlertMissionPrompt({ market, outcome, direction, threshold, deliveryChannel }) {
  const thresholdPct = (clamp01(threshold) * 100).toFixed(1).replace(/\.0$/, "");
  const outputHint = deliveryChannel
    ? `Use ${deliveryChannel}-output for delivery.`
    : "Use a connected output node for delivery.";
  return compactWhitespace([
    "Create and deploy a Nova mission for a Polymarket alert.",
    `Use polymarket-price-trigger with tokenId '${normalizeText(outcome?.tokenId)}', marketSlug '${normalizeText(market?.slug)}', direction '${direction}', threshold ${clamp01(threshold).toFixed(4)}.`,
    `Alert when '${normalizeText(market?.title || market?.question)}' crosses ${thresholdPct}% ${direction}.`,
    outputHint,
  ].join(" "));
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

  if (!userContextId || !conversationId || !sessionKey) {
    return buildErrorResult({
      code: "polymarket.context_missing",
      message: "Polymarket worker requires userContextId, conversationId, and sessionKey.",
      query: buildQuery(text, requestHints),
      userContextId,
      conversationId,
      sessionKey,
      latencyMs: Date.now() - startedAt,
    });
  }

  const action = detectAction(text, requestHints);

  try {
    if (action === ACTION.LEADERBOARD) {
      const window = parseLeaderboardWindow(text, requestHints);
      const limit = parseLeaderboardLimit(text, requestHints);
      const entries = await fetchLeaderboard(window, limit);
      const reply = entries.length === 0
        ? `Polymarket leaderboard (${window}) is currently unavailable.`
        : `Polymarket leaderboard (${window}):\n${entries.map((entry) => {
          const who = normalizeText(entry.username) || normalizeText(entry.walletAddress) || "unknown";
          return `- #${entry.rank} ${who}: PnL ${toUsd(entry.pnl)} | Volume ${toUsd(entry.volume)}`;
        }).join("\n")}`;
      return buildSuccessResult({
        action,
        code: "polymarket.leaderboard_ok",
        message: "Polymarket leaderboard loaded.",
        reply,
        providerId: "polymarket-data",
        query: `${window}:${limit}`,
        results: entries,
        userContextId,
        conversationId,
        sessionKey,
        latencyMs: Date.now() - startedAt,
      });
    }

    if (action === ACTION.TRENDING) {
      const markets = await fetchStructuredMarkets("", 6);
      return buildSuccessResult({
        action,
        code: "polymarket.trending_ok",
        message: "Polymarket trending scan completed.",
        reply: formatScanReply("trending markets", markets),
        query: "trending",
        results: markets,
        userContextId,
        conversationId,
        sessionKey,
        latencyMs: Date.now() - startedAt,
      });
    }

    if (action === ACTION.COMPARE) {
      const compareQueries = parseCompareQueries(text);
      if (compareQueries.length < 2) {
        return buildErrorResult({
          action,
          code: "polymarket.compare_query_missing",
          message: "Compare request needs two market prompts.",
          reply: "Tell me two markets to compare, for example: compare BTC above 120k vs ETH above 8k.",
          query: buildFocusedQuery(text, requestHints),
          userContextId,
          conversationId,
          sessionKey,
          latencyMs: Date.now() - startedAt,
        });
      }

      const comparisons = [];
      for (const queryPart of compareQueries.slice(0, 2)) {
        const market = (await fetchStructuredMarkets(queryPart, 1))[0] || null;
        if (!market) continue;
        const outcome = pickPrimaryOutcome(market);
        let price = toFiniteNumber(outcome?.price, Number.NaN);
        if (normalizeText(outcome?.tokenId)) {
          const live = await fetchTokenPrice(outcome.tokenId);
          if (live && Number.isFinite(live.price)) price = live.price;
        }
        if (!Number.isFinite(price)) continue;
        comparisons.push({ market, outcome, price: clamp01(price) });
      }

      const reply = comparisons.length === 0
        ? "I couldn't compare those markets right now. Name both markets more specifically and retry."
        : `Polymarket comparison:\n${comparisons.map((row) => {
          const title = normalizeText(row.market?.title || row.market?.question || "Unknown market");
          const label = normalizeText(row.outcome?.label || "primary outcome");
          return `- ${title}: ${toPercent(row.price, 1)} (${label})`;
        }).join("\n")}`;

      return buildSuccessResult({
        action,
        code: "polymarket.compare_ok",
        message: "Polymarket comparison completed.",
        reply,
        providerId: "polymarket-gamma",
        query: compareQueries.join(" vs "),
        results: comparisons,
        userContextId,
        conversationId,
        sessionKey,
        latencyMs: Date.now() - startedAt,
      });
    }

    if (action === ACTION.PRICE || action === ACTION.ORDERBOOK || action === ACTION.ALERT_CREATE) {
      const focused = action === ACTION.ALERT_CREATE
        ? compactWhitespace(
          String(text || "")
            .replace(/\b(alert|notify me|notification|ping me|let me know|watch for|watch when|set up an? alert|create an? alert)\b/gi, " ")
            .replace(/\b(if|when)\b/gi, " ")
            .replace(/(?:above|over|below|under|greater than|less than|at least|at most|>=|<=|>|<)\s*\d{1,3}(?:\.\d+)?\s*%?/gi, " "),
        )
        : buildFocusedQuery(text, requestHints);
      const query = compactWhitespace(focused || buildQuery(text, requestHints));
      const market = (await fetchStructuredMarkets(query, 6))[0] || null;
      if (!market) {
        return buildErrorResult({
          action,
          code: "polymarket.market_not_found",
          message: "No matching market found.",
          reply: `I couldn't find a Polymarket market for "${query || "that prompt"}". Name the market more specifically and retry.`,
          query,
          userContextId,
          conversationId,
          sessionKey,
          latencyMs: Date.now() - startedAt,
        });
      }

      const primary = pickPrimaryOutcome(market);
      const companion = pickCompanionOutcome(market, primary);

      if (action === ACTION.PRICE) {
        let price = toFiniteNumber(primary?.price, Number.NaN);
        if (normalizeText(primary?.tokenId)) {
          const live = await fetchTokenPrice(primary.tokenId);
          if (live && Number.isFinite(live.price)) price = live.price;
        }
        if (!Number.isFinite(price)) {
          return buildErrorResult({
            action,
            code: "polymarket.price_unavailable",
            message: "Price data unavailable.",
            reply: "I found the market, but live price data is unavailable right now. Retry in a moment.",
            query,
            results: [market],
            userContextId,
            conversationId,
            sessionKey,
            latencyMs: Date.now() - startedAt,
          });
        }

        const replyParts = [
          `${normalizeText(market.title || market.question)} is trading at ${toPercent(price, 1)} for ${normalizeText(primary?.label || "primary outcome")}.`,
        ];
        if (companion && Number.isFinite(Number(companion.price))) {
          replyParts.push(`${normalizeText(companion.label)}: ${toPercent(companion.price, 1)}.`);
        }
        if (market.volume24hr > 0) replyParts.push(`24h volume: ${toUsd(market.volume24hr)}.`);
        if (market.url) replyParts.push(`Market: ${market.url}`);

        return buildSuccessResult({
          action,
          code: "polymarket.price_ok",
          message: "Polymarket price loaded.",
          reply: replyParts.join(" "),
          providerId: "polymarket-clob",
          query,
          results: [{ market, outcome: primary, price: clamp01(price) }],
          userContextId,
          conversationId,
          sessionKey,
          latencyMs: Date.now() - startedAt,
        });
      }

      if (action === ACTION.ORDERBOOK) {
        const tokenId = normalizeText(primary?.tokenId);
        if (!tokenId) {
          return buildErrorResult({
            action,
            code: "polymarket.orderbook_token_missing",
            message: "Market token id missing for orderbook lookup.",
            reply: "I found the market, but couldn't resolve a tradable token for orderbook depth.",
            query,
            results: [market],
            userContextId,
            conversationId,
            sessionKey,
            latencyMs: Date.now() - startedAt,
          });
        }

        const orderBook = await fetchOrderBook(tokenId);
        if (!orderBook) {
          return buildErrorResult({
            action,
            code: "polymarket.orderbook_unavailable",
            message: "Orderbook unavailable.",
            reply: "Orderbook data is unavailable right now. Retry in a moment.",
            query,
            results: [market],
            userContextId,
            conversationId,
            sessionKey,
            latencyMs: Date.now() - startedAt,
          });
        }

        const replyParts = [
          `${normalizeText(market.title || market.question)} orderbook (${normalizeText(primary?.label || "primary outcome")}): best bid ${orderBook.bestBid > 0 ? toPercent(orderBook.bestBid, 2) : "n/a"}, best ask ${orderBook.bestAsk > 0 ? toPercent(orderBook.bestAsk, 2) : "n/a"}, spread ${orderBook.spread > 0 ? `${(orderBook.spread * 100).toFixed(2)} pts` : "n/a"}.`,
        ];
        if (Array.isArray(orderBook.bids) && orderBook.bids.length > 0) {
          replyParts.push(`Top bids: ${orderBook.bids.slice(0, 2).map((row) => `${toPercent(row.price, 1)} x ${row.size.toFixed(2)}`).join(" | ")}.`);
        }
        if (Array.isArray(orderBook.asks) && orderBook.asks.length > 0) {
          replyParts.push(`Top asks: ${orderBook.asks.slice(0, 2).map((row) => `${toPercent(row.price, 1)} x ${row.size.toFixed(2)}`).join(" | ")}.`);
        }
        if (market.url) replyParts.push(`Market: ${market.url}`);

        return buildSuccessResult({
          action,
          code: "polymarket.orderbook_ok",
          message: "Polymarket orderbook loaded.",
          reply: replyParts.join(" "),
          providerId: "polymarket-clob",
          query,
          results: [{ market, outcome: primary, orderBook }],
          userContextId,
          conversationId,
          sessionKey,
          latencyMs: Date.now() - startedAt,
        });
      }

      const thresholdConfig = parseAlertThreshold(text);
      if (!thresholdConfig) {
        return buildErrorResult({
          action,
          code: "polymarket.alert_threshold_missing",
          message: "Alert threshold missing.",
          reply: "Specify the threshold, for example: alert me when this market goes above 80%.",
          query,
          results: [market],
          userContextId,
          conversationId,
          sessionKey,
          latencyMs: Date.now() - startedAt,
        });
      }

      const tokenId = normalizeText(primary?.tokenId);
      if (!tokenId) {
        return buildErrorResult({
          action,
          code: "polymarket.alert_token_missing",
          message: "Market token id missing for alert trigger.",
          reply: "I found the market but it does not expose a token id, so I can't create a price-trigger alert yet.",
          query,
          results: [market],
          userContextId,
          conversationId,
          sessionKey,
          latencyMs: Date.now() - startedAt,
        });
      }

      const deliveryChannel = detectDeliveryChannel(text);
      const missionPrompt = buildAlertMissionPrompt({
        market,
        outcome: primary,
        direction: thresholdConfig.direction,
        threshold: thresholdConfig.threshold,
        deliveryChannel,
      });

      const runMissionBuild = typeof deps?.runMissionsDomainService === "function"
        ? deps.runMissionsDomainService
        : runMissionsDomainService;

      const missionResult = await runMissionBuild({
        text: missionPrompt,
        deploy: true,
        engine: "src",
        userContextId,
        conversationId,
        sessionKey,
        supabaseAccessToken: normalizeText(input.supabaseAccessToken),
      });

      if (missionResult?.ok !== true) {
        return buildErrorResult({
          action,
          code: normalizeText(missionResult?.code || "polymarket.alert_build_failed") || "polymarket.alert_build_failed",
          message: normalizeText(missionResult?.error || missionResult?.message || "Polymarket alert mission build failed.") || "Polymarket alert mission build failed.",
          reply: normalizeText(missionResult?.reply || "I couldn't create the Polymarket alert mission right now.") || "I couldn't create the Polymarket alert mission right now.",
          providerId: normalizeText(missionResult?.provider || "missions-service") || "missions-service",
          adapterId: "mission-builder",
          query,
          results: [market],
          toolCalls: ["mission"],
          data: missionResult?.data && typeof missionResult.data === "object" ? missionResult.data : {},
          userContextId,
          conversationId,
          sessionKey,
          latencyMs: Date.now() - startedAt,
        });
      }

      return buildSuccessResult({
        action,
        code: "polymarket.alert_created",
        message: "Polymarket alert mission created.",
        reply: normalizeText(missionResult?.reply || "Polymarket alert mission created.") || "Polymarket alert mission created.",
        providerId: normalizeText(missionResult?.provider || "missions-service") || "missions-service",
        adapterId: "mission-builder",
        query,
        results: [{ market, outcome: primary, direction: thresholdConfig.direction, threshold: thresholdConfig.threshold }],
        toolCalls: ["mission"],
        data: missionResult?.data && typeof missionResult.data === "object" ? missionResult.data : {},
        userContextId,
        conversationId,
        sessionKey,
        latencyMs: Date.now() - startedAt,
      });
    }

    const query = buildQuery(text, requestHints);
    const scanResult = await fetchMarketsForScan(query, deps);
    return buildSuccessResult({
      action: ACTION.SCAN,
      code: "polymarket.scan_ok",
      message: "Polymarket scan completed.",
      reply: formatScanReply(query, scanResult.results),
      providerId: scanResult.providerId,
      adapterId: scanResult.adapterId,
      query: scanResult.query || query,
      results: scanResult.results,
      attemptCount: scanResult.attemptCount,
      toolCalls: scanResult.adapterId === "web-search-tool-adapter" ? ["web_search"] : [],
      userContextId,
      conversationId,
      sessionKey,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    return buildErrorResult({
      action,
      code: "polymarket.fetch_failed",
      message: error instanceof Error ? error.message : "Polymarket fetch failed.",
      reply: "I couldn't reach Polymarket right now. Retry in a moment.",
      query: buildQuery(text, requestHints),
      userContextId,
      conversationId,
      sessionKey,
      latencyMs: Date.now() - startedAt,
    });
  }
}
