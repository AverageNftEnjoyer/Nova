function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value, fallback = {}) {
  return value && typeof value === "object" ? value : fallback;
}

export function normalizeWorkerSummary(summary, input = {}) {
  const fallbackRoute = normalizeText(input.fallbackRoute, "unclassified");
  const fallbackResponseRoute = normalizeText(input.fallbackResponseRoute, fallbackRoute);
  const fallbackProvider = normalizeText(input.fallbackProvider, "");
  const fallbackLatencyMs = Math.max(0, normalizeNumber(input.fallbackLatencyMs, 0));

  const source = summary && typeof summary === "object"
    ? summary
    : {
      route: fallbackRoute,
      responseRoute: fallbackResponseRoute,
      ok: true,
      reply: typeof summary === "string" ? summary : "",
      error: "",
    };

  const route = normalizeText(source.route, fallbackRoute);
  const responseRoute = normalizeText(source.responseRoute, fallbackResponseRoute);
  const ok = normalizeBoolean(source.ok, true);
  const error = ok ? "" : normalizeText(source.error, "worker_execution_failed");
  const telemetrySource = normalizeObject(source.telemetry, {});
  const requestHints = normalizeObject(source.requestHints, {});

  return {
    sessionKey: normalizeText(source.sessionKey, normalizeText(input.sessionKey, "")),
    route,
    responseRoute,
    ok,
    reply: normalizeText(source.reply, ""),
    error,
    errorMessage: normalizeText(source.errorMessage, ""),
    provider: normalizeText(source.provider, fallbackProvider),
    model: normalizeText(source.model, ""),
    toolCalls: normalizeArray(source.toolCalls),
    toolExecutions: normalizeArray(source.toolExecutions),
    retries: normalizeArray(source.retries),
    requestHints,
    promptTokens: Math.max(0, normalizeNumber(source.promptTokens, 0)),
    completionTokens: Math.max(0, normalizeNumber(source.completionTokens, 0)),
    totalTokens: Math.max(0, normalizeNumber(source.totalTokens, 0)),
    estimatedCostUsd: source.estimatedCostUsd == null ? null : Number(source.estimatedCostUsd),
    memoryRecallUsed: normalizeBoolean(source.memoryRecallUsed, false),
    webSearchPreloadUsed: normalizeBoolean(source.webSearchPreloadUsed, false),
    linkUnderstandingUsed: normalizeBoolean(source.linkUnderstandingUsed, false),
    canRunToolLoop: normalizeBoolean(source.canRunToolLoop, false),
    canRunWebSearch: normalizeBoolean(source.canRunWebSearch, false),
    canRunWebFetch: normalizeBoolean(source.canRunWebFetch, false),
    latencyMs: Math.max(0, normalizeNumber(source.latencyMs, fallbackLatencyMs)),
    telemetry: {
      ...telemetrySource,
      latencyMs: Math.max(0, normalizeNumber(telemetrySource.latencyMs, normalizeNumber(source.latencyMs, fallbackLatencyMs))),
      tokens: Math.max(0, normalizeNumber(telemetrySource.tokens, normalizeNumber(source.totalTokens, 0))),
      provider: normalizeText(telemetrySource.provider, normalizeText(source.provider, fallbackProvider)),
      toolCalls: Math.max(0, normalizeNumber(telemetrySource.toolCalls, normalizeArray(source.toolCalls).length)),
      userContextId: normalizeText(telemetrySource.userContextId, normalizeText(input.userContextId, "")),
      conversationId: normalizeText(telemetrySource.conversationId, normalizeText(input.conversationId, "")),
      sessionKey: normalizeText(telemetrySource.sessionKey, normalizeText(source.sessionKey, normalizeText(input.sessionKey, ""))),
    },
  };
}
