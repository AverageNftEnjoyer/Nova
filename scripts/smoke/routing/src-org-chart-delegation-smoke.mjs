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

const delegationModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "routing", "org-chart-delegation", "index.js")).href,
);
const { executeOrgChartDelegation } = delegationModule;

await run("P18-C1 delegation emits operator/council/manager/provider/worker envelopes with scoped context", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "spotify",
    responseRoute: "spotify",
    text: "play spotify",
    toolCalls: ["spotify"],
    provider: "openai",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-alpha",
    conversationId: "thread-123",
    sessionKey: "agent:nova:hud:user:tenant-alpha:dm:thread-123",
    executeWorker: async () => ({
      route: "spotify",
      ok: true,
      provider: "openai",
      totalTokens: 22,
      latencyMs: 47,
      toolCalls: ["spotify.play"],
    }),
  });

  assert.equal(out.orgChartPath.operatorId, "nova-operator");
  assert.equal(out.orgChartPath.domainManagerId, "media-manager");
  assert.equal(out.orgChartPath.workerAgentId, "spotify-agent");
  assert.equal(Array.isArray(out.envelopes), true);
  assert.equal(out.envelopes.length, 5);
  assert.equal(Array.isArray(out.hops), true);
  assert.equal(out.hops.length, 5);
  assert.equal(out.envelopes.every((envelope) => envelope?.result?.userContextId === "tenant-alpha"), true);
  assert.equal(out.hops.every((hop) => hop.userContextId === "tenant-alpha"), true);
  assert.equal(out.envelopes[3]?.agentId, "provider-selector");
  assert.equal(out.envelopes[4]?.agentId, "spotify-agent");
});

await run("P18-C2 worker failure is represented by normalized worker envelope", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "chat",
    responseRoute: "openai_stream",
    text: "debug runtime health",
    toolCalls: [],
    provider: "claude",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-bravo",
    conversationId: "thread-999",
    sessionKey: "agent:nova:hud:user:tenant-bravo:dm:thread-999",
    executeWorker: async () => ({
      route: "chat",
      ok: false,
      error: "worker_failed",
      provider: "claude",
      totalTokens: 9,
      latencyMs: 13,
      toolCalls: [],
    }),
  });

  const workerEnvelope = out.envelopes[out.envelopes.length - 1];
  assert.equal(workerEnvelope.agentId.length > 0, true);
  assert.equal(workerEnvelope.ok, false);
  assert.equal(workerEnvelope.error, "worker_failed");
  assert.equal(workerEnvelope.telemetry.provider, "claude");
});

await run("P18-C3 delegation requires executeWorker callback", async () => {
  let threw = false;
  try {
    await executeOrgChartDelegation({
      routeHint: "chat",
      userContextId: "tenant-charlie",
      conversationId: "thread-42",
      sessionKey: "agent:nova:hud:user:tenant-charlie:dm:thread-42",
    });
  } catch (error) {
    threw = true;
    assert.equal(String(error?.message || "").includes("executeWorker"), true);
  }
  assert.equal(threw, true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);

