import { createDiagnosticsProviderAdapter } from "./provider-adapter/index.js";

function normalizeText(value = "", fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function buildTelemetry({
  provider = "runtime_diagnostics",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  latencyMs = 0,
  action = "",
}) {
  return {
    domain: "diagnostics",
    provider: normalizeText(provider, "runtime_diagnostics"),
    adapterId: normalizeText(provider, "runtime_diagnostics"),
    latencyMs: Number(latencyMs || 0),
    action: normalizeText(action),
    userContextId: normalizeText(userContextId),
    conversationId: normalizeText(conversationId),
    sessionKey: normalizeText(sessionKey),
  };
}

function buildResponse({
  ok = true,
  code = "",
  message = "",
  reply = "",
  requestHints = {},
  provider = "runtime_diagnostics",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  action = "",
  startedAt = Date.now(),
  data = {},
}) {
  const latencyMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  return {
    ok,
    route: "diagnostic",
    responseRoute: "diagnostic",
    code: normalizeText(code),
    message: normalizeText(message),
    reply: normalizeText(reply),
    error: ok ? "" : normalizeText(code || "diagnostics.execution_failed"),
    toolCalls: [],
    toolExecutions: [],
    retries: [],
    requestHints: requestHints && typeof requestHints === "object" ? requestHints : {},
    provider: normalizeText(provider, "runtime_diagnostics"),
    model: "",
    latencyMs,
    telemetry: buildTelemetry({
      provider,
      userContextId,
      conversationId,
      sessionKey,
      latencyMs,
      action,
    }),
    ...data,
  };
}

function resolveContext(input = {}) {
  const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
  return {
    text: normalizeText(input.text),
    llmCtx: input.llmCtx && typeof input.llmCtx === "object" ? input.llmCtx : {},
    requestHints: input.requestHints && typeof input.requestHints === "object" ? input.requestHints : {},
    userContextId: normalizeText(input.userContextId || ctx.userContextId),
    conversationId: normalizeText(input.conversationId || ctx.conversationId),
    sessionKey: normalizeText(input.sessionKey || ctx.sessionKey),
  };
}

function resolveDiagnosticsAction(text = "", requestHints = {}) {
  const affinity = normalizeText(requestHints?.diagnosticsTopicAffinityId || requestHints?.topicAffinityId).toLowerCase();
  if (affinity === "diagnostics_errors") return "errors";
  if (affinity === "diagnostics_latency") return "latency";
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return "status";
  if (/\b(error|errors|trace|traces|stack|exception)\b/.test(normalized)) return "errors";
  if (/\b(latency|performance|slow|timing)\b/.test(normalized)) return "latency";
  if (/\b(status|health|diagnostics|debug|runtime)\b/.test(normalized)) return "status";
  return "unsupported";
}

function formatDiagnosticsReply(action = "status", snapshot = {}) {
  const provider = normalizeText(snapshot.provider, "unknown");
  const model = normalizeText(snapshot.model, "unknown");
  const tools = Number(snapshot.availableToolCount || 0);
  const canRunToolLoop = snapshot.canRunToolLoop === true ? "yes" : "no";
  const canRunWebSearch = snapshot.canRunWebSearch === true ? "yes" : "no";
  const canRunWebFetch = snapshot.canRunWebFetch === true ? "yes" : "no";
  const stageCount = Object.keys(snapshot.latencyStages && typeof snapshot.latencyStages === "object"
    ? snapshot.latencyStages
    : {}).length;

  if (action === "latency") {
    return [
      "Diagnostics latency view:",
      `- provider/model: ${provider} / ${model}`,
      `- latency stage count: ${stageCount}`,
      `- tool loop enabled: ${canRunToolLoop}`,
      `- web search enabled: ${canRunWebSearch}`,
      `- web fetch enabled: ${canRunWebFetch}`,
    ].join("\n");
  }

  if (action === "errors") {
    return [
      "Diagnostics error-path view:",
      `- provider/model: ${provider} / ${model}`,
      `- tools available: ${tools}`,
      "- last-known diagnostics are runtime-scope only; no persistent error trace was requested in this lane.",
    ].join("\n");
  }

  return [
    "Diagnostics runtime status:",
    `- provider/model: ${provider} / ${model}`,
    `- tools available: ${tools}`,
    `- tool loop enabled: ${canRunToolLoop}`,
    `- web search enabled: ${canRunWebSearch}`,
    `- web fetch enabled: ${canRunWebFetch}`,
  ].join("\n");
}

export async function runDiagnosticsDomainService(input = {}, deps = {}) {
  const startedAt = Date.now();
  const {
    text,
    llmCtx,
    requestHints,
    userContextId,
    conversationId,
    sessionKey,
  } = resolveContext(input);

  if (!userContextId || !conversationId || !sessionKey) {
    return buildResponse({
      ok: false,
      code: "diagnostics.context_missing",
      message: "Diagnostics worker requires userContextId, conversationId, and sessionKey.",
      reply: "I need a scoped conversation context before I can run diagnostics.",
      requestHints,
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
      action: "context_check",
    });
  }

  const providerAdapter = deps.providerAdapter && typeof deps.providerAdapter === "object"
    ? deps.providerAdapter
    : createDiagnosticsProviderAdapter();
  const action = resolveDiagnosticsAction(text, requestHints);

  if (action === "unsupported") {
    return buildResponse({
      ok: true,
      code: "diagnostics.unsupported_command",
      message: "Unsupported diagnostics command.",
      reply: "Diagnostics can report runtime status, latency, and error-path summaries. Try: `run diagnostics` or `diagnostics latency`.",
      requestHints,
      provider: normalizeText(providerAdapter.providerId, "runtime_diagnostics"),
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
      action,
    });
  }

  const snapshotResult = providerAdapter.collectRuntimeSnapshot({
    llmCtx,
    text,
    requestHints,
    userContextId,
    conversationId,
    sessionKey,
  });
  const snapshot = snapshotResult?.snapshot && typeof snapshotResult.snapshot === "object"
    ? snapshotResult.snapshot
    : {};

  return buildResponse({
    ok: snapshotResult?.ok !== false,
    code: snapshotResult?.ok === false ? "diagnostics.snapshot_failed" : `diagnostics.${action}_ok`,
    message: snapshotResult?.ok === false ? "Diagnostics snapshot failed." : "Diagnostics snapshot captured.",
    reply: formatDiagnosticsReply(action, snapshot),
    requestHints,
    provider: normalizeText(snapshotResult?.providerId || providerAdapter.providerId, "runtime_diagnostics"),
    userContextId,
    conversationId,
    sessionKey,
    startedAt,
    action,
    data: {
      diagnostics: snapshot,
    },
  });
}
