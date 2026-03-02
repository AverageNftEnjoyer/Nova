import type { WorkflowStep, WorkflowSummary } from "../../types/index"
import { WORKFLOW_VALIDATION_ISSUE_CODES, validateWorkflowSummary, type WorkflowValidationIssue } from "../validation/index.ts"
import { WORKFLOW_AUTOFIX_POLICY } from "./config.ts"
import type {
  WorkflowAutofixCandidate,
  WorkflowAutofixDisposition,
  WorkflowAutofixInput,
  WorkflowAutofixPolicy,
  WorkflowAutofixResult,
} from "./types.ts"

interface CandidatePlan extends WorkflowAutofixCandidate {
  apply: (summary: WorkflowSummary) => boolean
}

function cloneSummary(summary: WorkflowSummary): WorkflowSummary {
  return JSON.parse(JSON.stringify(summary || {})) as WorkflowSummary
}

function parseStepIndex(path: string): number {
  const match = /workflowSteps\[(\d+)\]/.exec(String(path || ""))
  if (!match) return -1
  const parsed = Number.parseInt(match[1] || "", 10)
  return Number.isFinite(parsed) ? parsed : -1
}

function toFixId(issue: WorkflowValidationIssue, index: number): string {
  const pathKey = String(issue.path || "")
    .replace(/[^a-zA-Z0-9_.[\]-]/g, "_")
  return `${issue.code}:${pathKey}:${index}`
}

function clampConfidence(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000
}

function ensureSteps(summary: WorkflowSummary): WorkflowStep[] {
  if (!Array.isArray(summary.workflowSteps)) summary.workflowSteps = []
  return summary.workflowSteps
}

function defaultTitleForStep(stepType: string, stepIndex: number): string {
  const base = String(stepType || "").trim().toLowerCase() || "step"
  return `${base.charAt(0).toUpperCase()}${base.slice(1)} step ${stepIndex + 1}`
}

function makePlan(
  issue: WorkflowValidationIssue,
  index: number,
  risk: "low" | "medium" | "high",
  confidence: number,
  title: string,
  changePreview: string,
  apply: (summary: WorkflowSummary) => boolean,
): CandidatePlan {
  const disposition: WorkflowAutofixDisposition = risk === "low" ? "safe_auto_apply" : "needs_approval"
  return {
    id: toFixId(issue, index),
    issueCode: issue.code,
    risk,
    disposition,
    confidence: clampConfidence(confidence),
    path: issue.path,
    title,
    message: issue.message,
    remediation: issue.remediation,
    changePreview,
    apply,
  }
}

