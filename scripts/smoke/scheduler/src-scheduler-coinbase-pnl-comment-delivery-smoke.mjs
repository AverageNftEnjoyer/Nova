import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

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

function loadTsModule(relativePath, requireMap = {}) {
  const fullPath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(fullPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: path.basename(relativePath),
  }).outputText;

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier in requireMap) return requireMap[specifier];
      if (specifier === "server-only") return {};
      throw new Error(`Unexpected require for ${relativePath}: ${specifier}`);
    },
    console,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(compiled, sandbox, { filename: `${relativePath}.cjs` });
  return module.exports;
}

const { buildCoinbasePnlPersonalityComment } = loadTsModule("src/integrations/coinbase/pnl-personality-comment.ts");
const { renderCoinbasePortfolioReport } = loadTsModule("src/integrations/coinbase/report-renderer.ts");

await run("P24-S1 scheduler delivery payload includes personality PnL comment line", async () => {
  const comment = buildCoinbasePnlPersonalityComment({
    assistantName: "Nova",
    tone: "relaxed",
    cadence: "weekly",
    estimatedTotalUsd: 12000,
    recentNetNotionalUsd: 1500,
    thresholdPct: 10,
    transactionCount: 6,
    valuedAssetCount: 4,
    freshnessMs: 30_000,
    seedKey: "scheduler-smoke-user",
  });
  assert.equal(comment.length > 0, true);
  assert.equal(/\bnote\s*\((?:daily|weekly|report)\)\s*:/i.test(comment), true);

  const rendered = renderCoinbasePortfolioReport({
    mode: "concise",
    source: "coinbase",
    generatedAtMs: Date.now(),
    portfolio: {
      source: "coinbase",
      fetchedAtMs: Date.now(),
      freshnessMs: 30_000,
      balances: [
        { assetSymbol: "BTC", available: 0.25, hold: 0, total: 0.25 },
        { assetSymbol: "ETH", available: 1.2, hold: 0, total: 1.2 },
      ],
    },
    transactions: [],
    personalityComment: comment,
  });
  assert.equal(rendered.includes(comment), true);

  let capturedDispatch = null;
  const { dispatchOutput } = loadTsModule("hud/lib/missions/output/dispatch.ts", {
    "@/lib/notifications/dispatcher": {
      dispatchNotification: async (input) => {
        capturedDispatch = input;
        return [{ ok: true, status: 200 }];
      },
    },
    "@/lib/novachat/pending-messages": {
      addPendingMessage: async () => {},
    },
    "../text/formatting": {
      formatNotificationText: (value) => String(value || ""),
    },
  });

  const schedule = {
    id: "mission-smoke-coinbase-comment",
    userId: "smoke-user-ctx",
    label: "Weekly PnL",
    integration: "telegram",
    message: "weekly pnl",
    time: "09:00",
    timezone: "America/New_York",
    enabled: true,
    chatIds: ["chat-1"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runCount: 0,
    successCount: 0,
    failureCount: 0,
  };

  const rows = await dispatchOutput("telegram", rendered, ["chat-1"], schedule);
  assert.equal(Array.isArray(rows), true);
  assert.equal(rows.some((row) => row.ok), true);
  assert.equal(Boolean(capturedDispatch), true);
  assert.equal(String(capturedDispatch.text || "").includes("note ("), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
