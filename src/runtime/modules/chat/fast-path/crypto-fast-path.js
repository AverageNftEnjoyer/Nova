import fs from "node:fs";
import path from "node:path";
import {
  normalizeCoinbaseCommandText,
  parseCoinbaseCommand,
  resolveEnabledCoinbaseCommandCategories,
} from "./coinbase-command-parser.js";
import { resolveCoinbaseRolloutAccessForFastPath } from "./coinbase-rollout-policy.js";
import {
  applyShortTermContextTurnClassification,
  clearShortTermContextState,
  readShortTermContextState,
  upsertShortTermContextState,
} from "../core/short-term-context-engine.js";

const CRYPTO_MARKER_REGEX =
  /\b(coinbase|crypto|bitcoin|ethereum|solana|cardano|dogecoin|ripple|litecoin|btc|eth|sol|xrp|ada|doge|ltc|usdt|usdc|eurc)\b/i;

const PRICE_INTENT_REGEX = /\b(price|quote|worth|rate|market\s+price|how much)\b/i;
const PORTFOLIO_INTENT_REGEX = /\b(portfolio|holdings?|balances?|account|net\s*worth|assets?)\b/i;
const TRANSACTION_INTENT_REGEX = /\b(transactions?|trades?|fills?|activity|history)\b/i;
const REPORT_INTENT_REGEX = /\b(report|summary|pnl|profit|loss|weekly|daily)\b/i;
const STATUS_INTENT_REGEX = /\b(status|connected|connection|capabilities?|scopes?)\b/i;
const CODING_INTENT_REGEX = /\b(refactor|debug|fix|function|class|module|typescript|javascript|python|sql|unit\s*test|edge\s*cases?|jest|vitest|mocha|runtime)\b/i;
const CRYPTO_CONVERSATIONAL_OPEN_REGEX =
  /\b(help|talk|chat|start|overview|walk\s+me\s+through|check\s+in|review|look\s+at)\b.*\b(crypto|coinbase|portfolio|holdings?)\b|\b(my|our)\s+crypto\b/i;
const EXPLICIT_CRYPTO_ACTION_REGEX =
  /\b(price|quote|ticker|portfolio|holdings?|balances?|transactions?|activity|history|report|summary|pnl|profit|loss|status|connected|connection|capabilities?|weekly|daily|buy|sell|trade|swap|transfer|withdraw|deposit)\b/i;
const COMMAND_CUE_REGEX =
  /\b(price|portfolio|holdings?|transactions?|activity|crypto\s+help|coinbase\s+status|weekly\s+report|weekly\s+pnl|daily\s+report|daily\s+crypto\s+(?:report|summary|update)|my\s+crypto\s+report|transfer\s+funds|buy\s+[a-z0-9]{2,10})\b/i;
