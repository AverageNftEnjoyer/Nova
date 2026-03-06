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
  const councilEnvelope = out.envelopes[1];
  assert.equal(councilEnvelope?.agentId, "routing-council");
  assert.equal(councilEnvelope?.result?.selectedDomainManagerId, "media-manager");
  assert.equal(councilEnvelope?.result?.selectedWorkerAgentId, "spotify-agent");
  assert.equal(councilEnvelope?.result?.decisionType, "default_fallback");
  assert.equal(councilEnvelope?.result?.matchedRuleId, "");
  assert.equal(councilEnvelope?.result?.policy?.approvalRequired, false);
  assert.equal(councilEnvelope?.result?.policy?.riskTier, "standard");
});

await run("P18-C1b youtube delegation resolves media-manager and youtube worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "youtube",
    responseRoute: "youtube",
    text: "refresh youtube feed for AI launches",
    toolCalls: ["youtube_home_control"],
    provider: "gemini",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-youtube",
    conversationId: "thread-youtube",
    sessionKey: "agent:nova:hud:user:tenant-youtube:dm:thread-youtube",
    executeWorker: async () => ({
      route: "youtube",
      ok: true,
      provider: "gemini",
      totalTokens: 31,
      latencyMs: 55,
      toolCalls: ["youtube_home_control"],
    }),
  });

  assert.equal(out.orgChartPath.domainManagerId, "media-manager");
  assert.equal(out.orgChartPath.workerAgentId, "youtube-agent");
  assert.equal(out.envelopes[4]?.agentId, "youtube-agent");
  assert.equal(out.hops[3]?.toAgentId, "youtube-agent");
});

await run("P18-C1c polymarket delegation resolves finance-manager and polymarket worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "polymarket",
    responseRoute: "polymarket",
    text: "scan polymarket odds for BTC > 150k",
    toolCalls: ["polymarket"],
    provider: "grok",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-polymarket",
    conversationId: "thread-polymarket",
    sessionKey: "agent:nova:hud:user:tenant-polymarket:dm:thread-polymarket",
    executeWorker: async () => ({
      route: "polymarket",
      ok: true,
      provider: "grok",
      totalTokens: 28,
      latencyMs: 49,
      toolCalls: ["polymarket"],
    }),
  });

  assert.equal(out.orgChartPath.domainManagerId, "finance-manager");
  assert.equal(out.orgChartPath.workerAgentId, "polymarket-agent");
  assert.equal(out.envelopes[4]?.agentId, "polymarket-agent");
  assert.equal(out.hops[3]?.toAgentId, "polymarket-agent");
});

await run("P18-C1d coinbase delegation resolves finance-manager and coinbase worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "coinbase",
    responseRoute: "coinbase",
    text: "refresh coinbase balances",
    toolCalls: ["coinbase"],
    provider: "openai",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-coinbase",
    conversationId: "thread-coinbase",
    sessionKey: "agent:nova:hud:user:tenant-coinbase:dm:thread-coinbase",
    executeWorker: async () => ({
      route: "coinbase",
      ok: true,
      provider: "openai",
      totalTokens: 19,
      latencyMs: 33,
      toolCalls: ["coinbase"],
    }),
  });
  assert.equal(out.orgChartPath.domainManagerId, "finance-manager");
  assert.equal(out.orgChartPath.workerAgentId, "coinbase-agent");
  assert.equal(out.envelopes[4]?.agentId, "coinbase-agent");
});

await run("P18-C1e gmail delegation resolves comms-manager and gmail worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "gmail",
    responseRoute: "gmail",
    text: "show unread gmail",
    toolCalls: ["gmail"],
    provider: "claude",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-gmail",
    conversationId: "thread-gmail",
    sessionKey: "agent:nova:hud:user:tenant-gmail:dm:thread-gmail",
    executeWorker: async () => ({
      route: "gmail",
      ok: true,
      provider: "claude",
      totalTokens: 21,
      latencyMs: 36,
      toolCalls: ["gmail"],
    }),
  });
  assert.equal(out.orgChartPath.domainManagerId, "comms-manager");
  assert.equal(out.orgChartPath.workerAgentId, "gmail-agent");
  assert.equal(out.envelopes[4]?.agentId, "gmail-agent");
});

