export const CRYPTO_MARKER_REGEX =
  /\b(coinbase|crypto|bitcoin|ethereum|solana|cardano|dogecoin|ripple|litecoin|btc|eth|sol|xrp|ada|doge|ltc|usdt|usdc|eurc)\b/i;

export const PRICE_INTENT_REGEX = /\b(price|quote|worth|rate|market\s+price|how much)\b/i;
export const PORTFOLIO_INTENT_REGEX = /\b(portfolio|holdings?|balances?|account|net\s*worth|assets?)\b/i;
export const TRANSACTION_INTENT_REGEX = /\b(transactions?|trades?|fills?|activity|history)\b/i;
export const REPORT_INTENT_REGEX = /\b(report|summary|pnl|profit|loss|weekly|daily)\b/i;
export const STATUS_INTENT_REGEX = /\b(status|connected|connection|capabilities?|scopes?)\b/i;
export const CODING_INTENT_REGEX = /\b(refactor|debug|fix|function|class|module|typescript|javascript|python|sql|unit\s*test|edge\s*cases?|jest|vitest|mocha|runtime)\b/i;
export const CRYPTO_CONVERSATIONAL_OPEN_REGEX =
  /\b(help|talk|chat|start|overview|walk\s+me\s+through|check\s+in|review|look\s+at)\b.*\b(crypto|coinbase|portfolio|holdings?)\b|\b(my|our)\s+crypto\b/i;
export const EXPLICIT_CRYPTO_ACTION_REGEX =
  /\b(price|quote|ticker|portfolio|holdings?|balances?|transactions?|activity|history|report|summary|pnl|profit|loss|status|connected|connection|capabilities?|weekly|daily|buy|sell|trade|swap|transfer|withdraw|deposit)\b/i;
export const COMMAND_CUE_REGEX =
  /\b(price|portfolio|holdings?|transactions?|activity|crypto\s+help|coinbase\s+status|weekly\s+report|weekly\s+pnl|daily\s+report|daily\s+crypto\s+(?:report|summary|update)|my\s+crypto\s+report|transfer\s+funds|buy\s+[a-z0-9]{2,10})\b/i;
export const COINBASE_FOLLOW_UP_TTL_MS = 8 * 60 * 1000;
export const COINBASE_WHY_REGEX = /\b(why|what(?:'s| is)\s+wrong|what\s+happened)\b/i;
export const COINBASE_CONSENT_AFFIRM_REGEX =
  /\b(you\s+have\s+consent|consent\s+(?:is\s+)?granted|i\s+(?:already\s+)?(?:gave|grant(?:ed)?|enabled)\s+consent|consent\s+is\s+on)\b/i;
export const CRYPTO_REPORT_CONTEXT_REGEX =
  /\b(crypto|coinbase)\b.*\b(reports?|summar(?:y|ies)|pnl)\b|\b(reports?|summar(?:y|ies)|pnl)\b.*\b(crypto|coinbase)\b|\bmy\s+crypto\s+reports?\b|\b(daily|weekly)\s+report\b/i;
export const CRYPTO_REPORT_ACTION_REGEX =
  /\b(set|make|change|customize|format|show|hide|include|exclude|only|round|remove|omit|always|never|remember|from\s+now\s+on)\b/i;
export const EXPLICIT_CRYPTO_REPORT_REGEX =
  /\b(daily\s+report\s+of\s+crypto|daily\s+crypto\s+(?:report|summary|update)|coinbase\s+daily\s+report|my\s+crypto\s+report|crypto\s+report|coinbase\s+report|portfolio\s+report|daily\s+pnl|weekly\s+pnl|weekly\s+report)\b/i;
export const REPORT_REPEAT_CUE_REGEX = /\b(again|rerun|refresh|repeat|same\s+report)\b/i;
export const FOLLOW_UP_REMOVE_RECALL_REGEX =
  /\bwhat\s+did\s+i\s+(?:just\s+)?ask\s+you\s+to\s+remove\b(?:.*\breport\b)?/i;
export const FOLLOW_UP_DETAIL_REGEX = /\b(more\s+detail|detailed|expand|expanded|drill\s+down|break\s*down)\b/i;
export const CONTEXTUAL_REPORT_FOLLOWUP_REGEX =
  /\b(reports?|summary|pnl|concise|detailed|detail|freshness|timestamps?|format|again|rerun|refresh|plain\s+english|less\s+technical)\b/i;
export const PERSONALITY_PNL_TRIGGER_REGEX = /\b(daily|weekly|pnl|profit|loss|p\s*&?\s*l)\b/i;
export const PERSONALITY_PNL_THRESHOLD_PCT = 10;
export const MISSION_CUE_REGEX =
  /\b(mission|workflow|automation|schedule|scheduled|briefing|brief|digest|build)\b/i;
export const NON_CRYPTO_TOPIC_CUE_REGEX =
  /\b(nba|nfl|mlb|nhl|weather|forecast|quote|quotes|inspirational|motivational|tech|technology|news|headline|article|recap|story)\b/i;

export const SYMBOL_ALIASES = {
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

export const KNOWN_SYMBOLS = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "LTC", "USDT", "USDC", "EURC", "AVAX", "DOT", "MATIC", "LINK", "ATOM", "XLM", "ALGO", "TRX", "NEAR", "APT", "ARB", "OP", "FIL", "AAVE", "SUI", "SHIB"];
export const CRYPTO_PRICE_STOP_WORDS = new Set([
  "coinbase", "crypto", "price", "quote", "worth", "how", "much", "is", "my", "portfolio", "report", "transactions",
  "transaction", "status", "the", "a", "an", "for", "of", "to", "in", "on", "and", "what", "whats", "current",
  "today", "now", "please", "show", "me",
]);