function createPlans(
  issues: WorkflowValidationIssue[],
  policy: WorkflowAutofixPolicy,
): CandidatePlan[] {
  const plans: CandidatePlan[] = []
  for (let index = 0; index < issues.length; index += 1) {
    const issue = issues[index]
    const stepIndex = parseStepIndex(issue.path)
    if (issue.code === WORKFLOW_VALIDATION_ISSUE_CODES.STEP_TITLE_MISSING && stepIndex >= 0) {
      plans.push(
        makePlan(
          issue,
          index,
          "low",
          0.97,
          "Set missing step title",
          "Auto-generate a stable, readable title for the step.",
          (summary) => {
            const steps = ensureSteps(summary)
            if (stepIndex >= steps.length) return false
            const step = steps[stepIndex]
            if (!step) return false
            if (String(step.title || "").trim()) return false
            step.title = defaultTitleForStep(String(step.type || ""), stepIndex)
            return true
          },
        ),
      )
      continue
    }
    if (issue.code === WORKFLOW_VALIDATION_ISSUE_CODES.AI_INTEGRATION_MISSING && stepIndex >= 0) {
      plans.push(
        makePlan(
          issue,
          index,
          "low",
          0.91,
          "Set default AI provider",
          `Set aiIntegration to "${policy.defaultAiIntegration}".`,
          (summary) => {
            const steps = ensureSteps(summary)
            if (stepIndex >= steps.length) return false
            const step = steps[stepIndex]
            if (!step || String(step.type || "").trim().toLowerCase() !== "ai") return false
            if (String(step.aiIntegration || "").trim()) return false
            step.aiIntegration = policy.defaultAiIntegration
            return true
          },
        ),
      )
      continue
    }
    if (issue.code === WORKFLOW_VALIDATION_ISSUE_CODES.OUTPUT_CHANNEL_MISSING && stepIndex >= 0) {
      plans.push(
        makePlan(
          issue,
          index,
          "low",
          0.9,
          "Set default output channel",
          `Set outputChannel to "${policy.defaultOutputChannel}".`,
          (summary) => {
            const steps = ensureSteps(summary)
            if (stepIndex >= steps.length) return false
            const step = steps[stepIndex]
            if (!step || String(step.type || "").trim().toLowerCase() !== "output") return false
            if (String(step.outputChannel || "").trim()) return false
            step.outputChannel = policy.defaultOutputChannel
            return true
          },
        ),
      )
      continue
    }
    if (issue.code === WORKFLOW_VALIDATION_ISSUE_CODES.FETCH_INPUT_MISSING && stepIndex >= 0) {
      plans.push(
        makePlan(
          issue,
          index,
          "medium",
          0.67,
          "Set fetch query placeholder",
          `Set fetchQuery to "${policy.defaultFetchQuery}".`,
          (summary) => {
            const steps = ensureSteps(summary)
            if (stepIndex >= steps.length) return false
            const step = steps[stepIndex]
            if (!step || String(step.type || "").trim().toLowerCase() !== "fetch") return false
            const hasUrl = String(step.fetchUrl || "").trim().length > 0
            const hasQuery = String(step.fetchQuery || "").trim().length > 0
            if (hasUrl || hasQuery) return false
            step.fetchQuery = policy.defaultFetchQuery
            return true
          },
        ),
      )
      continue
    }
    if (issue.code === WORKFLOW_VALIDATION_ISSUE_CODES.AI_PROMPT_MISSING && stepIndex >= 0) {
      plans.push(
        makePlan(
          issue,
          index,
          "medium",
          0.66,
          "Insert AI prompt template",
          "Insert a constrained AI prompt template with explicit objective and output format.",
          (summary) => {
            const steps = ensureSteps(summary)
            if (stepIndex >= steps.length) return false
            const step = steps[stepIndex]
            if (!step || String(step.type || "").trim().toLowerCase() !== "ai") return false
            if (String(step.aiPrompt || "").trim()) return false
            step.aiPrompt = "Analyze the provided input, extract key points, and return a concise structured response."
            return true
          },
        ),
      )
      continue
    }
    if (issue.code === WORKFLOW_VALIDATION_ISSUE_CODES.AI_PROMPT_TOO_SHORT && stepIndex >= 0) {
      plans.push(
        makePlan(
          issue,
          index,
          "medium",
          0.61,
          "Expand short AI prompt",
          "Append explicit constraints to improve determinism.",
          (summary) => {
            const steps = ensureSteps(summary)
            if (stepIndex >= steps.length) return false
            const step = steps[stepIndex]
            if (!step || String(step.type || "").trim().toLowerCase() !== "ai") return false
            const currentPrompt = String(step.aiPrompt || "").trim()
            if (!currentPrompt) return false
            const suffix = " Include assumptions, key risks, and a clearly labeled final answer."
            if (currentPrompt.includes(suffix.trim())) return false
            step.aiPrompt = `${currentPrompt}${suffix}`
            return true
          },
        ),
      )
      continue
    }
    if (issue.code === WORKFLOW_VALIDATION_ISSUE_CODES.CONDITION_FIELD_MISSING && stepIndex >= 0) {
      plans.push(
        makePlan(
          issue,
          index,
          "medium",
          0.64,
          "Set condition field placeholder",
          `Set conditionField to "${policy.defaultConditionField}".`,
          (summary) => {
            const steps = ensureSteps(summary)
            if (stepIndex >= steps.length) return false
            const step = steps[stepIndex]
            if (!step || String(step.type || "").trim().toLowerCase() !== "condition") return false
            if (String(step.conditionField || "").trim()) return false
            step.conditionField = policy.defaultConditionField
            return true
          },
        ),
      )
      continue
    }
    if (issue.code === WORKFLOW_VALIDATION_ISSUE_CODES.OUTPUT_RECIPIENTS_MISSING && stepIndex >= 0) {
      plans.push(
        makePlan(
          issue,
          index,
          "high",
          0.58,
          "Set output recipients placeholder",
          'Set outputRecipients to "REPLACE_WITH_RECIPIENTS" and require manual review.',
          (summary) => {
            const steps = ensureSteps(summary)
            if (stepIndex >= steps.length) return false
            const step = steps[stepIndex]
            if (!step || String(step.type || "").trim().toLowerCase() !== "output") return false
            if (String(step.outputRecipients || "").trim()) return false
            step.outputRecipients = "REPLACE_WITH_RECIPIENTS"
            return true
          },
        ),
      )
      continue
    }
  }
  return plans
}

