import {
  DOMAIN_WORKER_RULES,
  DEFAULT_DOMAIN_WORKER_RULE,
  PROVIDER_ADAPTER_BY_PROVIDER,
} from "./registry.js";
import { resolveCouncilDecision } from "../org-chart-council/index.js";

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((toolCall) => normalizeText(toolCall)).filter(Boolean);
}

function includesAnyToken(text, tokens) {
  if (!text) return false;
  for (const token of tokens) {
    if (!token) continue;
    if (text.includes(String(token))) return true;
  }
  return false;
}

function includesAnyToolCall(toolCalls, tokens) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return false;
  if (!Array.isArray(tokens) || tokens.length === 0) return false;
  return toolCalls.some((toolCall) => includesAnyToken(toolCall, tokens));
}

function ruleMatches(rule, context) {
  const routeMatch = includesAnyToken(context.route, rule.routeTokens || []);
  const responseRouteMatch = includesAnyToken(context.responseRoute, rule.responseRouteTokens || []);
  const textMatch = includesAnyToken(context.text, rule.textTokens || []);
  const toolCallMatch = includesAnyToolCall(context.toolCalls, rule.toolCallTokens || []);
  return routeMatch || responseRouteMatch || textMatch || toolCallMatch;
}

function resolveDomainAndWorker(context) {
  for (const rule of DOMAIN_WORKER_RULES) {
    if (ruleMatches(rule, context)) {
      return {
        domainManagerId: rule.domainManagerId,
        workerAgentId: rule.workerAgentId,
        reason: rule.reason,
      };
    }
  }
  return {
    domainManagerId: DEFAULT_DOMAIN_WORKER_RULE.domainManagerId,
    workerAgentId: DEFAULT_DOMAIN_WORKER_RULE.workerAgentId,
    reason: DEFAULT_DOMAIN_WORKER_RULE.reason,
  };
}

function resolveProviderRail(provider, providerSource) {
  const normalizedProvider = normalizeText(provider) || "none";
  const normalizedSource = normalizeText(providerSource) || "chat-runtime-default";
  return {
    agentId: "provider-selector",
    provider: normalizedProvider,
    adapterId: PROVIDER_ADAPTER_BY_PROVIDER[normalizedProvider] || "none",
    source: normalizedSource,
  };
}

export function resolveOrgChartRoutingEnvelope(input = {}) {
  const context = {
    route: normalizeText(input.route),
    responseRoute: normalizeText(input.responseRoute),
    text: normalizeText(input.text),
    toolCalls: normalizeToolCalls(input.toolCalls),
  };
  const councilDecision = resolveCouncilDecision({
    route: context.route,
    responseRoute: context.responseRoute,
    text: context.text,
    toolCalls: context.toolCalls,
  });
  const domainWorker = resolveDomainAndWorker(context);

  return {
    operatorId: "nova-operator",
    councilId: councilDecision.selectedCouncilId,
    councilDecision,
    domainManagerId: domainWorker.domainManagerId,
    workerAgentId: domainWorker.workerAgentId,
    providerSelector: resolveProviderRail(input.provider, input.providerSource),
    context: {
      userContextId: String(input.userContextId || "").trim(),
      conversationId: String(input.conversationId || "").trim(),
      sessionKey: String(input.sessionKey || "").trim(),
    },
    signal: domainWorker.reason,
  };
}
