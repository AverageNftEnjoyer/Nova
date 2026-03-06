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

const modulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "workers",
  "shared",
  "delegated-chat-worker",
  "index.js",
)).href;

const { runDelegatedChatWorker } = await import(modulePath);

await run("P31-C1 delegated chat worker normalizes object summaries to canonical contract", async () => {
  const out = await runDelegatedChatWorker({
    text: "hello",
    ctx: {},
    llmCtx: { activeChatRuntime: { provider: "openai" } },
    requestHints: {},
    route: "gmail",
    executeChatRequest: async () => ({
      route: "gmail",
      ok: true,
      reply: "done",
      toolCalls: ["gmail"],
    }),
  });
  assert.equal(out.route, "gmail");
  assert.equal(out.responseRoute, "gmail");
  assert.equal(out.ok, true);
  assert.equal(out.reply, "done");
  assert.equal(Array.isArray(out.toolCalls), true);
  assert.equal(Array.isArray(out.toolExecutions), true);
  assert.equal(Array.isArray(out.retries), true);
  assert.equal(typeof out.requestHints, "object");
});

await run("P31-C2 delegated chat worker normalizes non-object responses", async () => {
  const out = await runDelegatedChatWorker({
    text: "hello",
    ctx: {},
    llmCtx: { activeChatRuntime: { provider: "claude" } },
    requestHints: {},
    route: "telegram",
    executeChatRequest: async () => "plain text",
  });
  assert.equal(out.route, "telegram");
  assert.equal(out.responseRoute, "telegram");
  assert.equal(out.reply, "plain text");
  assert.equal(out.provider, "claude");
  assert.equal(out.error, "");
});

await run("P31-C3 delegated chat worker requires executeChatRequest callback", async () => {
  let errorText = "";
  try {
    await runDelegatedChatWorker({
      text: "hello",
      route: "chat",
    });
  } catch (error) {
    errorText = String(error?.message || "");
  }
  assert.equal(errorText.includes("executeChatRequest"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);

