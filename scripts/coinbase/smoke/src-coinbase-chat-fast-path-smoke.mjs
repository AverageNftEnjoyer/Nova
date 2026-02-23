import assert from "node:assert/strict";

import { isCryptoRequestText, tryCryptoFastPathReply } from "../../../src/runtime/modules/chat/fast-path/crypto-fast-path.js";
import { normalizeCoinbaseCommandText, parseCoinbaseCommand } from "../../../src/runtime/modules/chat/fast-path/coinbase-command-parser.js";

const availableTools = [
  { name: "coinbase_capabilities" },
  { name: "coinbase_spot_price" },
  { name: "coinbase_portfolio_snapshot" },
  { name: "coinbase_recent_transactions" },
  { name: "coinbase_portfolio_report" },
];

const runtimeTools = {
  calls: [],
  async executeToolUse(toolUse) {
    this.calls.push({
      name: String(toolUse?.name || ""),
      userContextId: String(toolUse?.input?.userContextId || ""),
      conversationId: String(toolUse?.input?.conversationId || ""),
      symbolPair: String(toolUse?.input?.symbolPair || ""),
    });
    const name = String(toolUse?.name || "");
    if (name === "coinbase_spot_price") {
      return {
        content: JSON.stringify({
          ok: true,
          kind: "coinbase_spot_price",
          source: "coinbase",
          confidence: "high",
          data: {
            symbolPair: "BTC-USD",
            price: 100000.25,
            fetchedAtMs: Date.now(),
            freshnessMs: 1200,
          },
        }),
      };
    }
    if (name === "coinbase_portfolio_snapshot") {
      return {
        content: JSON.stringify({
          ok: false,
          kind: "coinbase_portfolio_snapshot",
          source: "coinbase",
          errorCode: "AUTH_UNSUPPORTED",
          safeMessage: "I couldn't verify Coinbase portfolio because private Coinbase auth is not enabled in this runtime yet.",
          guidance: "Spot prices are available; portfolio and transactions need private-endpoint auth strategy wiring.",
        }),
      };
    }
    if (name === "coinbase_capabilities") {
      return {
        content: JSON.stringify({
          ok: true,
          kind: "coinbase_capabilities",
          source: "coinbase",
          checkedAtMs: Date.now(),
          capabilities: {
            status: "connected",
            marketData: "available",
            portfolio: "degraded",
            transactions: "degraded",
          },
        }),
      };
    }
    if (name === "coinbase_portfolio_report") {
      return {
        content: JSON.stringify({
          ok: true,
          kind: "coinbase_portfolio_report",
          source: "coinbase",
          report: {
            summary: {
              nonZeroAssetCount: 3,
              transactionCount: 8,
            },
            portfolio: {
              fetchedAtMs: Date.now(),
            },
          },
        }),
      };
    }
    return { content: JSON.stringify({ ok: false, errorCode: "UNKNOWN_TOOL" }) };
  },
};

assert.equal(isCryptoRequestText("nova price btc"), true, "crypto intent should detect ticker price");
assert.equal(isCryptoRequestText("how much is avax"), true, "crypto intent should detect known symbol with price intent");
assert.equal(isCryptoRequestText("price bitcoin"), true, "crypto intent should detect alias with price intent");
assert.equal(isCryptoRequestText("what is the weather in pittsburgh"), false, "weather should not trigger crypto intent");
assert.equal(
  isCryptoRequestText("Rate your confidence (0-100) on your summary accuracy and explain briefly."),
  false,
  "generic confidence/rating language must not trigger crypto intent",
);
assert.equal(
  isCryptoRequestText("Can you rate this plan from 1 to 10?"),
  false,
  "generic scoring language must not trigger crypto intent",
);
assert.equal(
  isCryptoRequestText("What retry rate should websocket reconnect use?"),
  false,
  "engineering 'rate' wording must not trigger crypto intent",
);
assert.equal(normalizeCoinbaseCommandText("nova wekly pNl"), "weekly pnl", "typo normalization should be deterministic");
assert.equal(parseCoinbaseCommand("my crypto report").intent, "report", "alias should route report intent");
assert.equal(parseCoinbaseCommand("portfolio").intent, "portfolio", "alias should route portfolio intent");
assert.equal(parseCoinbaseCommand("price btc").intent, "price", "alias should route price intent");

