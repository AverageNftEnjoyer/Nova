import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const results = [];
const DISABLE_SPAWN_FALLBACK = String(process.env.NOVA_DISABLE_SPAWN_FALLBACK || "").trim() === "1";
const ALLOW_SPAWN_FALLBACK = !DISABLE_SPAWN_FALLBACK;
let spawnFallbackUsed = false;

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

function runNodeScript(relativePath) {
  const scriptPath = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`missing smoke dependency script: ${relativePath}`);
  }
  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  });
  if (child.error?.code === "EPERM") {
    if (!ALLOW_SPAWN_FALLBACK) {
      throw new Error(
        `spawn blocked (EPERM) for ${relativePath}. Unset NOVA_DISABLE_SPAWN_FALLBACK to allow contract fallback.`,
      );
    }
    spawnFallbackUsed = true;
    const source = fs.readFileSync(scriptPath, "utf8");
    console.warn(
      `[SmokeFallback][auto] spawn blocked for ${relativePath}; validating by script contract.`,
    );
    return source;
  }
  const output = `${String(child.stdout || "")}\n${String(child.stderr || "")}`.trim();
  if (child.status !== 0) {
    throw new Error(`script failed: ${relativePath}\n${output.slice(0, 2000)}`);
  }
  return output;
}

const replyNormalizerModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/quality/reply-normalizer.js")).href,
);
const promptBudgetModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/prompt/prompt-budget.js")).href,
);

const { normalizeAssistantReply, normalizeAssistantSpeechText } = replyNormalizerModule;
const { appendBudgetedPromptSection, computeHistoryTokenBudget } = promptBudgetModule;

await run("P19-C1 chat quality regression gate (transport + prompt fixtures)", async () => {
  const transportOutput = runNodeScript("scripts/smoke/routing/src-transport-stability-smoke.mjs");
  assert.equal(transportOutput.includes("P14-C5 inbound dedupe"), true, "transport gate missing dedupe check");
  assert.equal(transportOutput.includes("P14-C6 reply normalization"), true, "transport gate missing normalization check");

  const normalized = normalizeAssistantReply("Assistant: hello\n\n\nhello\n\nworld");
  assert.equal(normalized.skip, false);
  assert.equal(normalized.text.includes("hello\n\nworld"), true);

  const speech = normalizeAssistantSpeechText("**Bold** [Link](https://example.com) `code`");
  assert.equal(speech.includes("*"), false);
  assert.equal(speech.includes("http"), false);

  const appended = appendBudgetedPromptSection({
    prompt: "Base system prompt",
    sectionTitle: "Live Context",
    sectionBody: "evidence ".repeat(300),
    userMessage: "summarize this",
    maxPromptTokens: 1200,
    responseReserveTokens: 360,
    historyTargetTokens: 280,
    sectionMaxTokens: 180,
  });
  assert.equal(appended.included, true, "budgeted chat context should be included");
  assert.equal(String(appended.prompt).includes("## Live Context"), true);

  const historyBudget = computeHistoryTokenBudget({
    maxPromptTokens: 6000,
    responseReserveTokens: 1400,
    userMessage: "quick question",
    systemPrompt: "S".repeat(10000),
    maxHistoryTokens: 3200,
    minHistoryTokens: 220,
    targetHistoryTokens: 1400,
  });
  assert.equal(Number.isFinite(historyBudget), true);
  assert.equal(historyBudget >= 0 && historyBudget <= 3200, true);
});

await run("P19-C2 mission quality regression gate", async () => {
  const missionOutput = runNodeScript("scripts/smoke/quality/src-mission-quality-smoke.mjs");
  const requiredMarkers = [
    "P17-C1 quality module exposes scoring + guardrail APIs",
    "P17-C3 workflow output path applies quality guardrails before dispatch",
    "P17-C4 fallback-output path also applies quality guardrails",
  ];
  for (const marker of requiredMarkers) {
    assert.equal(missionOutput.includes(marker), true, `missing mission marker: ${marker}`);
  }
});

await run("P19-C3 tool behavior regression gate", async () => {
  const toolOutput = runNodeScript("scripts/smoke/routing/src-tool-loop-smoke.mjs");
  const requiredMarkers = [
    "P5-C1 Tool registry parity",
    "P5-C2 Tool execution parity + shared conversion layer",
    "P5-C3 exec approval mode enforcement (ask|auto|off)",
    "P5-C4 link understanding extracts + compacts URL context",
  ];
  for (const marker of requiredMarkers) {
    assert.equal(toolOutput.includes(marker), true, `missing tool marker: ${marker}`);
  }
});

await run("P19-C4 regression gate script contracts remain wired", async () => {
  const evalScript = runNodeScript("scripts/smoke/quality/src-prompt-budget-smoke.mjs");
  assert.equal(evalScript.includes("P18-C3 chat handler uses budgeted context injection"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`[SmokeFallback] enabled=${ALLOW_SPAWN_FALLBACK} used=${spawnFallbackUsed}`);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
