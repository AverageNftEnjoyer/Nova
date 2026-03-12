import { resolveOrgChartRoutingEnvelope } from "../org-chart-routing/index.js";
import { executeCouncilStage } from "../org-chart-council-execution/index.js";
import { normalizeWorkerSummary } from "../../workers/shared/worker-contract/index.js";

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

function assertScopedContext(context = {}) {
  if (!String(context.userContextId || "").trim()) {
    throw new Error("executeOrgChartDelegation requires userContextId.");
  }
  if (!String(context.conversationId || "").trim()) {
    throw new Error("executeOrgChartDelegation requires conversationId.");
  }
  if (!String(context.sessionKey || "").trim()) {
    throw new Error("executeOrgChartDelegation requires sessionKey.");
  }
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

function resolvePolicyGate(input = {}) {
  const gate = input?.policyGate;
  if (!gate || typeof gate !== "object") {
    return {
      enabled: false,
      approvalGranted: false,
    };
  }
  return {
    enabled: gate.enabled === true,
    approvalGranted: gate.approvalGranted === true,
  };
}

function workerSummaryToEnvelope(workerAgentId, workerSummary, context, orgChartPath, latencyMs) {
  const summary = normalizeWorkerSummary(workerSummary, {
    defaultRoute: "unclassified",
    defaultResponseRoute: "unclassified",
    defaultProvider: String(orgChartPath?.providerSelector?.provider || ""),
    defaultLatencyMs: latencyMs,
    userContextId: context.userContextId,
    conversationId: context.conversationId,
    sessionKey: context.sessionKey,
  });
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
  assertScopedContext(context);
  const routeHint = String(input.routeHint || "unclassified");
  const responseRoute = String(input.responseRoute || "");
  const text = String(input.text || "");
  const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls : [];
  const provider = String(input.provider || "");
  const providerSource = String(input.providerSource || "worker-runtime-selected");
  const policyGate = resolvePolicyGate(input);

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
  const councilStage = executeCouncilStage({
    councilId: orgChartPath.councilId,
    councilDecision: orgChartPath.councilDecision,
    domainManagerId: orgChartPath.domainManagerId,
    workerAgentId: orgChartPath.workerAgentId,
    signal: orgChartPath.signal,
    routeHint,
    responseRoute,
    text,
    toolCalls,
  });
  const councilEnvelope = buildEnvelope({
    ok: councilStage.ok === true,
    agentId: councilStage.councilId,
    result: {
      selectedDomainManagerId: councilStage.selectedDomainManagerId,
      selectedWorkerAgentId: councilStage.selectedWorkerAgentId,
      signal: councilStage.signal,
      decisionType: String(councilStage?.decision?.decisionType || ""),
      matchedRuleId: String(councilStage?.decision?.matchedRuleId || ""),
      evidence: councilStage?.decision?.evidence || null,
      policy: councilStage?.policy || null,
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
  if (policyGate.enabled && councilStage?.policy?.approvalRequired === true && policyGate.approvalGranted !== true) {
    delegationError = {
      stage: "policy_gate",
      code: "policy_approval_required",
      message: "Policy council approval is required before worker execution.",
    };
    workerSummary = normalizeWorkerSummary({
      route: responseRoute || routeHint || "unclassified",
      responseRoute: responseRoute || "",
      ok: false,
      error: "policy_approval_required",
      errorMessage: "Policy council approval is required before worker execution.",
      provider: String(orgChartPath.providerSelector?.provider || provider || ""),
      toolCalls: [],
    }, {
      defaultRoute: responseRoute || routeHint || "unclassified",
      defaultResponseRoute: responseRoute || "",
      defaultProvider: String(orgChartPath.providerSelector?.provider || provider || ""),
      defaultLatencyMs: Math.max(0, Date.now() - workerStartedAt),
      userContextId: context.userContextId,
      conversationId: context.conversationId,
      sessionKey: context.sessionKey,
    });
  } else {
    try {
      workerSummary = await input.executeWorker({ orgChartPath });
    } catch (error) {
      const normalizedError = normalizeDelegationError(error);
      delegationError = {
        stage: "worker_execution",
        code: normalizedError.code,
        message: normalizedError.message,
      };
      workerSummary = normalizeWorkerSummary({
        route: responseRoute || routeHint || "unclassified",
        responseRoute: responseRoute || "",
        ok: false,
        error: normalizedError.code,
        errorMessage: normalizedError.message,
        provider: String(orgChartPath.providerSelector?.provider || provider || ""),
        toolCalls: [],
      }, {
        defaultRoute: responseRoute || routeHint || "unclassified",
        defaultResponseRoute: responseRoute || "",
        defaultProvider: String(orgChartPath.providerSelector?.provider || provider || ""),
        defaultLatencyMs: Math.max(0, Date.now() - workerStartedAt),
        userContextId: context.userContextId,
        conversationId: context.conversationId,
        sessionKey: context.sessionKey,
      });
    }
  }
  workerSummary = normalizeWorkerSummary(workerSummary, {
    defaultRoute: responseRoute || routeHint || "unclassified",
    defaultResponseRoute: responseRoute || "",
    defaultProvider: String(orgChartPath.providerSelector?.provider || provider || ""),
    defaultLatencyMs: Math.max(0, Date.now() - workerStartedAt),
    userContextId: context.userContextId,
    conversationId: context.conversationId,
    sessionKey: context.sessionKey,
  });
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
