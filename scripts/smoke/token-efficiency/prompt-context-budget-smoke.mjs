/**
 * Per-turn prompt context budget smoke (token-efficiency close-out issue 4).
 *
 * Before the fix, every per-turn section (preference, identity, live web search, link context, memory recall, ...)
 * had to fit the SYSTEM share of a 6,000-token input budget, which the fresh-install static prompt (~3.2k ~tok)
 * already filled: they were all dropped with `no_system_budget`, and the web-search preload's real search was
 * wasted. Now they are budgeted on their own (NOVA_PROMPT_TURN_CONTEXT_MAX_TOKENS, default 5,000, counted over the
 * text after the static system prompt), and NOVA_MAX_PROMPT_TOKENS (default 18,000) leaves the history its target.
 *
 * Through the REAL buildPromptContextForTurn at DEFAULT settings (no NOVA_PROMPT_* env), with the web search, link
 * fetch and memory index stubbed (no network):
 *   PCB-1  (a) fresh-install persona from templates/: Memory Recall, Web Search, Link Context, Identity and
 *          Preference sections are all in the prompt; history keeps its 1,400 target; static/turn split unchanged
 *   PCB-2  (b) a realistically larger persona (the templates x 2.5): same sections, same history target
 *   PCB-3  (c) a huge static prompt (persona files past their 24,000-char load cap + ~32k ~tok of HUD custom
 *          instructions): the per-turn context stays within its budget, every section within its cap, and the
 *          enrichment sections are still included (they are reserved first)
 *   PCB-4  the budget helper keeps its legacy behavior for callers that do not pass the per-turn params
 *   PCB-5  mutation: the same run with the builder reverted to the old system-budget mode and the old 6,000 max
 *          (in-memory module hook in a child process, no file changed) FAILS PCB-1 and PCB-2
 *
 * Offline: temp NOVA_DATA_DIR (isolated-data-dir.mjs), no network, no API keys.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isolatedDataDir } from "../lib/isolated-data-dir.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const MUTATION = String(process.env.NOVA_PROMPT_BUDGET_SMOKE_MUTATION || "").trim();

// Defaults only: this smoke is about the default settings.
for (const name of Object.keys(process.env)) {
  if (name.startsWith("NOVA_PROMPT_") || name === "NOVA_MAX_PROMPT_TOKENS" || name.startsWith("NOVA_FAST_LANE_")) {
    delete process.env[name];
  }
}
process.env.NOVA_EMBEDDING_PROVIDER = "local";

if (MUTATION === "legacy-budget") {
  // The pre-fix behavior: sections budgeted against the whole system prompt, 6,000-token max.
  process.env.NOVA_MAX_PROMPT_TOKENS = "6000";
  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (!url.startsWith("file:") || !fileURLToPath(url).replaceAll("\\", "/").endsWith("/chat-handler/prompt-context-builder/index.js")) {
        return result;
      }
      const source = typeof result.source === "string" ? result.source : Buffer.from(result.source).toString("utf8");
      const rewritten = source.replace(/turnContextMaxTokens: PROMPT_TURN_CONTEXT_MAX_TOKENS,/, "");
      if (rewritten === source) throw new Error("mutation anchor not found in prompt-context-builder");
      process.stderr.write("[prompt-budget-smoke] mutation applied: legacy-budget\n");
      return { ...result, source: rewritten };
    },
  });
}

const { buildPromptContextForTurn } = await import(
  pathToFileURL(path.join(repoRoot, "src/runtime/modules/chat/core/chat-handler/prompt-context-builder/index.js")).href
);
const { appendBudgetedPromptSection } = await import(
  pathToFileURL(path.join(repoRoot, "src/runtime/modules/chat/prompt/prompt-budget/index.js")).href
);
const { countApproxTokens } = await import(pathToFileURL(path.join(repoRoot, "src/runtime/core/context-prompt/index.js")).href);
const constants = await import(pathToFileURL(path.join(repoRoot, "src/runtime/core/constants/index.js")).href);

const results = [];
async function run(name, fn) {
  try {
    await fn();
    results.push({ status: "PASS", name });
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.message : String(error) });
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────

const PERSONA_FILES = ["SOUL.md", "USER.md", "MEMORY.md", "IDENTITY.md", "AGENTS.md"];
function createPersonaWorkspace(name, { repeat = 1, extraChars = 0 } = {}) {
  const dir = path.join(isolatedDataDir, "prompt-context-budget", name);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of PERSONA_FILES) {
    const template = fs.readFileSync(path.join(repoRoot, "templates", file), "utf8");
    const body = Array.from({ length: Math.ceil(repeat) }, (_, i) => (i === 0 ? template : `\n\n## Notes ${i + 1}\n${template}`))
      .join("")
      .slice(0, Math.round(template.length * repeat));
    fs.writeFileSync(path.join(dir, file), body + (extraChars > 0 ? `\n${"Long-form persona note. ".repeat(Math.ceil(extraChars / 24))}` : ""), "utf8");
  }
  return dir;
}

const URL = "https://nodejs.org/en/blog/release/v24-lts";
const TURN_TEXT = `What's the latest on ${URL}? Tell me how it changes the upgrade plan I told you about earlier.`;
const WEB_RESULT = Array.from({ length: 12 }, (_, i) => `[${i + 1}] Node.js 24 LTS item ${i + 1}\nhttps://example.test/node-24/${i + 1}\n${"Release note detail about V8, npm 11 and the permission model. ".repeat(7)}`)
  .join("\n\n").slice(0, 6000);
const PAGE = `# Node.js 24 becomes LTS\n\n${"The permission model is stable, URLPattern is global and url.parse() is deprecated. ".repeat(80)}`;
const MEMORY_HITS = [
  { source: "memory/upgrade-plan.md", content: `Upgrade plan: move orders-api from Node 20 to Node 24. ${"Blockers include native add-ons and url.parse calls. ".repeat(14)}` },
  { source: "MEMORY.md", content: `Sam prefers short answers. ${"Decision first, then bullets. ".repeat(20)}` },
  { source: "memory/services.md", content: `Services: orders-api, billing-worker. ${"Each runs on the shared Node base image. ".repeat(16)}` },
];

function fakeRuntimeTools() {
  return {
    async executeToolUse(toolUse) {
      if (toolUse?.name === "web_search") return { content: WEB_RESULT };
      if (toolUse?.name === "web_fetch") return { content: PAGE };
      throw new Error(`unexpected tool ${toolUse?.name}`);
    },
    memoryManager: {
      warmSession() {},
      async searchWithDiagnostics() {
        return { results: MEMORY_HITS, diagnostics: { source: "prompt-context-budget-smoke" } };
      },
    },
  };
}

const TRANSCRIPT = Array.from({ length: 16 }, (_, i) => ({
  role: i % 2 === 0 ? "user" : "assistant",
  content: i % 2 === 0
    ? `Question ${i / 2 + 1} about the Node upgrade: ${"what about native modules and CI images? ".repeat(6)}`
    : `Answer ${(i - 1) / 2 + 1}: ${"rebuild native add-ons against the new ABI and bump the CI base image. ".repeat(6)}`,
}));

async function buildTurn({ userContextId, workspace, text = TURN_TEXT, customInstructions = "", transcript = TRANSCRIPT }) {
  const runSummary = { requestHints: {} };
  const counters = {};
  const result = await buildPromptContextForTurn({
    text,
    uiText: text,
    ctx: {},
    source: "hud",
    sender: "hud-user",
    sessionKey: `agent:nova:hud:user:${userContextId}:dm:thread`,
    sessionContext: { transcript },
    userContextId,
    conversationId: `${userContextId}-thread`,
    personaWorkspaceDir: workspace,
    runtimeAssistantName: "Nova",
    runtimeCommunicationStyle: "direct",
    runtimeTone: "neutral",
    runtimeCustomInstructions: customInstructions,
    runtimeProactivity: "medium",
    runtimeHumorLevel: "low",
    runtimeRiskTolerance: "medium",
    runtimeStructurePreference: "balanced",
    runtimeChallengeLevel: "medium",
    requestHints: {},
    fastLaneSimpleChat: false,
    hasStrictOutputRequirements: false,
    outputConstraints: { instructions: "" },
    selectedChatModel: "gpt-5.6-terra",
    runtimeTools: fakeRuntimeTools(),
    availableTools: [{ name: "web_search" }, { name: "web_fetch" }],
    shouldPreloadWebSearchForTurn: true,
    shouldPreloadWebFetchForTurn: true,
    shouldAttemptMemoryRecallForTurn: true,
    observedToolCalls: [],
    runSummary,
    latencyTelemetry: {
      addStage() {},
      incrementCounter(name) { counters[name] = (counters[name] || 0) + 1; },
    },
    broadcastThinkingStatus() {},
  });
  return { result, runSummary, counters };
}

/** "## Title" sections of the per-turn part, with their token counts (header included, as the budget counts them). */
function turnSections(result) {
  const turn = result.systemPrompt.slice(result.staticSystemPrompt.length);
  return turn.split(/\n\n(?=## )/).map((part) => part.trim()).filter(Boolean).map((part) => ({
    title: part.slice(3, part.indexOf("\n") > 0 ? part.indexOf("\n") : undefined).trim(),
    tokens: countApproxTokens(`\n\n${part}`),
  }));
}

