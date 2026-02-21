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

const userContextId = String(process.env.NOVA_SMOKE_USER_CONTEXT_ID || "").trim();
if (!userContextId) {
  record(
    "SKIP",
    "Workstream B live smoke requires NOVA_SMOKE_USER_CONTEXT_ID",
    "Set env var and rerun for real user-context constrained chat checks.",
  );
  summarize(results[0]);
  process.exit(0);
}

const chatHandlerModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/core/chat-handler.js")).href
);
const constraintsModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/quality/output-constraints.js")).href
);

const { handleInput } = chatHandlerModule;
const { parseOutputConstraints, validateOutputConstraints } = constraintsModule;

const conversationId = `workstream-b-${Date.now()}`;
const sessionKeyHint = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;

async function ask(text) {
  const result = await handleInput(text, {
    source: "hud",
    sender: "hud-user",
    voice: false,
    userContextId,
    conversationId,
    sessionKeyHint,
  });
  return String(result?.reply || "").trim();
}

await run("B-live-1 one-word compliance", async () => {
  const prompt = "Answer with one word: blue or green?";
  const reply = await ask(prompt);
  assert.ok(reply.length > 0, "empty reply");
  const parsed = parseOutputConstraints(prompt);
  const check = validateOutputConstraints(reply, parsed);
  assert.equal(check.ok, true, `constraint violation: ${check.reason}; reply=${JSON.stringify(reply)}`);
});

await run("B-live-2 exact bullet count compliance", async () => {
  const prompt = "Give exactly 3 bullet points about websocket reconnect reliability.";
  const reply = await ask(prompt);
  assert.ok(reply.length > 0, "empty reply");
  const parsed = parseOutputConstraints(prompt);
  const check = validateOutputConstraints(reply, parsed);
  assert.equal(check.ok, true, `constraint violation: ${check.reason}; reply=${JSON.stringify(reply)}`);
});

await run("B-live-3 JSON-only compliance", async () => {
  const prompt = "Respond with JSON only with keys risk and action.";
  const reply = await ask(prompt);
  assert.ok(reply.length > 0, "empty reply");
  const parsed = parseOutputConstraints(prompt);
  const check = validateOutputConstraints(reply, parsed);
  assert.equal(check.ok, true, `constraint violation: ${check.reason}; reply=${JSON.stringify(reply)}`);
  const parsedJson = JSON.parse(reply);
  assert.equal(typeof parsedJson, "object");
  assert.equal(Array.isArray(parsedJson), false);
  const keys = Object.keys(parsedJson).sort();
  assert.deepEqual(keys, ["action", "risk"]);
});

await run("B-live-4 exact sentence count compliance", async () => {
  const prompt = "Explain why backoff jitter matters in exactly two short sentences.";
  const reply = await ask(prompt);
  assert.ok(reply.length > 0, "empty reply");
  const parsed = parseOutputConstraints(prompt);
  const check = validateOutputConstraints(reply, parsed);
  assert.equal(check.ok, true, `constraint violation: ${check.reason}; reply=${JSON.stringify(reply)}`);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
