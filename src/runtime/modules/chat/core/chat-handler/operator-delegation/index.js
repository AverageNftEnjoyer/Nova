import { resolveOrgChartRoutingEnvelope } from "../../../routing/org-chart-routing/index.js";
import { executeOrgChartDelegation } from "../../../routing/org-chart-delegation/index.js";

export function attachOrgChartPathToSummary(summary, orgChartPath, fallbackRoute = "unclassified") {
  const normalizedSummary = summary && typeof summary === "object"
    ? { ...summary }
    : {
        route: fallbackRoute,
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
  providerSource = "chat-runtime-fallback",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
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

export function ensureSummaryRequestHintsWithOrgChart(summary, fallback = {}) {
  const summaryRequestHints = summary?.requestHints && typeof summary.requestHints === "object"
    ? { ...summary.requestHints }
    : {};
  if (!summaryRequestHints.orgChartPath || typeof summaryRequestHints.orgChartPath !== "object") {
    summaryRequestHints.orgChartPath = resolveOrgChartRoutingEnvelope({
      route: String(fallback.route || "unclassified"),
      responseRoute: String(fallback.responseRoute || ""),
      text: String(fallback.text || ""),
      toolCalls: Array.isArray(fallback.toolCalls) ? fallback.toolCalls : [],
      provider: String(fallback.provider || ""),
      providerSource: String(fallback.providerSource || "chat-runtime-fallback"),
      userContextId: String(fallback.userContextId || ""),
      conversationId: String(fallback.conversationId || ""),
      sessionKey: String(fallback.sessionKey || ""),
    });
  }
  return summaryRequestHints;
}
