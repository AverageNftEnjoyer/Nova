import test from "node:test"
import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"

import {
  RUN_WORKFLOW_VALIDATION_POLICY,
  SAVE_WORKFLOW_VALIDATION_POLICY,
  WORKFLOW_VALIDATION_ISSUE_CODES,
  WORKFLOW_VALIDATION_LIMITS,
  validateMissionWorkflowMessage,
  validateWorkflowSummary,
  type WorkflowValidationInput,
} from "../index.ts"

function buildWorkflowMessage(summary: Record<string, unknown>): string {
  return `Mission description\n\n[NOVA WORKFLOW]\n${JSON.stringify(summary)}`
}

function buildTypicalSummary(): Record<string, unknown> {
  return {
    workflowSteps: [
      { id: "step-1", type: "trigger", title: "Start" },
      { id: "step-2", type: "fetch", title: "Fetch market data", fetchQuery: "market updates" },
      { id: "step-3", type: "transform", title: "Normalize data", transformAction: "normalize" },
      { id: "step-4", type: "condition", title: "Check confidence", conditionField: "data.confidence", conditionOperator: "greater_than", conditionValue: "0.6" },
      { id: "step-5", type: "ai", title: "Summarize", aiPrompt: "Write concise summary with risks and confidence.", aiIntegration: "openai" },
      { id: "step-6", type: "output", title: "Deliver", outputChannel: "novachat" },
    ],
  }
}

test("unit: malformed workflow payload is blocked with stable issue format", () => {
  const result = validateMissionWorkflowMessage({
    message: "Hello\n[NOVA WORKFLOW]\n{not valid json}",
    stage: "save",
    mode: "full",
    profile: "strict",
    userContextId: "u-test",
    scheduleId: "mission-1",
  })
  assert.equal(result.blocked, true)
  assert.equal(result.issues[0]?.code, WORKFLOW_VALIDATION_ISSUE_CODES.MALFORMED_WORKFLOW_JSON)
  assert.equal(result.issues[0]?.severity, "error")
  assert.equal(result.issues[0]?.path, "summary")
  assert.ok(result.issues[0]?.message.length)
  assert.ok(result.issues[0]?.remediation.length)
})

test("unit: strict profile enforces explicit aiIntegration while runtime does not", () => {
  const summary = {
    workflowSteps: [
      { id: "step-1", type: "ai", title: "Summarize", aiPrompt: "Summarize this dataset in plain text." },
      { id: "step-2", type: "output", title: "Deliver", outputChannel: "novachat" },
    ],
  }
  const strictResult = validateMissionWorkflowMessage({
    message: buildWorkflowMessage(summary),
    stage: "save",
    mode: "full",
    profile: "strict",
  })
  const runtimeResult = validateMissionWorkflowMessage({
    message: buildWorkflowMessage(summary),
    stage: "run",
    mode: "full",
    profile: "runtime",
  })
  assert.equal(strictResult.blocked, true)
  assert.ok(strictResult.issues.some((issue) => issue.code === WORKFLOW_VALIDATION_ISSUE_CODES.AI_INTEGRATION_MISSING))
  assert.equal(runtimeResult.blocked, false)
  assert.ok(runtimeResult.issues.every((issue) => issue.code !== WORKFLOW_VALIDATION_ISSUE_CODES.AI_INTEGRATION_MISSING))
})

test("unit: minimal mode returns error-only payload", () => {
  const input: WorkflowValidationInput = {
    mode: "minimal",
    profile: "ai-friendly",
    summary: {
      workflowSteps: [
        { id: "step-1", type: "ai", title: "", aiPrompt: "short", aiIntegration: "openai" },
      ],
    },
    stage: "save",
    hasWorkflowMarker: true,
  }
  const result = validateWorkflowSummary(input)
  assert.equal(result.issues.some((issue) => issue.severity === "warning"), false)
})

test("integration: pre-save blocks invalid workflow", () => {
  const result = validateMissionWorkflowMessage({
    message: buildWorkflowMessage({
      workflowSteps: [
        { id: "step-1", type: "fetch", title: "Fetch missing inputs" },
      ],
    }),
    stage: "save",
    mode: SAVE_WORKFLOW_VALIDATION_POLICY.mode,
    profile: SAVE_WORKFLOW_VALIDATION_POLICY.profile,
    userContextId: "tenant-alpha",
    scheduleId: "sched-1",
  })
  assert.equal(result.blocked, true)
  assert.ok(result.issues.some((issue) => issue.code === WORKFLOW_VALIDATION_ISSUE_CODES.FETCH_INPUT_MISSING))
})

test("integration: pre-run allows plain message schedules without workflow marker", () => {
  const result = validateMissionWorkflowMessage({
    message: "Send this plain notification to my channel.",
    stage: "run",
    mode: RUN_WORKFLOW_VALIDATION_POLICY.mode,
    profile: RUN_WORKFLOW_VALIDATION_POLICY.profile,
    userContextId: "tenant-alpha",
    scheduleId: "sched-2",
  })
  assert.equal(result.blocked, false)
  assert.equal(result.issueCount.error, 0)
})

test("integration: pre-run blocks malformed workflow payload", () => {
  const result = validateMissionWorkflowMessage({
    message: "Broken payload\n[NOVA WORKFLOW]\n{\"workflowSteps\":[",
    stage: "run",
    mode: RUN_WORKFLOW_VALIDATION_POLICY.mode,
    profile: RUN_WORKFLOW_VALIDATION_POLICY.profile,
    userContextId: "tenant-alpha",
    scheduleId: "sched-3",
  })
  assert.equal(result.blocked, true)
  assert.ok(result.issues.some((issue) => issue.code === WORKFLOW_VALIDATION_ISSUE_CODES.MALFORMED_WORKFLOW_JSON))
})

test("performance: minimal validation p95 is under configured target", () => {
  const summary = buildTypicalSummary()
  const samples: number[] = []
  for (let i = 0; i < 400; i += 1) {
    const started = performance.now()
    const result = validateMissionWorkflowMessage({
      message: buildWorkflowMessage(summary),
      stage: "run",
      mode: "minimal",
      profile: "runtime",
    })
    const ended = performance.now()
    samples.push(ended - started)
    assert.equal(result.blocked, false)
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1))
  const p95 = sorted[idx]
  assert.ok(
    p95 < WORKFLOW_VALIDATION_LIMITS.minimalP95TargetMs,
    `Expected p95 ${p95.toFixed(3)}ms to be below ${WORKFLOW_VALIDATION_LIMITS.minimalP95TargetMs}ms`,
  )
})
