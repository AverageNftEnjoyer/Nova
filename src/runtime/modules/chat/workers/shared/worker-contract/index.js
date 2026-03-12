function normalizeText(value, defaultValue = "") {
  const normalized = String(value || "").trim();
  return normalized || defaultValue;
}

function normalizeNumber(value, defaultValue = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return numeric;
}

function normalizeBoolean(value, defaultValue = false) {
  if (typeof value === "boolean") return value;
  return defaultValue;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value, defaultValue = {}) {
  return value && typeof value === "object" ? value : defaultValue;
}

export function normalizeWorkerSummary(summary, input = {}) {
  const defaultRoute = normalizeText(input.defaultRoute, "unclassified");
  const defaultResponseRoute = normalizeText(input.defaultResponseRoute, defaultRoute);
  const defaultProvider = normalizeText(input.defaultProvider, "");
  const defaultLatencyMs = Math.max(0, normalizeNumber(input.defaultLatencyMs, 0));

  const source = summary && typeof summary === "object"
    ? summary
    : {
      route: defaultRoute,
      responseRoute: defaultResponseRoute,
      ok: true,
      reply: typeof summary === "string" ? summary : "",
      error: "",
    };

  const route = normalizeText(source.route, defaultRoute);
  const responseRoute = normalizeText(source.responseRoute, defaultResponseRoute);
  const ok = normalizeBoolean(source.ok, true);
  const sourceError = normalizeText(source.error, "");
  const error = sourceError || (ok ? "" : "worker_execution_failed");
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
    provider: normalizeText(source.provider, defaultProvider),
    model: normalizeText(source.model, ""),
    toolCalls: normalizeArray(source.toolCalls),
    toolExecutions: normalizeArray(source.toolExecutions),
    retries: normalizeArray(source.retries),
    requestHints,
    recoveryReason: normalizeText(source.recoveryReason, ""),
    recoveryStage: normalizeText(source.recoveryStage, ""),
    hadCandidateBeforeRecovery: source.hadCandidateBeforeRecovery === true,
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
    latencyMs: Math.max(0, normalizeNumber(source.latencyMs, defaultLatencyMs)),
    telemetry: {
      ...telemetrySource,
      latencyMs: Math.max(0, normalizeNumber(telemetrySource.latencyMs, normalizeNumber(source.latencyMs, defaultLatencyMs))),
      tokens: Math.max(0, normalizeNumber(telemetrySource.tokens, normalizeNumber(source.totalTokens, 0))),
      provider: normalizeText(telemetrySource.provider, normalizeText(source.provider, defaultProvider)),
      toolCalls: Math.max(0, normalizeNumber(telemetrySource.toolCalls, normalizeArray(source.toolCalls).length)),
      userContextId: normalizeText(telemetrySource.userContextId, normalizeText(input.userContextId, "")),
      conversationId: normalizeText(telemetrySource.conversationId, normalizeText(input.conversationId, "")),
      sessionKey: normalizeText(telemetrySource.sessionKey, normalizeText(source.sessionKey, normalizeText(input.sessionKey, ""))),
    },
  };
}