const REQUIRED_SECTIONS = ["User Preference Memory", "Identity Intelligence", "Live Web Search Context", "Link Context", "Live Memory Recall"];
const SECTION_CAP = constants.PROMPT_CONTEXT_SECTION_MAX_TOKENS;
const TURN_BUDGET = constants.PROMPT_TURN_CONTEXT_MAX_TOKENS;

function assertSectionsAndHistory(label, { result, runSummary }, { expectHistoryTarget = true } = {}) {
  const titles = turnSections(result).map((s) => s.title);
  const missing = REQUIRED_SECTIONS.filter((t) => !titles.includes(t));
  assert.deepEqual(missing, [], `${label}: missing sections ${missing.join(", ")} (skipped: ${JSON.stringify(runSummary.requestHints.promptSectionsSkipped)})`);
  // Stage 1 layout: static part first and byte-stable, per-turn part after it.
  assert.ok(result.systemPrompt.startsWith(result.staticSystemPrompt), `${label}: static part is not the prefix`);
  assert.equal(result.turnContextPrompt, result.systemPrompt.slice(result.staticSystemPrompt.length).trim());
  for (const t of REQUIRED_SECTIONS) {
    assert.ok(!result.staticSystemPrompt.includes(`## ${t}\n`), `${label}: per-turn section "${t}" leaked into the static part`);
  }
  if (expectHistoryTarget) {
    assert.equal(runSummary.requestHints.historyTokenBudget, constants.PROMPT_HISTORY_TARGET_TOKENS,
      `${label}: history budget ${runSummary.requestHints.historyTokenBudget} (target ${constants.PROMPT_HISTORY_TARGET_TOKENS})`);
    assert.ok(result.historyMessages.length > 0, `${label}: no history injected`);
  }
}

