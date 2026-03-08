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

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.equal(start >= 0, true, `Missing start marker: ${startMarker}`);
  assert.equal(end > start, true, `Missing end marker after ${startMarker}`);
  return source.slice(start, end);
}

const typesSource = read("hud/lib/missions/job-ledger/types.ts");
const storeSource = read("hud/lib/missions/job-ledger/store.ts");

const enqueueBody = sliceBetween(
  storeSource,
  "async enqueue(input: EnqueueJobInput) {",
  "async claimRun(input: { jobRunId: string; leaseDurationMs: number }) {",
);

await run("P7-JL-1 enqueue contract is success-only and does not expose inserted rows", async () => {
  assert.equal(typesSource.includes('Promise<{ ok: true } | { ok: false; error: string }>'), true);
  assert.equal(enqueueBody.includes(".insert(row)"), true);
  assert.equal(enqueueBody.includes(".select("), false);
  assert.equal(enqueueBody.includes("jobRun:"), false);
  assert.equal(enqueueBody.includes("return { ok: true }"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