await run("P18-C1f telegram delegation resolves comms-manager and telegram worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "telegram",
    responseRoute: "telegram",
    text: "send telegram digest",
    toolCalls: ["telegram"],
    provider: "grok",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-telegram",
    conversationId: "thread-telegram",
    sessionKey: "agent:nova:hud:user:tenant-telegram:dm:thread-telegram",
    executeWorker: async () => ({
      route: "telegram",
      ok: true,
      provider: "grok",
      totalTokens: 17,
      latencyMs: 27,
      toolCalls: ["telegram"],
    }),
  });
  assert.equal(out.orgChartPath.domainManagerId, "comms-manager");
  assert.equal(out.orgChartPath.workerAgentId, "telegram-agent");
  assert.equal(out.envelopes[4]?.agentId, "telegram-agent");
});

await run("P18-C1g discord delegation resolves comms-manager and discord worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "discord",
    responseRoute: "discord",
    text: "post discord digest",
    toolCalls: ["discord"],
    provider: "claude",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-discord",
    conversationId: "thread-discord",
    sessionKey: "agent:nova:hud:user:tenant-discord:dm:thread-discord",
    executeWorker: async () => ({
      route: "discord",
      ok: true,
      provider: "claude",
      totalTokens: 18,
      latencyMs: 29,
      toolCalls: ["discord"],
    }),
  });
  assert.equal(out.orgChartPath.domainManagerId, "comms-manager");
  assert.equal(out.orgChartPath.workerAgentId, "discord-agent");
  assert.equal(out.envelopes[4]?.agentId, "discord-agent");
});

await run("P18-C1h calendar delegation resolves productivity-manager and calendar worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "calendar",
    responseRoute: "calendar",
    text: "show calendar agenda",
    toolCalls: ["calendar"],
    provider: "gemini",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-calendar",
    conversationId: "thread-calendar",
    sessionKey: "agent:nova:hud:user:tenant-calendar:dm:thread-calendar",
    executeWorker: async () => ({
      route: "calendar",
      ok: true,
      provider: "gemini",
      totalTokens: 16,
      latencyMs: 25,
      toolCalls: ["calendar"],
    }),
  });
  assert.equal(out.orgChartPath.domainManagerId, "productivity-manager");
  assert.equal(out.orgChartPath.workerAgentId, "calendar-agent");
  assert.equal(out.envelopes[4]?.agentId, "calendar-agent");
});

await run("P18-C1i reminders delegation resolves productivity-manager and reminders worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "reminder",
    responseRoute: "reminder",
    text: "set reminder for standup",
    toolCalls: ["reminder"],
    provider: "openai",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-reminder",
    conversationId: "thread-reminder",
    sessionKey: "agent:nova:hud:user:tenant-reminder:dm:thread-reminder",
    executeWorker: async () => ({
      route: "reminder",
      ok: true,
      provider: "openai",
      totalTokens: 14,
      latencyMs: 21,
      toolCalls: ["reminder"],
    }),
  });
  assert.equal(out.orgChartPath.domainManagerId, "productivity-manager");
  assert.equal(out.orgChartPath.workerAgentId, "reminders-agent");
  assert.equal(out.envelopes[4]?.agentId, "reminders-agent");
});