function assertWithinBudgets(label, { result, runSummary }) {
  const turnTokens = countApproxTokens(result.systemPrompt.slice(result.staticSystemPrompt.length));
  assert.ok(turnTokens <= TURN_BUDGET, `${label}: per-turn context ${turnTokens} > ${TURN_BUDGET}`);
  assert.equal(runSummary.requestHints.turnContextTokens, turnTokens);
  for (const section of turnSections(result)) {
    if (section.title.startsWith("Skills")) continue; // the skills block is counted in the budget, not capped per section
    assert.ok(section.tokens <= SECTION_CAP + 2, `${label}: section "${section.title}" is ${section.tokens} ~tok > cap ${SECTION_CAP}`);
  }
}

// Silence runtime chatter.
const originalLog = console.log;
const originalWarn = console.warn;
console.log = () => {};
console.warn = () => {};

const measured = {};

async function primePreferences(userContextId, workspace) {
  // A first turn that states a preference, as a user would (the preference store is per user).
  await buildTurn({ userContextId, workspace, text: "For future replies, call me Sam and keep your answers short.", transcript: [] });
}

await run("PCB-1 (a) fresh-install persona: every per-turn section included, history keeps its target", async () => {
  assert.equal(constants.MAX_PROMPT_TOKENS, MUTATION ? 6000 : 18000);
  const workspace = createPersonaWorkspace("fresh");
  await primePreferences("pcb-fresh", workspace);
  const turn = await buildTurn({ userContextId: "pcb-fresh", workspace });
  measured.fresh = { static: countApproxTokens(turn.result.staticSystemPrompt), turn: turn.runSummary.requestHints.turnContextTokens, history: turn.runSummary.requestHints.historyTokenBudget };
  assertSectionsAndHistory("fresh", turn);
  assertWithinBudgets("fresh", turn);
});

