import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"

import {
  WORKFLOW_VALIDATION_ISSUE_CODES,
  WORKFLOW_VALIDATION_LIMITS,
  validateWorkflowSummary,
  type WorkflowValidationInput,
} from "../index"

function buildTypicalSummary() {
  return {
    workflowSteps: [
      { id: "step-1", type: "trigger", title: "Start" },
      { id: "step-2", type: "fetch", title: "Fetch market data", fetchQuery: "market updates" },
      { id: "step-3", type: "transform", title: "Normalize data", transformAction: "normalize" },
      { id: "step-4", type: "condition", title: "Check confidence", conditionField: "data.confidence", conditionOperator: "greater_than", conditionValue: "0.6" },
      { id: "step-5", type: "ai", title: "Summarize", aiPrompt: "Write concise summary with risks and confidence.", aiIntegration: "openai" },
      { id: "step-6", type: "output", title: "Deliver", outputChannel: "telegram" },
    ],
  }
}

function runCheck(name: string, fn: () => void): void {
  fn()
  console.log(`PASS ${name}`)
}

runCheck("unit malformed workflow payload blocked with stable issue format", () => {
  const result = validateWorkflowSummary({
    stage: "save",
    mode: "full",
    profile: "strict",
    hasWorkflowMarker: true,
    summary: null,
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

runCheck("unit strict profile enforces aiIntegration while runtime does not", () => {
  const summary = {
    workflowSteps: [
      { id: "step-1", type: "ai", title: "Summarize", aiPrompt: "Summarize this dataset in plain text." },
      { id: "step-2", type: "output", title: "Deliver", outputChannel: "telegram" },
    ],
  }
  const strictResult = validateWorkflowSummary({
    stage: "save",
    mode: "full",
    profile: "strict",
    hasWorkflowMarker: true,
    summary,
  })
  const runtimeResult = validateWorkflowSummary({
    stage: "run",
    mode: "full",
    profile: "runtime",
    hasWorkflowMarker: true,
    summary,
  })
  assert.equal(strictResult.blocked, true)
  assert.ok(strictResult.issues.some((issue) => issue.code === WORKFLOW_VALIDATION_ISSUE_CODES.AI_INTEGRATION_MISSING))
  assert.equal(runtimeResult.blocked, false)
})

runCheck("unit minimal mode returns error-only payload", () => {
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

runCheck("integration save validation blocks invalid workflow summary", () => {
  const result = validateWorkflowSummary({
    stage: "save",
    mode: "full",
    profile: "strict",
    hasWorkflowMarker: true,
    summary: {
      workflowSteps: [
        { id: "step-1", type: "fetch", title: "Fetch missing inputs" },
      ],
    },
    userContextId: "tenant-alpha",
    scheduleId: "sched-1",
  })
  assert.equal(result.blocked, true)
  assert.ok(result.issues.some((issue) => issue.code === WORKFLOW_VALIDATION_ISSUE_CODES.FETCH_INPUT_MISSING))
})

runCheck("integration run validation allows schedules without workflow marker", () => {
  const result = validateWorkflowSummary({
    stage: "run",
    mode: "full",
    profile: "runtime",
    hasWorkflowMarker: false,
    summary: null,
    userContextId: "tenant-alpha",
    scheduleId: "sched-2",
  })
  assert.equal(result.blocked, false)
  assert.equal(result.issueCount.error, 0)
})

runCheck("integration pre-run blocks malformed workflow payload", () => {
  const result = validateWorkflowSummary({
    stage: "run",
    mode: "full",
    profile: "runtime",
    hasWorkflowMarker: true,
    summary: null,
    userContextId: "tenant-alpha",
    scheduleId: "sched-3",
  })
  assert.equal(result.blocked, true)
  assert.ok(result.issues.some((issue) => issue.code === WORKFLOW_VALIDATION_ISSUE_CODES.MALFORMED_WORKFLOW_JSON))
})

runCheck("performance minimal validation p95 under configured target", () => {
  const summary = buildTypicalSummary()
  const samples: number[] = []
  for (let i = 0; i < 400; i += 1) {
    const started = performance.now()
    const result = validateWorkflowSummary({
      stage: "run",
      mode: "minimal",
      profile: "runtime",
      hasWorkflowMarker: true,
      summary,
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
  console.log(`PERF minimal_p95_ms=${p95.toFixed(3)} target_ms=${WORKFLOW_VALIDATION_LIMITS.minimalP95TargetMs}`)
})
