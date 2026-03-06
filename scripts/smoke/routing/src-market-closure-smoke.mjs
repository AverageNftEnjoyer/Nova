import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

const marketWorkerSource = fs.readFileSync(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "workers",
  "market",
  "market-agent",
  "index.js",
), "utf8");

await run("MKT-CLOSE-1 market worker scopes stopSpeaking and speak by userContextId", async () => {
  assert.equal(marketWorkerSource.includes("stopSpeaking(userContextId ? { userContextId } : undefined);"), true);
  assert.equal(marketWorkerSource.includes("userContextId ? { userContextId } : undefined"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
