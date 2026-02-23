import assert from "node:assert/strict";
import { tryCryptoFastPathReply } from "../../../src/runtime/modules/chat/fast-path/crypto-fast-path.js";

const availableTools = [{ name: "coinbase_portfolio_report" }];

function makeRuntimeTools({ failAfter = Number.POSITIVE_INFINITY } = {}) {
  let calls = 0;
  return {
    async executeToolUse(toolUse) {
      calls += 1;
      if (calls > failAfter) {
        return {
          content: JSON.stringify({
            ok: false,
            errorCode: "TOOL_RUNTIME_UNAVAILABLE",
            safeMessage: "I couldn't verify Coinbase data because the tool runtime is unavailable.",
            guidance: "Retry after Nova runtime initializes tools.",
          }),
        };
      }
      return {
        content: JSON.stringify({
          ok: true,
          source: "coinbase",
          report: {
            rendered: "Coinbase concise portfolio report\ndate: 02/23/2026\nsource: coinbase\ntop_holdings: SUI: 124.80",
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
    },
  };
}

async function run() {
  const userContextId = `targeted-${Date.now()}`;
  const conversationId = `targeted-conv-${Date.now()}`;

  const stableRuntime = makeRuntimeTools();
  const first = await tryCryptoFastPathReply({
    text: "daily crypto report again",
    runtimeTools: stableRuntime,
    availableTools,
    userContextId,
    conversationId,
  });
  const second = await tryCryptoFastPathReply({
    text: "daily crypto report again",
    runtimeTools: stableRuntime,
    availableTools,
    userContextId,
    conversationId,
  });
  assert.equal(String(first.reply || "").startsWith("Refreshed report:"), true);
  assert.equal(String(second.reply || "").startsWith("Refreshed report:"), true);

  const failRuntime = makeRuntimeTools({ failAfter: 1 });
  const baseline = await tryCryptoFastPathReply({
    text: "daily report of crypto",
    runtimeTools: failRuntime,
    availableTools,
    userContextId: `${userContextId}-fallback`,
    conversationId: `${conversationId}-fallback`,
  });
  assert.equal(String(baseline.reply || "").includes("Coinbase concise portfolio report"), true);
  const fallback = await tryCryptoFastPathReply({
    text: "report again",
    runtimeTools: failRuntime,
    availableTools,
    userContextId: `${userContextId}-fallback`,
    conversationId: `${conversationId}-fallback`,
  });
  assert.equal(String(fallback.reply || "").includes("last known report"), true);
  assert.equal(String(fallback.reply || "").includes("Coinbase concise portfolio report"), true);

  const ctxUser = `${userContextId}-ctx`;
  const ctxConversation = `${conversationId}-ctx`;
  await tryCryptoFastPathReply({
    text: "daily report of crypto",
    runtimeTools: stableRuntime,
    availableTools,
    userContextId: ctxUser,
    conversationId: ctxConversation,
  });
  const contextual = await tryCryptoFastPathReply({
    text: "do not include timestamps ever",
    runtimeTools: stableRuntime,
    availableTools,
    userContextId: ctxUser,
    conversationId: ctxConversation,
  });
  assert.equal(String(contextual.source || ""), "preference");

  console.log("PASS src-coinbase-targeted-regression-smoke");
}

run().catch((error) => {
  console.error(`FAIL src-coinbase-targeted-regression-smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
