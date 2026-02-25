import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { tryCryptoFastPathReply } from "../../../src/runtime/modules/chat/fast-path/crypto-fast-path.js";

const logCalls = [];
const availableTools = [
  { name: "coinbase_capabilities" },
  { name: "coinbase_spot_price" },
  { name: "coinbase_portfolio_snapshot" },
  { name: "coinbase_recent_transactions" },
  { name: "coinbase_portfolio_report" },
];

const runtimeTools = {
  async executeToolUse(toolUse) {
    const name = String(toolUse?.name || "");
    const input = toolUse?.input || {};
    logCalls.push({
      name,
      userContextId: String(input.userContextId || ""),
      conversationId: String(input.conversationId || ""),
    });
    if (name === "coinbase_spot_price") {
      return { content: JSON.stringify({ ok: true, source: "coinbase", data: { symbolPair: String(input.symbolPair || "BTC-USD"), price: 101234.56, freshnessMs: 1200 } }) };
    }
    if (name === "coinbase_portfolio_snapshot") {
      return { content: JSON.stringify({ ok: true, source: "coinbase", data: { balances: [{ assetSymbol: "BTC", total: 1.2 }], freshnessMs: 2000 } }) };
    }
    if (name === "coinbase_recent_transactions") {
      return { content: JSON.stringify({ ok: true, source: "coinbase", freshnessMs: 3400, events: [{ side: "buy", quantity: 0.5, assetSymbol: "BTC", price: 100000, occurredAtMs: Date.now() - 20_000 }] }) };
    }
    if (name === "coinbase_portfolio_report") {
      return { content: JSON.stringify({ ok: true, source: "coinbase", report: { summary: { nonZeroAssetCount: 2, transactionCount: 3 }, portfolio: { freshnessMs: 3000 } } }) };
    }
    if (name === "coinbase_capabilities") {
      return { content: JSON.stringify({ ok: true, source: "coinbase", checkedAtMs: Date.now(), capabilities: { status: "connected", marketData: "available", portfolio: "available", transactions: "available" } }) };
    }
    return { content: JSON.stringify({ ok: false, errorCode: "UNKNOWN_TOOL" }) };
  },
};

async function ask(text, userContextId = "u-matrix", conversationId = "c-matrix") {
  return tryCryptoFastPathReply({ text, runtimeTools, availableTools, userContextId, conversationId });
}

function countTool(name) {
  return logCalls.filter((call) => call.name === name).length;
}

const cases = [];
async function runCase(id, fn) {
  try {
    await fn();
    cases.push({ id, status: "PASS" });
  } catch (error) {
    cases.push({ id, status: "FAIL", detail: error instanceof Error ? error.message : String(error) });
  }
}

const beforeCounts = {};
for (const tool of availableTools) beforeCounts[tool.name] = countTool(tool.name);

await runCase("A01", async () => {
  const res = await ask("price btc");
  assert.match(res.reply, /BTC-USD now:/i);
  assert.match(res.reply, /Freshness:/i);
  assert.match(res.reply, /Source:/i);
});
await runCase("A02", async () => assert.match((await ask("price eth")).reply, /ETH-USD now:/i));
await runCase("A03", async () => assert.match((await ask("btc price")).reply, /BTC-USD now:/i));
await runCase("A04", async () => assert.match((await ask("portfolio")).reply, /portfolio snapshot/i));
await runCase("A05", async () => assert.match((await ask("my portfolio")).reply, /portfolio snapshot/i));
await runCase("A06", async () => assert.match((await ask("my crypto report")).reply, /crypto report/i));
await runCase("A07", async () => assert.match((await ask("weekly pnl")).reply, /crypto report/i));
await runCase("A08", async () => assert.match((await ask("recent transactions")).reply, /Recent Coinbase transactions/i));
await runCase("A09", async () => assert.match((await ask("coinbase status")).reply, /Coinbase status:/i));
await runCase("A10", async () => assert.match((await ask("crypto help")).reply, /Commands:/i));

