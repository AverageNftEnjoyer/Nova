import { normalizeCoinbaseCommandText } from "../command-parser/index.js";

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

const CRYPTO_PRICE_STOP_WORDS = new Set([
  "coinbase", "crypto", "price", "quote", "worth", "how", "much", "is", "my", "portfolio", "report", "transactions",
  "transaction", "status", "the", "a", "an", "for", "of", "to", "in", "on", "and", "what", "whats", "current",
  "today", "now", "please", "show", "me",
]);

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
