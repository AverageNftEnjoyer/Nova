const CRYPTO_MARKER_REGEX =
  /\b(coinbase|crypto|bitcoin|ethereum|solana|cardano|dogecoin|ripple|litecoin|btc|eth|sol|xrp|ada|doge|ltc|usdt|usdc|eurc)\b/i;

const PRICE_INTENT_REGEX = /\b(price|quote|worth|rate|market\s+price|how much)\b/i;
const PORTFOLIO_INTENT_REGEX = /\b(portfolio|holdings?|balances?|account|net\s*worth|assets?)\b/i;
const TRANSACTION_INTENT_REGEX = /\b(transactions?|trades?|fills?|activity|history)\b/i;
const REPORT_INTENT_REGEX = /\b(report|summary|pnl|profit|loss|weekly|daily)\b/i;
const STATUS_INTENT_REGEX = /\b(status|connected|connection|capabilities?|scopes?)\b/i;

const SYMBOL_ALIASES = {
  bitcoin: "BTC",
  xbt: "BTC",
  ethereum: "ETH",
  ether: "ETH",
  solana: "SOL",
  ripple: "XRP",
  cardano: "ADA",
  dogecoin: "DOGE",
  litecoin: "LTC",
  tether: "USDT",
  usdt: "USDT",
  usdc: "USDC",
  eurc: "EURC",
};

const KNOWN_SYMBOLS = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "LTC", "USDT", "USDC", "EURC", "AVAX", "DOT", "MATIC", "LINK", "ATOM", "XLM", "ALGO", "TRX", "NEAR", "APT", "ARB", "OP", "FIL", "AAVE", "SUI", "SHIB"];

function stripAssistantPrefix(text) {
  return String(text || "")
    .replace(/^\s*(?:hey|hi|yo)\s+n[o0]va\b[\s,:-]*/i, "")
    .replace(/^\s*n[o0]va\b[\s,:-]*/i, "")
    .trim();
}

export function isCryptoRequestText(text) {
  const normalized = stripAssistantPrefix(text);
  if (!normalized) return false;
  if (CRYPTO_MARKER_REGEX.test(normalized)) return true;
  if (!PRICE_INTENT_REGEX.test(normalized)) return false;
  return /\b[a-z]{2,6}\b/i.test(normalized);
}

