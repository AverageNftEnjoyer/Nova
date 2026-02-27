import type { WorkflowAutofixPolicy } from "./types.ts"

function parseFloatWithBounds(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(String(value || ""))
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function parseIntWithBounds(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value || ""), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return fallback
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true
  if (normalized === "0" || normalized === "false" || normalized === "no") return false
  return fallback
}

function parseAiIntegration(value: string | undefined): WorkflowAutofixPolicy["defaultAiIntegration"] {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "openai" || normalized === "claude" || normalized === "grok" || normalized === "gemini") {
    return normalized
  }
  return "openai"
}

function parseOutputChannel(value: string | undefined): WorkflowAutofixPolicy["defaultOutputChannel"] {
  const normalized = String(value || "").trim().toLowerCase()
  if (
    normalized === "novachat" ||
    normalized === "telegram" ||
    normalized === "discord" ||
    normalized === "email" ||
    normalized === "push" ||
    normalized === "webhook"
  ) {
    return normalized
  }
  return "novachat"
}

export const WORKFLOW_AUTOFIX_POLICY: WorkflowAutofixPolicy = {
  autoApplyLowRisk: parseBoolean(process.env.NOVA_WORKFLOW_AUTOFIX_AUTO_APPLY_LOW_RISK, true),
  lowRiskConfidenceThreshold: parseFloatWithBounds(process.env.NOVA_WORKFLOW_AUTOFIX_LOW_RISK_CONFIDENCE, 0.8, 0, 1),
  approvalConfidenceThreshold: parseFloatWithBounds(process.env.NOVA_WORKFLOW_AUTOFIX_APPROVAL_CONFIDENCE, 0.55, 0, 1),
  maxFixCandidates: parseIntWithBounds(process.env.NOVA_WORKFLOW_AUTOFIX_MAX_CANDIDATES, 64, 1, 500),
  defaultAiIntegration: parseAiIntegration(process.env.NOVA_WORKFLOW_AUTOFIX_DEFAULT_AI_INTEGRATION),
  defaultOutputChannel: parseOutputChannel(process.env.NOVA_WORKFLOW_AUTOFIX_DEFAULT_OUTPUT_CHANNEL),
  defaultFetchQuery: String(process.env.NOVA_WORKFLOW_AUTOFIX_DEFAULT_FETCH_QUERY || "latest updates").trim() || "latest updates",
  defaultConditionField: String(process.env.NOVA_WORKFLOW_AUTOFIX_DEFAULT_CONDITION_FIELD || "data.payload").trim() || "data.payload",
}
