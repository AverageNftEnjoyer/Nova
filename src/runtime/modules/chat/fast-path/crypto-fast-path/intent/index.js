import {
  CODING_INTENT_REGEX,
  COMMAND_CUE_REGEX,
  CRYPTO_CONVERSATIONAL_OPEN_REGEX,
  CRYPTO_MARKER_REGEX,
  EXPLICIT_CRYPTO_ACTION_REGEX,
  EXPLICIT_CRYPTO_REPORT_REGEX,
  KNOWN_SYMBOLS,
  MISSION_CUE_REGEX,
  NON_CRYPTO_TOPIC_CUE_REGEX,
  PORTFOLIO_INTENT_REGEX,
  PRICE_INTENT_REGEX,
  REPORT_INTENT_REGEX,
  REPORT_REPEAT_CUE_REGEX,
  STATUS_INTENT_REGEX,
  SYMBOL_ALIASES,
  TRANSACTION_INTENT_REGEX,
  CRYPTO_PRICE_STOP_WORDS,
} from "../constants/index.js";
import {
  normalizeCoinbaseCommandText,
  parseCoinbaseCommand,
} from "../coinbase-command-parser.js";

export function hasDirectCryptoSymbolMention(text) {
  const tokens = String(text || "")
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const upper = token.toUpperCase();
    if (KNOWN_SYMBOLS.includes(upper)) return true;
    if (SYMBOL_ALIASES[lower]) return true;
  }
  return false;
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

export function extractPriceSymbol(text) {
  const normalized = normalizeCoinbaseCommandText(text);
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
  const candidates = tokens.filter((token) => {
    const lower = token.toLowerCase();
    if (CRYPTO_PRICE_STOP_WORDS.has(lower)) return false;
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

export function isCryptoRequestText(text) {
  const parsed = parseCoinbaseCommand(text);
  if (parsed.isCrypto) return true;
  const normalized = normalizeCoinbaseCommandText(text);
  if (!normalized) return false;
  if (CODING_INTENT_REGEX.test(normalized) && !CRYPTO_MARKER_REGEX.test(normalized)) return false;
  if (COMMAND_CUE_REGEX.test(normalized)) return true;
  if (CRYPTO_MARKER_REGEX.test(normalized)) return true;
  if (!PRICE_INTENT_REGEX.test(normalized)) return false;
  return hasDirectCryptoSymbolMention(normalized);
}

export function shouldDeferCryptoFastPathToMissionBuilder(text) {
  const normalized = normalizeCoinbaseCommandText(text);
  if (!normalized) return false;
  if (!MISSION_CUE_REGEX.test(normalized)) return false;
  if (!CRYPTO_MARKER_REGEX.test(normalized) && !hasDirectCryptoSymbolMention(normalized)) return false;
  return NON_CRYPTO_TOPIC_CUE_REGEX.test(normalized);
}

export function isExplicitCryptoReportRequest(text) {
  const normalized = normalizeCoinbaseCommandText(text);
  if (!normalized) return false;
  if (EXPLICIT_CRYPTO_REPORT_REGEX.test(normalized)) return true;
  if (/\b(crypto|coinbase)\b/.test(normalized) && /\breport\b/.test(normalized) && REPORT_REPEAT_CUE_REGEX.test(normalized)) {
    return true;
  }
  return false;
}

export function inferCryptoIntent(text) {
  const normalized = normalizeCoinbaseCommandText(text);
  const lower = normalized.toLowerCase();
  const hasPnlOrValuation =
    /\b(pnl|profit|loss|p\s*&?\s*l|total|total\s+balance|net\s+worth|value|worth|usd)\b/i.test(lower)
    && /\b(portfolio|account|holdings?|balances?|crypto|coinbase)\b/i.test(lower);
  if (hasPnlOrValuation) return "report";
  const hasCryptoMarker = CRYPTO_MARKER_REGEX.test(lower);
  const hasDirectSymbol = hasDirectCryptoSymbolMention(lower);
  const openEndedConversation = CRYPTO_CONVERSATIONAL_OPEN_REGEX.test(lower);
  const hasExplicitAction = EXPLICIT_CRYPTO_ACTION_REGEX.test(lower);
  if (hasCryptoMarker && openEndedConversation && !hasExplicitAction && !hasDirectSymbol) return "assist";
  const parsed = parseCoinbaseCommand(text);
  if (parsed.intent) return parsed.intent;
  if (STATUS_INTENT_REGEX.test(lower) && /\bcoinbase\b/.test(lower)) return "status";
  if (REPORT_INTENT_REGEX.test(lower) && (CRYPTO_MARKER_REGEX.test(lower) || PORTFOLIO_INTENT_REGEX.test(lower))) return "report";
  if (TRANSACTION_INTENT_REGEX.test(lower)) return "transactions";
  if (PORTFOLIO_INTENT_REGEX.test(lower)) return "portfolio";
  return "price";
}

export function buildCryptoConciergeReply() {
  return [
    "Yes. We can do this conversationally, not command-by-command.",
    "I can handle Coinbase portfolio totals, daily/weekly reports, daily PnL-style summaries, top holdings, recent transactions, and live spot prices.",
    "I can also save your report preferences per user profile, like which sections to show, which assets to include, and how compact the output should be.",
    "Try requests like:",
    "- `give me my daily crypto report`",
    "- `what is my portfolio total balance right now`",
    "- `break down my top holdings with values`",
    "- `show recent transactions and explain the trend`",
    "- `compare my current report to yesterday`",
    "- `price sui and btc in usd`",
    "If you want, I can start with your latest full portfolio report and then refine it based on your preferences.",
  ].join("\n");
}

export function buildMissingPriceTargetReply() {
  return [
    "I can pull that, but I need the target.",
    "If you want a coin price, send a ticker or pair like `SUI` or `SUI-USD`.",
    "If you want account-level value, say `show my portfolio total balance` or `show my daily crypto report`.",
  ].join("\n");
}