await run("P18-C1j web research delegation resolves system-manager and web-research worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "web_research",
    responseRoute: "web_research",
    text: "research latest ai safety",
    toolCalls: ["web_search"],
    provider: "claude",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-web",
    conversationId: "thread-web",
    sessionKey: "agent:nova:hud:user:tenant-web:dm:thread-web",
    executeWorker: async () => ({
      route: "web_research",
      ok: true,
      provider: "claude",
      totalTokens: 20,
      latencyMs: 34,
      toolCalls: ["web_search"],
    }),
  });
  assert.equal(out.orgChartPath.domainManagerId, "system-manager");
  assert.equal(out.orgChartPath.workerAgentId, "web-research-agent");
  assert.equal(out.envelopes[4]?.agentId, "web-research-agent");
});

await run("P18-C1k crypto delegation resolves finance-manager and crypto worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "crypto",
    responseRoute: "crypto",
    text: "btc price check",
    toolCalls: ["crypto"],
    provider: "openai",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-crypto",
    conversationId: "thread-crypto",
    sessionKey: "agent:nova:hud:user:tenant-crypto:dm:thread-crypto",
    executeWorker: async () => ({
      route: "crypto",
      ok: true,
      provider: "openai",
      totalTokens: 18,
      latencyMs: 29,
      toolCalls: ["crypto"],
    }),
  });
  assert.equal(out.orgChartPath.domainManagerId, "finance-manager");
  assert.equal(out.orgChartPath.workerAgentId, "crypto-agent");
  assert.equal(out.envelopes[4]?.agentId, "crypto-agent");
});

await run("P18-C1l market/weather delegation resolves finance-manager and market worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "weather",
    responseRoute: "weather",
    text: "weather in boston",
    toolCalls: ["weather"],
    provider: "gemini",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-market",
    conversationId: "thread-market",
    sessionKey: "agent:nova:hud:user:tenant-market:dm:thread-market",
    executeWorker: async () => ({
      route: "weather",
      ok: true,
      provider: "gemini",
      totalTokens: 17,
      latencyMs: 27,
      toolCalls: ["weather"],
    }),
  });
  assert.equal(out.orgChartPath.domainManagerId, "finance-manager");
  assert.equal(out.orgChartPath.workerAgentId, "market-agent");
  assert.equal(out.envelopes[4]?.agentId, "market-agent");
});

await run("P18-C1l2 market delegation resolves finance-manager and market worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "market",
    responseRoute: "market",
    text: "show stock market trend",
    toolCalls: ["market"],
    provider: "gemini",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-market-nonweather",
    conversationId: "thread-market-nonweather",
    sessionKey: "agent:nova:hud:user:tenant-market-nonweather:dm:thread-market-nonweather",
    executeWorker: async () => ({
      route: "market",
      ok: true,
      provider: "gemini",
      totalTokens: 17,
      latencyMs: 27,
      toolCalls: ["market"],
    }),
  });
  assert.equal(out.orgChartPath.domainManagerId, "finance-manager");
  assert.equal(out.orgChartPath.workerAgentId, "market-agent");
  assert.equal(out.envelopes[4]?.agentId, "market-agent");
});

await run("P18-C1m files delegation resolves system-manager and files worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "files",
    responseRoute: "files",
    text: "list files",
    toolCalls: ["file"],
    provider: "openai",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-files",
    conversationId: "thread-files",
    sessionKey: "agent:nova:hud:user:tenant-files:dm:thread-files",
    executeWorker: async () => ({
      route: "files",
      ok: true,
      provider: "openai",
      totalTokens: 15,
      latencyMs: 22,
      toolCalls: ["file"],
    }),
  });
  assert.equal(out.orgChartPath.domainManagerId, "system-manager");
  assert.equal(out.orgChartPath.workerAgentId, "files-agent");
  assert.equal(out.envelopes[4]?.agentId, "files-agent");
});

