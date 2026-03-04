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

const routerModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "routing", "org-chart-routing", "index.js")).href,
);
const { resolveOrgChartRoutingEnvelope } = routerModule;

await run("P19-C1 spotify request resolves media-manager and spotify worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "spotify",
    responseRoute: "spotify",
    text: "play spotify playlist",
    toolCalls: ["spotify.play"],
    provider: "openai",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-a",
    conversationId: "c-1",
    sessionKey: "s-1",
  });
  assert.equal(envelope.operatorId, "nova-operator");
  assert.equal(envelope.councilId, "routing-council");
  assert.equal(envelope.domainManagerId, "media-manager");
  assert.equal(envelope.workerAgentId, "spotify-agent");
  assert.equal(envelope.providerSelector.agentId, "provider-selector");
  assert.equal(envelope.providerSelector.adapterId, "openai-adapter");
  assert.equal(envelope.context.userContextId, "tenant-a");
});

await run("P19-C2 mission request resolves planning council and missions worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "workflow_build",
    responseRoute: "workflow_build",
    text: "build a mission for calendar summary",
    toolCalls: ["workflow_build"],
    provider: "claude",
    providerSource: "chat-runtime-selected",
  });
  assert.equal(envelope.councilId, "planning-council");
  assert.equal(envelope.domainManagerId, "productivity-manager");
  assert.equal(envelope.workerAgentId, "missions-agent");
  assert.equal(envelope.providerSelector.adapterId, "claude-adapter");
});

await run("P19-C3 unmatched route falls back to system diagnostics", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "chat",
    responseRoute: "unknown",
    text: "hello there",
    toolCalls: [],
    provider: "",
    providerSource: "",
  });
  assert.equal(envelope.domainManagerId, "system-manager");
  assert.equal(envelope.workerAgentId, "diagnostics-agent");
  assert.equal(envelope.providerSelector.adapterId, "none");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);

