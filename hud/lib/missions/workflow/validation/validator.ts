import type { WorkflowStep } from "../../types/index"
import { WORKFLOW_VALIDATION_LIMITS } from "./config.ts"
import {
  WORKFLOW_VALIDATION_ISSUE_CODES,
  type WorkflowValidationInput,
  type WorkflowValidationIssue,
  type WorkflowValidationResult,
} from "./types.ts"

const KNOWN_STEP_TYPES = new Set(["trigger", "fetch", "coinbase", "ai", "transform", "condition", "output"])
const STRICT_OUTPUT_CHANNELS_REQUIRING_RECIPIENTS = new Set(["telegram", "discord", "email", "webhook", "push"])

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now()
  }
  return Date.now()
}

function pushIssue(
  issues: WorkflowValidationIssue[],
  issue: WorkflowValidationIssue,
): void {
  if (issues.length >= WORKFLOW_VALIDATION_LIMITS.maxIssueCount) return
  issues.push(issue)
}

function createIssue(
  code: WorkflowValidationIssue["code"],
  severity: WorkflowValidationIssue["severity"],
  path: string,
  field: string,
  message: string,
  remediation: string,
): WorkflowValidationIssue {
  return { code, severity, path, field, message, remediation }
}

function normalizedStepType(step: WorkflowStep): string {
  return String(step.type || "").trim().toLowerCase()
}

function validateSteps(input: WorkflowValidationInput, issues: WorkflowValidationIssue[]): void {
  const steps = Array.isArray(input.summary?.workflowSteps) ? input.summary!.workflowSteps! : []
  const seenStepIds = new Set<string>()
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index] || {}
    const path = `summary.workflowSteps[${index}]`
    const stepType = normalizedStepType(step)
    const stepId = String(step.id || "").trim()

    if (!KNOWN_STEP_TYPES.has(stepType)) {
      pushIssue(
        issues,
        createIssue(
          WORKFLOW_VALIDATION_ISSUE_CODES.STEP_TYPE_INVALID,
          "error",
          `${path}.type`,
          "type",
          `Step type "${stepType || "unknown"}" is not supported.`,
          "Use one of: trigger, fetch, coinbase, ai, transform, condition, output.",
        ),
      )
      continue
    }

    if (!stepId) {
      pushIssue(
        issues,
        createIssue(
          WORKFLOW_VALIDATION_ISSUE_CODES.STEP_ID_MISSING,
          "error",
          `${path}.id`,
          "id",
          "Step id is missing.",
          `Set a stable unique step id (for example "step-${index + 1}").`,
        ),
      )
    } else if (seenStepIds.has(stepId)) {
      pushIssue(
        issues,
        createIssue(
          WORKFLOW_VALIDATION_ISSUE_CODES.STEP_ID_DUPLICATE,
          "error",
          `${path}.id`,
          "id",
          `Duplicate step id "${stepId}".`,
          "Ensure every workflow step has a unique id.",
        ),
      )
    } else {
      seenStepIds.add(stepId)
    }

    if (!String(step.title || "").trim()) {
      pushIssue(
        issues,
        createIssue(
          WORKFLOW_VALIDATION_ISSUE_CODES.STEP_TITLE_MISSING,
          "warning",
          `${path}.title`,
          "title",
          "Step title is empty.",
          "Add a descriptive step title to improve debugging and audit readability.",
        ),
      )
    }

    if (stepType === "fetch") {
      const fetchUrl = String(step.fetchUrl || "").trim()
      const fetchQuery = String(step.fetchQuery || "").trim()
      if (!fetchUrl && !fetchQuery) {
        pushIssue(
          issues,
          createIssue(
            WORKFLOW_VALIDATION_ISSUE_CODES.FETCH_INPUT_MISSING,
            "error",
            path,
            "fetchUrl",
            "Fetch step requires either fetchUrl or fetchQuery.",
            "Provide fetchUrl for direct fetches or fetchQuery for web search.",
          ),
        )
      }
    }

    if (stepType === "ai") {
      const aiPrompt = String(step.aiPrompt || "").trim()
      const aiIntegration = String(step.aiIntegration || "").trim()
      if (!aiPrompt) {
        pushIssue(
          issues,
          createIssue(
            WORKFLOW_VALIDATION_ISSUE_CODES.AI_PROMPT_MISSING,
            "error",
            `${path}.aiPrompt`,
            "aiPrompt",
            "AI step requires aiPrompt.",
            "Set aiPrompt with clear objective and output format requirements.",
          ),
        )
      }
      if (input.profile === "strict" && !aiIntegration) {
        pushIssue(
          issues,
          createIssue(
            WORKFLOW_VALIDATION_ISSUE_CODES.AI_INTEGRATION_MISSING,
            "error",
            `${path}.aiIntegration`,
            "aiIntegration",
            "Strict profile requires explicit aiIntegration.",
            "Set aiIntegration to one of: openai, claude, grok, gemini.",
          ),
        )
      }
      if (input.profile === "strict" && aiPrompt.length > 0 && aiPrompt.length < WORKFLOW_VALIDATION_LIMITS.strictAiPromptMinChars) {
        pushIssue(
          issues,
          createIssue(
            WORKFLOW_VALIDATION_ISSUE_CODES.AI_PROMPT_TOO_SHORT,
            "error",
            `${path}.aiPrompt`,
            "aiPrompt",
            `AI prompt is too short for strict profile (${aiPrompt.length} chars).`,
            `Use at least ${WORKFLOW_VALIDATION_LIMITS.strictAiPromptMinChars} characters with explicit instructions.`,
          ),
        )
      }
      if (input.profile === "ai-friendly" && aiPrompt.length > 0 && aiPrompt.length < WORKFLOW_VALIDATION_LIMITS.aiFriendlyAiPromptMinChars) {
        pushIssue(
          issues,
          createIssue(
            WORKFLOW_VALIDATION_ISSUE_CODES.AI_PROMPT_TOO_SHORT,
            "warning",
            `${path}.aiPrompt`,
            "aiPrompt",
            `AI prompt is short (${aiPrompt.length} chars) and may under-specify intent.`,
            `Expand prompt to at least ${WORKFLOW_VALIDATION_LIMITS.aiFriendlyAiPromptMinChars} characters for more stable output.`,
          ),
        )
      }
    }

    if (stepType === "condition") {
      if (!String(step.conditionField || "").trim()) {
        pushIssue(
          issues,
          createIssue(
            WORKFLOW_VALIDATION_ISSUE_CODES.CONDITION_FIELD_MISSING,
            "error",
            `${path}.conditionField`,
            "conditionField",
            "Condition step requires conditionField.",
            "Set conditionField to a concrete dot-path, for example data.payload.price.",
          ),
        )
      }
    }

    if (stepType === "output") {
      const outputChannel = String(step.outputChannel || "").trim().toLowerCase()
      const recipients = String(step.outputRecipients || "").trim()
      if (!outputChannel) {
        pushIssue(
          issues,
          createIssue(
            WORKFLOW_VALIDATION_ISSUE_CODES.OUTPUT_CHANNEL_MISSING,
            "error",
            `${path}.outputChannel`,
            "outputChannel",
            "Output step requires outputChannel.",
            "Set outputChannel to one of: telegram, discord, email, push, webhook.",
          ),
        )
      }
      if (input.profile === "strict" && STRICT_OUTPUT_CHANNELS_REQUIRING_RECIPIENTS.has(outputChannel) && !recipients) {
        pushIssue(
          issues,
          createIssue(
            WORKFLOW_VALIDATION_ISSUE_CODES.OUTPUT_RECIPIENTS_MISSING,
            "warning",
            `${path}.outputRecipients`,
            "outputRecipients",
            `Output channel "${outputChannel}" has no explicit outputRecipients in strict profile.`,
            "Provide outputRecipients directly, or verify schedule-level recipients are configured.",
          ),
        )
      }
    }
  }
}