await run("P18-C1n diagnostics delegation resolves system-manager and diagnostics worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "diagnostic",
    responseRoute: "diagnostic",
    text: "run diagnostics",
    toolCalls: ["diagnostic"],
    provider: "claude",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-diag",
    conversationId: "thread-diag",
    sessionKey: "agent:nova:hud:user:tenant-diag:dm:thread-diag",
    executeWorker: async () => ({
      route: "diagnostic",
      ok: true,
      provider: "claude",
      totalTokens: 16,
      latencyMs: 24,
      toolCalls: ["diagnostic"],
    }),
  });
  assert.equal(out.orgChartPath.domainManagerId, "system-manager");
  assert.equal(out.orgChartPath.workerAgentId, "diagnostics-agent");
  assert.equal(out.envelopes[4]?.agentId, "diagnostics-agent");
});

await run("P18-C1o voice delegation resolves media-manager and voice worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "voice",
    responseRoute: "voice",
    text: "mute input audio",
    toolCalls: ["voice"],
    provider: "openai",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-voice",
    conversationId: "thread-voice",
    sessionKey: "agent:nova:hud:user:tenant-voice:dm:thread-voice",
    executeWorker: async () => ({
      route: "voice",
      ok: true,
      provider: "openai",
      totalTokens: 13,
      latencyMs: 20,
      toolCalls: ["voice"],
    }),
  });
  assert.equal(out.orgChartPath.domainManagerId, "media-manager");
  assert.equal(out.orgChartPath.workerAgentId, "voice-agent");
  assert.equal(out.envelopes[4]?.agentId, "voice-agent");
});

await run("P18-C1p tts delegation resolves media-manager and tts worker", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "tts",
    responseRoute: "tts",
    text: "read this out loud",
    toolCalls: ["tts"],
    provider: "gemini",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-tts",
    conversationId: "thread-tts",
    sessionKey: "agent:nova:hud:user:tenant-tts:dm:thread-tts",
    executeWorker: async () => ({
      route: "tts",
      ok: true,
      provider: "gemini",
      totalTokens: 12,
      latencyMs: 19,
      toolCalls: ["tts"],
    }),
  });
  assert.equal(out.orgChartPath.domainManagerId, "media-manager");
  assert.equal(out.orgChartPath.workerAgentId, "tts-agent");
  assert.equal(out.envelopes[4]?.agentId, "tts-agent");
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

await run("P18-C2b thrown worker errors are normalized into failure summary + telemetry", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "web_research",
    responseRoute: "web_research",
    text: "search latest model updates",
    toolCalls: ["web_search"],
    provider: "openai",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-throw",
    conversationId: "thread-throw",
    sessionKey: "agent:nova:hud:user:tenant-throw:dm:thread-throw",
    executeWorker: async () => {
      const err = new Error("worker crashed");
      err.code = "WORKER_CRASH";
      throw err;
    },
  });

  assert.equal(out.workerSummary?.ok, false);
  assert.equal(out.workerSummary?.error, "worker_crash");
  assert.equal(String(out.workerSummary?.errorMessage || "").includes("worker crashed"), true);
  assert.equal(out.delegationError?.stage, "worker_execution");
  assert.equal(out.delegationError?.code, "worker_crash");
  const workerEnvelope = out.envelopes[out.envelopes.length - 1];
  assert.equal(workerEnvelope?.ok, false);
  assert.equal(workerEnvelope?.error, "worker_crash");
  assert.equal(Number(workerEnvelope?.telemetry?.latencyMs || 0) >= 0, true);
});

