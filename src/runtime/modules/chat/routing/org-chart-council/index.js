import {
  COUNCIL_RULES,
  DEFAULT_COUNCIL_ID,
} from "../org-chart-routing/registry.js";

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((toolCall) => normalizeText(toolCall)).filter(Boolean);
}

function includesAnyToken(text, tokens) {
  if (!text) return false;
  const normalizedTokens = Array.isArray(tokens) ? tokens : [];
  for (const token of normalizedTokens) {
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

function buildEvidence({ routeMatched, responseRouteMatched, textMatched, toolCallMatched }) {
  return {
    routeMatched: routeMatched === true,
    responseRouteMatched: responseRouteMatched === true,
    textMatched: textMatched === true,
    toolCallMatched: toolCallMatched === true,
  };
}

function evaluateCouncilRule(rule, context) {
  const routeMatched = includesAnyToken(context.route, rule.routeTokens);
  const responseRouteMatched = includesAnyToken(context.responseRoute, rule.responseRouteTokens);
  const textMatched = includesAnyToken(context.text, rule.textTokens);
  const toolCallMatched = includesAnyToolCall(context.toolCalls, rule.toolCallTokens);
  const matched = routeMatched || responseRouteMatched || textMatched || toolCallMatched;
  return {
    matched,
    evidence: buildEvidence({
      routeMatched,
      responseRouteMatched,
      textMatched,
      toolCallMatched,
    }),
  };
}

export function resolveCouncilDecision(input = {}) {
  const context = {
    route: normalizeText(input.route),
    responseRoute: normalizeText(input.responseRoute),
    text: normalizeText(input.text),
    toolCalls: normalizeToolCalls(input.toolCalls),
  };

  for (const rule of COUNCIL_RULES) {
    const evaluation = evaluateCouncilRule(rule, context);
    if (!evaluation.matched) continue;
    return {
      selectedCouncilId: String(rule.id || DEFAULT_COUNCIL_ID),
      decisionType: "rule_match",
      matchedRuleId: String(rule.id || ""),
      evidence: evaluation.evidence,
      inputSnapshot: {
        route: context.route,
        responseRoute: context.responseRoute,
        toolCalls: context.toolCalls.slice(0, 8),
      },
    };
  }

  return {
    selectedCouncilId: DEFAULT_COUNCIL_ID,
    decisionType: "default_fallback",
    matchedRuleId: "",
    evidence: buildEvidence({
      routeMatched: false,
      responseRouteMatched: false,
      textMatched: false,
      toolCallMatched: false,
    }),
    inputSnapshot: {
      route: context.route,
      responseRoute: context.responseRoute,
      toolCalls: context.toolCalls.slice(0, 8),
    },
  };
}