const COINBASE_FOLLOW_UP_TTL_MS = 8 * 60 * 1000;
const COINBASE_WHY_REGEX = /\b(why|what(?:'s| is)\s+wrong|what\s+happened)\b/i;
const COINBASE_CONSENT_AFFIRM_REGEX =
  /\b(you\s+have\s+consent|consent\s+(?:is\s+)?granted|i\s+(?:already\s+)?(?:gave|grant(?:ed)?|enabled)\s+consent|consent\s+is\s+on)\b/i;
const CRYPTO_REPORT_CONTEXT_REGEX =
  /\b(crypto|coinbase)\b.*\b(reports?|summar(?:y|ies)|pnl)\b|\b(reports?|summar(?:y|ies)|pnl)\b.*\b(crypto|coinbase)\b|\bmy\s+crypto\s+reports?\b|\b(daily|weekly)\s+report\b/i;
const CRYPTO_REPORT_ACTION_REGEX =
  /\b(set|make|change|customize|format|show|hide|include|exclude|only|round|remove|omit|always|never|remember|from\s+now\s+on)\b/i;
const EXPLICIT_CRYPTO_REPORT_REGEX =
  /\b(daily\s+report\s+of\s+crypto|daily\s+crypto\s+(?:report|summary|update)|coinbase\s+daily\s+report|my\s+crypto\s+report|crypto\s+report|coinbase\s+report|portfolio\s+report|daily\s+pnl|weekly\s+pnl|weekly\s+report)\b/i;
const REPORT_REPEAT_CUE_REGEX = /\b(again|rerun|refresh|repeat|same\s+report)\b/i;
const FOLLOW_UP_REMOVE_RECALL_REGEX =
  /\bwhat\s+did\s+i\s+(?:just\s+)?ask\s+you\s+to\s+remove\b(?:.*\breport\b)?/i;
const FOLLOW_UP_DETAIL_REGEX = /\b(more\s+detail|detailed|expand|expanded|drill\s+down|break\s*down)\b/i;
const CONTEXTUAL_REPORT_FOLLOWUP_REGEX =
  /\b(reports?|summary|pnl|concise|detailed|detail|freshness|timestamps?|format|again|rerun|refresh|plain\s+english|less\s+technical)\b/i;
const PERSONALITY_PNL_TRIGGER_REGEX = /\b(daily|weekly|pnl|profit|loss|p\s*&?\s*l)\b/i;
const PERSONALITY_PNL_THRESHOLD_PCT = 10;
const MISSION_CUE_REGEX =
  /\b(mission|workflow|automation|schedule|scheduled|briefing|brief|digest|build)\b/i;
const NON_CRYPTO_TOPIC_CUE_REGEX =
  /\b(nba|nfl|mlb|nhl|weather|forecast|quote|quotes|inspirational|motivational|tech|technology|news|headline|article|recap|story)\b/i;

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
const coinbaseFollowUpStateByConversation = new Map();
const personaMetaCache = new Map();

function getCoinbaseFollowUpKey(userContextId, conversationId) {
  const user = String(userContextId || "").trim().toLowerCase();
  const convo = String(conversationId || "").trim().toLowerCase() || "_default";
  return `${user}::${convo}`;
}

function pruneCoinbaseFollowUpState() {
  const now = Date.now();
  for (const [key, entry] of coinbaseFollowUpStateByConversation.entries()) {
    if (!entry || now - Number(entry.ts || 0) > COINBASE_FOLLOW_UP_TTL_MS) {
      coinbaseFollowUpStateByConversation.delete(key);
    }
  }
}

function readCoinbaseFollowUpState(key) {
  pruneCoinbaseFollowUpState();
  return coinbaseFollowUpStateByConversation.get(key) || null;
}

function updateCoinbaseFollowUpState(key, payload) {
  if (!key) return;
  if (payload?.ok) {
    coinbaseFollowUpStateByConversation.delete(key);
    return;
  }
  const errorCode = String(payload?.errorCode || "").trim().toUpperCase();
  if (!errorCode) return;
  coinbaseFollowUpStateByConversation.set(key, {
    ts: Date.now(),
    errorCode,
    guidance: String(payload?.guidance || "").trim(),
    safeMessage: String(payload?.safeMessage || "").trim(),
  });
}

function buildFollowUpReplyFromState(followUp) {
  const code = String(followUp?.errorCode || "").trim().toUpperCase();
  if (!code) return "";
  if (code === "CONSENT_REQUIRED") {
    return [
      "I can only use the Coinbase consent flag saved in your privacy settings.",
      "If you already enabled it, refresh/reconnect once and retry `recent transactions` or `weekly pnl`.",
      "If not, set `Transaction Consent Granted` ON (or `Require Consent` OFF) in Integrations -> Coinbase -> Privacy Controls first.",
    ].join("\n");
  }
  if (code === "DISCONNECTED") {
    return "Coinbase is disconnected for this runtime user context. Reconnect in Integrations, then retry.";
  }
  if (code === "AUTH_FAILED" || code === "AUTH_UNSUPPORTED") {
    return "Coinbase private auth is failing for this runtime context (key/scopes/allowlist/private key). Re-save credentials and reconnect, then retry.";
  }
  if (code === "RATE_LIMITED") {
    return "Coinbase is rate limiting requests right now. Wait briefly, then retry.";
  }
  return String(followUp?.safeMessage || "").trim() || "Coinbase is currently unavailable for this request.";
}

function readCryptoTopicAffinity(userContextId, conversationId) {
  return readShortTermContextState({
    userContextId,
    conversationId,
    domainId: "crypto",
  });
}

function clearCryptoTopicAffinity(userContextId, conversationId) {
  clearShortTermContextState({
    userContextId,
    conversationId,
    domainId: "crypto",
  });
}

function updateCryptoTopicAffinity(userContextId, conversationId, update) {
  const slots = { ...(update && typeof update === "object" ? update : {}) };
  const topicAffinityId = String(slots.topicAffinityId || "").trim();
  delete slots.topicAffinityId;
  return upsertShortTermContextState({
    userContextId,
    conversationId,
    domainId: "crypto",
    topicAffinityId,
    slots,
  });
}

function directiveToRemovedSection(directive) {
  const value = String(directive || "").trim().toLowerCase();
  if (!value) return "";
  if (value.startsWith("include_recent_net_cash_flow: false")) return "recent net cash-flow PnL proxy";
  if (value.startsWith("include_timestamp: false")) return "timestamp";
  if (value.startsWith("include_freshness: false")) return "freshness";
  return "";
}

function mergeRemovedSections(existing, directives) {
  const out = Array.isArray(existing) ? [...existing] : [];
  for (const directive of directives || []) {
    const section = directiveToRemovedSection(directive);
    if (section && !out.includes(section)) out.push(section);
  }
  return out.slice(-8);
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

function shouldDeferCryptoFastPathToMissionBuilder(text) {
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

function hasDirectCryptoSymbolMention(text) {
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

function extractPriceSymbol(text) {
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

function buildCryptoConciergeReply() {
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

function buildMissingPriceTargetReply() {
  return [
    "I can pull that, but I need the target.",
    "If you want a coin price, send a ticker or pair like `SUI` or `SUI-USD`.",
    "If you want account-level value, say `show my portfolio total balance` or `show my daily crypto report`.",
  ].join("\n");
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

function formatFreshness(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return "unknown";
  const seconds = Math.round(value / 1000);
  return `${seconds}s`;
}

function formatUsdAmount(value, decimalPlaces = 2) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "n/a";
  const places = Math.max(0, Math.min(8, Math.floor(Number(decimalPlaces) || 2)));
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(amount);
}

function normalizePersonaTone(value) {
  const tone = String(value || "").trim().toLowerCase();
  if (tone === "enthusiastic" || tone === "calm" || tone === "direct" || tone === "relaxed") return tone;
  return "neutral";
}

function resolvePersonaMeta({ workspaceDir, userContextId }) {
  const uid = String(userContextId || "").trim().toLowerCase();
  if (!uid) return { assistantName: "Nova", tone: "neutral", communicationStyle: "friendly" };
  const root = String(workspaceDir || "").trim() || process.cwd();
  const cacheKey = `${root}::${uid}`;
  const now = Date.now();
  const cached = personaMetaCache.get(cacheKey);
  if (cached && now - Number(cached.ts || 0) < 60_000) return cached.value;

  const agentsPath = path.join(root, ".agent", "user-context", uid, "AGENTS.md");
  let assistantName = "Nova";
  let tone = "neutral";
  let communicationStyle = "friendly";
  try {
    const content = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, "utf8") : "";
    const lines = String(content || "").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = String(rawLine || "").trim();
      let match = line.match(/^-+\s*Assistant name:\s*(.+)$/i);
      if (match?.[1]) assistantName = String(match[1]).trim() || assistantName;
      match = line.match(/^-+\s*Tone:\s*(.+)$/i);
      if (match?.[1]) tone = normalizePersonaTone(match[1]);
      match = line.match(/^-+\s*Communication style:\s*(.+)$/i);
      if (match?.[1]) communicationStyle = String(match[1]).trim().toLowerCase() || communicationStyle;
    }
  } catch {
    // Fall back to defaults when persona files are unavailable.
  }
  const value = {
    assistantName: assistantName || "Nova",
    tone: normalizePersonaTone(tone),
    communicationStyle: communicationStyle || "friendly",
  };
  personaMetaCache.set(cacheKey, { ts: now, value });
  return value;
}

function hashSeed(value) {
  const input = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function selectVariant(variants, seed) {
  if (!Array.isArray(variants) || variants.length === 0) return "";
  const index = seed % variants.length;
  return String(variants[index] || "");
}

function buildPnlPersonalityComment({
  estimatedTotalUsd,
  recentNetNotionalUsd,
  includeRecentNetCashFlow,
  normalizedInput,
  userContextId,
  workspaceDir,
  transactionCount,
  valuedAssetCount,
  freshnessMs,
}) {
  if (!includeRecentNetCashFlow) return "";
  if (!PERSONALITY_PNL_TRIGGER_REGEX.test(String(normalizedInput || ""))) return "";
  const total = Number(estimatedTotalUsd);
  const recentNet = Number(recentNetNotionalUsd);
  const txCount = Number(transactionCount);
  const pricedAssetCount = Number(valuedAssetCount);
  const freshness = Number(freshnessMs);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(recentNet)) return "";
  if (Math.abs(recentNet) < 250) return "";
  if (Number.isFinite(txCount) && txCount < 3) return "";
  if (Number.isFinite(pricedAssetCount) && pricedAssetCount <= 0) return "";
  if (Number.isFinite(freshness) && freshness > 6 * 60 * 60 * 1000) return "";
  const pct = (recentNet / total) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) < PERSONALITY_PNL_THRESHOLD_PCT + 0.05) return "";

  const direction = pct >= 0 ? "up" : "down";
  const cadence = /\bweekly\b/i.test(String(normalizedInput || ""))
    ? "weekly"
    : /\bdaily\b/i.test(String(normalizedInput || ""))
      ? "daily"
      : "report";
  const persona = resolvePersonaMeta({ workspaceDir, userContextId });
  const name = String(persona.assistantName || "Nova").trim() || "Nova";
  const pctText = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  const seed = hashSeed(`${String(userContextId || "")}:${direction}:${cadence}:${persona.tone}:${Math.round(pct * 10)}`);

  const toneVariants = {
    enthusiastic: {
      up: [
        `${name} note (${cadence}): ${pctText} is a strong move up. Momentum is doing you a favor today.`,
        `${name} note (${cadence}): ${pctText} up. That is the kind of curve people screenshot.`,
        `${name} note (${cadence}): ${pctText} green. Clean execution and strong follow-through.`,
      ],
      down: [
        `${name} note (${cadence}): ${pctText}. Rough tape, but this is where discipline beats emotion.`,
        `${name} note (${cadence}): ${pctText} drawdown. Not fun, but survivable with controlled sizing.`,
        `${name} note (${cadence}): ${pctText} down. Keep the plan tighter than the panic.`,
      ],
    },
    calm: {
      up: [
        `${name} note (${cadence}): ${pctText} is a meaningful gain. Solid progress.`,
        `${name} note (${cadence}): ${pctText} up. Nice improvement without overreacting.`,
        `${name} note (${cadence}): ${pctText} positive move. Keep consistency over excitement.`,
      ],
      down: [
        `${name} note (${cadence}): ${pctText} indicates notable pressure. Stay systematic.`,
        `${name} note (${cadence}): ${pctText} down. Reset and focus on risk controls.`,
        `${name} note (${cadence}): ${pctText} drawdown. Patience and process matter most here.`,
      ],
    },
    direct: {
      up: [
        `${name} note (${cadence}): ${pctText}. Strong period. Keep what is working.`,
        `${name} note (${cadence}): ${pctText}. Clear positive acceleration.`,
        `${name} note (${cadence}): ${pctText}. Good result. Do not overtrade it.`,
      ],
      down: [
        `${name} note (${cadence}): ${pctText}. Drawdown is material. Cut noise, manage risk.`,
        `${name} note (${cadence}): ${pctText}. Negative swing. Tighten exposures.`,
        `${name} note (${cadence}): ${pctText}. Protect capital first.`,
      ],
    },
    relaxed: {
      up: [
        `${name} note (${cadence}): ${pctText} up. That is a pretty clean climb.`,
        `${name} note (${cadence}): ${pctText} in the green. Nice lift.`,
        `${name} note (${cadence}): ${pctText} gain. Good vibe, keep it measured.`,
      ],
      down: [
        `${name} note (${cadence}): ${pctText}. Not ideal, but recoveries start with calm decisions.`,
        `${name} note (${cadence}): ${pctText} down. Take a breath and trim the chaos.`,
        `${name} note (${cadence}): ${pctText} drawdown. Keep it steady and deliberate.`,
      ],
    },
    neutral: {
      up: [
        `${name} note (${cadence}): ${pctText} indicates strong positive movement.`,
        `${name} note (${cadence}): ${pctText} gain recorded for this period.`,
        `${name} note (${cadence}): ${pctText} up move is significant.`,
      ],
      down: [
        `${name} note (${cadence}): ${pctText} indicates meaningful negative movement.`,
        `${name} note (${cadence}): ${pctText} drawdown recorded for this period.`,
        `${name} note (${cadence}): ${pctText} down move is significant.`,
      ],
    },
  };

  const toneKey = normalizePersonaTone(persona.tone);
  return selectVariant(toneVariants[toneKey]?.[direction] || toneVariants.neutral[direction], seed);
}

function parseCryptoReportPreferenceDirectives(text, options = {}) {
  const assumeReportContext = options?.assumeReportContext === true;
  const raw = String(text || "").trim();
  const normalized = normalizeCoinbaseCommandText(raw);
  if ((!CRYPTO_REPORT_CONTEXT_REGEX.test(normalized) && !assumeReportContext) || !CRYPTO_REPORT_ACTION_REGEX.test(normalized)) {
    return { ok: false, directives: [], reason: "" };
  }
  const directives = [];
  const cleanAssetPhrase = (value) =>
    String(value || "")
      .split(/\b(?:from|for|in|while|then|also|because|so)\b/i)[0]
      .replace(/[.;]+$/g, "")
      .trim();
  const exceptMatch = raw.match(/exclude\s+all\s+assets\s+except\s+([^\n\r]+)/i);
  if (exceptMatch?.[1]) directives.push(`only_assets: ${cleanAssetPhrase(exceptMatch[1])}`);
  const includeMatch = raw.match(/include\s+assets?\s+([^\n\r]+)/i) || raw.match(/only\s+assets?\s+([^\n\r]+)/i);
  if (includeMatch?.[1]) directives.push(`include_assets: ${cleanAssetPhrase(includeMatch[1])}`);
  const excludeMatch = raw.match(/exclude\s+assets?\s+([^\n\r]+)/i);
  if (excludeMatch?.[1] && !exceptMatch) directives.push(`exclude_assets: ${cleanAssetPhrase(excludeMatch[1])}`);
  const decimalsMatch = raw.match(/(\d+)\s+decimal/i) || raw.match(/decimals?\s*(?:to|=|:)?\s*(\d+)/i);
  if (decimalsMatch?.[1]) directives.push(`decimals: ${Math.max(0, Math.min(8, Number(decimalsMatch[1]) || 2))}`);
  if (/\b(no|hide|omit|remove|exclude|dont\s+want|don't\s+want)\b.*\b(net\s*cash[-\s]?flow|p\s*&?\s*l\s*proxy|pnl\s*proxy|recent\s+net)\b/i.test(raw)) {
    directives.push("include_recent_net_cash_flow: false");
  }
  if (/\b(show|include|keep)\b.*\b(net\s*cash[-\s]?flow|p\s*&?\s*l\s*proxy|pnl\s*proxy|recent\s+net)\b/i.test(raw)) {
    directives.push("include_recent_net_cash_flow: true");
  }
  const hideTimestamp = /\b(no|hide|omit|remove|do\s+not|don't)\b.*\b(timestamps?|time)\b/i.test(raw);
  const showTimestamp = /\b(show|include)\b.*\b(timestamps?|time)\b/i.test(raw);
  if (hideTimestamp) directives.push("include_timestamp: false");
  else if (showTimestamp) directives.push("include_timestamp: true");
  const hideFreshness = /\b(no|hide|omit|remove|do\s+not|don't)\b.*\bfreshness\b/i.test(raw);
  const showFreshness = /\b(show|include)\b.*\bfreshness\b/i.test(raw);
  if (hideFreshness) directives.push("include_freshness: false");
  else if (showFreshness) directives.push("include_freshness: true");
  if (/\biso\s*date\b|\byyyy-mm-dd\b/i.test(raw)) directives.push("date_format: ISO_DATE");
  if (/\bmm\/dd\/yyyy\b|\bdate\s+only\b/i.test(raw)) directives.push("date_format: MM/DD/YYYY");
  const hasActionableDirective = directives.length > 0;
  const hasPreferenceStyleInstruction =
    /\b(from\s+now\s+on|going\s+forward|always|never|remember|default|preference|less\s+technical|plain\s+english)\b/i.test(raw);
  if (hasActionableDirective || hasPreferenceStyleInstruction) directives.push(`rule: ${raw.replace(/[\r\n]+/g, " ").trim()}`);
  return {
    ok: hasActionableDirective || hasPreferenceStyleInstruction,
    directives,
    reason: hasActionableDirective || hasPreferenceStyleInstruction ? "" : "No actionable report preference found.",
  };
}

function upsertCryptoReportPreferences({ userContextId, workspaceDir, directives }) {
  const uid = String(userContextId || "").trim().toLowerCase();
  if (!uid) return { ok: false, error: "Missing user context." };
  const workspaceRoot = String(workspaceDir || "").trim() || process.cwd();
  const userSkillPath = path.join(
    workspaceRoot,
    ".agent",
    "user-context",
    uid,
    "skills",
    "coinbase",
    "SKILL.md",
  );
  const legacyUserPath = path.join(workspaceRoot, ".agent", "user-context", uid, "skills.md");
  const baselinePath = path.join(workspaceRoot, "skills", "coinbase", "SKILL.md");
  const legacyBaselinePath = path.join(workspaceRoot, ".agent", "skills.md");
  const sectionHeader = "## Crypto Report Preferences";
  let content = "";
  try {
    if (fs.existsSync(userSkillPath)) {
      content = fs.readFileSync(userSkillPath, "utf8");
    } else if (fs.existsSync(legacyUserPath)) {
      content = fs.readFileSync(legacyUserPath, "utf8");
    } else if (fs.existsSync(baselinePath)) {
      content = fs.readFileSync(baselinePath, "utf8");
    } else if (fs.existsSync(legacyBaselinePath)) {
      content = fs.readFileSync(legacyBaselinePath, "utf8");
    } else {
      content = "# Nova Skills\n\n";
    }
  } catch {
    content = "# Nova Skills\n\n";
  }
  const lines = content.split(/\r?\n/);
  let sectionStart = lines.findIndex((line) => String(line || "").trim().toLowerCase() === sectionHeader.toLowerCase());
  let sectionEnd = -1;
  if (sectionStart >= 0) {
    for (let i = sectionStart + 1; i < lines.length; i += 1) {
      if (/^##\s+/.test(String(lines[i] || "").trim())) {
        sectionEnd = i;
        break;
      }
    }
    if (sectionEnd < 0) sectionEnd = lines.length;
  } else {
    if (lines.length > 0 && String(lines[lines.length - 1] || "").trim() !== "") lines.push("");
    sectionStart = lines.length;
    lines.push(sectionHeader, "");
    sectionEnd = lines.length;
  }

  const known = new Map();
  const rules = [];
  for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
    const line = String(lines[i] || "").trim();
    if (!line || line.startsWith("#")) continue;
    const kv = line.match(/^([a-z_]+)\s*:\s*(.+)$/i);
    if (kv) {
      const key = kv[1].toLowerCase();
      if (key === "rule") rules.push(`rule: ${kv[2].trim()}`);
      else known.set(key, `${kv[1]}: ${kv[2].trim()}`);
    }
  }

  for (const directiveRaw of directives) {
    const directive = String(directiveRaw || "").trim();
    const kv = directive.match(/^([a-z_]+)\s*:\s*(.+)$/i);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    if (key === "rule") {
      const normalizedRule = `rule: ${kv[2].trim()}`;
      if (!rules.includes(normalizedRule)) rules.push(normalizedRule);
      continue;
    }
    known.set(key, `${kv[1]}: ${kv[2].trim()}`);
  }

  const sectionLines = [
    sectionHeader,
    ...[...known.values()],
    ...rules.slice(-25),
    "",
  ];
  const rebuilt = [
    ...lines.slice(0, sectionStart),
    ...sectionLines,
    ...lines.slice(sectionEnd),
  ].join("\n");
  fs.mkdirSync(path.dirname(userSkillPath), { recursive: true });
  fs.writeFileSync(userSkillPath, rebuilt, "utf8");
  return { ok: true, filePath: userSkillPath, applied: directives };
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

function buildReportRepeatPrefix(text) {
  const normalized = normalizeCoinbaseCommandText(text);
  if (!REPORT_REPEAT_CUE_REGEX.test(normalized)) return "";
  if (/\b(last\s+one|one\s+more\s+time|again)\b/i.test(normalized)) return "Refreshed report:\n";
  return "Updated report:\n";
}

function buildStatusReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("status", payload);
  const caps = payload.capabilities || {};
  return [
    `Coinbase status: ${String(caps.status || "unknown")}.`,
    `Capabilities: market=${String(caps.marketData || "unknown")}, portfolio=${String(caps.portfolio || "unknown")}, transactions=${String(caps.transactions || "unknown")}.`,
    `Checked: ${formatTimestamp(payload.checkedAtMs)}.`,
    "Commands: price <ticker>, portfolio, recent transactions, my crypto report, weekly pnl.",
  ].join("\n");
}

function buildPriceReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("price", payload);
  const data = payload.data || {};
  const pair = String(data.symbolPair || "").trim() || "unknown pair";
  return [
    `${pair} now: ${formatUsdAmount(data.price)}.`,
    `Freshness: ${formatFreshness(data.freshnessMs)}.`,
    `Source: ${String(payload.source || data.source || "coinbase")}.`,
  ].join("\n");
}

function buildPortfolioReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("portfolio", payload);
  const data = payload.data || {};
  const summary = payload.summary || {};
  const balances = Array.isArray(data.balances) ? data.balances : [];
  const nonZero = balances.filter((entry) => Number(entry?.total || 0) > 0);
  const estimatedTotalUsd = Number(summary.estimatedTotalUsd);
  const valuedAssetCount = Number(summary.valuedAssetCount || 0);
  const activeAssetCount = Number(summary.assetCount || nonZero.length);
  const top = nonZero.slice(0, 5).map((entry) => {
    const symbol = String(entry.assetSymbol || "asset").toUpperCase();
    const total = Number(entry.total || 0);
    return `- ${symbol}: ${Number.isFinite(total) ? total.toLocaleString("en-US", { maximumFractionDigits: 8 }) : "n/a"}`;
  });
  return [
    `Coinbase portfolio snapshot (${nonZero.length} active assets).`,
    Number.isFinite(estimatedTotalUsd)
      ? `- Estimated total balance (USD): ${formatUsdAmount(estimatedTotalUsd)}${valuedAssetCount > 0 ? ` (${valuedAssetCount}/${activeAssetCount || valuedAssetCount} assets priced)` : ""}`
      : "",
    top.length > 0 ? top.join("\n") : "- No non-zero balances found.",
    `Freshness: ${formatFreshness(data.freshnessMs)}.`,
    `Source: ${String(payload.source || data.source || "coinbase")}.`,
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
    `Freshness: ${formatFreshness(payload.freshnessMs)}.`,
    `Source: ${String(payload.source || "coinbase")}.`,
  ].join("\n");
}

function buildReportReply(payload, context = {}) {
  if (!payload?.ok) return buildSafeFailureReply("report", payload);
  const report = payload.report || {};
  const rendered = String(report.rendered || "")
    .split("\n")
    .filter((line) => !/^\s*timestamp\s*:/i.test(String(line || "")))
    .join("\n")
    .trim();
  const hasRenderedPersonalityComment = /\bnote\s*\((?:daily|weekly|report)\)\s*:/i.test(rendered);
  const summary = report.summary || {};
  const recentFlowUpAssets = Number(summary.recentFlowUpAssets || 0);
  const recentFlowDownAssets = Number(summary.recentFlowDownAssets || 0);
  const estimatedTotalUsd = Number(summary.estimatedTotalUsd);
  const valuedAssetCount = Number(summary.valuedAssetCount || 0);
  const totalActiveAssets = Number(summary.nonZeroAssetCount || 0);
  const recentNetNotionalUsd = Number(summary.recentNetNotionalUsd);
  const transactionsUnavailableReason = String(summary.transactionsUnavailableReason || "").trim();
  const includeRecentNetCashFlow = summary.includeRecentNetCashFlow !== false;
  const decimalPlaces = Math.max(0, Math.min(8, Math.floor(Number(summary.decimalPlaces || 2))));
  const enrichedLines = [
    Number.isFinite(estimatedTotalUsd)
      ? `- Estimated total balance (USD): ${formatUsdAmount(estimatedTotalUsd, decimalPlaces)}${valuedAssetCount > 0 ? ` (${valuedAssetCount}/${totalActiveAssets || valuedAssetCount} assets priced)` : ""}`
      : "",
    `- Up positions (recent buy flow): ${Math.max(0, recentFlowUpAssets)}`,
    `- Down positions (recent sell flow): ${Math.max(0, recentFlowDownAssets)}`,
    includeRecentNetCashFlow && Number.isFinite(recentNetNotionalUsd)
      ? `- Recent net cash-flow PnL proxy: ${formatUsdAmount(recentNetNotionalUsd, decimalPlaces)}`
      : "",
    hasRenderedPersonalityComment
      ? ""
      : buildPnlPersonalityComment({
          estimatedTotalUsd,
          recentNetNotionalUsd,
          includeRecentNetCashFlow,
          normalizedInput: context.normalizedInput || "",
          userContextId: context.userContextId || "",
          workspaceDir: context.workspaceDir || "",
          transactionCount: summary.transactionCount,
          valuedAssetCount,
          freshnessMs: report?.portfolio?.freshnessMs,
        }),
    transactionsUnavailableReason ? `- Note: ${transactionsUnavailableReason}` : "",
  ].filter(Boolean);
  if (rendered) {
    if (enrichedLines.length === 0) return rendered;
    return `${rendered}\n${enrichedLines.join("\n")}`;
  }
  const portfolio = report.portfolio || {};
  return [
    "Coinbase crypto report:",
    `- Active assets: ${Number(summary.nonZeroAssetCount || 0)}`,
    `- Recent transactions included: ${Number(summary.transactionCount || 0)}`,
    `- Freshness: ${formatFreshness(portfolio.freshnessMs)}`,
    `- Source: ${String(payload.source || "coinbase")}`,
  ].join("\n");
}

export async function tryCryptoFastPathReply({
  text,
  runtimeTools,
  availableTools,
  userContextId,
  conversationId,
  workspaceDir,
}) {
  const normalizedUserContextId = String(userContextId || "").trim();
  if (!normalizedUserContextId) {
    return {
      reply: "I couldn't verify crypto data because user context is missing. Retry from your Nova account session.",
      source: "validation",
    };
  }
  const normalizedInput = normalizeCoinbaseCommandText(text);
  if (shouldDeferCryptoFastPathToMissionBuilder(normalizedInput)) {
    return { reply: "", source: "" };
  }
  const followUpKey = getCoinbaseFollowUpKey(normalizedUserContextId, conversationId);
  const followUpState = readCoinbaseFollowUpState(followUpKey);
  const shortTermTurn = applyShortTermContextTurnClassification({
    userContextId: normalizedUserContextId,
    conversationId,
    domainId: "crypto",
    text: normalizedInput,
  });
  const topicAffinity = readCryptoTopicAffinity(normalizedUserContextId, conversationId);
  const topicSlots = topicAffinity?.slots && typeof topicAffinity.slots === "object" ? topicAffinity.slots : {};
  const missionAffinity = readShortTermContextState({
    userContextId: normalizedUserContextId,
    conversationId,
    domainId: "mission_task",
  });
  const assistantAffinity = readShortTermContextState({
    userContextId: normalizedUserContextId,
    conversationId,
    domainId: "assistant",
  });
  const missionContextIsNewer = Number(missionAffinity?.ts || 0) > Number(topicAffinity?.ts || 0);
  const assistantContextIsNewer = Number(assistantAffinity?.ts || 0) > Number(topicAffinity?.ts || 0);
  const sameConversationAffinity =
    topicAffinity && String(topicAffinity.conversationId || "").trim() === String(conversationId || "").trim();
  const contextualCryptoFollowUp = sameConversationAffinity && CONTEXTUAL_REPORT_FOLLOWUP_REGEX.test(normalizedInput);
  const isCryptoRequest = isCryptoRequestText(text) || contextualCryptoFollowUp;
  if (!isCryptoRequest) {
    if (shortTermTurn.isCancel) {
      clearCryptoTopicAffinity(normalizedUserContextId, conversationId);
      return { reply: "Okay, cleared the current crypto follow-up context.", source: "followup" };
    }
    if (shortTermTurn.isNewTopic) {
      clearCryptoTopicAffinity(normalizedUserContextId, conversationId);
      return { reply: "", source: "" };
    }
    if (sameConversationAffinity && FOLLOW_UP_REMOVE_RECALL_REGEX.test(normalizedInput)) {
      const removed = Array.isArray(topicSlots?.removedSections) ? topicSlots.removedSections : [];
      if (removed.length > 0) {
        updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
          topicAffinityId: "crypto_report_followup",
        });
        return {
          reply: `You asked me to remove: ${removed.join(", ")}.`,
          source: "coinbase_followup",
        };
      }
    }
    if (missionContextIsNewer || assistantContextIsNewer) {
      return { reply: "", source: "" };
    }
    if (
      sameConversationAffinity
      && /\b(total|balance|pnl|profit|loss|worth|value|price)\b/i.test(normalizedInput)
      && (
        String(topicSlots?.lastReportReply || "").trim().length > 0
        || /\b(report|portfolio|price|transactions|assist)\b/i.test(String(topicSlots?.intent || ""))
      )
    ) {
      const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_portfolio_report", {
        userContextId: normalizedUserContextId,
        conversationId: String(conversationId || "").trim(),
        transactionLimit: 8,
        mode: "concise",
      });
      updateCoinbaseFollowUpState(followUpKey, payload);
      const reportReply = buildReportReply(payload, {
        normalizedInput,
        userContextId: normalizedUserContextId,
        workspaceDir,
      });
      updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
        topicAffinityId: "crypto_report_followup",
        intent: "report",
        lastReportMode: "concise",
        lastReportReply: String(reportReply || "").trim(),
      });
      return { reply: reportReply, source: "coinbase_followup", toolCall: "coinbase_portfolio_report" };
    }
    if (sameConversationAffinity && shortTermTurn.isNonCriticalFollowUp && String(topicSlots?.intent || "") === "report") {
      const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_portfolio_report", {
        userContextId: normalizedUserContextId,
        conversationId: String(conversationId || "").trim(),
        transactionLimit: 8,
        mode: FOLLOW_UP_DETAIL_REGEX.test(normalizedInput) ? "detailed" : String(topicSlots?.lastReportMode || "concise"),
      });
      updateCoinbaseFollowUpState(followUpKey, payload);
      const reportReply = buildReportReply(payload, {
        normalizedInput,
        userContextId: normalizedUserContextId,
        workspaceDir,
      });
      const detailedRequested = FOLLOW_UP_DETAIL_REGEX.test(normalizedInput);
      if (!payload?.ok && detailedRequested && String(topicSlots?.lastReportReply || "").trim()) {
        return {
          reply: `Detailed report refresh is unavailable right now. Last known report:\n${String(topicSlots.lastReportReply).trim()}`,
          source: "coinbase_followup",
          toolCall: "coinbase_portfolio_report",
        };
      }
      updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
        topicAffinityId: "crypto_report_followup",
        intent: "report",
        lastReportMode: FOLLOW_UP_DETAIL_REGEX.test(normalizedInput) ? "detailed" : String(topicSlots?.lastReportMode || "concise"),
        lastReportReply: String(reportReply || "").trim(),
      });
      return { reply: reportReply, source: "coinbase_followup", toolCall: "coinbase_portfolio_report" };
    }
    if (followUpState && (COINBASE_CONSENT_AFFIRM_REGEX.test(normalizedInput) || COINBASE_WHY_REGEX.test(normalizedInput))) {
      return { reply: buildFollowUpReplyFromState(followUpState), source: "coinbase_followup" };
    }
    return { reply: "", source: "" };
  }

  const prefsCommand = parseCryptoReportPreferenceDirectives(text, { assumeReportContext: sameConversationAffinity });
  if (prefsCommand.ok) {
    try {
      const persisted = upsertCryptoReportPreferences({
        userContextId: normalizedUserContextId,
        workspaceDir,
        directives: prefsCommand.directives,
      });
      if (!persisted.ok) {
        return { reply: "I couldn't save your crypto report preferences yet. Retry once.", source: "preference" };
      }
      const applied = persisted.applied.filter((line) => !/^rule:/i.test(String(line || "")));
      const removedSections = mergeRemovedSections(topicSlots?.removedSections, applied);
      updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
        topicAffinityId: "crypto_report_preferences",
        intent: "report",
        lastReportMode: String(topicSlots?.lastReportMode || "concise"),
        lastPreferenceDirectives: applied.slice(-12),
        removedSections,
      });
      return {
        reply: [
          "Saved your crypto report preferences for this user profile.",
          applied.length > 0 ? `Applied: ${applied.join(" | ")}` : "Applied: custom rule stored.",
          "Future crypto reports will use these defaults unless you change them.",
        ].join("\n"),
        source: "preference",
      };
    } catch {
      return { reply: "I couldn't save your crypto report preferences yet. Retry once.", source: "preference" };
    }
  }

  if (sameConversationAffinity && FOLLOW_UP_REMOVE_RECALL_REGEX.test(normalizedInput)) {
    const removed = Array.isArray(topicSlots?.removedSections) ? topicSlots.removedSections : [];
    if (removed.length > 0) {
      updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
        topicAffinityId: "crypto_report_followup",
      });
      return {
        reply: `You asked me to remove: ${removed.join(", ")}.`,
        source: "coinbase_followup",
      };
    }
  }
  if (
    sameConversationAffinity
    && FOLLOW_UP_DETAIL_REGEX.test(normalizedInput)
    && /\b(report|portfolio|assist)\b/i.test(String(topicSlots?.intent || ""))
  ) {
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_portfolio_report", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
      transactionLimit: 8,
      mode: "detailed",
    });
    updateCoinbaseFollowUpState(followUpKey, payload);
    let reportReply = buildReportReply(payload, {
      normalizedInput,
      userContextId: normalizedUserContextId,
      workspaceDir,
    });
    if (!payload?.ok && String(topicSlots?.lastReportReply || "").trim()) {
      reportReply = `Detailed report refresh is unavailable right now. Last known report:\n${String(topicSlots.lastReportReply).trim()}`;
    }
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_report_followup",
      intent: "report",
      lastReportMode: "detailed",
      lastReportReply: String(reportReply || "").trim(),
    });
    return { reply: reportReply, source: "coinbase_followup", toolCall: "coinbase_portfolio_report" };
  }

  const intent = inferCryptoIntent(text);
  const forceReportByContext =
    sameConversationAffinity
    && /\b(report|summary|pnl|concise|detailed|detail|freshness|timestamp|format|again|rerun|refresh)\b/i.test(normalizedInput);
  const shouldPromoteToReport =
    sameConversationAffinity
    && /\b(total|balance|worth|value|portfolio|account)\b/i.test(normalizedInput)
    && /\b(price|it|that|this)\b/i.test(normalizedInput)
    && /\b(assist|report|portfolio)\b/i.test(String(topicSlots?.intent || ""));
  const effectiveIntent = (shouldPromoteToReport || forceReportByContext) ? "report" : intent;
  if (effectiveIntent === "assist") {
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_assist",
      intent: "assist",
    });
    return {
      reply: buildCryptoConciergeReply(),
      source: "coinbase",
    };
  }
  if (shortTermTurn.isCancel) {
    clearCryptoTopicAffinity(normalizedUserContextId, conversationId);
    return { reply: "Okay, cleared the current crypto follow-up context.", source: "followup" };
  }
  if (/\b(buy|sell|trade|swap|transfer|withdraw|deposit)\b/i.test(normalizedInput)) {
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_policy",
      intent: "policy",
    });
    return {
      reply: "Coinbase trade/transfer execution is out of scope in Nova v1. I can help with read-only prices, portfolio, transactions, and reports.",
      source: "policy",
    };
  }
  if (/\bweekly\s+report\b/i.test(normalizedInput) && !/\b(pnl|portfolio|crypto)\b/i.test(normalizedInput)) {
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_report_clarify",
      intent: "report",
    });
    return {
      reply: "Do you want a weekly portfolio report or weekly PnL report?",
      source: "clarify",
    };
  }
  const category = effectiveIntent === "report" ? "reports" : effectiveIntent;
  const rollout = resolveCoinbaseRolloutAccessForFastPath(normalizedUserContextId);
  if (!rollout.enabled) {
    return {
      reply: `Coinbase is not enabled for this user cohort yet (stage=${rollout.stage}, reason=${rollout.reason}). Support: ${rollout.supportChannel}.`,
      source: "policy",
    };
  }
  const enabledCategories = resolveEnabledCoinbaseCommandCategories();
  if (!enabledCategories.has(category)) {
    return {
      reply: `Coinbase ${category} commands are currently disabled by admin policy. Ask an admin to enable category "${category}" via NOVA_COINBASE_COMMAND_CATEGORIES.`,
      source: "policy",
    };
  }
  if (effectiveIntent === "status") {
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_capabilities", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
    });
    updateCoinbaseFollowUpState(followUpKey, payload);
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_status",
      intent: "status",
    });
    return { reply: buildStatusReply(payload), source: "coinbase", toolCall: "coinbase_capabilities" };
  }

  if (effectiveIntent === "price") {
    if (/\b(price\s+usd|usd\s+price)\b/i.test(normalizedInput)) {
      return {
        reply: "USD is the quote currency, not the crypto asset target. Share the crypto ticker (for example BTC or ETH).",
        source: "validation",
      };
    }
    const symbolResolution = extractPriceSymbol(text);
    if (symbolResolution.status === "ambiguous" && symbolResolution.suggestion) {
      return {
        reply: `I am not fully confident on the ticker. Did you mean ${symbolResolution.suggestion}? Send that symbol/pair exactly and I will fetch it.`,
        source: "clarify",
      };
    }
    if (symbolResolution.status !== "resolved" || !symbolResolution.symbolPair) {
      return {
        reply: buildMissingPriceTargetReply(),
        source: "validation",
      };
    }
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_spot_price", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
      symbolPair: symbolResolution.symbolPair,
    });
    updateCoinbaseFollowUpState(followUpKey, payload);
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_price",
      intent: "price",
      lastSymbolPair: symbolResolution.symbolPair,
    });
    return { reply: buildPriceReply(payload), source: "coinbase", toolCall: "coinbase_spot_price" };
  }

  if (effectiveIntent === "portfolio") {
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_portfolio_snapshot", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
    });
    updateCoinbaseFollowUpState(followUpKey, payload);
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_portfolio",
      intent: "portfolio",
    });
    return { reply: buildPortfolioReply(payload), source: "coinbase", toolCall: "coinbase_portfolio_snapshot" };
  }

  if (effectiveIntent === "transactions") {
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_recent_transactions", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
      limit: 6,
    });
    updateCoinbaseFollowUpState(followUpKey, payload);
    updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
      topicAffinityId: "crypto_transactions",
      intent: "transactions",
    });
    return { reply: buildTransactionsReply(payload), source: "coinbase", toolCall: "coinbase_recent_transactions" };
  }

  const reportMode = /\b(detailed|full|expanded)\b/i.test(normalizedInput) ? "detailed" : "concise";
  const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_portfolio_report", {
    userContextId: normalizedUserContextId,
    conversationId: String(conversationId || "").trim(),
    transactionLimit: 8,
    mode: reportMode,
  });
  updateCoinbaseFollowUpState(followUpKey, payload);
  let reportReply = buildReportReply(payload, {
    normalizedInput,
    userContextId: normalizedUserContextId,
    workspaceDir,
  });
  if (!payload?.ok && String(topicSlots?.lastReportReply || "").trim()) {
    reportReply = [
      "Live refresh is unavailable right now. Showing your last known report:",
      String(topicSlots.lastReportReply).trim(),
    ].join("\n");
  }
  const repeatPrefix = buildReportRepeatPrefix(text);
  if (repeatPrefix && String(reportReply || "").trim()) {
    reportReply = `${repeatPrefix}${String(reportReply || "").trim()}`;
  }
  updateCryptoTopicAffinity(normalizedUserContextId, conversationId, {
    topicAffinityId: "crypto_report",
    intent: "report",
    lastReportMode: reportMode,
    lastReportReply: String(reportReply || "").trim(),
  });
  return { reply: reportReply, source: "coinbase", toolCall: "coinbase_portfolio_report" };
}
