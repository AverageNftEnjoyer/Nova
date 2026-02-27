import assert from "node:assert/strict"
import test from "node:test"

import { executeWorkflowAutofix } from "../index.ts"

test("unit: low-risk fixes are auto-applied when apply=true", () => {
  const result = executeWorkflowAutofix({
    apply: true,
    stage: "save",
    mode: "full",
    profile: "strict",
    summary: {
      workflowSteps: [
        { id: "a", type: "ai", title: "", aiPrompt: "Do work" },
        { id: "b", type: "output", title: "Send", outputChannel: "" },
      ],
    },
    userContextId: "tenant-alpha",
  })
  assert.equal(result.appliedFixIds.length >= 2, true)
  assert.equal(result.summary.workflowSteps?.[0]?.title?.length ? true : false, true)
  assert.equal(result.summary.workflowSteps?.[0]?.aiIntegration?.length ? true : false, true)
  assert.equal(result.summary.workflowSteps?.[1]?.outputChannel?.length ? true : false, true)
})

test("unit: medium/high risk fixes are gated until explicitly approved", () => {
  const summary = {
    workflowSteps: [
      { id: "f1", type: "fetch", title: "Fetch" },
      { id: "a1", type: "ai", title: "AI", aiPrompt: "" },
    ],
  }
  const preview = executeWorkflowAutofix({
    apply: false,
    stage: "save",
    mode: "full",
    profile: "strict",
    summary,
    userContextId: "tenant-bravo",
  })
  assert.equal(preview.candidates.some((candidate) => candidate.disposition === "needs_approval"), true)

  const approvedIds = preview.candidates
    .filter((candidate) => candidate.disposition === "needs_approval")
    .map((candidate) => candidate.id)

  const applied = executeWorkflowAutofix({
    apply: true,
    approvedFixIds: approvedIds,
    stage: "save",
    mode: "full",
    profile: "strict",
    summary,
    userContextId: "tenant-bravo",
  })
  assert.equal(applied.appliedFixIds.some((id) => approvedIds.includes(id)), true)
  assert.equal(String(applied.summary.workflowSteps?.[0]?.fetchQuery || "").trim().length > 0, true)
  assert.equal(String(applied.summary.workflowSteps?.[1]?.aiPrompt || "").trim().length > 0, true)
})
