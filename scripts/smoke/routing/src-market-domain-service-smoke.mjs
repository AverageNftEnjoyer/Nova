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

const marketServiceModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "services",
  "market",
  "index.js",
)).href;
const { runMarketDomainService } = await import(marketServiceModulePath);

await run("P33-C1 market service builds scoped query and returns normalized success envelope", async () => {
  let receivedQuery = "";
  const out = await runMarketDomainService({
    text: "show stock market trend today",
    userContextId: "tenant-a",
    conversationId: "thread-a",
    sessionKey: "agent:nova:hud:user:tenant-a:dm:thread-a",
  }, {
    providerAdapter: {
      async searchMarket(input = {}) {
        receivedQuery = String(input.query || "");
        return {
          ok: true,
          code: "market.search_ok",
          message: "ok",
          providerId: "web_search",
          adapterId: "web-search-tool-adapter",
          attempts: 1,
          results: [{
            title: "Stocks edge higher as Nasdaq leads",
            url: "https://example.com/markets/nasdaq",
            snippet: "Nasdaq and S&P traded higher in the latest session.",
          }],
        };
      },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.route, "market");
  assert.equal(out.responseRoute, "market");
  assert.equal(receivedQuery.toLowerCase().includes("stock market trend today"), true);
  assert.equal(out.results.length, 1);
  assert.equal(out.telemetry.resultCount, 1);
  assert.equal(out.reply.includes("Stocks edge higher as Nasdaq leads"), true);
});

await run("P33-C2 market service uses short-term follow-up context for generic refresh queries", async () => {
  let receivedQuery = "";
  const out = await runMarketDomainService({
    text: "refresh market",
    userContextId: "tenant-b",
    conversationId: "thread-b",
    sessionKey: "agent:nova:hud:user:tenant-b:dm:thread-b",
    requestHints: {
      marketShortTermContextSummary: "Nasdaq and S&P 500 intraday move",
      marketTopicAffinityId: "market_equities",
    },
  }, {
    providerAdapter: {
      async searchMarket(input = {}) {
        receivedQuery = String(input.query || "");
        return {
          ok: true,
          code: "market.search_ok",
          message: "ok",
          providerId: "web_search",
          adapterId: "web-search-tool-adapter",
          attempts: 1,
          results: [{
            title: "Nasdaq and S&P finish mixed",
            url: "https://example.com/markets/spx",
            snippet: "Large-cap indices finished mixed.",
          }],
        };
      },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(receivedQuery.toLowerCase().includes("nasdaq and s&p 500 intraday move"), true);
  assert.equal(receivedQuery.toLowerCase().includes("stock market index update"), true);
});

await run("P33-C3 market service returns deterministic failure envelope when context is missing", async () => {
  const out = await runMarketDomainService({
    text: "show market trend",
    userContextId: "tenant-c",
    conversationId: "",
    sessionKey: "",
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "market.context_missing");
  assert.equal(out.route, "market");
  assert.equal(out.responseRoute, "market");
  assert.equal(typeof out.reply, "string");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
