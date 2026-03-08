import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildPromptContextForTurn } from "./prompt-context-builder/index.js";

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-prompt-history-"));
  for (const name of ["SOUL.md", "USER.md", "MEMORY.md", "IDENTITY.md", "AGENTS.md"]) {
    fs.writeFileSync(path.join(root, name), `${name}\n${"context ".repeat(120)}`, "utf8");
  }
  return root;
}

function createLatencyTelemetry() {
  return {
    addStage() {},
    incrementCounter() {},
  };
}

test("oversized optional prompt sections do not starve transcript history injection", async () => {
  const workspace = makeWorkspace();
  try {
    const runSummary = { requestHints: {} };
    const result = await buildPromptContextForTurn({
      text: "What is the project codename?",
      uiText: "What is the project codename?",
      ctx: {},
      source: "hud",
      sender: "hud-user",
      sessionKey: "agent:nova:hud:user:test-user:dm:history-budget-thread",
      sessionContext: {
        transcript: [
          { role: "user", content: "For this conversation call me Alex." },
          { role: "assistant", content: "Got it, Alex." },
          { role: "user", content: "My project codename is Aurora-7." },
          { role: "assistant", content: "Understood. The codename is Aurora-7." },
        ],
      },
      userContextId: "test-user",
      conversationId: "history-budget-thread",
      personaWorkspaceDir: workspace,
      runtimeAssistantName: "Nova",
      runtimeCommunicationStyle: "direct",
      runtimeTone: "neutral",
      runtimeCustomInstructions: "",
      runtimeProactivity: "medium",
      runtimeHumorLevel: "low",
      runtimeRiskTolerance: "medium",
      runtimeStructurePreference: "balanced",
      runtimeChallengeLevel: "medium",
      requestHints: {
        assistantShortTermFollowUp: true,
        assistantShortTermContextSummary: `recentUserFacts: ${"Aurora-7 ".repeat(2000)}`,
        assistantTopicAffinityId: "coding_assistant",
      },
      fastLaneSimpleChat: false,
      hasStrictOutputRequirements: false,
      outputConstraints: { instructions: "" },
      selectedChatModel: "gpt-5-mini",
      runtimeTools: null,
      availableTools: [],
      shouldPreloadWebSearchForTurn: false,
      shouldPreloadWebFetchForTurn: false,
      shouldAttemptMemoryRecallForTurn: false,
      observedToolCalls: [],
      runSummary,
      latencyTelemetry: createLatencyTelemetry(),
      broadcastThinkingStatus() {},
    });

    assert.ok(runSummary.requestHints.historyTokenBudget > 0);
    assert.ok(runSummary.requestHints.historyMessagesInjected > 0);
    assert.ok(result.historyMessages.some((message) => message.content.includes("Aurora-7")));
    assert.ok(result.messages.some((message) => message.role === "assistant" && message.content.includes("Aurora-7")));
    assert.match(result.systemPrompt, /current conversation transcript first/i);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
