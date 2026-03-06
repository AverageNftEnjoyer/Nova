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

await run("P19-C1b youtube request resolves media-manager and youtube worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "youtube",
    responseRoute: "youtube",
    text: "show youtube videos about market news",
    toolCalls: ["youtube_home_control"],
    provider: "gemini",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-a",
    conversationId: "c-yt",
    sessionKey: "s-yt",
  });
  assert.equal(envelope.operatorId, "nova-operator");
  assert.equal(envelope.councilId, "routing-council");
  assert.equal(envelope.domainManagerId, "media-manager");
  assert.equal(envelope.workerAgentId, "youtube-agent");
  assert.equal(envelope.providerSelector.agentId, "provider-selector");
  assert.equal(envelope.providerSelector.adapterId, "gemini-adapter");
  assert.equal(envelope.context.userContextId, "tenant-a");
});

await run("P19-C1c polymarket request resolves finance-manager and polymarket worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "polymarket",
    responseRoute: "polymarket",
    text: "show polymarket election odds",
    toolCalls: ["polymarket"],
    provider: "grok",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-a",
    conversationId: "c-pm",
    sessionKey: "s-pm",
  });
  assert.equal(envelope.operatorId, "nova-operator");
  assert.equal(envelope.councilId, "routing-council");
  assert.equal(envelope.domainManagerId, "finance-manager");
  assert.equal(envelope.workerAgentId, "polymarket-agent");
  assert.equal(envelope.providerSelector.agentId, "provider-selector");
  assert.equal(envelope.providerSelector.adapterId, "grok-adapter");
  assert.equal(envelope.context.userContextId, "tenant-a");
});

await run("P19-C1d coinbase request resolves finance-manager and coinbase worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "coinbase",
    responseRoute: "coinbase",
    text: "sync coinbase portfolio",
    toolCalls: ["coinbase"],
    provider: "openai",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-a",
    conversationId: "c-cb",
    sessionKey: "s-cb",
  });
  assert.equal(envelope.domainManagerId, "finance-manager");
  assert.equal(envelope.workerAgentId, "coinbase-agent");
  assert.equal(envelope.providerSelector.adapterId, "openai-adapter");
});

await run("P19-C1e gmail request resolves comms-manager and gmail worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "gmail",
    responseRoute: "gmail",
    text: "check gmail inbox",
    toolCalls: ["gmail"],
    provider: "claude",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-a",
    conversationId: "c-gm",
    sessionKey: "s-gm",
  });
  assert.equal(envelope.domainManagerId, "comms-manager");
  assert.equal(envelope.workerAgentId, "gmail-agent");
  assert.equal(envelope.providerSelector.adapterId, "claude-adapter");
});

await run("P19-C1f telegram request resolves comms-manager and telegram worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "telegram",
    responseRoute: "telegram",
    text: "send telegram update",
    toolCalls: ["telegram"],
    provider: "grok",
    providerSource: "chat-runtime-selected",
  });
  assert.equal(envelope.domainManagerId, "comms-manager");
  assert.equal(envelope.workerAgentId, "telegram-agent");
  assert.equal(envelope.providerSelector.adapterId, "grok-adapter");
});

await run("P19-C1g discord request resolves comms-manager and discord worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "discord",
    responseRoute: "discord",
    text: "post discord update",
    toolCalls: ["discord"],
    provider: "claude",
    providerSource: "chat-runtime-selected",
  });
  assert.equal(envelope.domainManagerId, "comms-manager");
  assert.equal(envelope.workerAgentId, "discord-agent");
  assert.equal(envelope.providerSelector.adapterId, "claude-adapter");
});

await run("P19-C1h calendar request resolves productivity-manager and calendar worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "calendar",
    responseRoute: "calendar",
    text: "show calendar tomorrow",
    toolCalls: ["calendar"],
    provider: "gemini",
    providerSource: "chat-runtime-selected",
  });
  assert.equal(envelope.domainManagerId, "productivity-manager");
  assert.equal(envelope.workerAgentId, "calendar-agent");
  assert.equal(envelope.providerSelector.adapterId, "gemini-adapter");
});

await run("P19-C1i reminder request resolves productivity-manager and reminders worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "reminder",
    responseRoute: "reminder",
    text: "set reminder at 5pm",
    toolCalls: ["reminder"],
    provider: "openai",
    providerSource: "chat-runtime-selected",
  });
  assert.equal(envelope.domainManagerId, "productivity-manager");
  assert.equal(envelope.workerAgentId, "reminders-agent");
  assert.equal(envelope.providerSelector.adapterId, "openai-adapter");
});

