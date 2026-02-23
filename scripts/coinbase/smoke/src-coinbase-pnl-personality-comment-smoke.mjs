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

function loadPersonalityModule() {
  const filePath = path.join(process.cwd(), "src", "integrations", "coinbase", "pnl-personality-comment.ts");
  const source = fs.readFileSync(filePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: "pnl-personality-comment.ts",
  }).outputText;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: () => {
      throw new Error("No external requires expected.");
    },
    console,
  };
  vm.runInNewContext(compiled, sandbox, { filename: "pnl-personality-comment.cjs" });
  return module.exports;
}

const { buildCoinbasePnlPersonalityComment } = loadPersonalityModule();

const scenarios = [
  { id: "T1", tone: "enthusiastic", assistantName: "Nova", cadence: "daily", total: 10000, recent: 1400, seed: "u1" },
  { id: "T2", tone: "enthusiastic", assistantName: "Nova", cadence: "weekly", total: 12000, recent: -1700, seed: "u2" },
  { id: "T3", tone: "calm", assistantName: "Astra", cadence: "daily", total: 15000, recent: 1700, seed: "u3" },
  { id: "T4", tone: "calm", assistantName: "Astra", cadence: "weekly", total: 16000, recent: -2100, seed: "u4" },
  { id: "T5", tone: "direct", assistantName: "Quanta", cadence: "daily", total: 9000, recent: 1100, seed: "u5" },
  { id: "T6", tone: "direct", assistantName: "Quanta", cadence: "weekly", total: 11000, recent: -1500, seed: "u6" },
  { id: "T7", tone: "relaxed", assistantName: "Luna", cadence: "daily", total: 13000, recent: 1600, seed: "u7" },
  { id: "T8", tone: "relaxed", assistantName: "Luna", cadence: "weekly", total: 14000, recent: -1600, seed: "u8" },
  { id: "T9", tone: "neutral", assistantName: "Nova", cadence: "report", total: 20000, recent: 2600, seed: "u9" },
  { id: "T10", tone: "neutral", assistantName: "Nova", cadence: "report", total: 20000, recent: -2600, seed: "u10" },
];

await run("P23-C1 generates 10 personality comments for >=10% pnl scenarios", async () => {
  const lines = scenarios.map((scenario) =>
    buildCoinbasePnlPersonalityComment({
      assistantName: scenario.assistantName,
      tone: scenario.tone,
      cadence: scenario.cadence,
      estimatedTotalUsd: scenario.total,
      recentNetNotionalUsd: scenario.recent,
      thresholdPct: 10,
      seedKey: scenario.seed,
    }),
  );

  lines.forEach((line, index) => {
    assert.equal(typeof line, "string");
    assert.equal(line.trim().length > 0, true, `scenario ${scenarios[index].id} should produce a comment`);
  });

  console.log("\nGenerated 10 fake-data responses:");
  scenarios.forEach((scenario, index) => {
    console.log(`${scenario.id} (${scenario.tone}, ${scenario.cadence}, pnl=${((scenario.recent / scenario.total) * 100).toFixed(1)}%):`);
    console.log(`  ${lines[index]}`);
  });
});

await run("P23-C2 returns empty comment below threshold", async () => {
  const line = buildCoinbasePnlPersonalityComment({
    assistantName: "Nova",
    tone: "enthusiastic",
    cadence: "daily",
    estimatedTotalUsd: 10000,
    recentNetNotionalUsd: 500,
    thresholdPct: 10,
    seedKey: "below-threshold",
  });
  assert.equal(line, "");
});

await run("P23-C3 deterministic output for same seed and inputs", async () => {
  const input = {
    assistantName: "Nova",
    tone: "direct",
    cadence: "weekly",
    estimatedTotalUsd: 10000,
    recentNetNotionalUsd: -1200,
    thresholdPct: 10,
    seedKey: "deterministic",
  };
  const a = buildCoinbasePnlPersonalityComment(input);
  const b = buildCoinbasePnlPersonalityComment(input);
  assert.equal(a, b);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
