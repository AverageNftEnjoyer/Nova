import assert from "node:assert/strict"

import { executeWorkflowAutofix } from "../index"

function runCheck(name: string, fn: () => void): void {
  fn()
  console.log(`PASS ${name}`)
}

runCheck("autofix preview exposes confidence-ranked candidates", () => {
  const preview = executeWorkflowAutofix({
    apply: false,
    stage: "save",
    mode: "full",
    profile: "strict",
    summary: {
      workflowSteps: [
        { id: "step-1", type: "ai", title: "", aiPrompt: "" },
      ],
    },
    userContextId: "tenant-preview",
  })
  assert.equal(preview.candidates.length > 0, true)
  assert.equal(preview.candidates[0].confidence >= preview.candidates[preview.candidates.length - 1].confidence, true)
})

runCheck("autofix applies low-risk fixes without explicit approval", () => {
  const result = executeWorkflowAutofix({
    apply: true,
    stage: "save",
    mode: "full",
    profile: "strict",
    summary: {
      workflowSteps: [
        { id: "step-1", type: "ai", title: "", aiPrompt: "Summarize portfolio." },
      ],
    },
    userContextId: "tenant-low-risk",
  })
  assert.equal(String(result.summary.workflowSteps?.[0]?.title || "").trim().length > 0, true)
  assert.equal(String(result.summary.workflowSteps?.[0]?.aiIntegration || "").trim().length > 0, true)
})

runCheck("autofix blocks medium/high fixes without approval then applies with approval", () => {
  const summary = {
    workflowSteps: [
      { id: "step-fetch", type: "fetch", title: "Fetch data" },
      { id: "step-ai", type: "ai", title: "Summarize", aiPrompt: "" },
    ],
  }
  const preview = executeWorkflowAutofix({
    apply: false,
    stage: "save",
    mode: "full",
    profile: "strict",
    summary,
    userContextId: "tenant-approval",
  })
  const approvalIds = preview.candidates
    .filter((candidate) => candidate.disposition === "needs_approval")
    .map((candidate) => candidate.id)
  const withoutApproval = executeWorkflowAutofix({
    apply: true,
    stage: "save",
    mode: "full",
    profile: "strict",
    summary,
    userContextId: "tenant-approval",
  })
  assert.equal(String(withoutApproval.summary.workflowSteps?.[0]?.fetchQuery || "").trim().length, 0)
  assert.equal(String(withoutApproval.summary.workflowSteps?.[1]?.aiPrompt || "").trim().length, 0)

  const withApproval = executeWorkflowAutofix({
    apply: true,
    approvedFixIds: approvalIds,
    stage: "save",
    mode: "full",
    profile: "strict",
    summary,
    userContextId: "tenant-approval",
  })
  assert.equal(String(withApproval.summary.workflowSteps?.[0]?.fetchQuery || "").trim().length > 0, true)
  assert.equal(String(withApproval.summary.workflowSteps?.[1]?.aiPrompt || "").trim().length > 0, true)
})