export function executeWorkflowAutofix(input: WorkflowAutofixInput): WorkflowAutofixResult {
  const policy = WORKFLOW_AUTOFIX_POLICY
  const initialValidation = validateWorkflowSummary({
    mode: input.mode,
    profile: input.profile,
    summary: input.summary,
    stage: input.stage,
    hasWorkflowMarker: true,
    userContextId: input.userContextId,
    scheduleId: input.scheduleId,
  })
  const allPlans = createPlans(initialValidation.issues, policy)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, policy.maxFixCandidates)

  const approvedFixIds = new Set((Array.isArray(input.approvedFixIds) ? input.approvedFixIds : []).map((row) => String(row || "")))
  const workingSummary = cloneSummary(input.summary)
  const appliedFixIds: string[] = []
  const pendingApprovalFixIds: string[] = []

  if (input.apply) {
    for (const plan of allPlans) {
      const isLowRiskAutoEligible =
        plan.disposition === "safe_auto_apply" &&
        policy.autoApplyLowRisk &&
        plan.confidence >= policy.lowRiskConfidenceThreshold
      const isApproved =
        plan.disposition === "needs_approval" &&
        approvedFixIds.has(plan.id) &&
        plan.confidence >= policy.approvalConfidenceThreshold

      if (!isLowRiskAutoEligible && !isApproved) {
        if (plan.disposition === "needs_approval") pendingApprovalFixIds.push(plan.id)
        continue
      }
      if (plan.apply(workingSummary)) {
        appliedFixIds.push(plan.id)
      }
    }
  } else {
    for (const plan of allPlans) {
      if (plan.disposition === "needs_approval") pendingApprovalFixIds.push(plan.id)
    }
  }

  const finalValidation = validateWorkflowSummary({
    mode: input.mode,
    profile: input.profile,
    summary: workingSummary,
    stage: input.stage,
    hasWorkflowMarker: true,
    userContextId: input.userContextId,
    scheduleId: input.scheduleId,
  })

  return {
    ok: !finalValidation.blocked,
    blocked: finalValidation.blocked,
    stage: input.stage,
    mode: input.mode,
    profile: input.profile,
    issueReduction: {
      before: initialValidation.issues.length,
      after: finalValidation.issues.length,
    },
    candidates: allPlans.map((plan) => ({
      id: plan.id,
      issueCode: plan.issueCode,
      risk: plan.risk,
      disposition: plan.disposition,
      confidence: plan.confidence,
      path: plan.path,
      title: plan.title,
      message: plan.message,
      remediation: plan.remediation,
      changePreview: plan.changePreview,
    })),
    appliedFixIds,
    pendingApprovalFixIds,
    initialValidation,
    finalValidation,
    summary: workingSummary,
    metadata: {
      userContextId: input.userContextId,
      scheduleId: input.scheduleId,
    },
  }
}
