import assert from "node:assert/strict";
import fs from "node:fs";
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
  const requiredTokens = [
    'import { appendBudgetedPromptSection, computeHistoryTokenBudget, resolveDynamicPromptBudget } from "../prompt/prompt-budget.js";',
    "const promptBudgetOptions = {",
    "const promptBudgetProfile = resolveDynamicPromptBudget({",
    "const appended = appendBudgetedPromptSection({",
    "const computedHistoryTokenBudget = computeHistoryTokenBudget({",
    "history_budget=${computedHistoryTokenBudget}",
  ];
  for (const token of requiredTokens) {
    assert.equal(chatHandlerSource.includes(token), true, `missing chat-handler token: ${token}`);
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

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
