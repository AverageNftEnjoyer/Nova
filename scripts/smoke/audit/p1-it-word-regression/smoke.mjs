/**
 * Audit P1 regression — "it" word no longer fires coinbase_portfolio_report
 *
 * Bug: /\b(total|balance|pnl|profit|loss|worth|value|price|it)\b/i in the
 * follow-up regex caused ANY message containing "it" after a crypto-active
 * conversation to fire a live portfolio API call.
 *
 * Fix: removed "it" from the regex (crypto-fast-path.js:789).
 *
 * Tests:
 *   A) "can you explain it" after crypto context → zero tool calls
 *   B) "whats my total balance" after crypto context → still fires report
 *   C) "how does it work exactly" (multi-word, only "it") → zero tool calls
 */

import assert from "node:assert/strict";
import { tryCryptoFastPathReply } from "../../../../src/runtime/modules/chat/fast-path/crypto-fast-path/index.js";

const calls = [];

const availableTools = [
  { name: "coinbase_portfolio_report" },
  { name: "coinbase_portfolio_snapshot" },
  { name: "coinbase_spot_price" },
  { name: "coinbase_capabilities" },
];

const runtimeTools = {
  async executeToolUse(toolUse) {
    const name = String(toolUse?.name || "");
    calls.push({ name, input: toolUse?.input || {} });

    if (name === "coinbase_capabilities") {
      return {
        content: JSON.stringify({
          ok: true,
          kind: "coinbase_capabilities",
          source: "coinbase",
          checkedAtMs: Date.now(),
          capabilities: { status: "connected" },
        }),
      };
    }
    if (name === "coinbase_portfolio_report") {
      return {
        content: JSON.stringify({
          ok: true,
          source: "coinbase",
          report: {
            rendered: "Coinbase concise portfolio report\ndate: 02/22/2026\ntop_holdings: BTC: 0.05",
            summary: {
              estimatedTotalUsd: 5000,
              valuedAssetCount: 1,
              nonZeroAssetCount: 1,
              recentFlowUpAssets: 0,
              recentFlowDownAssets: 0,
              includeRecentNetCashFlow: false,
              decimalPlaces: 2,
            },
          },
        }),
      };
    }
    if (name === "coinbase_portfolio_snapshot") {
      return { content: JSON.stringify({ ok: true, data: { balances: [], freshnessMs: 0 } }) };
    }
    return { content: JSON.stringify({ ok: false, errorCode: "UNKNOWN" }) };
  },
};

async function run() {
  const userContextId = `audit-p1-${Date.now()}`;
  const conversationId = `conv-p1-${Date.now()}`;

  // ── Seed crypto affinity by requesting a real crypto report first
  const seed = await tryCryptoFastPathReply({
    text: "show me my coinbase portfolio report",
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
  });
  assert.ok(
    ["coinbase", "coinbase_followup"].includes(String(seed.source || "")),
    `seed should be a coinbase response, got source="${seed.source}"`,
  );

  const callsAfterSeed = calls.length;
  assert.ok(callsAfterSeed > 0, "seed must have made at least one tool call");

  // ── Test A: "can you explain it" — "it" alone must NOT fire portfolio report
  calls.length = 0;
  const explainIt = await tryCryptoFastPathReply({
    text: "can you explain it",
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
  });

  const reportCallsA = calls.filter((c) => c.name === "coinbase_portfolio_report");
  assert.equal(
    reportCallsA.length,
    0,
    `"can you explain it" must NOT fire coinbase_portfolio_report — fired ${reportCallsA.length} time(s). Bug: "it" was in follow-up regex.`,
  );

  // ── Test B: "whats my total balance" — crypto words still fire the follow-up
  calls.length = 0;
  const totalBalance = await tryCryptoFastPathReply({
    text: "whats my total balance",
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
  });

  const reportCallsB = calls.filter((c) => c.name === "coinbase_portfolio_report");
  assert.ok(
    reportCallsB.length >= 1 || ["coinbase", "coinbase_followup"].includes(String(totalBalance.source || "")),
    `"whats my total balance" should still trigger crypto follow-up (has "total" and "balance")`,
  );

  // ── Test C: "how does it work exactly" — only "it", no crypto words
  calls.length = 0;
  const howItWorks = await tryCryptoFastPathReply({
    text: "how does it work exactly",
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
  });

  const reportCallsC = calls.filter((c) => c.name === "coinbase_portfolio_report");
  assert.equal(
    reportCallsC.length,
    0,
    `"how does it work exactly" must NOT fire coinbase_portfolio_report — fired ${reportCallsC.length} time(s).`,
  );

  console.log("PASS smoke/audit/p1-it-word-regression");
}

run().catch((err) => {
  console.error(`FAIL smoke/audit/p1-it-word-regression: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
