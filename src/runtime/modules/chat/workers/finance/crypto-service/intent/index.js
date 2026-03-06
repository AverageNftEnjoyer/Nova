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
} from "../constants/index.js";
import {
  normalizeCoinbaseCommandText,
  parseCoinbaseCommand,
} from "../../../../../services/coinbase/command-parser/index.js";
import { extractPriceSymbol } from "../../../../../services/coinbase/price-symbol/index.js";

export { extractPriceSymbol };

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

export function shouldDeferCryptoRequestToMissionBuilder(text) {
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
