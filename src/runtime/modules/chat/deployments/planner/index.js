import { resolveOrgChartRoutingEnvelope } from "../../routing/org-chart-routing/index.js";
import {
  DEFAULT_DOMAIN_WORKER_RULE,
  DOMAIN_WORKER_RULES,
} from "../../routing/org-chart-routing/registry.js";

const SPECIALISTS = new Set([
  DEFAULT_DOMAIN_WORKER_RULE.workerAgentId,
  ...DOMAIN_WORKER_RULES.map((rule) => rule.workerAgentId),
]);
const TOOL_NAME = /^[a-z][a-z0-9_:-]{0,95}$/;

function boundedText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function stringList(value, maxItems, maxChars) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => boundedText(entry, maxChars)).filter(Boolean))].slice(0, maxItems);
}

function nullableNumber(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("The manager returned an empty deployment plan.");
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The manager did not return a JSON deployment plan.");
  return JSON.parse(unfenced.slice(start, end + 1));
}

export function buildDeploymentPlanningPrompt({ outcome, userContextId = "", conversationId = "" }) {
  const routing = resolveOrgChartRoutingEnvelope({
    text: outcome,
    route: "deployment",
    responseRoute: "deployment_plan",
    userContextId,
    conversationId,
  });
  const allowedSpecialists = [...SPECIALISTS].sort();
  return {
    routing,
    systemText: [
      "You are U.B Agents' deployment manager. Convert the user's requested outcome into one executable deployment plan.",
      "Choose kind=task for a one-off outcome and kind=automation only for recurring, scheduled, event-triggered, or reusable work.",
      "Return exactly one JSON object and no prose.",
      `Allowed specialist IDs: ${allowedSpecialists.join(", ")}.`,
      "Tool names must be lowercase registry-style identifiers. Do not invent credentials or claim an integration is connected.",
      "High-risk plans and plans with external writes, money movement, deletion, account changes, or bypass permissions require review.",
      "Schema: {outcome:string, acceptanceCriteria:string[], kind:'task'|'automation', specialists:string[], tools:string[], context:string[], risk:'low'|'medium'|'high', budgetEstimate:{costUsd:number|null,tokens:number|null,confidence:'low'|'medium'|'high'}, reviewRequired:boolean, rationale:string}.",
    ].join("\n"),
    userText: boundedText(outcome, 8_000),
  };
}

export function validateDeploymentPlan(value, context = {}) {
  const input = value && typeof value === "object" ? value : {};
  const outcome = boundedText(input.outcome || context.outcome, 8_000);
  if (!outcome) throw new Error("A deployment plan must include an outcome.");
  const kind = input.kind === "automation" ? "automation" : input.kind === "task" ? "task" : "";
  if (!kind) throw new Error("A deployment plan must choose task or automation.");
  const acceptanceCriteria = stringList(input.acceptanceCriteria, 20, 500);
  if (acceptanceCriteria.length === 0) {
    throw new Error("A deployment plan must include at least one acceptance criterion.");
  }
  const routing = context.routing || resolveOrgChartRoutingEnvelope({ text: outcome });
  const requestedSpecialists = stringList(input.specialists, 12, 96).filter((id) => SPECIALISTS.has(id));
  const specialists = requestedSpecialists.length > 0
    ? requestedSpecialists
    : [routing.workerAgentId || DEFAULT_DOMAIN_WORKER_RULE.workerAgentId];
  const tools = stringList(input.tools, 24, 96).filter((name) => TOOL_NAME.test(name));
  const contextItems = stringList(input.context, 20, 500);
  const risk = input.risk === "high" || input.risk === "medium" ? input.risk : "low";
  const estimate = input.budgetEstimate && typeof input.budgetEstimate === "object"
    ? input.budgetEstimate
    : {};
  const confidence = ["low", "medium", "high"].includes(estimate.confidence)
    ? estimate.confidence
    : "low";
  const reviewRequired = risk === "high" || input.reviewRequired === true;
  return {
    outcome,
    acceptanceCriteria,
    kind,
    specialists,
    tools,
    context: contextItems,
    risk,
    budgetEstimate: {
      costUsd: nullableNumber(estimate.costUsd, 0, 100_000),
      tokens: nullableNumber(estimate.tokens, 0, 100_000_000),
      confidence,
    },
    reviewRequired,
    rationale: boundedText(input.rationale, 2_000),
  };
}

export function parseDeploymentPlan(text, context = {}) {
  return validateDeploymentPlan(extractJson(text), context);
}