function levenshteinDistance(aRaw, bRaw) {
  const a = String(aRaw || "");
  const b = String(bRaw || "");
  if (!a) return b.length;
  if (!b) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

function normalizeSymbolToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function resolveSymbolToken(tokenRaw) {
  const token = normalizeSymbolToken(tokenRaw);
  if (!token) {
    return { status: "unresolved", symbol: "", confidence: 0, suggestion: "" };
  }
  const upper = token.toUpperCase();
  if (KNOWN_SYMBOLS.includes(upper)) {
    return { status: "resolved", symbol: upper, confidence: 1, suggestion: "" };
  }
  if (SYMBOL_ALIASES[token]) {
    return { status: "resolved", symbol: SYMBOL_ALIASES[token], confidence: 0.98, suggestion: "" };
  }

  const candidates = new Map();
  for (const symbol of KNOWN_SYMBOLS) {
    const dist = levenshteinDistance(token, symbol.toLowerCase());
    const score = 1 - dist / Math.max(token.length, symbol.length);
    candidates.set(symbol, Math.max(score, Number(candidates.get(symbol) || 0)));
  }
  for (const [alias, symbol] of Object.entries(SYMBOL_ALIASES)) {
    const dist = levenshteinDistance(token, alias);
    const score = 1 - dist / Math.max(token.length, alias.length);
    candidates.set(symbol, Math.max(score, Number(candidates.get(symbol) || 0)));
  }

  const ranked = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
  const best = ranked[0];
  const second = ranked[1];
  const bestScore = Number(best?.[1] || 0);
  const margin = bestScore - Number(second?.[1] || 0);
  const bestSymbol = String(best?.[0] || "");
  const bestDistance = bestSymbol ? levenshteinDistance(token, bestSymbol.toLowerCase()) : Number.POSITIVE_INFINITY;
  if (bestSymbol && bestScore >= 0.93) {
    return { status: "resolved", symbol: bestSymbol, confidence: bestScore, suggestion: "" };
  }
  if (bestSymbol && token.length <= 4 && bestDistance <= 1) {
    return { status: "ambiguous", symbol: "", confidence: 0.72, suggestion: bestSymbol };
  }
  if (bestSymbol && bestScore >= 0.78 && margin >= 0.04) {
    return { status: "ambiguous", symbol: "", confidence: bestScore, suggestion: bestSymbol };
  }
  return { status: "unresolved", symbol: "", confidence: bestScore, suggestion: bestSymbol };
}

function extractPriceSymbol(text) {
  const normalized = stripAssistantPrefix(text);
  const pairMatch = normalized.match(/\b([a-z0-9]{2,10})\s*(?:\/|-)\s*([a-z0-9]{2,10})\b/i);
  if (pairMatch?.[1] && pairMatch?.[2]) {
    const base = resolveSymbolToken(pairMatch[1]);
    const quote = normalizeSymbolToken(pairMatch[2]).toUpperCase() || "USD";
    if (base.status === "resolved") {
      return { status: "resolved", symbolPair: `${base.symbol}-${quote}`, suggestion: "", confidence: "high" };
    }
    if (base.status === "ambiguous") {
      return { status: "ambiguous", symbolPair: "", suggestion: `${base.suggestion}-${quote}`, confidence: "medium" };
    }
    return { status: "unresolved", symbolPair: "", suggestion: "", confidence: "low" };
  }

  const tokens = normalized
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 14);
  const stopWords = new Set([
    "coinbase", "crypto", "price", "quote", "worth", "how", "much", "is", "my", "portfolio", "report", "transactions",
    "transaction", "status", "the", "a", "an", "for", "of", "to", "in", "on", "and", "what", "whats", "whats", "current",
    "today", "now", "please", "show", "me",
  ]);
  const candidates = tokens.filter((token) => {
    const lower = token.toLowerCase();
    if (stopWords.has(lower)) return false;
    const upper = token.toUpperCase();
    if (KNOWN_SYMBOLS.includes(upper)) return true;
    if (SYMBOL_ALIASES[lower]) return true;
    return token.length <= 5;
  });

  let bestResolved = null;
  let bestAmbiguous = null;
  for (const candidate of candidates) {
    const resolved = resolveSymbolToken(candidate);
    if (resolved.status === "resolved") {
      if (!bestResolved || resolved.confidence > bestResolved.confidence) {
        bestResolved = resolved;
      }
      continue;
    }
    if (resolved.status === "ambiguous") {
      if (!bestAmbiguous || resolved.confidence > bestAmbiguous.confidence) {
        bestAmbiguous = resolved;
      }
    }
  }
  if (bestResolved?.symbol) {
    return { status: "resolved", symbolPair: `${bestResolved.symbol}-USD`, suggestion: "", confidence: bestResolved.confidence >= 0.93 ? "high" : "medium" };
  }
  if (bestAmbiguous?.suggestion) {
    return { status: "ambiguous", symbolPair: "", suggestion: `${bestAmbiguous.suggestion}-USD`, confidence: "medium" };
  }
  return { status: "unresolved", symbolPair: "", suggestion: "", confidence: "low" };
}

function inferCryptoIntent(text) {
  const normalized = stripAssistantPrefix(text);
  const lower = normalized.toLowerCase();
  if (STATUS_INTENT_REGEX.test(lower) && /\bcoinbase\b/.test(lower)) return "status";
  if (REPORT_INTENT_REGEX.test(lower) && (CRYPTO_MARKER_REGEX.test(lower) || PORTFOLIO_INTENT_REGEX.test(lower))) return "report";
  if (TRANSACTION_INTENT_REGEX.test(lower)) return "transactions";
  if (PORTFOLIO_INTENT_REGEX.test(lower)) return "portfolio";
  return "price";
}

function parseToolPayload(raw) {
  const text = String(raw || "").trim();
  if (!text) return { ok: false, errorCode: "EMPTY_TOOL_RESPONSE", safeMessage: "I couldn't verify Coinbase data right now.", guidance: "Retry in a moment." };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // no-op
  }
  return { ok: false, errorCode: "NON_JSON_TOOL_RESPONSE", safeMessage: "I couldn't verify Coinbase data right now.", guidance: "Retry in a moment." };
}

