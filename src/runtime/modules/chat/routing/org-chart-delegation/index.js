import { resolveOrgChartRoutingEnvelope } from "../org-chart-routing/index.js";

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric;
}

function buildContext(input = {}) {
  return {
    userContextId: String(input.userContextId || "").trim(),
    conversationId: String(input.conversationId || "").trim(),
    sessionKey: String(input.sessionKey || "").trim(),
  };
}

function buildEnvelope({ ok = true, agentId = "", result = {}, error = "", telemetry = {}, context = {} }) {
  return {
    ok: ok === true,
    agentId: String(agentId || "").trim(),
    result: {
      ...result,
      userContextId: context.userContextId || "",
      conversationId: context.conversationId || "",
      sessionKey: context.sessionKey || "",
    },
    error: String(error || ""),
    telemetry: {
      latencyMs: Math.max(0, normalizeNumber(telemetry.latencyMs, 0)),
      tokens: Math.max(0, normalizeNumber(telemetry.tokens, 0)),
      provider: String(telemetry.provider || ""),
      toolCalls: Math.max(0, normalizeNumber(telemetry.toolCalls, 0)),
    },
  };
}

function buildHop(fromAgentId, toAgentId, context, stage) {
  return {
    fromAgentId: String(fromAgentId || "").trim(),
    toAgentId: String(toAgentId || "").trim(),
    stage: String(stage || "").trim(),
    userContextId: context.userContextId || "",
    conversationId: context.conversationId || "",
    sessionKey: context.sessionKey || "",
  };
}

function normalizeDelegationError(error) {
  const code = String(error?.code || "worker_execution_failed")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .slice(0, 64);
  const message = String(error?.message || "Worker execution failed.")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 280);
  return {
    code: code || "worker_execution_failed",
    message: message || "Worker execution failed.",
  };
}

function workerSummaryToEnvelope(workerAgentId, workerSummary, context, orgChartPath, latencyMs) {
  const summary = workerSummary && typeof workerSummary === "object"
    ? workerSummary
    : {
        route: "unclassified",
        ok: true,
        reply: typeof workerSummary === "string" ? workerSummary : "",
        error: "",
      };
  const toolCalls = Array.isArray(summary.toolCalls) ? summary.toolCalls.length : 0;
  return buildEnvelope({
    ok: summary.ok !== false,
    agentId: workerAgentId,
    result: {
      route: String(summary.route || "unclassified"),
      responseRoute: String(summary.responseRoute || ""),
      signal: String(orgChartPath?.signal || ""),
    },
    error: summary.ok === false ? String(summary.error || "worker_execution_failed") : "",
    telemetry: {
      latencyMs: Math.max(0, normalizeNumber(summary.latencyMs, latencyMs)),
      tokens: Math.max(0, normalizeNumber(summary.totalTokens, 0)),
      provider: String(summary.provider || orgChartPath?.providerSelector?.provider || ""),
      toolCalls,
    },
    context,
  });
}

export async function executeOrgChartDelegation(input = {}) {
  if (typeof input.executeWorker !== "function") {
    throw new Error("executeOrgChartDelegation requires executeWorker callback.");
  }

  const context = buildContext(input);
  const routeHint = String(input.routeHint || "unclassified");
  const responseRoute = String(input.responseRoute || "");
  const text = String(input.text || "");
  const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls : [];
  const provider = String(input.provider || "");
  const providerSource = String(input.providerSource || "chat-runtime-fallback");

  const orgChartPath = resolveOrgChartRoutingEnvelope({
    route: routeHint,
    responseRoute,
    text,
    toolCalls,
    provider,
    providerSource,
    userContextId: context.userContextId,
    conversationId: context.conversationId,
    sessionKey: context.sessionKey,
  });

  const operatorEnvelope = buildEnvelope({
    ok: true,
    agentId: orgChartPath.operatorId,
    result: {
      decision: "delegate",
      targetCouncilId: orgChartPath.councilId,
      routeHint,
      responseRoute,
    },
    telemetry: {
      latencyMs: 0,
      provider: orgChartPath.providerSelector?.provider || "",
      toolCalls: 0,
    },
    context,
  });
  const councilEnvelope = buildEnvelope({
    ok: true,
    agentId: orgChartPath.councilId,
    result: {
      selectedDomainManagerId: orgChartPath.domainManagerId,
      signal: orgChartPath.signal,
    },
    telemetry: {
      latencyMs: 0,
      provider: orgChartPath.providerSelector?.provider || "",
      toolCalls: 0,
    },
    context,
  });
  const managerEnvelope = buildEnvelope({
    ok: true,
    agentId: orgChartPath.domainManagerId,
    result: {
      selectedWorkerAgentId: orgChartPath.workerAgentId,
      signal: orgChartPath.signal,
    },
    telemetry: {
      latencyMs: 0,
      provider: orgChartPath.providerSelector?.provider || "",
      toolCalls: 0,
    },
    context,
  });
  const providerEnvelope = buildEnvelope({
    ok: true,
    agentId: orgChartPath.providerSelector?.agentId || "provider-selector",
    result: {
      selectedProvider: String(orgChartPath.providerSelector?.provider || ""),
      adapterId: String(orgChartPath.providerSelector?.adapterId || "none"),
      source: String(orgChartPath.providerSelector?.source || ""),
    },
    telemetry: {
      latencyMs: 0,
      provider: orgChartPath.providerSelector?.provider || "",
      toolCalls: 0,
    },
    context,
  });

  const workerStartedAt = Date.now();
  let workerSummary = null;
  let delegationError = null;
  try {
    workerSummary = await input.executeWorker({ orgChartPath });
  } catch (error) {
    const normalizedError = normalizeDelegationError(error);
    delegationError = {
      stage: "worker_execution",
      code: normalizedError.code,
      message: normalizedError.message,
    };
    workerSummary = {
      route: responseRoute || routeHint || "unclassified",
      responseRoute: responseRoute || "",
      ok: false,
      error: normalizedError.code,
      errorMessage: normalizedError.message,
      provider: String(orgChartPath.providerSelector?.provider || provider || ""),
      totalTokens: 0,
      latencyMs: Math.max(0, Date.now() - workerStartedAt),
      toolCalls: [],
    };
  }
  const workerEnvelope = workerSummaryToEnvelope(
    orgChartPath.workerAgentId,
    workerSummary,
    context,
    orgChartPath,
    Date.now() - workerStartedAt,
  );

  const envelopes = [
    operatorEnvelope,
    councilEnvelope,
    managerEnvelope,
    providerEnvelope,
    workerEnvelope,
  ];
  const hops = [
    buildHop(orgChartPath.operatorId, orgChartPath.councilId, context, "operator_to_council"),
    buildHop(orgChartPath.councilId, orgChartPath.domainManagerId, context, "council_to_manager"),
    buildHop(orgChartPath.domainManagerId, orgChartPath.providerSelector?.agentId || "provider-selector", context, "manager_to_provider_selector"),
    buildHop(orgChartPath.providerSelector?.agentId || "provider-selector", orgChartPath.workerAgentId, context, "provider_selector_to_worker"),
    buildHop(orgChartPath.workerAgentId, orgChartPath.operatorId, context, "worker_to_operator"),
  ];

  return {
    orgChartPath,
    envelopes,
    hops,
    workerSummary,
    delegationError,
  };
}