function applyModeProfileFilters(input: WorkflowValidationInput, issues: WorkflowValidationIssue[]): WorkflowValidationIssue[] {
  if (input.mode === "minimal") {
    return issues.filter((issue) => issue.severity === "error")
  }
  if (input.profile === "minimal" || input.profile === "runtime") {
    return issues.filter((issue) => issue.severity === "error")
  }
  return issues
}

export function validateWorkflowSummary(input: WorkflowValidationInput): WorkflowValidationResult {
  const startedAt = nowMs()
  const issues: WorkflowValidationIssue[] = []

  if (input.hasWorkflowMarker && !input.summary) {
    pushIssue(
      issues,
      createIssue(
        WORKFLOW_VALIDATION_ISSUE_CODES.MALFORMED_WORKFLOW_JSON,
        "error",
        "summary",
        "summary",
        "Workflow marker is present but workflow JSON could not be parsed.",
        "Fix [NOVA WORKFLOW] JSON payload format.",
      ),
    )
  }

  if (input.summary) {
    const steps = input.summary.workflowSteps
    if (!Array.isArray(steps)) {
      pushIssue(
        issues,
        createIssue(
          WORKFLOW_VALIDATION_ISSUE_CODES.WORKFLOW_STEPS_MISSING,
          "error",
          "summary.workflowSteps",
          "workflowSteps",
          "workflowSteps is missing or not an array.",
          "Provide workflowSteps as a non-empty array.",
        ),
      )
    } else if (steps.length === 0) {
      pushIssue(
        issues,
        createIssue(
          WORKFLOW_VALIDATION_ISSUE_CODES.WORKFLOW_STEPS_EMPTY,
          "error",
          "summary.workflowSteps",
          "workflowSteps",
          "workflowSteps array is empty.",
          "Add at least one workflow step.",
        ),
      )
    } else if (steps.length > WORKFLOW_VALIDATION_LIMITS.maxSteps) {
      pushIssue(
        issues,
        createIssue(
          WORKFLOW_VALIDATION_ISSUE_CODES.WORKFLOW_STEP_LIMIT_EXCEEDED,
          "error",
          "summary.workflowSteps",
          "workflowSteps",
          `workflowSteps exceeds configured limit (${steps.length}/${WORKFLOW_VALIDATION_LIMITS.maxSteps}).`,
          `Reduce step count or increase NOVA_WORKFLOW_VALIDATION_MAX_STEPS for this environment.`,
        ),
      )
    } else {
      validateSteps(input, issues)
    }
  }

  const filteredIssues = applyModeProfileFilters(input, issues)
  const issueCount = {
    error: filteredIssues.filter((issue) => issue.severity === "error").length,
    warning: filteredIssues.filter((issue) => issue.severity === "warning").length,
    info: filteredIssues.filter((issue) => issue.severity === "info").length,
  }
  const blocked = issueCount.error > 0
  return {
    ok: !blocked,
    blocked,
    mode: input.mode,
    profile: input.profile,
    stage: input.stage,
    durationMs: nowMs() - startedAt,
    issueCount,
    issues: filteredIssues,
    metadata: {
      userContextId: input.userContextId,
      scheduleId: input.scheduleId,
    },
  }
}
