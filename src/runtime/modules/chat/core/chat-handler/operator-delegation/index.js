import { resolveOrgChartRoutingEnvelope } from "../../../routing/org-chart-routing/index.js";
import { executeOrgChartDelegation } from "../../../routing/org-chart-delegation/index.js";

export function attachOrgChartPathToSummary(summary, orgChartPath, defaultRoute = "unclassified") {
  const normalizedSummary = summary && typeof summary === "object"
    ? { ...summary }
    : {
        route: defaultRoute,
        ok: true,
        reply: typeof summary === "string" ? summary : "",
      };
  const requestHints = normalizedSummary.requestHints && typeof normalizedSummary.requestHints === "object"
    ? { ...normalizedSummary.requestHints }
    : {};
  if (!requestHints.orgChartPath || typeof requestHints.orgChartPath !== "object") {
    requestHints.orgChartPath = orgChartPath;
  }
  requestHints.operatorId = "nova-operator";
  requestHints.delegationStage = "operator_handoff";
  normalizedSummary.requestHints = requestHints;
  return normalizedSummary;
}

export async function delegateToOrgChartWorker({
  routeHint = "unclassified",
  responseRoute = "",
  text = "",
  toolCalls = [],
  provider = "",
  providerSource = "worker-runtime-selected",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  policyGate = null,
  run,
}) {
  const delegation = await executeOrgChartDelegation({
    routeHint: String(routeHint || "unclassified"),
    responseRoute: String(responseRoute || ""),
    text,
    toolCalls,
    provider,
    providerSource,
    userContextId,
    conversationId,
    sessionKey,
    ...(policyGate && typeof policyGate === "object" ? { policyGate } : {}),
    executeWorker: async ({ orgChartPath }) => run(orgChartPath),
  });
  const summary = attachOrgChartPathToSummary(
    delegation.workerSummary,
    delegation.orgChartPath,
    String(routeHint || "unclassified"),
  );
  const requestHints = summary.requestHints && typeof summary.requestHints === "object"
    ? { ...summary.requestHints }
    : {};
  requestHints.orgChartDelegation = {
    mode: "enforced",
    envelopes: Array.isArray(delegation.envelopes) ? delegation.envelopes : [],
    hops: Array.isArray(delegation.hops) ? delegation.hops : [],
  };
  if (delegation.delegationError && typeof delegation.delegationError === "object") {
    requestHints.delegationError = {
      stage: String(delegation.delegationError.stage || "worker_execution"),
      code: String(delegation.delegationError.code || "worker_execution_failed"),
      message: String(delegation.delegationError.message || "Worker execution failed."),
    };
  }
  summary.requestHints = requestHints;
  return summary;
}

export function ensureSummaryRequestHintsWithOrgChart(summary, defaults = {}) {
  const summaryRequestHints = summary?.requestHints && typeof summary.requestHints === "object"
    ? { ...summary.requestHints }
    : {};
  if (!summaryRequestHints.orgChartPath || typeof summaryRequestHints.orgChartPath !== "object") {
    summaryRequestHints.orgChartPath = resolveOrgChartRoutingEnvelope({
      route: String(defaults.route || "unclassified"),
      responseRoute: String(defaults.responseRoute || ""),
      text: String(defaults.text || ""),
      toolCalls: Array.isArray(defaults.toolCalls) ? defaults.toolCalls : [],
      provider: String(defaults.provider || ""),
      providerSource: String(defaults.providerSource || "worker-runtime-selected"),
      userContextId: String(defaults.userContextId || ""),
      conversationId: String(defaults.conversationId || ""),
      sessionKey: String(defaults.sessionKey || ""),
    });
  }
  return summaryRequestHints;
}