await run("P18-C2c planning council delegation preserves council rule-match metadata", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "workflow_build",
    responseRoute: "workflow_build",
    text: "build mission workflow",
    toolCalls: ["workflow_build"],
    provider: "claude",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-planning",
    conversationId: "thread-planning",
    sessionKey: "agent:nova:hud:user:tenant-planning:dm:thread-planning",
    executeWorker: async () => ({
      route: "workflow_build",
      ok: true,
      provider: "claude",
      totalTokens: 11,
      latencyMs: 17,
      toolCalls: [],
    }),
  });
  const councilEnvelope = out.envelopes[1];
  assert.equal(out.orgChartPath?.councilId, "planning-council");
  assert.equal(out.orgChartPath?.councilDecision?.decisionType, "rule_match");
  assert.equal(out.orgChartPath?.councilDecision?.matchedRuleId, "planning-council");
  assert.equal(councilEnvelope?.agentId, "planning-council");
  assert.equal(councilEnvelope?.result?.decisionType, "rule_match");
  assert.equal(councilEnvelope?.result?.matchedRuleId, "planning-council");
  assert.equal(councilEnvelope?.result?.selectedDomainManagerId, "productivity-manager");
  assert.equal(councilEnvelope?.result?.selectedWorkerAgentId, "missions-agent");
  assert.equal(councilEnvelope?.result?.policy?.approvalRequired, false);
});

await run("P18-C2d policy metadata marks sensitive tool call approval requirement", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "gmail",
    responseRoute: "gmail",
    text: "forward this email",
    toolCalls: ["gmail_forward_message"],
    provider: "claude",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-policy",
    conversationId: "thread-policy",
    sessionKey: "agent:nova:hud:user:tenant-policy:dm:thread-policy",
    executeWorker: async () => ({
      route: "gmail",
      ok: true,
      provider: "claude",
      totalTokens: 10,
      latencyMs: 16,
      toolCalls: ["gmail_forward_message"],
    }),
  });

  const councilEnvelope = out.envelopes[1];
  assert.equal(councilEnvelope?.result?.policy?.approvalRequired, true);
  assert.equal(councilEnvelope?.result?.policy?.riskTier, "high");
  assert.equal(councilEnvelope?.result?.policy?.reason, "sensitive_tool_call");
  assert.equal(councilEnvelope?.result?.policy?.matchedSensitiveToolCall, "gmail_forward_message");
});

