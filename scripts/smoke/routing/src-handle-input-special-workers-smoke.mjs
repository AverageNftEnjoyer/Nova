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

const chatHandlerModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler", "index.js")).href,
);

const { handleInput } = chatHandlerModule;

await run("P31-C1 handleInput routes memory updates through memory worker", async () => {
  let workerCalls = 0;
  const out = await handleInput("update your memory that my favorite color is green", {
    source: "hud",
    sender: "hud-user",
    voice: false,
    userContextId: "smoke-special-memory",
    conversationId: "smoke-special-memory-thread",
    sessionKeyHint: "agent:nova:hud:user:smoke-special-memory:dm:smoke-special-memory-thread",
    memoryWorker: async (text, ctx) => {
      workerCalls += 1;
      assert.equal(ctx.userContextId, "smoke-special-memory");
      return {
        route: "memory_update",
        ok: true,
        reply: `memory worker handled: ${text}`,
      };
    },
  });

  assert.equal(out?.route, "memory_update");
  assert.equal(out?.ok, true);
  assert.equal(workerCalls, 1);
  assert.equal(out?.requestHints?.orgChartPath?.workerAgentId, "memory-agent");
  assert.equal(out?.requestHints?.orgChartPath?.domainManagerId, "system-manager");
});

await run("P31-C2 handleInput routes shutdown requests through shutdown worker", async () => {
  let workerCalls = 0;
  const out = await handleInput("shutdown nova", {
    source: "hud",
    sender: "hud-user",
    voice: false,
    userContextId: "smoke-special-shutdown",
    conversationId: "smoke-special-shutdown-thread",
    sessionKeyHint: "agent:nova:hud:user:smoke-special-shutdown:dm:smoke-special-shutdown-thread",
    shutdownWorker: async (text, ctx) => {
      workerCalls += 1;
      assert.equal(ctx.userContextId, "smoke-special-shutdown");
      return {
        route: "shutdown",
        ok: true,
        reply: `shutdown worker handled: ${text}`,
      };
    },
  });

  assert.equal(out?.route, "shutdown");
  assert.equal(out?.ok, true);
  assert.equal(workerCalls, 1);
  assert.equal(out?.requestHints?.orgChartPath?.workerAgentId, "shutdown-agent");
  assert.equal(out?.requestHints?.orgChartPath?.domainManagerId, "system-manager");
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