await run("PCB-2 (b) persona 2.5x the templates: every per-turn section included, history keeps its target", async () => {
  const workspace = createPersonaWorkspace("large", { repeat: 2.5 });
  await primePreferences("pcb-large", workspace);
  const turn = await buildTurn({ userContextId: "pcb-large", workspace });
  measured.large = { static: countApproxTokens(turn.result.staticSystemPrompt), turn: turn.runSummary.requestHints.turnContextTokens, history: turn.runSummary.requestHints.historyTokenBudget };
  assert.ok(measured.large.static > measured.fresh.static * 1.8, `persona not larger: ${measured.large.static} vs ${measured.fresh.static}`);
  assertSectionsAndHistory("large", turn);
  assertWithinBudgets("large", turn);
});

await run("PCB-2b persona files at their 24,000-char load cap: history still keeps its target", async () => {
  const workspace = createPersonaWorkspace("at-cap", { repeat: 4, extraChars: 30_000 });
  await primePreferences("pcb-cap", workspace);
  const turn = await buildTurn({ userContextId: "pcb-cap", workspace });
  measured.atCap = { static: countApproxTokens(turn.result.staticSystemPrompt), turn: turn.runSummary.requestHints.turnContextTokens, history: turn.runSummary.requestHints.historyTokenBudget };
  assertSectionsAndHistory("at-cap", turn);
  assertWithinBudgets("at-cap", turn);
});

await run("PCB-3 (c) huge static prompt (30k+ ~tok): per-turn context within budget, each section within its cap", async () => {
  const workspace = createPersonaWorkspace("huge", { repeat: 4, extraChars: 30_000 });
  await primePreferences("pcb-huge", workspace);
  const customInstructions = "Always follow the house style guide in full detail. ".repeat(2200);
  const turn = await buildTurn({ userContextId: "pcb-huge", workspace, customInstructions });
  const staticTokens = countApproxTokens(turn.result.staticSystemPrompt);
  measured.huge = { static: staticTokens, turn: turn.runSummary.requestHints.turnContextTokens, history: turn.runSummary.requestHints.historyTokenBudget };
  assert.ok(staticTokens > 30_000, `static prompt only ${staticTokens} ~tok`);
  assertSectionsAndHistory("huge", turn, { expectHistoryTarget: false });
  assertWithinBudgets("huge", turn);
});

