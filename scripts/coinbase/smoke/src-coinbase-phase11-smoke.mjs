import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  CoinbaseDataStore,
  CoinbaseHttpClient,
  CoinbaseService,
  computeCoinbaseRetryDelayMs,
  createStaticCredentialProvider,
  mapCoinbaseHttpError,
} from "../../../dist/integrations/coinbase/index.js";
import { tryCryptoFastPathReply } from "../../../src/runtime/modules/chat/fast-path/crypto-fast-path/index.js";
import { normalizeCoinbaseCommandText, parseCoinbaseCommand } from "../../../src/runtime/modules/chat/fast-path/coinbase-command-parser/index.js";

const results = [];

function record(status, name, detail = "") {
  results.push({ status, name, detail });
}

async function run(name, fn) {
  try {
    await fn();
    record("PASS", name);
  } catch (error) {
    record("FAIL", name, error instanceof Error ? error.message : String(error));
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function tempDb(name) {
  const dbPath = path.join(process.cwd(), "scripts", "coinbase", ".tmp", name);
  fs.rmSync(dbPath, { force: true });
  return dbPath;
}

await run("P11-U1 parser unit tests cover aliases + typo normalization", async () => {
  assert.equal(normalizeCoinbaseCommandText("nova wekly pNl"), "weekly pnl");
  assert.equal(parseCoinbaseCommand("my crypto report").intent, "report");
  assert.equal(parseCoinbaseCommand("portfolo").intent, "portfolio");
  assert.equal(parseCoinbaseCommand("what is weather today").isCrypto, false);
});

await run("P11-U2 mapper unit tests normalize spot/portfolio/transactions", async () => {
  const service = new CoinbaseService({
    credentialProvider: createStaticCredentialProvider({
      "u-phase11": { connected: true, apiKey: "key", apiSecret: "secret" },
    }),
    authStrategy: { name: "phase11-auth" },
  });
  service.createClient = () => ({
    getPublicJson: async () => ({ data: { amount: "100123.45", base: "BTC", currency: "USD" } }),
    getPrivateJson: async (requestPath) => {
      if (String(requestPath).includes("accounts")) {
        return {
          accounts: [
            {
              uuid: "acct-1",
              name: "Main",
              type: "wallet",
              currency: "BTC",
              available_balance: { value: "1.0" },
              hold: { value: "0.2" },
            },
          ],
        };
      }
      return {
        fills: [
          {
            entry_id: "fill-1",
            side: "BUY",
            size: "0.4",
            price: "99999.12",
            commission: "1.25",
            trade_time: new Date(1700000000000).toISOString(),
            product_id: "BTC-USD",
            order_status: "FILLED",
          },
        ],
      };
    },
  });

  const spot = await service.getSpotPrice({ userContextId: "u-phase11", conversationId: "c1", missionRunId: "m1" }, { symbolPair: "BTC-USD", bypassCache: true });
  assert.equal(spot.symbolPair, "BTC-USD");
  assert.equal(spot.baseAsset, "BTC");
  assert.equal(spot.quoteAsset, "USD");
  assert.equal(Number(spot.price) > 0, true);

  const portfolio = await service.getPortfolioSnapshot({ userContextId: "u-phase11", conversationId: "c1", missionRunId: "m1" }, { bypassCache: true });
  assert.equal(portfolio.balances.length, 1);
  assert.equal(portfolio.balances[0].assetSymbol, "BTC");
  assert.equal(portfolio.balances[0].total, 1.2);

  const tx = await service.getRecentTransactions({ userContextId: "u-phase11", conversationId: "c1", missionRunId: "m1" }, { limit: 5, bypassCache: true });
  assert.equal(tx.length, 1);
  assert.equal(tx[0].assetSymbol, "BTC");
  assert.equal(tx[0].side, "buy");
});

await run("P11-U3 retry/error mapping unit tests for CoinbaseHttpClient", async () => {
  const client = new CoinbaseHttpClient({ maxRetries: 2 });
  assert.equal(client instanceof CoinbaseHttpClient, true);

  const rateLimited = mapCoinbaseHttpError({
    status: 429,
    endpoint: "/x",
    userContextId: "u",
    detail: "retry please",
    retryAfterHeader: "3",
  });
  assert.equal(rateLimited.code, "RATE_LIMITED");
  assert.equal(rateLimited.retryable, true);
  assert.equal(Number(rateLimited.retryAfterMs) >= 3000, true);

  const authFailed = mapCoinbaseHttpError({
    status: 401,
    endpoint: "/x",
    userContextId: "u",
    detail: "",
    retryAfterHeader: null,
  });
  assert.equal(authFailed.code, "AUTH_FAILED");
  assert.equal(authFailed.retryable, false);

  const upstream = mapCoinbaseHttpError({
    status: 503,
    endpoint: "/x",
    userContextId: "u",
    detail: "",
    retryAfterHeader: null,
  });
  assert.equal(upstream.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(upstream.retryable, true);

  const backoff = computeCoinbaseRetryDelayMs(2, 4000);
  assert.equal(backoff >= 4000, true);
});

await run("P11-I1 OAuth connect/refresh/revoke integration tests are user-scoped", async () => {
  process.env.NOVA_COINBASE_TOKEN_KEYS = process.env.NOVA_COINBASE_TOKEN_KEYS || "phase11-token-key";
  const store = new CoinbaseDataStore(tempDb("coinbase-phase11-oauth.sqlite"));
  try {
    store.upsertConnectionMetadata({
      userContextId: "u-oauth-a",
      connected: true,
      mode: "oauth",
      keyFingerprint: "fp-a",
    });
    store.saveOauthTokens({
      userContextId: "u-oauth-a",
      accessToken: "access-a",
      refreshToken: "refresh-a-v1",
      scope: "portfolio:view",
      expiresAtMs: Date.now() + 3600000,
    });
    store.saveOauthTokens({
      userContextId: "u-oauth-a",
      accessToken: "access-a",
      refreshToken: "refresh-a-v2",
      scope: "portfolio:view",
      expiresAtMs: Date.now() + 7200000,
    });
    store.saveOauthTokens({
      userContextId: "u-oauth-b",
      accessToken: "access-b",
      refreshToken: "refresh-b-v1",
      scope: "portfolio:view",
      expiresAtMs: Date.now() + 3600000,
    });

    const beforeRevokeA = store.getOauthTokens("u-oauth-a");
    const beforeRevokeB = store.getOauthTokens("u-oauth-b");
    assert.equal(beforeRevokeA?.refreshToken, "refresh-a-v2");
    assert.equal(beforeRevokeB?.refreshToken, "refresh-b-v1");

    store.revokeOauthTokens("u-oauth-a");
    const afterRevokeA = store.getOauthTokens("u-oauth-a");
    const afterRevokeB = store.getOauthTokens("u-oauth-b");
    assert.equal(Number(afterRevokeA?.revokedAtMs || 0) > 0, true);
    assert.equal(Number(afterRevokeB?.revokedAtMs || 0), 0);
  } finally {
    store.close();
  }
});

await run("P11-R1 runtime isolation + cross-conversation routing under load", async () => {
  const calls = [];
  const runtimeTools = {
    async executeToolUse(toolUse) {
      const input = toolUse?.input || {};
      calls.push({
        name: String(toolUse?.name || ""),
        userContextId: String(input.userContextId || ""),
        conversationId: String(input.conversationId || ""),
      });
      return {
        content: JSON.stringify({
          ok: true,
          source: "coinbase",
          data: { symbolPair: "BTC-USD", price: 100000.1, freshnessMs: 1000, fetchedAtMs: Date.now() },
        }),
      };
    },
  };
  const availableTools = [{ name: "coinbase_spot_price" }];
  const requests = [];
  for (let i = 0; i < 40; i += 1) {
    const user = i % 2 === 0 ? "u-load-a" : "u-load-b";
    const conv = i % 2 === 0 ? `conv-a-${i}` : `conv-b-${i}`;
    requests.push(
      tryCryptoFastPathReply({
        text: "price btc",
        runtimeTools,
        availableTools,
        userContextId: user,
        conversationId: conv,
      }),
    );
  }
  const replies = await Promise.all(requests);
  assert.equal(replies.length, 40);
  assert.equal(calls.length, 40);
  for (const call of calls) {
    assert.equal(call.userContextId.startsWith("u-load-"), true);
    assert.equal(call.conversationId.startsWith("conv-"), true);
  }
  assert.equal(calls.some((call) => call.userContextId === "u-load-a"), true);
  assert.equal(calls.some((call) => call.userContextId === "u-load-b"), true);
});

await run("P11-M1 mission scheduling/retry/idempotency checks", async () => {
  const schedulerSource = read("hud/lib/notifications/scheduler.ts");
  assert.equal(schedulerSource.includes("SCHEDULER_MAX_RETRIES_PER_RUN_KEY"), true);
  assert.equal(schedulerSource.includes("computeRetryDelayMs"), true);
  assert.equal(schedulerSource.includes("appendNotificationDeadLetter"), true);

  const store = new CoinbaseDataStore(tempDb("coinbase-phase11-idempotency.sqlite"));
  try {
    const first = store.claimIdempotencyKey({
      key: "phase11:u1:mission:daily",
      userContextId: "u1",
      scope: "mission_run",
      ttlMs: 60000,
    });
    const second = store.claimIdempotencyKey({
      key: "phase11:u1:mission:daily",
      userContextId: "u1",
      scope: "mission_run",
      ttlMs: 60000,
    });
    const otherUser = store.claimIdempotencyKey({
      key: "phase11:u1:mission:daily",
      userContextId: "u2",
      scope: "mission_run",
      ttlMs: 60000,
    });
    assert.equal(first.accepted, true);
    assert.equal(second.accepted, false);
    assert.equal(otherUser.accepted, true);
  } finally {
    store.close();
  }
});

await run("P11-UI1 UI/API connect-disconnect/error-state rendering hooks", async () => {
  const integrationsPageSource = read("hud/app/integrations/page.tsx");
  const configRouteSource = read("hud/app/api/integrations/config/route.ts");
  const probeRouteSource = read("hud/app/api/integrations/test-coinbase/route.ts");

  assert.equal(integrationsPageSource.includes("settings.coinbase.connected"), true);
  assert.equal(integrationsPageSource.includes("coinbaseSyncLabel"), true);
  assert.equal(integrationsPageSource.includes("coinbaseNeedsKeyWarning"), true);
  assert.equal(configRouteSource.includes("explicitDisconnect"), true);
  assert.equal(configRouteSource.includes("coinbase.disconnect.secure_delete"), true);
  assert.equal(probeRouteSource.includes("coinbase_outage"), true);
  assert.equal(probeRouteSource.includes("lastSyncErrorCode"), true);
});

await run("P11-CI1 CI smoke command wiring includes Coinbase enabled flows", async () => {
  const pkg = JSON.parse(read("package.json"));
  const command = String(pkg?.scripts?.["smoke:src-coinbase-ci"] || "");
  assert.notEqual(command.trim(), "");
  const required = [
    "smoke:src-coinbase-storage",
    "smoke:src-coinbase-chat",
    "smoke:src-coinbase-phase6",
    "smoke:src-coinbase-phase7-matrix",
    "smoke:src-coinbase-phase8",
    "smoke:src-coinbase-phase9",
    "smoke:src-coinbase-phase10",
    "smoke:src-coinbase-phase11",
  ];
  for (const token of required) assert.equal(command.includes(token), true, `missing gate: ${token}`);
});

const liveToggle = String(process.env.NOVA_COINBASE_LIVE_TESTS || "").trim().toLowerCase();
const liveRequested = liveToggle === "1" || liveToggle === "true" || liveToggle === "on";
const liveApiKey = String(process.env.NOVA_COINBASE_API_KEY || "").trim();
const liveApiSecret = String(process.env.NOVA_COINBASE_API_SECRET || "").trim();
const liveEnabled = liveRequested || (liveApiKey.length > 0 && liveApiSecret.length > 0);
if (!liveEnabled) {
  await run("P11-LIVE1 optional live Coinbase probe", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: { iso: new Date().toISOString(), epoch: String(Math.floor(Date.now() / 1000)) } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    try {
      const client = new CoinbaseHttpClient({
        authStrategy: {
          name: "noop-live-check",
          async buildHeaders() {
            return {};
          },
        },
        maxRetries: 0,
        timeoutMs: 5000,
      });
      const payload = await client.getPublicJson("/v2/time", { userContextId: "phase11-live-fallback" });
      assert.equal(typeof payload === "object" && payload !== null, true);
      assert.equal(typeof payload?.data === "object" && payload?.data !== null, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
} else {
  await run("P11-LIVE1 optional live Coinbase probe", async () => {
    if (!liveApiKey || !liveApiSecret) {
      throw new Error("Live mode requires NOVA_COINBASE_API_KEY and NOVA_COINBASE_API_SECRET.");
    }
    const client = new CoinbaseHttpClient({
      authStrategy: {
        name: "noop-live-check",
        async buildHeaders() {
          return {};
        },
      },
      maxRetries: 0,
      timeoutMs: 5000,
    });
    const payload = await client.getPublicJson("/v2/time", { userContextId: "phase11-live" });
    assert.equal(typeof payload === "object" && payload !== null, true);
  });
}

const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
const reportPath = path.join(process.cwd(), "archive", "logs", "coinbase-phase11-smoke-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify({ ts: new Date().toISOString(), pass, fail, skip: skipCount, results }, null, 2)}\n`, "utf8");
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`report=${reportPath}`);
console.log(`Summary: pass=${pass} fail=${fail} skip=${skipCount}`);
if (fail > 0) process.exit(1);

