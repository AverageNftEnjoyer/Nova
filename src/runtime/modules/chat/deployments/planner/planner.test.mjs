import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeploymentPlanningPrompt,
  parseDeploymentPlan,
  validateDeploymentPlan,
} from "./index.js";

test("planning prompt carries org-chart routing context", () => {
  const prompt = buildDeploymentPlanningPrompt({
    outcome: "Email me a daily summary of new accounting software reviews",
    userContextId: "user-1",
    conversationId: "conversation-1",
  });
  assert.equal(prompt.routing.operatorId, "nova-operator");
  assert.equal(prompt.routing.context.userContextId, "user-1");
  assert.match(prompt.systemText, /task.*automation/i);
});

test("validated plans reject missing acceptance criteria", () => {
  assert.throws(
    () => validateDeploymentPlan({ outcome: "Do work", kind: "task" }),
    /acceptance criterion/i,
  );
});

test("high risk always requires review and unknown specialists are removed", () => {
  const plan = validateDeploymentPlan({
    outcome: "Prepare a wallet transfer for review",
    kind: "task",
    acceptanceCriteria: ["A proposed transfer is ready but not sent"],
    specialists: ["not-a-real-specialist"],
    tools: ["phantom_capabilities", "Invalid Tool"],
    context: [],
    risk: "high",
    budgetEstimate: { costUsd: 1, tokens: 1000, confidence: "medium" },
    reviewRequired: false,
    rationale: "Money movement is sensitive.",
  });
  assert.equal(plan.reviewRequired, true);
  assert.equal(plan.specialists.length, 1);
  assert.deepEqual(plan.tools, ["phantom_capabilities"]);
});

test("strict JSON proposals parse without prose inference", () => {
  const plan = parseDeploymentPlan(JSON.stringify({
    outcome: "Produce a one-time market comparison",
    acceptanceCriteria: ["Three products are compared"],
    kind: "task",
    specialists: ["web-research-agent"],
    tools: ["web_search"],
    context: ["User requirements"],
    risk: "low",
    budgetEstimate: { costUsd: 0.25, tokens: 6000, confidence: "low" },
    reviewRequired: false,
    rationale: "One-time research request.",
  }));
  assert.equal(plan.kind, "task");
  assert.deepEqual(plan.specialists, ["web-research-agent"]);
});