await run("PCB-3b a tight per-turn budget keeps enrichment first and stays within it", async () => {
  // Same builder, same defaults except the per-turn budget, applied through the helper the builder uses: a
  // 1,500-token budget with two enrichment sections reserved leaves the profile sections the rest.
  const base = "STATIC".repeat(2000);
  let prompt = `${base}\n\n## Skills (framework)\n${"skill line ".repeat(60)}`;
  const reserve = 2 * 500;
  const profile = appendBudgetedPromptSection({
    prompt, sectionTitle: "Identity Intelligence", sectionBody: "identity fact. ".repeat(400),
    turnContextStart: base.length, turnContextMaxTokens: 1500, reservedTokens: reserve, sectionMaxTokens: 500,
  });
  assert.equal(profile.included, true);
  assert.ok(profile.turnContextTokens <= 1500 - reserve, `profile section used the enrichment reserve (${profile.turnContextTokens})`);
  prompt = profile.prompt;
  for (const title of ["Live Web Search Context", "Live Memory Recall"]) {
    const appended = appendBudgetedPromptSection({
      prompt, sectionTitle: title, sectionBody: "evidence line. ".repeat(400),
      turnContextStart: base.length, turnContextMaxTokens: 1500, reservedTokens: 0, sectionMaxTokens: 500,
    });
    assert.equal(appended.included, true, `${title}: ${appended.reason}`);
    prompt = appended.prompt;
  }
  assert.ok(countApproxTokens(prompt.slice(base.length)) <= 1500);
});

await run("PCB-4 legacy system-budget mode unchanged for callers without the per-turn params", async () => {
  const big = "x".repeat(3187 * 3.5);
  const dropped = appendBudgetedPromptSection({
    prompt: big, sectionTitle: "Live Memory Recall", sectionBody: "fact ".repeat(50), userMessage: "hi",
    maxPromptTokens: 6000, responseReserveTokens: 1400, historyTargetTokens: 1400, sectionMaxTokens: 1000,
  });
  assert.equal(dropped.included, false);
  assert.equal(dropped.reason, "no_system_budget", "legacy mode must keep rejecting when the system share is full");
  const fits = appendBudgetedPromptSection({
    prompt: "Base.", sectionTitle: "Live Memory Recall", sectionBody: "fact ".repeat(50), userMessage: "hi",
    maxPromptTokens: 6000, responseReserveTokens: 1400, historyTargetTokens: 1400, sectionMaxTokens: 1000,
  });
  assert.equal(fits.included, true);
  assert.equal(fits.budgetMode, "system");
  assert.ok(Number.isFinite(fits.maxSystemTokens) && Number.isFinite(fits.availableSystemTokens));
});

if (!MUTATION) {
  await run("PCB-5 mutation: the pre-fix budget (system share, 6,000 max) fails PCB-1 and PCB-2", async () => {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd: repoRoot,
      env: { ...process.env, NOVA_PROMPT_BUDGET_SMOKE_MUTATION: "legacy-budget", NOVA_DATA_DIR: "" },
      encoding: "utf8",
      timeout: 180_000,
    });
    const output = `${child.stdout || ""}${child.stderr || ""}`;
    assert.match(output, /mutation applied: legacy-budget/, `the hook did not apply:\n${output.slice(-1500)}`);
    assert.notEqual(child.status, 0, "the mutated run passed");
    assert.match(output, /\[FAIL\] PCB-1/, "PCB-1 did not fail under the old budget");
    assert.match(output, /\[FAIL\] PCB-2 \(b\)/, "PCB-2 did not fail under the old budget");
    assert.match(output, /no_system_budget/, "the old failure reason was not seen");
  });
}

console.log = originalLog;
console.warn = originalWarn;

for (const r of results) console.log(`[${r.status}] ${r.name}${r.detail ? `\n  ${r.detail}` : ""}`);
console.log(`measured (~tok): ${JSON.stringify(measured)}`);
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\nprompt-context-budget${MUTATION ? ` (mutation ${MUTATION})` : ""}: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
