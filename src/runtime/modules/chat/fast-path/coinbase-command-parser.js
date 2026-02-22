const COINBASE_CATEGORY_ORDER = ["price", "portfolio", "transactions", "reports", "status"];

const COINBASE_ALIAS_PATTERNS = {
  price: [
    /\bprice\s+[a-z0-9]{2,12}\b/i,
    /\bquote\s+[a-z0-9]{2,12}\b/i,
    /\bhow much is\s+[a-z0-9]{2,12}\b/i,
    /\bspot\s+price\b/i,
  ],
  portfolio: [
    /\bportfolio\b/i,
    /\bmy\s+portfolio\b/i,
    /\bholdings?\b/i,
    /\bbalances?\b/i,
  ],
  transactions: [
    /\btransactions?\b/i,
    /\btrade\s+history\b/i,
    /\bfills?\b/i,
    /\bactivity\b/i,
  ],
  reports: [
    /\bmy\s+crypto\s+report\b/i,
    /\bcrypto\s+report\b/i,
    /\bweekly\s+p\s*&?\s*l\b/i,
    /\bweekly\s+pnl\b/i,
    /\bdaily\s+crypto\s+report\b/i,
  ],
  status: [
    /\bcoinbase\s+status\b/i,
    /\bcoinbase\s+account\s+status\b/i,
    /\bcrypto\s+account\s+status\b/i,
    /\bcrypto\s+help\b/i,
    /\bconnection\s+status\b/i,
    /\bcoinbase\s+connected\b/i,
  ],
};

const CRYPTO_MARKER_REGEX =
  /\b(coinbase|crypto|bitcoin|ethereum|solana|cardano|dogecoin|ripple|litecoin|btc|eth|sol|xrp|ada|doge|ltc|usdt|usdc|eurc)\b/i;
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
const KNOWN_SYMBOLS = new Set([
  "BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "LTC", "USDT", "USDC", "EURC", "AVAX", "DOT",
  "MATIC", "LINK", "ATOM", "XLM", "ALGO", "TRX", "NEAR", "APT", "ARB", "OP", "FIL", "AAVE", "SUI", "SHIB",
]);

const TYPO_NORMALIZATION_MAP = new Map([
  ["prcie", "price"],
  ["pirce", "price"],
  ["portfolo", "portfolio"],
  ["portfoilo", "portfolio"],
  ["porfolio", "portfolio"],
  ["cryto", "crypto"],
  ["crytpo", "crypto"],
  ["cripto", "crypto"],
  ["coibase", "coinbase"],
  ["recnt", "recent"],
  ["wekly", "weekly"],
  ["weely", "weekly"],
  ["pnl", "pnl"],
  ["pn", "pnl"],
  ["reprot", "report"],
  ["tranctions", "transactions"],
  ["transacitons", "transactions"],
  ["trasnactions", "transactions"],
  ["balnce", "balance"],
  ["sstatus", "status"],
]);

function stripAssistantPrefix(text) {
  return String(text || "")
    .replace(/^\s*(?:hey|hi|yo)\s+n[o0]va\b[\s,:-]*/i, "")
    .replace(/^\s*n[o0]va\b[\s,:-]*/i, "")
    .trim();
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

function normalizeToken(tokenRaw) {
  const token = String(tokenRaw || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!token) return "";
  const direct = TYPO_NORMALIZATION_MAP.get(token);
  if (direct) return direct;
  for (const [bad, replacement] of TYPO_NORMALIZATION_MAP.entries()) {
    if (Math.abs(bad.length - token.length) > 1) continue;
    if (levenshteinDistance(token, bad) <= 1) return replacement;
  }
  return token;
}

export function normalizeCoinbaseCommandText(text) {
  const stripped = stripAssistantPrefix(text);
  if (!stripped) return "";
  return stripped
    .split(/\s+/)
    .map((token) => normalizeToken(token))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferIntentFromAliases(normalizedText) {
  for (const category of COINBASE_CATEGORY_ORDER) {
    const patterns = COINBASE_ALIAS_PATTERNS[category] || [];
    if (patterns.some((pattern) => pattern.test(normalizedText))) return category;
  }
  return "";
}

function hasDirectCryptoSymbolMention(text) {
  const tokens = String(text || "")
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const upper = token.toUpperCase();
    if (KNOWN_SYMBOLS.has(upper)) return true;
    if (SYMBOL_ALIASES[lower]) return true;
  }
  return false;
}

export function parseCoinbaseCommand(text) {
  const raw = stripAssistantPrefix(text);
  const normalized = normalizeCoinbaseCommandText(raw);
  if (!normalized) {
    return {
      isCrypto: false,
      intent: "",
      category: "",
      normalizedText: "",
      matchedBy: "none",
      ambiguous: false,
    };
  }

  const aliasIntent = inferIntentFromAliases(normalized);
  if (aliasIntent) {
    return {
      isCrypto: true,
      intent: aliasIntent === "reports" ? "report" : aliasIntent,
      category: aliasIntent,
      normalizedText: normalized,
      matchedBy: "alias",
      ambiguous: false,
    };
  }

  const hasCryptoMarker = CRYPTO_MARKER_REGEX.test(normalized);
  const hasPriceIntent = /\b(price|quote|worth|rate|market\s+price|how much)\b/i.test(normalized);
  const hasDirectSymbol = hasDirectCryptoSymbolMention(normalized);
  if (!hasCryptoMarker && (!hasPriceIntent || !hasDirectSymbol)) {
    return {
      isCrypto: false,
      intent: "",
      category: "",
      normalizedText: normalized,
      matchedBy: "none",
      ambiguous: false,
    };
  }

  const intent =
    /\b(status|connected|connection|capabilities?|scopes?)\b/i.test(normalized) ? "status" :
    /\b(report|summary|pnl|profit|loss|weekly|daily)\b/i.test(normalized) ? "report" :
    /\b(transactions?|trades?|fills?|activity|history)\b/i.test(normalized) ? "transactions" :
    /\b(portfolio|holdings?|balances?|account|net\s*worth|assets?)\b/i.test(normalized) ? "portfolio" :
    "price";
  const category = intent === "report" ? "reports" : intent;
  return {
    isCrypto: true,
    intent,
    category,
    normalizedText: normalized,
    matchedBy: "intent",
    ambiguous: false,
  };
}

function parseCategoryList(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => COINBASE_CATEGORY_ORDER.includes(value));
}

export function resolveEnabledCoinbaseCommandCategories() {
  const defaults = ["price", "portfolio", "transactions", "reports", "status"];
  const enabledRaw = process.env.NOVA_COINBASE_COMMAND_CATEGORIES;
  const disabledRaw = process.env.NOVA_COINBASE_DISABLED_COMMAND_CATEGORIES;
  const enabled = parseCategoryList(enabledRaw);
  const disabled = new Set(parseCategoryList(disabledRaw));
  const base = enabled.length > 0 ? enabled : defaults;
  return new Set(base.filter((category) => !disabled.has(category)));
}
