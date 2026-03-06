import assert from "node:assert/strict";

import { runDelegatedDomainService } from "../../../src/runtime/modules/services/shared/delegated-domain-service/index.js";

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

await run("Delegated domain service normalizes scoped summary metadata", async () => {
  const ctx = {
    userContextId: "smoke-user",
    conversationId: "smoke-thread",
    sessionKey: "agent:nova:hud:user:smoke-user:dm:smoke-thread",
  };
  const requestHints = { testHint: true };
  let executedText = "";
  const providerAdapter = {
    id: "delegated-smoke-adapter",
    timeoutMs: 2500,
    async execute(input) {
      executedText = String(input?.text || "");
      return {
        ok: true,
        attemptCount: 1,
        summary: {
          ok: true,
          route: "reminder",
          responseRoute: "reminder",
          reply: "Reminder delegated successfully.",
          requestHints: { ...requestHints, adapterEcho: true },
          telemetry: {
            provider: "delegated-provider",
          },
        },
      };
    },
  };

  const delegated = await runDelegatedDomainService({
    domainId: "reminders",
    route: "reminder",
    responseRoute: "reminder",
    degradedReply: "Reminder request degraded.",
    text: "reminder status",
    ctx,
    requestHints,
  }, { providerAdapter });

  assert.equal(executedText, "reminder status");
  assert.equal(delegated.ok, true);
  assert.equal(delegated.route, "reminder");
  assert.equal(delegated.responseRoute, "reminder");
  assert.equal(String(delegated.telemetry?.domain || ""), "reminders");
  assert.equal(String(delegated.telemetry?.provider || ""), "delegated-provider");
  assert.equal(String(delegated.telemetry?.adapterId || ""), "delegated-smoke-adapter");
  assert.equal(String(delegated.telemetry?.userContextId || ""), "smoke-user");
  assert.equal(delegated.requestHints?.adapterEcho, true);
});

await run("Delegated domain service degrades with explicit scoped failure metadata", async () => {
  const ctx = {
    userContextId: "smoke-user",
    conversationId: "smoke-thread",
    sessionKey: "agent:nova:hud:user:smoke-user:dm:smoke-thread",
  };
  const providerAdapter = {
    id: "delegated-smoke-adapter",
    timeoutMs: 2500,
    async execute() {
      return {
        ok: false,
        code: "network_unreachable",
        message: "delegated provider timed out",
        attemptCount: 2,
        timeoutMs: 2500,
      };
    },
  };

  const delegated = await runDelegatedDomainService({
    domainId: "reminders",
    route: "reminder",
    responseRoute: "reminder",
    degradedReply: "Reminder request degraded.",
    text: "reminder status",
    ctx,
  }, { providerAdapter });

  assert.equal(delegated.ok, false);
  assert.equal(String(delegated.code || ""), "reminders.network_unreachable");
  assert.equal(String(delegated.reply || ""), "Reminder request degraded.");
  assert.equal(Number(delegated.telemetry?.attemptCount || 0), 2);
  assert.equal(Number(delegated.telemetry?.timeoutMs || 0), 2500);
  assert.equal(String(delegated.telemetry?.adapterId || ""), "delegated-smoke-adapter");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
