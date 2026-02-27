import { parseMissionWorkflow, WORKFLOW_MARKER } from "../parsing.ts"
import { WORKFLOW_RUN_VALIDATION_POLICY, WORKFLOW_SAVE_VALIDATION_POLICY } from "./config.ts"
import type {
  WorkflowValidationMode,
  WorkflowValidationProfile,
  WorkflowValidationResult,
} from "./types.ts"
import { validateWorkflowSummary } from "./validator.ts"

export interface ValidateWorkflowMessageInput {
  message: string
  stage: "save" | "run"
  mode: WorkflowValidationMode
  profile: WorkflowValidationProfile
  userContextId?: string
  scheduleId?: string
}

export function validateMissionWorkflowMessage(
  input: ValidateWorkflowMessageInput,
): WorkflowValidationResult {
  const message = String(input.message || "")
  const parsed = parseMissionWorkflow(message)
  const hasWorkflowMarker = message.includes(WORKFLOW_MARKER)
  if (!hasWorkflowMarker) {
    return {
      ok: true,
      blocked: false,
      mode: input.mode,
      profile: input.profile,
      stage: input.stage,
      durationMs: 0,
      issueCount: { error: 0, warning: 0, info: 0 },
      issues: [],
      metadata: {
        userContextId: input.userContextId,
        scheduleId: input.scheduleId,
      },
    }
  }
  return validateWorkflowSummary({
    mode: input.mode,
    profile: input.profile,
    summary: parsed.summary,
    stage: input.stage,
    hasWorkflowMarker,
    userContextId: input.userContextId,
    scheduleId: input.scheduleId,
  })
}

export const SAVE_WORKFLOW_VALIDATION_POLICY = WORKFLOW_SAVE_VALIDATION_POLICY
export const RUN_WORKFLOW_VALIDATION_POLICY = WORKFLOW_RUN_VALIDATION_POLICY
