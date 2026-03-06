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

const shutdownServiceModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "services",
  "shutdown",
  "index.js",
)).href;

const { runShutdownDomainService } = await import(shutdownServiceModulePath);

await run("P39-C1 shutdown domain service enforces scoped context", async () => {
  const out = await runShutdownDomainService({
    text: "shutdown nova",
    userContextId: "",
    conversationId: "",
    sessionKey: "",
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "shutdown.context_missing");
  assert.equal(out.route, "shutdown");
  assert.equal(out.responseRoute, "shutdown");
});

await run("P39-C2 shutdown domain service uses scoped stop + reply and exits when enabled", async () => {
  const events = [];
  const out = await runShutdownDomainService({
    text: "shutdown nova",
    userContextId: "smoke-shutdown-user",
    conversationId: "smoke-shutdown-thread",
    sessionKey: "agent:nova:hud:user:smoke-shutdown-user:dm:smoke-shutdown-thread",
    ctx: {
      source: "hud",
      sender: "hud-user",
      userContextId: "smoke-shutdown-user",
      conversationId: "smoke-shutdown-thread",
      sessionKey: "agent:nova:hud:user:smoke-shutdown-user:dm:smoke-shutdown-thread",
    },
  }, {
    providerAdapter: {
      id: "test-adapter",
      providerId: "test_shutdown_provider",
      stopScopedSpeech({ userContextId = "" } = {}) {
        events.push({ type: "stop", userContextId });
      },
      async sendShutdownReply({ text = "", ctx = {} } = {}) {
        events.push({ type: "reply", text, userContextId: ctx.userContextId });
        return "Shutting down now. If you need me again, just restart the system.";
      },
      exitProcess(code = 0) {
        events.push({ type: "exit", code });
      },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.code, "shutdown.completed");
  assert.equal(out.provider, "test_shutdown_provider");
  assert.equal(out.telemetry.userContextId, "smoke-shutdown-user");
  assert.equal(out.telemetry.exited, true);
  assert.deepEqual(events, [
    { type: "stop", userContextId: "smoke-shutdown-user" },
    { type: "reply", text: "shutdown nova", userContextId: "smoke-shutdown-user" },
    { type: "exit", code: 0 },
  ]);
});

await run("P39-C3 shutdown domain service skips process exit when disabled", async () => {
  const events = [];
  const out = await runShutdownDomainService({
    text: "shutdown nova",
    userContextId: "smoke-shutdown-noexit",
    conversationId: "smoke-shutdown-noexit-thread",
    sessionKey: "agent:nova:hud:user:smoke-shutdown-noexit:dm:smoke-shutdown-noexit-thread",
    ctx: {
      source: "hud",
      sender: "hud-user",
      userContextId: "smoke-shutdown-noexit",
      conversationId: "smoke-shutdown-noexit-thread",
      sessionKey: "agent:nova:hud:user:smoke-shutdown-noexit:dm:smoke-shutdown-noexit-thread",
    },
    exitProcess: false,
  }, {
    providerAdapter: {
      id: "test-adapter",
      providerId: "test_shutdown_provider",
      stopScopedSpeech({ userContextId = "" } = {}) {
        events.push({ type: "stop", userContextId });
      },
      async sendShutdownReply() {
        events.push({ type: "reply" });
        return "Shutting down now.";
      },
      exitProcess(code = 0) {
        events.push({ type: "exit", code });
      },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.telemetry.exited, false);
  assert.equal(events.some((event) => event.type === "exit"), false);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
