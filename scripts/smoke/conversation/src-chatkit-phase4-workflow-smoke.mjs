import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const mod = await import(pathToFileURL(path.join(process.cwd(), "dist/integrations/chatkit/index.js")).href);

const plan = mod.buildStructuredWorkflowPlan({
  prompt: "Build a company research output",
  skillNames: ["summarize", "research", "nova-core"],
});

assert.equal(Array.isArray(plan.steps), true);
assert.equal(plan.steps.length, 3, "workflow should have deterministic 3 steps");
assert.equal(plan.steps[0].kind, "research");
assert.equal(plan.steps[1].kind, "summarize");
assert.equal(plan.steps[2].kind, "display");

let attempts = 0;
const workflowResult = await mod.runStructuredChatKitWorkflow(
  {
    userContextId: "phase4-user",
    conversationId: "phase4-thread",
    missionRunId: "phase4-mission",
    prompt: "Analyze this company for a marketing brief.",
    skillNames: ["research", "summarize"],
    maxAttemptsPerStep: 2,
  },
  {
    executeStep: async ({ prompt }) => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          outputText: "",
          provider: "openai-chatkit",
          model: "gpt-5-mini",
          latencyMs: 1,
          errorCode: "TRANSIENT",
          errorMessage: "temporary failure",
        };
      }
      const phase = prompt.includes("Current step (research)")
        ? "research"
        : prompt.includes("Current step (summarize)")
          ? "summarize"
          : "display";
      return {
        ok: true,
        outputText: `${phase} output`,
        provider: "openai-chatkit",
        model: "gpt-5-mini",
        latencyMs: 1,
      };
    },
  },
);

assert.equal(workflowResult.ok, true, "workflow should succeed with retry");
assert.equal(workflowResult.steps.length, 3);
assert.equal(workflowResult.steps[0].attempts, 2, "first step should retry once");
assert.equal(workflowResult.steps[1].attempts, 1);
assert.equal(workflowResult.steps[2].attempts, 1);
assert.equal(typeof workflowResult.finalOutput, "string");
assert.equal(workflowResult.finalOutput.length > 0, true);

console.log("[src-chatkit-phase4-workflow-smoke] PASS");

