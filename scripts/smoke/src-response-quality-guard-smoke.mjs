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

const guardModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/quality/response-quality-guard.js")).href
);
const replyNormalizerModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/quality/reply-normalizer.js")).href
);

const {
  normalizeInboundUserText,
  shouldUseVagueClarifier,
  repairBrokenReadability,
} = guardModule;
const { normalizeAssistantReply } = replyNormalizerModule;

await run("Inbound sanitizer strips ANSI and bracketed-paste artifacts", async () => {
  const dirty = "hello\u001B[201~ world [200~ [201~";
  const clean = normalizeInboundUserText(dirty);
  assert.equal(clean.includes("\u001B"), false);
  assert.equal(clean.includes("[200~"), false);
  assert.equal(clean.includes("[201~"), false);
  assert.equal(clean, "hello world");
});

await run("Vague-request classifier catches brief generic asks", async () => {
  const vague = shouldUseVagueClarifier("i just want some advice");
  assert.equal(vague.shouldClarify, true);
  const specific = shouldUseVagueClarifier("I need advice on a backend retry strategy for websocket reconnects");
  assert.equal(specific.shouldClarify, false);
});

await run("Readability repair separates merged alpha-numeric tokens", async () => {
  const repaired = repairBrokenReadability("in5 minutes write2 options compare3 paths");
  assert.equal(repaired.includes("in 5"), true);
  assert.equal(repaired.includes("write 2"), true);
  assert.equal(repaired.includes("compare 3"), true);
});

await run("Reply normalizer removes transport artifacts from model output", async () => {
  const normalized = normalizeAssistantReply("Profile\u001B[201~\nNice. If’re not sure [200~");
  assert.equal(normalized.skip, false);
  assert.equal(normalized.text.includes("\u001B"), false);
  assert.equal(normalized.text.includes("[200~"), false);
  assert.equal(normalized.text.includes("if you're"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