await run("P19-C1j web research request resolves system-manager and web-research worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "web_research",
    responseRoute: "web_research",
    text: "research latest ai safety with citations",
    toolCalls: ["web_search"],
    provider: "claude",
    providerSource: "chat-runtime-selected",
  });
  assert.equal(envelope.domainManagerId, "system-manager");
  assert.equal(envelope.workerAgentId, "web-research-agent");
  assert.equal(envelope.providerSelector.adapterId, "claude-adapter");
});

await run("P19-C1k crypto request resolves finance-manager and crypto worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "crypto",
    responseRoute: "crypto",
    text: "btc price update",
    toolCalls: ["crypto"],
    provider: "openai",
    providerSource: "chat-runtime-selected",
  });
  assert.equal(envelope.domainManagerId, "finance-manager");
  assert.equal(envelope.workerAgentId, "crypto-agent");
  assert.equal(envelope.providerSelector.adapterId, "openai-adapter");
});

await run("P19-C1l market/weather request resolves finance-manager and market worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "weather",
    responseRoute: "weather",
    text: "weather in nyc",
    toolCalls: ["weather"],
    provider: "gemini",
    providerSource: "chat-runtime-selected",
  });
  assert.equal(envelope.domainManagerId, "finance-manager");
  assert.equal(envelope.workerAgentId, "market-agent");
  assert.equal(envelope.providerSelector.adapterId, "gemini-adapter");
});

await run("P19-C1l2 market request resolves finance-manager and market worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "market",
    responseRoute: "market",
    text: "show stock market trend",
    toolCalls: ["market"],
    provider: "gemini",
    providerSource: "chat-runtime-selected",
  });
  assert.equal(envelope.domainManagerId, "finance-manager");
  assert.equal(envelope.workerAgentId, "market-agent");
  assert.equal(envelope.providerSelector.adapterId, "gemini-adapter");
});

await run("P19-C1m files request resolves system-manager and files worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "files",
    responseRoute: "files",
    text: "list files in workspace",
    toolCalls: ["file"],
    provider: "openai",
    providerSource: "chat-runtime-selected",
  });
  assert.equal(envelope.domainManagerId, "system-manager");
  assert.equal(envelope.workerAgentId, "files-agent");
  assert.equal(envelope.providerSelector.adapterId, "openai-adapter");
});

await run("P19-C1n diagnostics request resolves system-manager and diagnostics worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "diagnostic",
    responseRoute: "diagnostic",
    text: "run diagnostics",
    toolCalls: ["diagnostic"],
    provider: "claude",
    providerSource: "chat-runtime-selected",
  });
  assert.equal(envelope.domainManagerId, "system-manager");
  assert.equal(envelope.workerAgentId, "diagnostics-agent");
  assert.equal(envelope.providerSelector.adapterId, "claude-adapter");
});

await run("P19-C1o voice request resolves media-manager and voice worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "voice",
    responseRoute: "voice",
    text: "mute microphone",
    toolCalls: ["voice"],
    provider: "openai",
    providerSource: "chat-runtime-selected",
  });
  assert.equal(envelope.domainManagerId, "media-manager");
  assert.equal(envelope.workerAgentId, "voice-agent");
  assert.equal(envelope.providerSelector.adapterId, "openai-adapter");
});

await run("P19-C1p tts request resolves media-manager and tts worker", async () => {
  const envelope = resolveOrgChartRoutingEnvelope({
    route: "tts",
    responseRoute: "tts",
    text: "read that aloud",
    toolCalls: ["tts"],
    provider: "gemini",
    providerSource: "chat-runtime-selected",
  });
  assert.equal(envelope.domainManagerId, "media-manager");
  assert.equal(envelope.workerAgentId, "tts-agent");
  assert.equal(envelope.providerSelector.adapterId, "gemini-adapter");
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
  assert.equal(envelope.councilDecision?.decisionType, "rule_match");
  assert.equal(envelope.councilDecision?.matchedRuleId, "planning-council");
  assert.equal(envelope.councilDecision?.evidence?.routeMatched, true);
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
  assert.equal(envelope.councilId, "routing-council");
  assert.equal(envelope.councilDecision?.decisionType, "default_fallback");
  assert.equal(envelope.councilDecision?.matchedRuleId, "");
  assert.equal(envelope.councilDecision?.evidence?.routeMatched, false);
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
