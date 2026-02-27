import type { WorkflowSummary } from "../../types.ts"
import type { WorkflowValidationIssue, WorkflowValidationMode, WorkflowValidationProfile, WorkflowValidationResult } from "../validation/index.ts"

export type WorkflowAutofixRisk = "low" | "medium" | "high"

export type WorkflowAutofixDisposition = "safe_auto_apply" | "needs_approval"

export interface WorkflowAutofixCandidate {
  id: string
  issueCode: WorkflowValidationIssue["code"]
  risk: WorkflowAutofixRisk
  disposition: WorkflowAutofixDisposition
  confidence: number
  path: string
  title: string
  message: string
  remediation: string
  changePreview: string
}

export interface WorkflowAutofixPolicy {
  autoApplyLowRisk: boolean
  lowRiskConfidenceThreshold: number
  approvalConfidenceThreshold: number
  maxFixCandidates: number
  defaultAiIntegration: "openai" | "claude" | "grok" | "gemini"
  defaultOutputChannel: "novachat" | "telegram" | "discord" | "email" | "push" | "webhook"
  defaultFetchQuery: string
  defaultConditionField: string
}

export interface WorkflowAutofixInput {
  summary: WorkflowSummary
  stage: "save" | "run"
  mode: WorkflowValidationMode
  profile: WorkflowValidationProfile
  approvedFixIds?: string[]
  apply: boolean
  userContextId?: string
  scheduleId?: string
}

export interface WorkflowAutofixResult {
  ok: boolean
  blocked: boolean
  stage: "save" | "run"
  mode: WorkflowValidationMode
  profile: WorkflowValidationProfile
  issueReduction: {
    before: number
    after: number
  }
  candidates: WorkflowAutofixCandidate[]
  appliedFixIds: string[]
  pendingApprovalFixIds: string[]
  initialValidation: WorkflowValidationResult
  finalValidation: WorkflowValidationResult
  summary: WorkflowSummary
  metadata: {
    userContextId?: string
    scheduleId?: string
  }
}
