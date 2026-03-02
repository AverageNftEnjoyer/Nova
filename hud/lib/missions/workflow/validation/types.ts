import type { WorkflowSummary } from "../../types/index"

export type WorkflowValidationMode = "minimal" | "full"

export type WorkflowValidationProfile = "minimal" | "runtime" | "strict" | "ai-friendly"

export type WorkflowValidationSeverity = "error" | "warning" | "info"

export const WORKFLOW_VALIDATION_ISSUE_CODES = {
  MALFORMED_WORKFLOW_JSON: "workflow.malformed_json",
  WORKFLOW_STEPS_MISSING: "workflow.steps_missing",
  WORKFLOW_STEPS_EMPTY: "workflow.steps_empty",
  WORKFLOW_STEP_LIMIT_EXCEEDED: "workflow.step_limit_exceeded",
  STEP_TYPE_INVALID: "workflow.step_type_invalid",
  STEP_ID_MISSING: "workflow.step_id_missing",
  STEP_ID_DUPLICATE: "workflow.step_id_duplicate",
  STEP_TITLE_MISSING: "workflow.step_title_missing",
  FETCH_INPUT_MISSING: "workflow.fetch_input_missing",
  AI_PROMPT_MISSING: "workflow.ai_prompt_missing",
  AI_PROMPT_TOO_SHORT: "workflow.ai_prompt_too_short",
  AI_INTEGRATION_MISSING: "workflow.ai_integration_missing",
  CONDITION_FIELD_MISSING: "workflow.condition_field_missing",
  OUTPUT_CHANNEL_MISSING: "workflow.output_channel_missing",
  OUTPUT_RECIPIENTS_MISSING: "workflow.output_recipients_missing",
} as const

export type WorkflowValidationIssueCode =
  (typeof WORKFLOW_VALIDATION_ISSUE_CODES)[keyof typeof WORKFLOW_VALIDATION_ISSUE_CODES]

export interface WorkflowValidationIssue {
  code: WorkflowValidationIssueCode
  severity: WorkflowValidationSeverity
  path: string
  field: string
  message: string
  remediation: string
}

export interface WorkflowValidationInput {
  mode: WorkflowValidationMode
  profile: WorkflowValidationProfile
  summary: WorkflowSummary | null
  stage: "save" | "run"
  hasWorkflowMarker: boolean
  userContextId?: string
  scheduleId?: string
}

export interface WorkflowValidationResult {
  ok: boolean
  blocked: boolean
  mode: WorkflowValidationMode
  profile: WorkflowValidationProfile
  stage: "save" | "run"
  durationMs: number
  issueCount: {
    error: number
    warning: number
    info: number
  }
  issues: WorkflowValidationIssue[]
  metadata: {
    userContextId?: string
    scheduleId?: string
  }
}
