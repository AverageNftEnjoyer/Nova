import assert from "node:assert/strict";

import { isCryptoRequestText, tryCryptoFastPathReply } from "../../src/runtime/modules/chat/crypto-fast-path.js";

const availableTools = [
  { name: "coinbase_capabilities" },
  { name: "coinbase_spot_price" },
  { name: "coinbase_portfolio_snapshot" },
  { name: "coinbase_recent_transactions" },
  { name: "coinbase_portfolio_report" },
];

const runtimeTools = {
  async executeToolUse(toolUse) {
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
    return { content: JSON.stringify({ ok: false, errorCode: "UNKNOWN_TOOL" }) };
  },
};

assert.equal(isCryptoRequestText("nova price btc"), true, "crypto intent should detect ticker price");
assert.equal(isCryptoRequestText("what is the weather in pittsburgh"), false, "weather should not trigger crypto intent");

const priceReply = await tryCryptoFastPathReply({
  text: "nova what's the price of btc",
  runtimeTools,
  availableTools,
  userContextId: "u1",
  conversationId: "c1",
});
assert.match(String(priceReply.reply || ""), /BTC-USD now:/i, "price reply should include canonical pair");
assert.match(String(priceReply.reply || ""), /Freshness:/i, "price reply should include freshness");
assert.match(String(priceReply.reply || ""), /Source: Coinbase spot price\./i, "price reply should include source");

const ambiguousReply = await tryCryptoFastPathReply({
  text: "coinbase price btx",
  runtimeTools,
  availableTools,
  userContextId: "u1",
  conversationId: "c1",
});
assert.match(String(ambiguousReply.reply || ""), /not fully confident/i, "ambiguous ticker should ask clarifying question");

const portfolioReply = await tryCryptoFastPathReply({
  text: "coinbase portfolio",
  runtimeTools,
  availableTools,
  userContextId: "u1",
  conversationId: "c1",
});
assert.match(String(portfolioReply.reply || ""), /couldn't verify/i, "portfolio auth failure should be explicit no-verify");

console.log("[coinbase:chat-fast-path:smoke] crypto routing + confidence + safe failure policy passed.");