const priceReply = await tryCryptoFastPathReply({
  text: "nova what's the price of btc",
  runtimeTools,
  availableTools,
  userContextId: "u1",
  conversationId: "c1",
});
assert.match(String(priceReply.reply || ""), /BTC-USD now:/i, "price reply should include canonical pair");
assert.match(String(priceReply.reply || ""), /Freshness:/i, "price reply should include freshness metadata");
assert.match(String(priceReply.reply || ""), /Source:/i, "price reply should include source metadata");

const ambiguousReply = await tryCryptoFastPathReply({
  text: "coinbase price btx",
  runtimeTools,
  availableTools,
  userContextId: "u1",
  conversationId: "c1",
});
assert.match(String(ambiguousReply.reply || ""), /not fully confident/i, "ambiguous ticker should ask clarifying question");

const portfolioReply = await tryCryptoFastPathReply({
  text: "portfolo",
  runtimeTools,
  availableTools,
  userContextId: "u1",
  conversationId: "c1",
});
assert.match(String(portfolioReply.reply || ""), /couldn't verify/i, "portfolio auth failure should be explicit no-verify");

const reportAliasReply = await tryCryptoFastPathReply({
  text: "my crypto report",
  runtimeTools,
  availableTools,
  userContextId: "u1",
  conversationId: "c1",
});
assert.match(String(reportAliasReply.reply || ""), /crypto report/i, "report alias should resolve to report flow");

const weeklyPnlReply = await tryCryptoFastPathReply({
  text: "weekly pnl",
  runtimeTools,
  availableTools,
  userContextId: "u2",
  conversationId: "c2",
});
assert.match(String(weeklyPnlReply.reply || ""), /crypto report/i, "weekly pnl alias should resolve to report flow");

const previousDisabledCategories = process.env.NOVA_COINBASE_DISABLED_COMMAND_CATEGORIES;
process.env.NOVA_COINBASE_DISABLED_COMMAND_CATEGORIES = "reports";
const blockedReportReply = await tryCryptoFastPathReply({
  text: "my crypto report",
  runtimeTools,
  availableTools,
  userContextId: "u1",
  conversationId: "c1",
});
if (previousDisabledCategories === undefined) delete process.env.NOVA_COINBASE_DISABLED_COMMAND_CATEGORIES;
else process.env.NOVA_COINBASE_DISABLED_COMMAND_CATEGORIES = previousDisabledCategories;
assert.match(String(blockedReportReply.reply || ""), /disabled by admin policy/i, "disabled report category should fail closed");

const cryptoHelpReply = await tryCryptoFastPathReply({
  text: "crypto help",
  runtimeTools,
  availableTools,
  userContextId: "u1",
  conversationId: "c1",
});
assert.match(String(cryptoHelpReply.reply || ""), /Commands:/i, "crypto help should include supported commands guidance");

const mixedMissionReply = await tryCryptoFastPathReply({
  text: "build me a morning mission with nba recap, inspirational quote, sui price, and a tech headline",
  runtimeTools,
  availableTools,
  userContextId: "u1",
  conversationId: "c1",
});
assert.equal(String(mixedMissionReply.reply || "").trim(), "", "mixed mission prompt should defer to mission builder, not coinbase fast-path");

assert.equal(runtimeTools.calls.some((call) => call.userContextId === "u1"), true, "tool calls should include first userContextId");
assert.equal(runtimeTools.calls.some((call) => call.userContextId === "u2"), true, "tool calls should include second userContextId");
assert.equal(runtimeTools.calls.every((call) => call.userContextId.length > 0), true, "tool calls should never drop userContextId");

console.log("[coinbase:chat-fast-path:smoke] crypto routing + confidence + safe failure policy passed.");