await run("P18-C2e enabled policy gate blocks sensitive worker execution without approval", async () => {
  let workerCalled = false;
  const out = await executeOrgChartDelegation({
    routeHint: "gmail",
    responseRoute: "gmail",
    text: "forward this email",
    toolCalls: ["gmail_forward_message"],
    provider: "claude",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-policy-gate",
    conversationId: "thread-policy-gate",
    sessionKey: "agent:nova:hud:user:tenant-policy-gate:dm:thread-policy-gate",
    policyGate: {
      enabled: true,
      approvalGranted: false,
    },
    executeWorker: async () => {
      workerCalled = true;
      return { route: "gmail", ok: true };
    },
  });

  assert.equal(workerCalled, false);
  assert.equal(out.workerSummary?.ok, false);
  assert.equal(out.workerSummary?.error, "policy_approval_required");
  assert.equal(out.delegationError?.stage, "policy_gate");
  assert.equal(out.delegationError?.code, "policy_approval_required");
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

await run("P18-C3b delegation rejects missing scoped context identifiers", async () => {
  let missingUserContextError = "";
  let missingConversationError = "";
  let missingSessionKeyError = "";

  try {
    await executeOrgChartDelegation({
      routeHint: "chat",
      responseRoute: "chat",
      text: "hello",
      toolCalls: [],
      conversationId: "thread-x",
      sessionKey: "agent:nova:hud:user:u:dm:thread-x",
      executeWorker: async () => ({ route: "chat", ok: true }),
    });
  } catch (error) {
    missingUserContextError = String(error?.message || "");
  }

  try {
    await executeOrgChartDelegation({
      routeHint: "chat",
      responseRoute: "chat",
      text: "hello",
      toolCalls: [],
      userContextId: "tenant-x",
      sessionKey: "agent:nova:hud:user:tenant-x:dm:thread-x",
      executeWorker: async () => ({ route: "chat", ok: true }),
    });
  } catch (error) {
    missingConversationError = String(error?.message || "");
  }

  try {
    await executeOrgChartDelegation({
      routeHint: "chat",
      responseRoute: "chat",
      text: "hello",
      toolCalls: [],
      userContextId: "tenant-x",
      conversationId: "thread-x",
      executeWorker: async () => ({ route: "chat", ok: true }),
    });
  } catch (error) {
    missingSessionKeyError = String(error?.message || "");
  }

  assert.equal(missingUserContextError.includes("userContextId"), true);
  assert.equal(missingConversationError.includes("conversationId"), true);
  assert.equal(missingSessionKeyError.includes("sessionKey"), true);
});

await run("P18-C4 string worker result is normalized to canonical worker summary contract", async () => {
  const out = await executeOrgChartDelegation({
    routeHint: "chat",
    responseRoute: "chat",
    text: "hello",
    toolCalls: [],
    provider: "openai",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-contract",
    conversationId: "thread-contract",
    sessionKey: "agent:nova:hud:user:tenant-contract:dm:thread-contract",
    executeWorker: async () => "plain reply",
  });

  const summary = out.workerSummary;
  assert.equal(summary.ok, true);
  assert.equal(summary.route, "chat");
  assert.equal(summary.responseRoute, "chat");
  assert.equal(summary.reply, "plain reply");
  assert.equal(Array.isArray(summary.toolCalls), true);
  assert.equal(Array.isArray(summary.toolExecutions), true);
  assert.equal(Array.isArray(summary.retries), true);
  assert.equal(summary.sessionKey, "agent:nova:hud:user:tenant-contract:dm:thread-contract");
  assert.equal(typeof summary.requestHints, "object");
  assert.equal(typeof summary.telemetry, "object");
  assert.equal(summary.telemetry.userContextId, "tenant-contract");
  assert.equal(summary.telemetry.conversationId, "thread-contract");
  assert.equal(summary.telemetry.sessionKey, "agent:nova:hud:user:tenant-contract:dm:thread-contract");
  assert.equal(typeof summary.canRunToolLoop, "boolean");
  assert.equal(typeof summary.canRunWebSearch, "boolean");
  assert.equal(typeof summary.canRunWebFetch, "boolean");
  assert.equal(Number(summary.totalTokens) >= 0, true);
  assert.equal(Number(summary.latencyMs) >= 0, true);
});

await run("P18-C5 parallel delegations keep user-scoped envelopes and hops isolated", async () => {
  const runA = executeOrgChartDelegation({
    routeHint: "spotify",
    responseRoute: "spotify",
    text: "play spotify",
    toolCalls: ["spotify"],
    provider: "openai",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-a",
    conversationId: "thread-a",
    sessionKey: "agent:nova:hud:user:tenant-a:dm:thread-a",
    executeWorker: async () => ({ route: "spotify", ok: true, reply: "A" }),
  });

  const runB = executeOrgChartDelegation({
    routeHint: "gmail",
    responseRoute: "gmail",
    text: "open gmail",
    toolCalls: ["gmail"],
    provider: "claude",
    providerSource: "chat-runtime-selected",
    userContextId: "tenant-b",
    conversationId: "thread-b",
    sessionKey: "agent:nova:hud:user:tenant-b:dm:thread-b",
    executeWorker: async () => ({ route: "gmail", ok: true, reply: "B" }),
  });

  const [outA, outB] = await Promise.all([runA, runB]);

  assert.equal(outA.envelopes.every((envelope) => envelope?.result?.userContextId === "tenant-a"), true);
  assert.equal(outB.envelopes.every((envelope) => envelope?.result?.userContextId === "tenant-b"), true);
  assert.equal(outA.hops.every((hop) => hop.userContextId === "tenant-a"), true);
  assert.equal(outB.hops.every((hop) => hop.userContextId === "tenant-b"), true);
  assert.equal(outA.envelopes.some((envelope) => envelope?.result?.userContextId === "tenant-b"), false);
  assert.equal(outB.envelopes.some((envelope) => envelope?.result?.userContextId === "tenant-a"), false);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
