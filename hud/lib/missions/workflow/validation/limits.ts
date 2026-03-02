function parseIntWithBounds(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value || ""), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export interface WorkflowValidationLimits {
  maxSteps: number
  strictAiPromptMinChars: number
  aiFriendlyAiPromptMinChars: number
  maxIssueCount: number
  minimalP95TargetMs: number
}

export const WORKFLOW_VALIDATION_LIMITS: WorkflowValidationLimits = {
  maxSteps: parseIntWithBounds(process.env.NOVA_WORKFLOW_VALIDATION_MAX_STEPS, 200, 1, 5000),
  strictAiPromptMinChars: parseIntWithBounds(process.env.NOVA_WORKFLOW_VALIDATION_STRICT_AI_PROMPT_MIN_CHARS, 40, 1, 2000),
  aiFriendlyAiPromptMinChars: parseIntWithBounds(
    process.env.NOVA_WORKFLOW_VALIDATION_AI_FRIENDLY_PROMPT_MIN_CHARS,
    40,
    1,
    2000,
  ),
  maxIssueCount: parseIntWithBounds(process.env.NOVA_WORKFLOW_VALIDATION_MAX_ISSUES, 100, 1, 1000),
  minimalP95TargetMs: parseIntWithBounds(process.env.NOVA_WORKFLOW_VALIDATION_MINIMAL_P95_TARGET_MS, 100, 10, 5000),
}
