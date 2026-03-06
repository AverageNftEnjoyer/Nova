const KNOWN_COUNCIL_IDS = new Set([
  "routing-council",
  "memory-council",
  "planning-council",
  "policy-council",
]);
const SENSITIVE_TOOL_CALLS = new Set([
  "gmail_forward_message",
  "gmail_reply_draft",
]);

function normalizeId(value, fallback = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

function normalizeToolCalls(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeId(entry))
    .filter(Boolean);
}

function buildPolicyDecision({ councilId, routeHint, responseRoute, toolCalls }) {
  const normalizedRouteHint = normalizeId(routeHint);
  const normalizedResponseRoute = normalizeId(responseRoute);
  const normalizedToolCalls = normalizeToolCalls(toolCalls);
  const sensitiveTool = normalizedToolCalls.find((toolCall) => SENSITIVE_TOOL_CALLS.has(toolCall)) || "";
  const approvalRequired = Boolean(sensitiveTool || councilId === "policy-council");
  const riskTier = approvalRequired ? "high" : "standard";
  const reason = sensitiveTool
    ? "sensitive_tool_call"
    : (councilId === "policy-council" ? "policy_council_routed" : "none");

  return {
    approvalRequired,
    riskTier,
    reason,
    routeHint: normalizedRouteHint,
    responseRoute: normalizedResponseRoute,
    matchedSensitiveToolCall: sensitiveTool,
    observedToolCalls: normalizedToolCalls.slice(0, 8),
  };
}

export function executeCouncilStage(input = {}) {
  const councilId = normalizeId(input.councilId, "routing-council");
  const domainManagerId = normalizeId(input.domainManagerId);
  const workerAgentId = normalizeId(input.workerAgentId);
  const signal = normalizeId(input.signal);
  const routeHint = normalizeId(input.routeHint);
  const responseRoute = normalizeId(input.responseRoute);
  const toolCalls = normalizeToolCalls(input.toolCalls);
  const councilDecision = input.councilDecision && typeof input.councilDecision === "object"
    ? input.councilDecision
    : {};

  if (!KNOWN_COUNCIL_IDS.has(councilId)) {
    throw new Error(`Unknown council id "${councilId}" in executeCouncilStage.`);
  }
  if (!domainManagerId) {
    throw new Error("executeCouncilStage requires domainManagerId.");
  }
  if (!workerAgentId) {
    throw new Error("executeCouncilStage requires workerAgentId.");
  }

  return {
    ok: true,
    councilId,
    selectedDomainManagerId: domainManagerId,
    selectedWorkerAgentId: workerAgentId,
    signal,
    decision: {
      decisionType: normalizeId(councilDecision.decisionType),
      matchedRuleId: normalizeId(councilDecision.matchedRuleId),
      evidence: councilDecision.evidence || null,
      inputSnapshot: councilDecision.inputSnapshot || null,
    },
    policy: buildPolicyDecision({
      councilId,
      routeHint,
      responseRoute,
      toolCalls,
    }),
  };
}