await runCase("T01", async () => assert.match((await ask("prcie btc")).reply, /BTC-USD now:/i));
await runCase("T02", async () => assert.match((await ask("pirce eth")).reply, /ETH-USD now:/i));
await runCase("T03", async () => assert.match((await ask("portfolo")).reply, /portfolio snapshot/i));
await runCase("T04", async () => assert.match((await ask("my crytpo report")).reply, /crypto report/i));
await runCase("T05", async () => assert.match((await ask("wekly pnl")).reply, /crypto report/i));
await runCase("T06", async () => assert.match((await ask("recnt trasnactions")).reply, /Recent Coinbase transactions/i));
await runCase("T07", async () => assert.match((await ask("coibase status")).reply, /Coinbase status:/i));
await runCase("T08", async () => assert.match((await ask("price btcc")).reply, /Did you mean BTC-USD/i));

await runCase("G01", async () => assert.match((await ask("price")).reply, /I can pull that, but I need the target|Share the crypto ticker/i));
await runCase("G02", async () => assert.match((await ask("price usd")).reply, /Share the crypto ticker/i));
await runCase("G03", async () => assert.match((await ask("weekly report")).reply, /weekly portfolio report or weekly PnL report/i));
await runCase("G04", async () => assert.match((await ask("transfer funds")).reply, /out of scope/i));
await runCase("G05", async () => assert.match((await ask("buy btc now")).reply, /out of scope/i));

const prevDisabled = process.env.NOVA_COINBASE_DISABLED_COMMAND_CATEGORIES;
await runCase("C01", async () => {
  process.env.NOVA_COINBASE_DISABLED_COMMAND_CATEGORIES = "price";
  const before = countTool("coinbase_spot_price");
  const res = await ask("price btc");
  assert.match(res.reply, /disabled by admin policy/i);
  assert.equal(countTool("coinbase_spot_price"), before);
});
await runCase("C02", async () => {
  process.env.NOVA_COINBASE_DISABLED_COMMAND_CATEGORIES = "portfolio";
  const before = countTool("coinbase_portfolio_snapshot");
  const res = await ask("portfolio");
  assert.match(res.reply, /disabled by admin policy/i);
  assert.equal(countTool("coinbase_portfolio_snapshot"), before);
});
await runCase("C03", async () => {
  process.env.NOVA_COINBASE_DISABLED_COMMAND_CATEGORIES = "transactions";
  const before = countTool("coinbase_recent_transactions");
  const res = await ask("recent transactions");
  assert.match(res.reply, /disabled by admin policy/i);
  assert.equal(countTool("coinbase_recent_transactions"), before);
});
await runCase("C04", async () => {
  process.env.NOVA_COINBASE_DISABLED_COMMAND_CATEGORIES = "reports";
  const before = countTool("coinbase_portfolio_report");
  const res = await ask("weekly pnl");
  assert.match(res.reply, /disabled by admin policy/i);
  assert.equal(countTool("coinbase_portfolio_report"), before);
});
await runCase("C05", async () => {
  process.env.NOVA_COINBASE_DISABLED_COMMAND_CATEGORIES = "";
  const res = await ask("price btc");
  assert.match(res.reply, /Freshness:/i);
});
if (prevDisabled === undefined) delete process.env.NOVA_COINBASE_DISABLED_COMMAND_CATEGORIES;
else process.env.NOVA_COINBASE_DISABLED_COMMAND_CATEGORIES = prevDisabled;

await runCase("ISO1", async () => {
  const first = await ask("price btc", "user-a", "conv-a");
  const second = await ask("portfolio", "user-b", "conv-b");
  assert.match(first.reply, /BTC-USD now:/i);
  assert.match(second.reply, /portfolio snapshot/i);
  const hasA = logCalls.some((c) => c.userContextId === "user-a");
  const hasB = logCalls.some((c) => c.userContextId === "user-b");
  assert.equal(hasA && hasB, true);
});

const pass = cases.filter((c) => c.status === "PASS").length;
const fail = cases.filter((c) => c.status === "FAIL").length;

const report = {
  ts: new Date().toISOString(),
  pass,
  fail,
  total: cases.length,
  cases,
  toolCalls: logCalls,
  startToolCounts: beforeCounts,
};

const reportPath = path.join(process.cwd(), "archive", "logs", "coinbase-phase7-matrix-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

for (const c of cases) {
  const detail = c.detail ? ` :: ${c.detail}` : "";
  console.log(`[${c.status}] ${c.id}${detail}`);
}
console.log(`report=${reportPath}`);
console.log(`Summary: pass=${pass} fail=${fail} total=${cases.length}`);
if (fail > 0) process.exit(1);

