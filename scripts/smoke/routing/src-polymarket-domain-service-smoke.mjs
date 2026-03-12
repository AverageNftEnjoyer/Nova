import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

async function withMockFetch(handler, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(body, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

const polymarketServiceModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "services",
  "polymarket",
  "index.js",
)).href;
const { runPolymarketDomainService } = await import(polymarketServiceModulePath);

await run("P32-C1 polymarket service builds scoped query and returns normalized success envelope", async () => {
  let receivedQuery = "";
  const out = await runPolymarketDomainService({
    text: "show polymarket odds for election 2028",
    userContextId: "tenant-a",
    conversationId: "thread-a",
    sessionKey: "agent:nova:hud:user:tenant-a:dm:thread-a",
  }, {
    providerAdapter: {
      async searchMarkets(input = {}) {
        receivedQuery = String(input.query || "");
        return {
          ok: true,
          code: "polymarket.search_ok",
          message: "ok",
          providerId: "web_search",
          adapterId: "web-search-tool-adapter",
          attempts: 1,
          results: [{
            title: "Will candidate X win the 2028 election?",
            url: "https://polymarket.com/event/election-2028",
            snippet: "Live odds market for the 2028 election.",
          }],
        };
      },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.action, "scan");
  assert.equal(out.route, "polymarket");
  assert.equal(out.responseRoute, "polymarket");
  assert.equal(receivedQuery.includes("site:polymarket.com"), true);
  assert.equal(receivedQuery.toLowerCase().includes("election 2028"), true);
  assert.equal(out.results.length, 1);
  assert.equal(out.telemetry.resultCount, 1);
  assert.equal(out.reply.includes("Will candidate X win the 2028 election?"), true);
});

await run("P32-C2 polymarket service uses short-term follow-up context for generic refresh queries", async () => {
  let receivedQuery = "";
  const out = await runPolymarketDomainService({
    text: "refresh polymarket",
    userContextId: "tenant-b",
    conversationId: "thread-b",
    sessionKey: "agent:nova:hud:user:tenant-b:dm:thread-b",
    requestHints: {
      polymarketShortTermContextSummary: "BTC over 150k by year end",
      polymarketTopicAffinityId: "polymarket_crypto",
    },
  }, {
    providerAdapter: {
      async searchMarkets(input = {}) {
        receivedQuery = String(input.query || "");
        return {
          ok: true,
          code: "polymarket.search_ok",
          message: "ok",
          providerId: "web_search",
          adapterId: "web-search-tool-adapter",
          attempts: 1,
          results: [{
            title: "Will BTC hit $150k by Dec 31?",
            url: "https://polymarket.com/event/btc-150k",
            snippet: "Crypto market odds.",
          }],
        };
      },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.action, "scan");
  assert.equal(receivedQuery.toLowerCase().includes("btc over 150k by year end"), true);
  assert.equal(receivedQuery.toLowerCase().includes("crypto market odds"), true);
});

await run("P32-C3 polymarket service returns deterministic failure envelope when context is missing", async () => {
  const out = await runPolymarketDomainService({
    text: "show polymarket odds",
    userContextId: "tenant-c",
    conversationId: "",
    sessionKey: "",
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "polymarket.context_missing");
  assert.equal(out.route, "polymarket");
  assert.equal(out.responseRoute, "polymarket");
  assert.equal(typeof out.reply, "string");
});

await run("P32-C4 polymarket service handles price action with live token pricing", async () => {
  await withMockFetch(async (url) => {
    const raw = String(url || "");
    if (raw.includes("/public-search") && /btc.*150k/i.test(raw)) {
      return jsonResponse({
        markets: [{
          id: "m1",
          slug: "btc-150k",
          question: "Will BTC hit $150k by Dec 31?",
          outcomes: "[\"Yes\",\"No\"]",
          outcomePrices: "[0.63,0.37]",
          clobTokenIds: "[\"btc-yes\",\"btc-no\"]",
          volume24hr: 2100000,
          acceptingOrders: true,
        }],
      });
    }
    if (raw.includes("/price?token_id=btc-yes")) {
      return jsonResponse({ price: 0.64 });
    }
    throw new Error(`Unexpected fetch URL: ${raw}`);
  }, async () => {
    const out = await runPolymarketDomainService({
      text: "what is btc 150k trading at on polymarket",
      userContextId: "tenant-price",
      conversationId: "thread-price",
      sessionKey: "agent:nova:hud:user:tenant-price:dm:thread-price",
    });

    assert.equal(out.ok, true);
    assert.equal(out.action, "price");
    assert.equal(out.code, "polymarket.price_ok");
    assert.equal(out.reply.includes("64.0%"), true);
    assert.equal(out.results.length, 1);
  });
});

await run("P32-C5 polymarket service handles leaderboard action", async () => {
  await withMockFetch(async (url) => {
    const raw = String(url || "");
    if (raw.includes("/leaderboard") && raw.includes("window=week")) {
      return jsonResponse([
        { rank: 1, username: "trader-a", pnl: 125000.25, volume: 3400000 },
        { rank: 2, username: "trader-b", pnl: 99000.1, volume: 2800000 },
      ]);
    }
    throw new Error(`Unexpected fetch URL: ${raw}`);
  }, async () => {
    const out = await runPolymarketDomainService({
      text: "show polymarket leaderboard this week",
      userContextId: "tenant-leaderboard",
      conversationId: "thread-leaderboard",
      sessionKey: "agent:nova:hud:user:tenant-leaderboard:dm:thread-leaderboard",
    });

    assert.equal(out.ok, true);
    assert.equal(out.action, "leaderboard");
    assert.equal(out.code, "polymarket.leaderboard_ok");
    assert.equal(out.reply.includes("#1 trader-a"), true);
    assert.equal(out.results.length, 2);
  });
});

await run("P32-C6 polymarket service handles compare action", async () => {
  await withMockFetch(async (url) => {
    const raw = String(url || "");
    if (raw.includes("/public-search") && /btc.*150k/i.test(raw)) {
      return jsonResponse({
        markets: [{
          slug: "btc-150k",
          question: "Will BTC hit $150k by Dec 31?",
          outcomes: "[\"Yes\",\"No\"]",
          outcomePrices: "[0.63,0.37]",
          clobTokenIds: "[\"btc-yes\",\"btc-no\"]",
        }],
      });
    }
    if (raw.includes("/public-search") && /eth.*8k/i.test(raw)) {
      return jsonResponse({
        markets: [{
          slug: "eth-8k",
          question: "Will ETH hit $8k by Dec 31?",
          outcomes: "[\"Yes\",\"No\"]",
          outcomePrices: "[0.42,0.58]",
          clobTokenIds: "[\"eth-yes\",\"eth-no\"]",
        }],
      });
    }
    if (raw.includes("/price?token_id=btc-yes")) return jsonResponse({ price: 0.65 });
    if (raw.includes("/price?token_id=eth-yes")) return jsonResponse({ price: 0.44 });
    throw new Error(`Unexpected fetch URL: ${raw}`);
  }, async () => {
    const out = await runPolymarketDomainService({
      text: "compare btc 150k vs eth 8k on polymarket",
      userContextId: "tenant-compare",
      conversationId: "thread-compare",
      sessionKey: "agent:nova:hud:user:tenant-compare:dm:thread-compare",
    });

    assert.equal(out.ok, true);
    assert.equal(out.action, "compare");
    assert.equal(out.code, "polymarket.compare_ok");
    assert.equal(out.reply.includes("Will BTC hit $150k"), true);
    assert.equal(out.reply.includes("Will ETH hit $8k"), true);
    assert.equal(out.results.length, 2);
  });
});

await run("P32-C7 polymarket service routes alert intent through mission builder", async () => {
  let capturedMissionPrompt = "";
  await withMockFetch(async (url) => {
    const raw = String(url || "");
    if (raw.includes("/public-search") && /btc.*150k/i.test(raw)) {
      return jsonResponse({
        markets: [{
          slug: "btc-150k",
          question: "Will BTC hit $150k by Dec 31?",
          outcomes: "[\"Yes\",\"No\"]",
          outcomePrices: "[0.63,0.37]",
          clobTokenIds: "[\"btc-yes\",\"btc-no\"]",
        }],
      });
    }
    throw new Error(`Unexpected fetch URL: ${raw}`);
  }, async () => {
    const out = await runPolymarketDomainService({
      text: "set up an alert when btc 150k goes above 80% on polymarket and send to slack",
      userContextId: "tenant-alert",
      conversationId: "thread-alert",
      sessionKey: "agent:nova:hud:user:tenant-alert:dm:thread-alert",
      supabaseAccessToken: "test-token",
    }, {
      runMissionsDomainService: async (input = {}) => {
        capturedMissionPrompt = String(input.text || "");
        return {
          ok: true,
          provider: "mission-smoke",
          reply: "Done - your alert mission is deployed.",
          data: { missionId: "mission-smoke-1" },
        };
      },
    });

    assert.equal(out.ok, true);
    assert.equal(out.action, "alert_create");
    assert.equal(out.code, "polymarket.alert_created");
    assert.equal(Array.isArray(out.toolCalls), true);
    assert.equal(out.toolCalls.includes("mission"), true);
    assert.equal(capturedMissionPrompt.includes("polymarket-price-trigger"), true);
    assert.equal(capturedMissionPrompt.includes("threshold 0.8000"), true);
  });
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
