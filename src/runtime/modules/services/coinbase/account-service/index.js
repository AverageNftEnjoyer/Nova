import { describeUnknownError } from "../../../../llm/providers/index.js";
import {
  normalizeCoinbaseCommandText,
  parseCoinbaseCommand,
  resolveEnabledCoinbaseCommandCategories,
} from "../command-parser/index.js";
import { extractPriceSymbol } from "../price-symbol/index.js";
import { resolveCoinbaseRolloutAccess } from "../rollout-policy/index.js";

function parseToolPayload(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return {
      ok: false,
      errorCode: "EMPTY_TOOL_RESPONSE",
      safeMessage: "I couldn't verify Coinbase data right now.",
      guidance: "Retry in a moment.",
    };
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
  }
  return {
    ok: false,
    errorCode: "NON_JSON_TOOL_RESPONSE",
    safeMessage: "I couldn't verify Coinbase data right now.",
    guidance: "Retry in a moment.",
  };
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

async function executeCoinbaseTool(runtimeTools, availableTools, toolName, input) {
  if (typeof runtimeTools?.executeToolUse !== "function") {
    return {
      ok: false,
      errorCode: "TOOL_RUNTIME_UNAVAILABLE",
      safeMessage: "I couldn't verify Coinbase data because the tool runtime is unavailable.",
      guidance: "Retry after Nova runtime initializes tools.",
    };
  }
  const exists = Array.isArray(availableTools) && availableTools.some((tool) => String(tool?.name || "") === toolName);
  if (!exists) {
    return {
      ok: false,
      errorCode: "TOOL_NOT_ENABLED",
      safeMessage: `I couldn't verify Coinbase data because ${toolName} is not enabled.`,
      guidance: "Enable Coinbase tools in NOVA_ENABLED_TOOLS and restart Nova.",
    };
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
      guidance: describeUnknownError(err),
    };
  }
}

function buildSafeFailureReply(actionLabel, payload) {
  const safeMessage = String(payload?.safeMessage || "").trim() || `I couldn't verify live Coinbase ${actionLabel} right now.`;
  const guidance = String(payload?.guidance || "").trim();
  if (guidance) return `${safeMessage}\nNext step: ${guidance}`;
  return `${safeMessage}\nNext step: Retry in a moment.`;
}

function buildStatusReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("status", payload);
  const caps = payload.capabilities || {};
  return [
    `Coinbase status: ${String(caps.status || "unknown")}.`,
    `Capabilities: market=${String(caps.marketData || "unknown")}, portfolio=${String(caps.portfolio || "unknown")}, transactions=${String(caps.transactions || "unknown")}.`,
    `Checked: ${formatTimestamp(payload.checkedAtMs)}.`,
    "Commands: coinbase status, coinbase portfolio, coinbase transactions, coinbase report, coinbase price <ticker>.",
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
  const balances = Array.isArray(data.balances) ? data.balances : [];
  const nonZero = balances.filter((entry) => Number(entry?.total || 0) > 0);
  const top = nonZero.slice(0, 5).map((entry) => {
    const symbol = String(entry.assetSymbol || "asset").toUpperCase();
    const total = Number(entry.total || 0);
    const quantity = Number.isFinite(total)
      ? total.toLocaleString("en-US", { maximumFractionDigits: 8 })
      : "n/a";
    return `- ${symbol}: ${quantity}`;
  });
  return [
    `Coinbase portfolio snapshot (${nonZero.length} active assets).`,
    top.length > 0 ? top.join("\n") : "- No non-zero balances found.",
    `Freshness: ${formatFreshness(data.freshnessMs)}.`,
  ].join("\n");
}

function buildTransactionsReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("transactions", payload);
  const events = Array.isArray(payload.events) ? payload.events : [];
  const top = events.slice(0, 6).map((entry) => {
    const side = String(entry?.side || "trade").toUpperCase();
    const symbol = String(entry?.assetSymbol || "asset").toUpperCase();
    const quantity = Number(entry?.quantity || 0);
    const price = Number(entry?.price || 0);
    return `- ${side} ${Number.isFinite(quantity) ? quantity : "n/a"} ${symbol} @ ${formatUsdAmount(price)}`;
  });
  return [
    `Recent Coinbase transactions (${events.length}).`,
    top.length > 0 ? top.join("\n") : "- No recent transactions found.",
    `Freshness: ${formatFreshness(payload.freshnessMs)}.`,
  ].join("\n");
}

function buildReportReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("report", payload);
  const report = payload.report || {};
  const summary = report.summary || {};
  const portfolio = report.portfolio || {};
  const estimatedTotalUsd = Number(summary.estimatedTotalUsd);
  const transactionCount = Number(summary.transactionCount || 0);
  const nonZeroAssetCount = Number(summary.nonZeroAssetCount || 0);
  return [
    "Coinbase portfolio report:",
    Number.isFinite(estimatedTotalUsd) ? `- Estimated balance: ${formatUsdAmount(estimatedTotalUsd)}` : "- Estimated balance: n/a",
    `- Active assets: ${Number.isFinite(nonZeroAssetCount) ? nonZeroAssetCount : 0}`,
    `- Transactions analyzed: ${Number.isFinite(transactionCount) ? transactionCount : 0}`,
    `- Freshness: ${formatFreshness(portfolio.freshnessMs)}`,
    `- Source: ${String(payload.source || "coinbase")}`,
  ].join("\n");
}

