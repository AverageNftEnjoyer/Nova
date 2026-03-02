import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { CoinbaseDataStore } from "../../../dist/integrations/coinbase/index.js";
import { renderCoinbasePortfolioReport } from "../../../dist/integrations/coinbase/report-renderer/index.js";

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

await run("P8-R1 concise renderer includes metadata", async () => {
  const text = renderCoinbasePortfolioReport({
    mode: "concise",
    source: "coinbase",
    generatedAtMs: Date.now(),
    portfolio: {
      balances: [{ accountId: "a", accountName: "n", accountType: "spot", assetSymbol: "BTC", available: 1, hold: 0, total: 1 }],
      fetchedAtMs: Date.now(),
      freshnessMs: 1200,
      source: "coinbase",
    },
    transactions: [],
  });
  assert.match(text, /timestamp:|date:/i);
  assert.match(text, /source:/i);
  assert.match(text, /active_assets:/i);
  assert.match(text, /concise portfolio report/i);
});

await run("P8-R2 detailed renderer includes holdings and activity", async () => {
  const text = renderCoinbasePortfolioReport({
    mode: "detailed",
    source: "coinbase",
    generatedAtMs: Date.now(),
    portfolio: {
      balances: [{ accountId: "a", accountName: "n", accountType: "spot", assetSymbol: "ETH", available: 2, hold: 0, total: 2 }],
      fetchedAtMs: Date.now(),
      freshnessMs: 1200,
      source: "coinbase",
    },
    transactions: [{ id: "t1", side: "buy", assetSymbol: "ETH", quantity: 0.2, price: 3000, fee: 2, occurredAtMs: Date.now(), status: "done" }],
  });
  assert.match(text, /holdings:/i);
  assert.match(text, /recent_transactions:/i);
  assert.match(text, /detailed portfolio report/i);
});

await run("P8-D1 output dispatch supports email/discord/telegram/telegram and typed channel errors", async () => {
  const source = read("hud/lib/missions/output/dispatch.ts");
  assert.equal(source.includes("channel === \"discord\" || channel === \"telegram\" || channel === \"email\""), true);
  assert.equal(source.includes("channel_unavailable:"), true);
  assert.equal(source.includes("channel === \"telegram\""), true);
});

await run("P8-D2 notification dispatcher includes email adapter", async () => {
  const source = read("hud/lib/notifications/dispatcher.ts");
  assert.equal(source.includes("sendEmailMessage"), true);
  assert.equal(source.includes("input.integration === \"email\""), true);
});

await run("P8-E1 export route enforces supabase auth and user scoping", async () => {
  const source = read("hud/app/api/coinbase/exports/route.ts");
  assert.equal(source.includes("requireSupabaseApiUser"), true);
  assert.equal(source.includes("verified.user.id"), true);
  assert.equal(source.includes("store.listReportHistory(userContextId"), true);
  assert.equal(source.includes("store.listSnapshots(userContextId, \"transactions\""), true);
});

await run("P8-E2 retention route enforces auth and supports update+prune with audit", async () => {
  const source = read("hud/app/api/coinbase/retention/route.ts");
  assert.equal(source.includes("requireSupabaseApiUser"), true);
  assert.equal(source.includes("setRetentionSettings"), true);
  assert.equal(source.includes("pruneForUser"), true);
  assert.equal(source.includes("coinbase.retention.update"), true);
  assert.equal(source.includes("coinbase.retention.prune"), true);
});

await run("P8-R3 retention pruning is user-scoped and does not leak", async () => {
  const dbPath = path.join(process.cwd(), "scripts", "coinbase", ".tmp", "coinbase-phase8-smoke.sqlite");
  fs.rmSync(dbPath, { force: true });
  const store = new CoinbaseDataStore(dbPath);
  try {
    const old = Date.now() - 120 * 24 * 60 * 60 * 1000;
    const r1 = store.appendReportHistory({ userContextId: "u1", reportType: "portfolio", deliveredChannel: "telegram", deliveredAtMs: old, payload: { a: 1 } });
    const r2 = store.appendReportHistory({ userContextId: "u2", reportType: "portfolio", deliveredChannel: "telegram", deliveredAtMs: old, payload: { a: 2 } });
    store.db.prepare("UPDATE coinbase_report_history SET created_at = ? WHERE report_run_id = ?").run(old, r1);
    store.db.prepare("UPDATE coinbase_report_history SET created_at = ? WHERE report_run_id = ?").run(old, r2);
    store.setRetentionSettings({ userContextId: "u1", reportRetentionDays: 1, snapshotRetentionDays: 1, transactionRetentionDays: 1 });
    const pruned = store.pruneForUser("u1");
    assert.ok(pruned.reportsDeleted >= 1);
    const u1 = store.listReportHistory("u1", 10);
    const u2 = store.listReportHistory("u2", 10);
    assert.equal(u1.length, 0);
    assert.equal(u2.length, 1);
  } finally {
    store.close();
  }
});

const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const reportPath = path.join(process.cwd(), "archive", "logs", "coinbase-phase8-smoke-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify({ ts: new Date().toISOString(), pass, fail, results }, null, 2)}\n`, "utf8");
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`report=${reportPath}`);
console.log(`Summary: pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);

