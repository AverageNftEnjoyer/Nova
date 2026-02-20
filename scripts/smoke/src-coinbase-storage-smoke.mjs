import path from "node:path";
import { CoinbaseDataStore } from "../../dist/integrations/coinbase/index.js";

process.env.NOVA_COINBASE_TOKEN_KEYS = process.env.NOVA_COINBASE_TOKEN_KEYS || "coinbase-storage-smoke-key";

const dbPath = path.join(process.cwd(), ".agent", "coinbase", "coinbase-storage-smoke.sqlite");
const store = new CoinbaseDataStore(dbPath);

const claimFirst = store.claimIdempotencyKey({
  key: "smoke:u1:daily:2026-02-20",
  userContextId: "u1",
  scope: "daily_report",
  ttlMs: 60_000,
});
if (!claimFirst.accepted || claimFirst.status !== "pending") {
  throw new Error("Idempotency first claim failed.");
}

const claimSecond = store.claimIdempotencyKey({
  key: "smoke:u1:daily:2026-02-20",
  userContextId: "u1",
  scope: "daily_report",
  ttlMs: 60_000,
});
if (claimSecond.accepted) {
  throw new Error("Idempotency duplicate claim should be rejected.");
}

store.completeIdempotencyKey({
  key: "smoke:u1:daily:2026-02-20",
  userContextId: "u1",
  status: "completed",
  resultRef: "report-smoke-1",
});

store.appendSnapshot({
  userContextId: "u1",
  snapshotType: "spot_price",
  symbolPair: "BTC-USD",
  payload: { symbolPair: "BTC-USD", price: 100_000 },
  fetchedAtMs: Date.now(),
  freshnessMs: 0,
  source: "coinbase",
});

store.appendReportHistory({
  userContextId: "u1",
  reportType: "daily_portfolio",
  deliveredChannel: "novachat",
  payload: { totalUsd: 1234.56 },
});

store.appendAuditLog({
  userContextId: "u1",
  eventType: "coinbase.report.generate",
  status: "ok",
  details: { run: "smoke" },
});

store.saveOauthTokens({
  userContextId: "u1",
  accessToken: "at-smoke",
  refreshToken: "rt-smoke",
  scope: "portfolio.read",
  expiresAtMs: Date.now() + 3_600_000,
});
const tokenRecord = store.getOauthTokens("u1");
if (!tokenRecord || tokenRecord.accessToken !== "at-smoke" || tokenRecord.refreshToken !== "rt-smoke") {
  throw new Error("Encrypted OAuth token roundtrip failed.");
}

store.close();
console.log("[coinbase:smoke] storage schema + idempotency + audit + token encryption passed.");
