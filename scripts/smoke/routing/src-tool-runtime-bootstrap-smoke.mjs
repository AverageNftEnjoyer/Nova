import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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

const runtimeCompatModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "tools", "runtime", "runtime-compat", "index.js")).href,
);
const { createToolRuntime } = runtimeCompatModule;

await run("P22-C1 bootstrap failure is bounded and does not loop warnings", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-tool-bootstrap-"));
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map((entry) => String(entry || "")).join(" "));
  try {
    const runtime = createToolRuntime({
      enabled: true,
      memoryEnabled: false,
      rootDir: tmpRoot,
      memoryDbPath: path.join(tmpRoot, "memory.db"),
      memorySourceDir: path.join(tmpRoot, "memory"),
      enabledTools: [],
      execApprovalMode: "auto",
      safeBinaries: [],
      webSearchProvider: "",
      webSearchApiKey: "",
      allowElevatedTools: false,
      allowDangerousTools: false,
      elevatedToolAllowlist: "",
      dangerousToolAllowlist: "",
      enforceCapabilities: false,
      capabilityAllowlist: "",
      capabilityDenylist: "",
      memoryConfig: {
        embeddingProvider: "",
        embeddingModel: "",
        embeddingApiKey: "",
        chunkSize: 400,
        chunkOverlap: 80,
        hybridVectorWeight: 0.7,
        hybridBm25Weight: 0.3,
        topK: 8,
      },
      describeUnknownError: (err) => String(err?.message || err || ""),
    });

    const first = await runtime.initToolRuntimeIfNeeded({ userContextId: "bootstrap-user" });
    const second = await runtime.initToolRuntimeIfNeeded({ userContextId: "bootstrap-user" });
    assert.equal(first?.initialized, false);
    assert.equal(second?.initialized, false);

    const unavailableWarnings = warnings.filter((line) => line.includes("Agent core build bootstrap unavailable"));
    assert.equal(unavailableWarnings.length, 1);
  } finally {
    console.warn = originalWarn;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

await run("P22-C2 bootstrap warning path avoids npm.cmd EINVAL spawn regression", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-tool-bootstrap-einval-"));
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map((entry) => String(entry || "")).join(" "));
  try {
    const runtime = createToolRuntime({
      enabled: true,
      memoryEnabled: false,
      rootDir: tmpRoot,
      memoryDbPath: path.join(tmpRoot, "memory.db"),
      memorySourceDir: path.join(tmpRoot, "memory"),
      enabledTools: [],
      execApprovalMode: "auto",
      safeBinaries: [],
      webSearchProvider: "",
      webSearchApiKey: "",
      allowElevatedTools: false,
      allowDangerousTools: false,
      elevatedToolAllowlist: "",
      dangerousToolAllowlist: "",
      enforceCapabilities: false,
      capabilityAllowlist: "",
      capabilityDenylist: "",
      memoryConfig: {
        embeddingProvider: "",
        embeddingModel: "",
        embeddingApiKey: "",
        chunkSize: 400,
        chunkOverlap: 80,
        hybridVectorWeight: 0.7,
        hybridBm25Weight: 0.3,
        topK: 8,
      },
      describeUnknownError: (err) => String(err?.message || err || ""),
    });
    await runtime.initToolRuntimeIfNeeded({ userContextId: "bootstrap-user" });
    const joined = warnings.join("\n");
    assert.equal(joined.includes("npm.cmd EINVAL"), false);
  } finally {
    console.warn = originalWarn;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