function formatFreshnessMs(value) {
  const ms = Math.max(0, Math.floor(Number(value || 0)));
  if (ms <= 0) return "unknown";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function formatTimestamp(ms) {
  const parsed = Number(ms);
  if (!Number.isFinite(parsed) || parsed <= 0) return "unknown time";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function formatUsdAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount >= 1000 ? 2 : 4,
  }).format(amount);
}

async function executeCoinbaseTool(runtimeTools, availableTools, toolName, input) {
  if (typeof runtimeTools?.executeToolUse !== "function") {
    return { ok: false, errorCode: "TOOL_RUNTIME_UNAVAILABLE", safeMessage: "I couldn't verify Coinbase data because the tool runtime is unavailable.", guidance: "Retry after Nova runtime initializes tools." };
  }
  const exists = Array.isArray(availableTools) && availableTools.some((tool) => String(tool?.name || "") === toolName);
  if (!exists) {
    return { ok: false, errorCode: "TOOL_NOT_ENABLED", safeMessage: `I couldn't verify Coinbase data because ${toolName} is not enabled.`, guidance: "Enable Coinbase tools in NOVA_ENABLED_TOOLS and restart Nova." };
  }
  try {
    const result = await runtimeTools.executeToolUse(
      {
        id: `tool_${toolName}_${Date.now()}`,
        name: toolName,
        input,
        type: "tool_use",
      },
      availableTools,
    );
    return parseToolPayload(result?.content || "");
  } catch (err) {
    return {
      ok: false,
      errorCode: "TOOL_EXECUTION_FAILED",
      safeMessage: "I couldn't verify Coinbase data because tool execution failed.",
      guidance: err instanceof Error ? err.message : "Retry in a moment.",
    };
  }
}

function buildSafeFailureReply(actionLabel, payload) {
  const safeMessage = String(payload?.safeMessage || "").trim() || `I couldn't verify live Coinbase ${actionLabel} right now.`;
  const guidance = String(payload?.guidance || "").trim();
  if (guidance) {
    return `${safeMessage}\nNext step: ${guidance}`;
  }
  return `${safeMessage}\nNext step: Retry in a moment.`;
}

function buildStatusReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("status", payload);
  const caps = payload.capabilities || {};
  return [
    `Coinbase status: ${String(caps.status || "unknown")}.`,
    `Capabilities: market=${String(caps.marketData || "unknown")}, portfolio=${String(caps.portfolio || "unknown")}, transactions=${String(caps.transactions || "unknown")}.`,
    `Checked: ${formatTimestamp(payload.checkedAtMs)}.`,
    "Source: Coinbase capability probe.",
    "Confidence: high (Coinbase runtime capabilities).",
  ].join("\n");
}

function buildPriceReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("price", payload);
  const data = payload.data || {};
  const pair = String(data.symbolPair || "").trim() || "unknown pair";
  return [
    `${pair} now: ${formatUsdAmount(data.price)}.`,
    `Freshness: updated ${formatTimestamp(data.fetchedAtMs)} (${formatFreshnessMs(data.freshnessMs)}).`,
    "Source: Coinbase spot price.",
    `Confidence: ${String(payload.confidence || "high")} (Coinbase API).`,
  ].join("\n");
}

function buildPortfolioReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("portfolio", payload);
  const data = payload.data || {};
  const balances = Array.isArray(data.balances) ? data.balances : [];
  const nonZero = balances.filter((entry) => Number(entry?.total || 0) > 0);
  const top = nonZero.slice(0, 5).map((entry) => {
    const symbol = String(entry.assetSymbol || "asset").toUpperCase();
    const total = Number(entry.total || 0);
    return `- ${symbol}: ${Number.isFinite(total) ? total.toLocaleString("en-US", { maximumFractionDigits: 8 }) : "n/a"}`;
  });
  return [
    `Coinbase portfolio snapshot (${nonZero.length} active assets).`,
    top.length > 0 ? top.join("\n") : "- No non-zero balances found.",
    `Freshness: updated ${formatTimestamp(data.fetchedAtMs)} (${formatFreshnessMs(data.freshnessMs)}).`,
    "Source: Coinbase portfolio snapshot.",
    "Confidence: high (Coinbase API).",
  ].join("\n");
}

function buildTransactionsReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("transactions", payload);
  const events = Array.isArray(payload.events) ? payload.events : [];
  const lines = events.slice(0, 5).map((event) => {
    const side = String(event.side || "other").toUpperCase();
    const qty = Number(event.quantity || 0);
    const symbol = String(event.assetSymbol || "").toUpperCase();
    const price = Number(event.price);
    const at = formatTimestamp(event.occurredAtMs);
    const priceChunk = Number.isFinite(price) ? ` @ ${formatUsdAmount(price)}` : "";
    return `- ${side} ${Number.isFinite(qty) ? qty.toLocaleString("en-US", { maximumFractionDigits: 8 }) : "n/a"} ${symbol}${priceChunk} (${at})`;
  });
  return [
    `Recent Coinbase transactions (${events.length}).`,
    lines.length > 0 ? lines.join("\n") : "- No recent transactions returned.",
    "Source: Coinbase transaction history.",
    "Confidence: high (Coinbase API).",
  ].join("\n");
}

function buildReportReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("report", payload);
  const report = payload.report || {};
  const summary = report.summary || {};
  const portfolio = report.portfolio || {};
  return [
    "Coinbase crypto report:",
    `- Active assets: ${Number(summary.nonZeroAssetCount || 0)}`,
    `- Recent transactions included: ${Number(summary.transactionCount || 0)}`,
    `- Freshness: updated ${formatTimestamp(portfolio.fetchedAtMs)} (${formatFreshnessMs(portfolio.freshnessMs)})`,
    "Source: Coinbase portfolio + transactions.",
    "Confidence: high (Coinbase API).",
  ].join("\n");
}

export async function tryCryptoFastPathReply({
  text,
  runtimeTools,
  availableTools,
  userContextId,
  conversationId,
}) {
  if (!isCryptoRequestText(text)) return { reply: "", source: "" };
  const normalizedUserContextId = String(userContextId || "").trim();
  if (!normalizedUserContextId) {
    return {
      reply: "I couldn't verify crypto data because user context is missing. Retry from your Nova account session.",
      source: "validation",
    };
  }

  const intent = inferCryptoIntent(text);
  if (intent === "status") {
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_capabilities", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
    });
    return { reply: buildStatusReply(payload), source: "coinbase", toolCall: "coinbase_capabilities" };
  }

  if (intent === "price") {
    const symbolResolution = extractPriceSymbol(text);
    if (symbolResolution.status === "ambiguous" && symbolResolution.suggestion) {
      return {
        reply: `I am not fully confident on the ticker. Did you mean ${symbolResolution.suggestion}? Send that symbol/pair exactly and I will fetch it.`,
        source: "clarify",
      };
    }
    if (symbolResolution.status !== "resolved" || !symbolResolution.symbolPair) {
      return {
        reply: "Share the crypto ticker (for example BTC, ETH, SOL) or pair (for example BTC-USD) and I will fetch live Coinbase price.",
        source: "validation",
      };
    }
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_spot_price", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
      symbolPair: symbolResolution.symbolPair,
    });
    return { reply: buildPriceReply(payload), source: "coinbase", toolCall: "coinbase_spot_price" };
  }

  if (intent === "portfolio") {
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_portfolio_snapshot", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
    });
    return { reply: buildPortfolioReply(payload), source: "coinbase", toolCall: "coinbase_portfolio_snapshot" };
  }

  if (intent === "transactions") {
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_recent_transactions", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
      limit: 6,
    });
    return { reply: buildTransactionsReply(payload), source: "coinbase", toolCall: "coinbase_recent_transactions" };
  }

  const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_portfolio_report", {
    userContextId: normalizedUserContextId,
    conversationId: String(conversationId || "").trim(),
    transactionLimit: 8,
  });
  return { reply: buildReportReply(payload), source: "coinbase", toolCall: "coinbase_portfolio_report" };
}
