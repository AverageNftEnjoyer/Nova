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

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
