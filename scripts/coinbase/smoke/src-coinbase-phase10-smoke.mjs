import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { CoinbaseDataStore, renderCoinbasePortfolioReport } from "../../../dist/integrations/coinbase/index.js";
import { tryCryptoFastPathReply } from "../../../src/runtime/modules/chat/fast-path/crypto-fast-path/index.js";

const results = [];
function run(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push({ status: "PASS", name }))
    .catch((error) => results.push({ status: "FAIL", name, detail: error instanceof Error ? error.message : String(error) }));
}

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

await run("P10-D1 report renderer omits investment disclaimer", async () => {
  const text = renderCoinbasePortfolioReport({
    mode: "concise",
    source: "coinbase",
    generatedAtMs: Date.now(),
    portfolio: {
      balances: [{ accountId: "acct", accountName: "main", accountType: "spot", assetSymbol: "BTC", available: 1, hold: 0, total: 1 }],
      fetchedAtMs: Date.now(),
      freshnessMs: 1000,
      source: "coinbase",
    },
    transactions: [],
  });
  assert.equal(/disclaimer:\s+informational summaries only; not investment advice\./i.test(text), false);
});

await run("P10-D2 fast-path Coinbase replies omit disclaimer", async () => {
  const runtimeTools = {
    async executeToolUse(toolUse) {
      if (String(toolUse?.name || "") === "coinbase_spot_price") {
        return { content: JSON.stringify({ ok: true, source: "coinbase", data: { symbolPair: "BTC-USD", price: 100000, freshnessMs: 1200 } }) };
      }
      return { content: JSON.stringify({ ok: false, errorCode: "UNKNOWN_TOOL" }) };
    },
  };
  const res = await tryCryptoFastPathReply({
    text: "price btc",
    runtimeTools,
    availableTools: [{ name: "coinbase_spot_price" }],
    userContextId: "phase10-user",
    conversationId: "phase10-conv",
  });
  assert.equal(/disclaimer:\s+informational summaries only; not investment advice\./i.test(res.reply), false);
});

await run("P10-C1 transaction access is consent-gated in tool and export API paths", async () => {
  const toolSource = read("src/tools/builtin/coinbase-tools.ts");
  const exportsRoute = read("hud/app/api/coinbase/exports/route.ts");
  assert.equal(toolSource.includes("CONSENT_REQUIRED"), true);
  assert.equal(toolSource.includes("transactionHistoryConsentGranted"), true);
  assert.equal(exportsRoute.includes("Transaction-history consent is required"), true);
});

await run("P10-P1 privacy controls persist and retention remains integrated", async () => {
  const dbPath = path.join(process.cwd(), "scripts", "coinbase", ".tmp", "coinbase-phase10-smoke.sqlite");
  fs.rmSync(dbPath, { force: true });
  const store = new CoinbaseDataStore(dbPath);
  try {
    const defaults = store.getPrivacySettings("u10");
    assert.equal(defaults.requireTransactionConsent, true);
    assert.equal(defaults.transactionHistoryConsentGranted, false);
    const next = store.setPrivacySettings({
      userContextId: "u10",
      showBalances: false,
      showTransactions: false,
      transactionHistoryConsentGranted: true,
    });
    assert.equal(next.showBalances, false);
    assert.equal(next.showTransactions, false);
    assert.equal(next.transactionHistoryConsentGranted, true);
    const retention = store.setRetentionSettings({
      userContextId: "u10",
      reportRetentionDays: 14,
      snapshotRetentionDays: 7,
      transactionRetentionDays: 3,
    });
    assert.equal(retention.reportRetentionDays, 14);
    assert.equal(retention.transactionRetentionDays, 3);
  } finally {
    store.close();
  }
});

await run("P10-S1 secure delete purges scoped sensitive Coinbase data and preserves user isolation", async () => {
  const dbPath = path.join(process.cwd(), "scripts", "coinbase", ".tmp", "coinbase-phase10-delete-smoke.sqlite");
  fs.rmSync(dbPath, { force: true });
  const store = new CoinbaseDataStore(dbPath);
  try {
    const old = Date.now() - 86400000;
    store.appendSnapshot({
      userContextId: "u10a",
      snapshotType: "transactions",
      payload: { tx: 1 },
      fetchedAtMs: old,
      freshnessMs: 1000,
      source: "coinbase",
    });
    store.appendReportHistory({
      userContextId: "u10a",
      reportType: "portfolio",
      deliveredChannel: "telegram",
      deliveredAtMs: old,
      payload: { p: 1 },
    });
    store.saveOauthTokens({
      userContextId: "u10a",
      accessToken: "token-a",
      refreshToken: "refresh-a",
      scope: "portfolio:view",
      expiresAtMs: Date.now() + 100000,
    });
    store.appendSnapshot({
      userContextId: "u10b",
      snapshotType: "transactions",
      payload: { tx: 2 },
      fetchedAtMs: old,
      freshnessMs: 1000,
      source: "coinbase",
    });

    const purged = store.purgeUserData("u10a");
    assert.equal(Number(purged.snapshotsDeleted) >= 1, true);
    assert.equal(Number(purged.reportsDeleted) >= 1, true);
    assert.equal(Number(purged.oauthTokensDeleted) >= 0, true);
    assert.equal(store.listSnapshots("u10a", "transactions", 10).length, 0);
    assert.equal(store.listReportHistory("u10a", 10).length, 0);
    assert.equal(store.getOauthTokens("u10a"), null);
    assert.equal(store.listSnapshots("u10b", "transactions", 10).length, 1);
  } finally {
    store.close();
  }
});

const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const reportPath = path.join(process.cwd(), "archive", "logs", "coinbase-phase10-smoke-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify({ ts: new Date().toISOString(), pass, fail, results }, null, 2)}\n`, "utf8");
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`report=${reportPath}`);
console.log(`Summary: pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);

