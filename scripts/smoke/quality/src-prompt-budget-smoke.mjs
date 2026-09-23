import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const results = [];

function record(status, name, detail = "") {
  results.push({ status, name, detail });
}

async function run(name, fn) {
  try {
    await fn();
    record("PASS", name);
  } catch (error) {
    record("FAIL", name, error instanceof Error ? error.message : String(error));
  }
}

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const constantsSource = read("src/runtime/core/constants/index.js");
const chatHandlerSource = read("src/runtime/modules/chat/core/chat-handler/index.js");
const promptContextBuilderSource = read("src/runtime/modules/chat/core/chat-handler/prompt-context-builder/index.js");
const missionAiExecutorsSource = read("hud/lib/missions/workflow/executors/ai-executors.ts");
const promptBudgetSource = read("src/runtime/modules/chat/prompt/prompt-budget/index.js");
const promptBudgetModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/prompt/prompt-budget/index.js")).href,
);

const {
  compactTextToTokenBudget,
  appendBudgetedPromptSection,
  computeHistoryTokenBudget,
  computeInputPromptBudget,
} = promptBudgetModule;

await run("P18-C1 runtime constants expose prompt budget controls", async () => {
  const requiredTokens = [
    "PROMPT_RESPONSE_RESERVE_TOKENS",
    "PROMPT_HISTORY_TARGET_TOKENS",
    "PROMPT_MIN_HISTORY_TOKENS",
    "PROMPT_CONTEXT_SECTION_MAX_TOKENS",
    "PROMPT_BUDGET_DEBUG",
  ];
  for (const token of requiredTokens) {
    assert.equal(constantsSource.includes(token), true, `missing constants token: ${token}`);
  }
});

await run("P18-C2 prompt budget helpers compact and bound sections", async () => {
  assert.equal(promptBudgetSource.includes("export function appendBudgetedPromptSection"), true);
  assert.equal(promptBudgetSource.includes("export function computeHistoryTokenBudget"), true);

  const budget = computeInputPromptBudget(6000, 1400);
  assert.equal(budget, 4600);

  const longBody = Array.from({ length: 80 }, (_, idx) => `line-${idx} context payload`).join(" ");
  const compacted = compactTextToTokenBudget(longBody, 40);
  assert.equal(compacted.length > 0, true);

  const appended = appendBudgetedPromptSection({
    prompt: "Base instructions.",
    sectionTitle: "Live Web Search Context",
    sectionBody: longBody,
    userMessage: "summarize this now",
    maxPromptTokens: 900,
    responseReserveTokens: 300,
    historyTargetTokens: 160,
    sectionMaxTokens: 120,
  });
  assert.equal(appended.included, true, "section should fit under constrained budget");
  assert.equal(appended.prompt.includes("## Live Web Search Context"), true);
});

await run("P18-C3 chat handler uses budgeted context injection and dynamic history budget", async () => {
  const chatHandlerRequiredTokens = [
    'import { executeChatRequest } from "./execute-chat-request/index.js";',
  ];
  for (const token of chatHandlerRequiredTokens) {
    assert.equal(chatHandlerSource.includes(token), true, `missing chat-handler token: ${token}`);
  }

  const legacyChatHandlerTokens = [
    'import { appendBudgetedPromptSection, computeHistoryTokenBudget, resolveDynamicPromptBudget } from "../../prompt/prompt-budget/index.js";',
  ];
  for (const token of legacyChatHandlerTokens) {
    assert.equal(chatHandlerSource.includes(token), false, `legacy chat-handler token still present: ${token}`);
  }

  const requiredTokens = [
    "computeTurnContextTokenBudget,",
    "const promptBudgetOptions = {",
    "const promptBudgetProfile = resolveDynamicPromptBudget({",
    "const turnContextBudgetTokens = computeTurnContextTokenBudget({",
    "maxContextTokens: turnContextBudgetTokens,",
    "const computedHistoryTokenBudget = computeHistoryTokenBudget({",
    "history_budget=${computedHistoryTokenBudget}",
  ];
  for (const token of requiredTokens) {
    assert.equal(promptContextBuilderSource.includes(token), true, `missing prompt-context token: ${token}`);
  }
});

