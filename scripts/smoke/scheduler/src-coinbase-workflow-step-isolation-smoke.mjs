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

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-cb-isolation-smoke-"));
const hudRoot = path.join(tmpRoot, "hud");
await fsp.mkdir(hudRoot, { recursive: true });

const artifactModule = loadTsModule(
  "hud/lib/missions/workflow/coinbase-artifacts.ts",
  {},
  {
    process: { ...process, cwd: () => hudRoot, env: process.env },
  },
);

await run("P26-CB3 cross-user isolation blocks artifact reads across user contexts", async () => {
  const { persistCoinbaseStepArtifact, loadRecentCoinbaseStepArtifacts } = artifactModule;
  assert.equal(typeof persistCoinbaseStepArtifact, "function");
  assert.equal(typeof loadRecentCoinbaseStepArtifacts, "function");

  const a = await persistCoinbaseStepArtifact({
    userContextId: "user-a",
    conversationId: "conv-1",
    missionId: "mission-1",
    missionRunId: "run-a",
    stepId: "step-a",
    intent: "report",
    summary: "user-a artifact",
    output: { ok: true, source: "coinbase" },
    metadata: { ok: true, retryCount: 0, quoteCurrency: "USD", assets: ["BTC"] },
  });
  const b = await persistCoinbaseStepArtifact({
    userContextId: "user-b",
    conversationId: "conv-1",
    missionId: "mission-1",
    missionRunId: "run-b",
    stepId: "step-b",
    intent: "report",
    summary: "user-b artifact",
    output: { ok: true, source: "coinbase" },
    metadata: { ok: true, retryCount: 0, quoteCurrency: "USD", assets: ["ETH"] },
  });
  assert.equal(typeof a.artifactRef, "string");
  assert.equal(typeof b.artifactRef, "string");

  const listA = await loadRecentCoinbaseStepArtifacts({
    userContextId: "user-a",
    conversationId: "conv-1",
    missionId: "mission-1",
    limit: 10,
  });
  const listB = await loadRecentCoinbaseStepArtifacts({
    userContextId: "user-b",
    conversationId: "conv-1",
    missionId: "mission-1",
    limit: 10,
  });
  assert.equal(listA.some((item) => item.summary.includes("user-a artifact")), true);
  assert.equal(listA.some((item) => item.summary.includes("user-b artifact")), false);
  assert.equal(listB.some((item) => item.summary.includes("user-b artifact")), true);
  assert.equal(listB.some((item) => item.summary.includes("user-a artifact")), false);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});

if (failCount > 0) process.exit(1);
