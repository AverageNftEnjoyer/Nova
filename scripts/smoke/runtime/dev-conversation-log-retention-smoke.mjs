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

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

await run("DCLR-1 Dev conversation global log keeps append path", async () => {
  const src = read("src/runtime/modules/chat/telemetry/dev-conversation-log/index.js");
  assert.equal(src.includes("conversation-dev-all.jsonl"), true);
  assert.equal(src.includes("fs.appendFileSync(DEV_CONVERSATION_GLOBAL_LOG_PATH"), true);
});

await run("DCLR-2 Dev conversation global archive mirror appends daily file", async () => {
  const src = read("src/runtime/modules/chat/telemetry/dev-conversation-log/index.js");
  assert.equal(src.includes("DEV_CONVERSATION_GLOBAL_ARCHIVE_MIRROR_ENABLED"), true);
  assert.equal(src.includes("resolveGlobalArchiveMirrorPath"), true);
  assert.equal(src.includes("conversation-dev-all-"), true);
  assert.equal(src.includes("fs.appendFileSync(mirrorPath"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
