import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  CoinbaseCircuitBreaker,
  CoinbaseError,
  CoinbaseService,
  createStaticCredentialProvider,
  getCoinbaseMetricsSnapshot,
  recordCoinbaseMetric,
  recordCoinbaseStructuredLog,
  resetCoinbaseObservabilityForTests,
} from "../../../dist/integrations/coinbase/index.js";

const results = [];
function run(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push({ status: "PASS", name }))
    .catch((error) => results.push({ status: "FAIL", name, detail: error instanceof Error ? error.message : String(error) }));
}

function ensureRemoved(relPath) {
  const full = path.join(process.cwd(), relPath);
  fs.rmSync(full, { force: true });
}

function readJsonl(relPath) {
  const full = path.join(process.cwd(), relPath);
  if (!fs.existsSync(full)) return [];
  return fs
    .readFileSync(full, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const structuredLogPath = path.join("archive", "logs", "coinbase-structured.jsonl");
const alertsPath = path.join("archive", "logs", "coinbase-alerts.jsonl");
ensureRemoved(structuredLogPath);
ensureRemoved(alertsPath);
resetCoinbaseObservabilityForTests();

const credProvider = createStaticCredentialProvider({
  "phase9-user-a": {
    connected: true,
    apiKey: "phase9-key-a",
    apiSecret: "phase9-secret-a",
  },
  "phase9-user-b": {
    connected: true,
    apiKey: "phase9-key-b",
    apiSecret: "phase9-secret-b",
  },
  "phase9-auth-missing": {
    connected: true,
    apiKey: "phase9-key-missing",
    apiSecret: "",
  },
});

await run("P9-L1 structured logs include required IDs and provider on request paths", async () => {
  const service = new CoinbaseService({
    credentialProvider: credProvider,
    authStrategy: { name: "phase9-auth" },
  });
  service.createClient = () => ({
    getPublicJson: async () => ({ data: { amount: "102345.12", base: "BTC", currency: "USD" } }),
    getPrivateJson: async (requestPath) => {
      if (String(requestPath).includes("/v3/brokerage/accounts")) {
        return { accounts: [{ uuid: "acct-1", name: "Main", type: "wallet", currency: "BTC", available_balance: { value: "1.0" }, hold: { value: "0.1" } }] };
      }
      return { fills: [{ entry_id: "fill-1", side: "BUY", size: "0.2", price: "100000", commission: "2", trade_time: new Date().toISOString(), product_id: "BTC-USD", order_status: "FILLED" }] };
    },
  });

  await service.getSpotPrice(
    { userContextId: "phase9-user-a", conversationId: "conv-a", missionRunId: "run-a" },
    { symbolPair: "BTC-USD", bypassCache: true },
  );
  await service.getPortfolioSnapshot(
    { userContextId: "phase9-user-b", conversationId: "conv-b", missionRunId: "run-b" },
    { bypassCache: true },
  );
  const logs = readJsonl(structuredLogPath);
  const requestLogs = logs.filter((line) =>
    ["coinbase.spot_price", "coinbase.portfolio", "coinbase.transactions"].includes(String(line.event || "")),
  );
  assert.ok(requestLogs.length >= 2);
  for (const line of requestLogs) {
    assert.equal(String(line.provider), "coinbase");
    assert.notEqual(String(line.userContextId || "").trim(), "");
    assert.notEqual(String(line.conversationId || "").trim(), "");
    assert.notEqual(String(line.missionRunId || "").trim(), "");
  }
});

await run("P9-M1 metrics emit endpoint latency and error dimensions", async () => {
  recordCoinbaseMetric({ endpoint: "/phase9/success", ok: true, latencyMs: 120, statusClass: "2xx", category: "request" });
  recordCoinbaseMetric({ endpoint: "/phase9/success", ok: true, latencyMs: 180, statusClass: "2xx", category: "request" });
  recordCoinbaseMetric({ endpoint: "/phase9/failure", ok: false, latencyMs: 60, statusClass: "5xx", errorCode: "TIMEOUT", category: "request" });
  const snapshot = getCoinbaseMetricsSnapshot();
  const success = snapshot.endpoints["/phase9/success"];
  const failure = snapshot.endpoints["/phase9/failure"];
  assert.ok(success.latency.p50 >= 0);
  assert.ok(success.latency.p95 >= 0);
  assert.ok(success.latency.p99 >= 0);
  assert.equal(Number(failure.failure) >= 1, true);
  assert.equal(Number(failure.statusClass["5xx"]) >= 1, true);
});

await run("P9-M2 refresh and report success/failure metrics emit", async () => {
  recordCoinbaseMetric({ endpoint: "auth.resolve", ok: false, errorCode: "AUTH_FAILED", statusClass: "401", category: "refresh" });
  recordCoinbaseMetric({ endpoint: "auth.resolve", ok: true, statusClass: "2xx", category: "refresh" });
  recordCoinbaseMetric({ endpoint: "tool.coinbase_portfolio_report", ok: true, statusClass: "2xx", category: "report" });
  recordCoinbaseMetric({ endpoint: "tool.coinbase_portfolio_report", ok: false, errorCode: "UNKNOWN", statusClass: "5xx", category: "report" });
  const snapshot = getCoinbaseMetricsSnapshot();
  const refresh = snapshot.endpoints["auth.resolve"];
  const report = snapshot.endpoints["tool.coinbase_portfolio_report"];
  assert.equal(Number(refresh.refreshFailure) >= 1, true);
  assert.equal(Number(refresh.refreshSuccess) >= 1, true);
  assert.equal(Number(report.reportSuccess) >= 1, true);
  assert.equal(Number(report.reportFailures) >= 1, true);
});

await run("P9-A1 alert triggers for auth failures, provider failures, report failures, and latency p95 breach", async () => {
  const assertSingleAlert = (eventName) => {
    const alerts = readJsonl(alertsPath).map((line) => String(line.event || ""));
    assert.equal(alerts.some((event) => event === eventName), true);
  };

  resetCoinbaseObservabilityForTests();
  ensureRemoved(alertsPath);
  for (let i = 0; i < 5; i += 1) {
    recordCoinbaseMetric({ endpoint: "auth.resolve", ok: false, errorCode: "AUTH_FAILED", statusClass: "401", category: "refresh" });
  }
  assertSingleAlert("coinbase.alert.auth_failures");

  resetCoinbaseObservabilityForTests();
  ensureRemoved(alertsPath);
  for (let i = 0; i < 8; i += 1) {
    recordCoinbaseMetric({ endpoint: "/v3/brokerage/accounts", ok: false, errorCode: "TIMEOUT", statusClass: "5xx", category: "request" });
  }
  assertSingleAlert("coinbase.alert.provider_failures");

  resetCoinbaseObservabilityForTests();
  ensureRemoved(alertsPath);
  for (let i = 0; i < 5; i += 1) {
    recordCoinbaseMetric({ endpoint: "tool.coinbase_portfolio_report", ok: false, errorCode: "UNKNOWN", statusClass: "5xx", category: "report" });
  }
  assertSingleAlert("coinbase.alert.report_failures");

  resetCoinbaseObservabilityForTests();
  ensureRemoved(alertsPath);
  for (let i = 0; i < 11; i += 1) {
    recordCoinbaseMetric({ endpoint: "/phase9/latency", ok: true, latencyMs: 5_200 + i, statusClass: "2xx", category: "request" });
  }
  assertSingleAlert("coinbase.alert.latency_p95_breach");
});

await run("P9-C1 circuit breaker transitions and deterministic degraded response", async () => {
  const breaker = new CoinbaseCircuitBreaker({ failureThreshold: 2, cooldownMs: 5_000 });
  const endpoint = "/v2/prices/:symbol/spot";
  breaker.onFailure(endpoint, 1000);
  breaker.onFailure(endpoint, 1001);
  const openGate = breaker.canRequest(endpoint, 1002);
  assert.equal(openGate.ok, false);
  const halfOpenGate = breaker.canRequest(endpoint, 7005);
  assert.equal(halfOpenGate.ok, true);
  const blockedProbe = breaker.canRequest(endpoint, 7006);
  assert.equal(blockedProbe.ok, false);
  breaker.onSuccess(endpoint);
  const closedGate = breaker.canRequest(endpoint, 7007);
  assert.equal(closedGate.ok, true);

  const serviceBreaker = new CoinbaseCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
  const service = new CoinbaseService({
    credentialProvider: credProvider,
    authStrategy: { name: "phase9-auth" },
    circuitBreaker: serviceBreaker,
  });
  service.createClient = () => ({
    getPublicJson: async () => {
      throw new CoinbaseError({
        code: "TIMEOUT",
        endpoint: "/v2/prices/BTC-USD/spot",
        userContextId: "phase9-user-a",
        message: "simulated timeout",
        retryable: true,
      });
    },
    getPrivateJson: async () => ({ fills: [] }),
  });
  await assert.rejects(
    () => service.getSpotPrice({ userContextId: "phase9-user-a", conversationId: "conv-cb", missionRunId: "run-cb" }, { symbolPair: "BTC-USD", bypassCache: true }),
    (error) => String(error?.code || "") === "TIMEOUT",
  );
  await assert.rejects(
    () => service.getSpotPrice({ userContextId: "phase9-user-a", conversationId: "conv-cb", missionRunId: "run-cb" }, { symbolPair: "BTC-USD", bypassCache: true }),
    (error) => String(error?.code || "") === "UPSTREAM_UNAVAILABLE",
  );
});

await run("P9-I1 no cross-user leakage in structured log userContextId under failure load", async () => {
  recordCoinbaseStructuredLog({
    ts: new Date().toISOString(),
    provider: "coinbase",
    event: "coinbase.test.failure",
    endpoint: "/phase9/test",
    status: "error",
    userContextId: "phase9-user-a",
    conversationId: "conv-a",
    missionRunId: "run-a",
    errorCode: "SIMULATED",
  });
  recordCoinbaseStructuredLog({
    ts: new Date().toISOString(),
    provider: "coinbase",
    event: "coinbase.test.failure",
    endpoint: "/phase9/test",
    status: "error",
    userContextId: "phase9-user-b",
    conversationId: "conv-b",
    missionRunId: "run-b",
    errorCode: "SIMULATED",
  });
  const logs = readJsonl(structuredLogPath);
  const testEvents = logs.filter((line) => String(line.event || "") === "coinbase.test.failure");
  assert.equal(testEvents.length >= 2, true);
  for (const line of testEvents) {
    assert.equal(["phase9-user-a", "phase9-user-b"].includes(String(line.userContextId)), true);
    assert.notEqual(String(line.userContextId || "").trim(), "");
  }
});

const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const metricsPath = path.join(process.cwd(), "archive", "logs", "coinbase-phase9-metrics-snapshot.json");
const reportPath = path.join(process.cwd(), "archive", "logs", "coinbase-phase9-smoke-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(metricsPath, `${JSON.stringify(getCoinbaseMetricsSnapshot(), null, 2)}\n`, "utf8");
fs.writeFileSync(reportPath, `${JSON.stringify({ ts: new Date().toISOString(), pass, fail, results }, null, 2)}\n`, "utf8");
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`report=${reportPath}`);
console.log(`metrics=${metricsPath}`);
console.log(`structuredLogs=${path.join(process.cwd(), structuredLogPath)}`);
console.log(`alerts=${path.join(process.cwd(), alertsPath)}`);
console.log(`Summary: pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);

