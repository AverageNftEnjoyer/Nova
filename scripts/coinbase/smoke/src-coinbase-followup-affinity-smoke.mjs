import assert from "node:assert/strict";
import { tryCryptoFastPathReply } from "../../../src/runtime/modules/chat/fast-path/crypto-fast-path.js";

const calls = [];

const availableTools = [
  { name: "coinbase_portfolio_report" },
  { name: "coinbase_portfolio_snapshot" },
  { name: "coinbase_recent_transactions" },
  { name: "coinbase_spot_price" },
  { name: "coinbase_capabilities" },
];

const runtimeTools = {
  async executeToolUse(toolUse) {
    const name = String(toolUse?.name || "");
    const input = toolUse?.input || {};
    calls.push({ name, input });
    if (name === "coinbase_portfolio_report") {
      const mode = String(input.mode || "concise");
      return {
        content: JSON.stringify({
          ok: true,
          source: "coinbase",
          report: {
            rendered: `Coinbase ${mode} portfolio report\ndate: 02/23/2026\nsource: coinbase\ntop_holdings: SUI: 124.80`,
            summary: {
              estimatedTotalUsd: 111.82,
              valuedAssetCount: 1,
              nonZeroAssetCount: 1,
              recentFlowUpAssets: 1,
              recentFlowDownAssets: 0,
              includeRecentNetCashFlow: false,
              decimalPlaces: 2,
            },
          },
        }),
      };
    }
    if (name === "coinbase_capabilities") {
      return { content: JSON.stringify({ ok: true, capabilities: { status: "connected" }, checkedAtMs: Date.now() }) };
    }
    if (name === "coinbase_portfolio_snapshot") {
      return { content: JSON.stringify({ ok: true, data: { balances: [], freshnessMs: 0 } }) };
    }
    if (name === "coinbase_recent_transactions") {
      return { content: JSON.stringify({ ok: true, events: [], freshnessMs: 0 }) };
    }
    if (name === "coinbase_spot_price") {
      return { content: JSON.stringify({ ok: true, data: { symbolPair: "SUI-USD", price: 0.89, freshnessMs: 0 } }) };
    }
    return { content: JSON.stringify({ ok: false, errorCode: "UNKNOWN" }) };
  },
};

async function run() {
  const userContextId = `followup-${Date.now()}`;
  const conversationId = `conv-${Date.now()}`;

  const assist = await tryCryptoFastPathReply({
    text: "hey nova i wanna talk about my crypto",
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
  });
  assert.equal(assist.source, "coinbase");
  assert.equal(String(assist.reply || "").toLowerCase().includes("conversationally"), true);

  const assistFollowUp = await tryCryptoFastPathReply({
    text: "whats the total price of it",
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
  });
  assert.equal(["coinbase", "coinbase_followup"].includes(String(assistFollowUp.source || "")), true);
  assert.equal(String(assistFollowUp.reply || "").includes("Coinbase concise portfolio report"), true);

  const report = await tryCryptoFastPathReply({
    text: "daily report of crypto",
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
  });
  assert.equal(report.source, "coinbase");
  assert.equal(String(report.reply || "").includes("Coinbase concise portfolio report"), true);

  const preference = await tryCryptoFastPathReply({
    text: "remove the recent net cash-flow pnl proxy line from my daily report",
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
  });
  assert.equal(preference.source, "preference");

  const recall = await tryCryptoFastPathReply({
    text: "what did i just ask you to remove from the report",
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
  });
  assert.equal(["coinbase", "coinbase_followup"].includes(String(recall.source || "")), true);
  assert.equal(String(recall.reply || "").toLowerCase().includes("recent net cash-flow"), true);

  const detail = await tryCryptoFastPathReply({
    text: "oh wait, more detail",
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
  });
  assert.equal(["coinbase", "coinbase_followup"].includes(String(detail.source || "")), true);
  assert.equal(String(detail.reply || "").includes("Coinbase detailed portfolio report"), true);

  const switched = await tryCryptoFastPathReply({
    text: "new topic: weather in miami",
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
  });
  assert.equal(String(switched.reply || ""), "");

  const afterSwitch = await tryCryptoFastPathReply({
    text: "oh wait, more detail",
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
  });
  assert.equal(String(afterSwitch.reply || ""), "");
  assert.equal(String(afterSwitch.source || ""), "");

  const detailedCalls = calls.filter((entry) =>
    entry.name === "coinbase_portfolio_report" && String(entry.input?.mode || "") === "detailed");
  assert.equal(detailedCalls.length >= 1, true, "expected at least one detailed report follow-up call");

  console.log("PASS src-coinbase-followup-affinity-smoke");
}

run().catch((error) => {
  console.error(`FAIL src-coinbase-followup-affinity-smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