export async function runCoinbaseAccountRequest(input = {}) {
  const {
    text,
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
  } = input;

  const normalizedUserContextId = String(userContextId || "").trim();
  if (!normalizedUserContextId) {
    return {
      ok: false,
      reply: "I couldn't verify Coinbase data because user context is missing. Retry from your Nova account session.",
      errorCode: "COINBASE_USER_CONTEXT_MISSING",
      toolCall: "",
      intent: "",
    };
  }

  const normalizedInput = normalizeCoinbaseCommandText(text);
  const parsedCommand = parseCoinbaseCommand(normalizedInput);
  if (!parsedCommand?.isCrypto) {
    return {
      ok: false,
      reply: "For Coinbase lane actions, ask about status, portfolio, transactions, reports, or price (for example `coinbase price BTC`).",
      errorCode: "COINBASE_INTENT_INVALID",
      toolCall: "",
      intent: "",
    };
  }

  const intent = String(parsedCommand.intent || "status").trim().toLowerCase();
  const category = intent === "report" ? "reports" : intent;
  const rollout = resolveCoinbaseRolloutAccess(normalizedUserContextId);
  if (!rollout.enabled) {
    return {
      ok: false,
      reply: `Coinbase is not enabled for this user cohort yet (stage=${rollout.stage}, reason=${rollout.reason}). Support: ${rollout.supportChannel}.`,
      errorCode: "COINBASE_ROLLOUT_BLOCKED",
      toolCall: "",
      intent,
    };
  }

  const enabledCategories = resolveEnabledCoinbaseCommandCategories();
  if (!enabledCategories.has(category)) {
    return {
      ok: false,
      reply: `Coinbase ${category} commands are currently disabled by admin policy. Ask an admin to enable category "${category}" via NOVA_COINBASE_COMMAND_CATEGORIES.`,
      errorCode: "COINBASE_CATEGORY_DISABLED",
      toolCall: "",
      intent,
    };
  }

  if (intent === "status") {
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_capabilities", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
    });
    return {
      ok: payload?.ok === true,
      reply: buildStatusReply(payload),
      errorCode: payload?.ok ? "" : String(payload?.errorCode || "COINBASE_STATUS_FAILED"),
      toolCall: "coinbase_capabilities",
      intent,
    };
  }

  if (intent === "price") {
    const symbolResolution = extractPriceSymbol(normalizedInput);
    if (symbolResolution.status === "ambiguous" && symbolResolution.suggestion) {
      return {
        ok: false,
        reply: `I am not fully confident on the ticker. Did you mean ${symbolResolution.suggestion}? Send that symbol/pair exactly and I will fetch it.`,
        errorCode: "COINBASE_PRICE_SYMBOL_AMBIGUOUS",
        toolCall: "",
        intent,
      };
    }
    if (symbolResolution.status !== "resolved" || !symbolResolution.symbolPair) {
      return {
        ok: false,
        reply: "I can pull that, but I need the target ticker or pair (for example `BTC` or `BTC-USD`).",
        errorCode: "COINBASE_PRICE_SYMBOL_MISSING",
        toolCall: "",
        intent,
      };
    }
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_spot_price", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
      symbolPair: symbolResolution.symbolPair,
    });
    return {
      ok: payload?.ok === true,
      reply: buildPriceReply(payload),
      errorCode: payload?.ok ? "" : String(payload?.errorCode || "COINBASE_PRICE_FAILED"),
      toolCall: "coinbase_spot_price",
      intent,
    };
  }

  if (intent === "portfolio") {
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_portfolio_snapshot", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
    });
    return {
      ok: payload?.ok === true,
      reply: buildPortfolioReply(payload),
      errorCode: payload?.ok ? "" : String(payload?.errorCode || "COINBASE_PORTFOLIO_FAILED"),
      toolCall: "coinbase_portfolio_snapshot",
      intent,
    };
  }

  if (intent === "transactions") {
    const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_recent_transactions", {
      userContextId: normalizedUserContextId,
      conversationId: String(conversationId || "").trim(),
      limit: 6,
    });
    return {
      ok: payload?.ok === true,
      reply: buildTransactionsReply(payload),
      errorCode: payload?.ok ? "" : String(payload?.errorCode || "COINBASE_TRANSACTIONS_FAILED"),
      toolCall: "coinbase_recent_transactions",
      intent,
    };
  }

  const reportMode = /\b(detailed|full|expanded)\b/i.test(normalizedInput) ? "detailed" : "concise";
  const payload = await executeCoinbaseTool(runtimeTools, availableTools, "coinbase_portfolio_report", {
    userContextId: normalizedUserContextId,
    conversationId: String(conversationId || "").trim(),
    transactionLimit: 8,
    mode: reportMode,
  });
  return {
    ok: payload?.ok === true,
    reply: buildReportReply(payload),
    errorCode: payload?.ok ? "" : String(payload?.errorCode || "COINBASE_REPORT_FAILED"),
    toolCall: "coinbase_portfolio_report",
    intent: "report",
  };
}