await run("P18-C4 mission AI executors are explicitly bounded before LLM calls", async () => {
  const requiredTokens = [
    "const MAX_INPUT_CHARS = 12000",
    "const MAX_PROMPT_CHARS = 11000",
    "return truncateForModel(fallback, MAX_INPUT_CHARS)",
    "const fullPrompt = truncateForModel(",
    "truncateForModel(prompt, MAX_PROMPT_CHARS)",
    "truncateForModel(combinedPrompt, MAX_PROMPT_CHARS)",
  ];
  for (const token of requiredTokens) {
    assert.equal(missionAiExecutorsSource.includes(token), true, `missing mission AI executor token: ${token}`);
  }

  const historyBudget = computeHistoryTokenBudget({
    maxPromptTokens: 6000,
    responseReserveTokens: 1400,
    userMessage: "hello",
    systemPrompt: "x".repeat(12000),
    maxHistoryTokens: 3200,
    minHistoryTokens: 100,
    targetHistoryTokens: 1400,
  });
  assert.equal(historyBudget >= 0, true);
  assert.equal(historyBudget <= 3200, true);
});

// Stage 1 side fix: with a fresh-install persona the static system prompt (~3.2k ~tok) used to fill the whole
// system budget, so every per-turn section (memory recall, web/link context, identity, preferences) was dropped
// with `no_system_budget`. The real prompt builder must now deliver them in the final user turn, keep the static
// system prompt free of them, and keep the history budget.
await run("P18-C5 per-turn context survives a fresh-install static prompt and rides on the final user turn", async () => {
  const { buildPromptContextForTurn, TURN_CONTEXT_OPEN_TAG } = await import(
    pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/core/chat-handler/prompt-context-builder/index.js")).href
  );
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "nova-prompt-budget-"));
  try {
    for (const name of ["SOUL.md", "USER.md", "MEMORY.md", "IDENTITY.md", "AGENTS.md"]) {
      fs.copyFileSync(path.join(process.cwd(), "templates", name), path.join(workspace, name));
    }
    const recallMarker = "Recall-marker: the user's favourite editor is Helix.";
    const memoryManager = {
      warmSession() {},
      async searchWithDiagnostics() {
        return { results: [{ source: "memory/notes.md", content: recallMarker }], diagnostics: null };
      },
    };
    const build = (text, transcript) => buildPromptContextForTurn({
      text,
      uiText: text,
      ctx: {},
      source: "hud",
      sender: "hud-user",
      sessionKey: "agent:nova:hud:user:budget-user:dm:budget-thread",
      sessionContext: { transcript },
      userContextId: "budget-user",
      conversationId: "budget-thread",
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
      requestHints: { assistantShortTermContextSummary: `last topic: ${text}` },
      fastLaneSimpleChat: false,
      hasStrictOutputRequirements: false,
      outputConstraints: { instructions: "" },
      selectedChatModel: "gpt-5.6-terra",
      runtimeTools: { memoryManager },
      availableTools: [],
      shouldPreloadWebSearchForTurn: false,
      shouldPreloadWebFetchForTurn: false,
      shouldAttemptMemoryRecallForTurn: true,
      observedToolCalls: [],
      runSummary: { requestHints: {} },
      latencyTelemetry: { addStage() {}, incrementCounter() {} },
      broadcastThinkingStatus() {},
    });

    const first = await build("Which editor should I set up for this project?", []);
    const second = await build("And what theme would suit it?", [
      { role: "user", content: "Which editor should I set up for this project?" },
      { role: "assistant", content: "Helix, since you already use it." },
    ]);
    for (const turn of [first, second]) {
      assert.equal(turn.usedMemoryRecall, true, "memory recall was dropped");
      assert.equal(turn.systemPrompt.includes(recallMarker), false, "per-turn context leaked into the static system prompt");
      const last = turn.messages[turn.messages.length - 1];
      assert.equal(last.role, "user");
      assert.equal(last.content.startsWith(TURN_CONTEXT_OPEN_TAG), true, "final user turn does not start with the per-turn block");
      assert.equal(last.content.includes(recallMarker), true, "memory recall missing from the final user turn");
      assert.equal(last.content.includes("## Short-Term Context"), true, "short-term context missing");
    }
    assert.equal(first.systemPrompt, second.systemPrompt, "static system prompt changed between turns");
    assert.equal(second.historyMessages.length, 2, "history was not injected");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
