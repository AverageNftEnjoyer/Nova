import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const nativeRequire = createRequire(import.meta.url);

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

function loadTsModule(relativePath, requireMap = {}, extraGlobals = {}) {
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
      return nativeRequire(specifier);
    },
    console,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    ...extraGlobals,
  };
  vm.runInNewContext(compiled, sandbox, { filename: `${relativePath}.cjs` });
  return module.exports;
}

const repoRoot = process.cwd();
const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-cb-step-smoke-"));
const hudRoot = path.join(tmpRoot, "hud");
await fsp.mkdir(hudRoot, { recursive: true });

const artifactModule = loadTsModule(
  "hud/lib/missions/workflow/coinbase-artifacts.ts",
  {},
  {
    process: { ...process, cwd: () => hudRoot, env: process.env },
  },
);

const stableFetchPayload = {
  ok: true,
  source: "coinbase",
  primitive: "daily_portfolio_summary",
  checkedAtMs: Date.now(),
  checkedAtIso: new Date().toISOString(),
  quoteCurrency: "USD",
  assets: ["BTC", "ETH"],
  prices: [{ symbolPair: "BTC-USD", baseAsset: "BTC", quoteAsset: "USD", price: 100000, fetchedAtMs: Date.now() }],
  portfolio: { balances: [], fetchedAtMs: Date.now() },
  transactions: [],
  integration: {
    connected: true,
    lastSyncAt: "",
    lastSyncStatus: "success",
    lastSyncErrorCode: "",
    lastSyncErrorMessage: "",
    lastFreshnessMs: 0,
  },
  notes: [],
};

const coinbaseStepModule = loadTsModule(
  "hud/lib/missions/workflow/coinbase-step.ts",
  {
    "../coinbase/fetch": {
      parseCoinbaseFetchQuery: () => ({}),
      fetchCoinbaseMissionData: async () => stableFetchPayload,
    },
    "./coinbase-artifacts": artifactModule,
  },
  {
    process: { ...process, cwd: () => hudRoot, env: process.env },
  },
);

await run("P26-CB1 deterministic coinbase generation path emits type=coinbase step", async () => {
  const source = fs.readFileSync(path.join(repoRoot, "hud/lib/missions/workflow/generation.ts"), "utf8");
  assert.equal(source.includes('type: "coinbase"'), true);
  assert.equal(source.includes("deterministic-coinbase-template"), true);
});

await run("P26-CB2 coinbase step executes, persists artifact, and re-reads on next run", async () => {
  const { executeCoinbaseWorkflowStep } = coinbaseStepModule;
  assert.equal(typeof executeCoinbaseWorkflowStep, "function");
  const step = {
    id: "step-coinbase-1",
    type: "coinbase",
    title: "Run Coinbase step",
    coinbaseIntent: "report",
    coinbaseParams: {
      assets: ["BTC", "ETH"],
      quoteCurrency: "USD",
      includePreviousArtifactContext: true,
    },
    coinbaseFormat: { style: "standard", includeRawMetadata: true },
  };

  const first = await executeCoinbaseWorkflowStep({
    step,
    userContextId: "smoke-user-a",
    conversationId: "conv-a",
    missionId: "mission-a",
    missionRunId: "run-1",
    scope: { userId: "smoke-user-a" },
  });
  assert.equal(first.ok, true);
  assert.equal(typeof first.artifactRef, "string");

  const second = await executeCoinbaseWorkflowStep({
    step,
    userContextId: "smoke-user-a",
    conversationId: "conv-a",
    missionId: "mission-a",
    missionRunId: "run-2",
    scope: { userId: "smoke-user-a" },
  });
  assert.equal(second.ok, true);
  assert.equal(second.recentArtifacts.length >= 1, true);
  assert.equal(second.priorArtifactContextSnippet.includes(String(first.artifactRef)), true);

  const artifactDir = path.join(tmpRoot, ".agent", "user-context", "smoke-user-a", "missions", "coinbase-artifacts");
  const files = await fsp.readdir(artifactDir);
  assert.equal(files.some((name) => name.endsWith(".jsonl")), true);
});

await run("P26-CB4 telemetry emits user-safe structured events with required ids", async () => {
  const { executeCoinbaseWorkflowStep } = coinbaseStepModule;
  const events = [];
  const step = {
    id: "step-coinbase-telemetry",
    type: "coinbase",
    title: "Run Coinbase step",
    coinbaseIntent: "report",
    coinbaseParams: { assets: ["BTC"], quoteCurrency: "USD", includePreviousArtifactContext: true },
  };

  const result = await executeCoinbaseWorkflowStep({
    step,
    userContextId: "smoke-user-t",
    conversationId: "conv-t",
    missionId: "mission-t",
    missionRunId: "run-t",
    scope: { userId: "smoke-user-t" },
    logger: (entry) => events.push(entry),
  });
  assert.equal(result.ok, true);
  assert.equal(events.some((event) => event.event === "coinbase.step.generated"), true);
  assert.equal(events.some((event) => event.event === "coinbase.step.executed"), true);
  const required = ["userContextId", "conversationId", "missionRunId", "stepId"];
  for (const event of events) {
    if (!String(event?.event || "").startsWith("coinbase.step.")) continue;
    for (const key of required) {
      assert.equal(typeof event[key] === "string" && String(event[key]).trim().length > 0, true);
    }
  }
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});

if (failCount > 0) process.exit(1);
