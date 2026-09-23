/**
 * Offline token baseline harness (token-efficiency Stage 0, PLAN.md step 7).
 *
 * Drives the REAL runtime (handleInput → routing → prompt assembly → direct completion / tool loops) with a FAKE
 * model and captures every model request payload. No API keys, no network: globalThis.fetch and http(s) are
 * guarded (token-harness-lib.mjs) and any real network attempt fails the run.
 *
 * How the fakes work
 * - OpenAI-compatible shape: handleInput's `runtimeSelectionOverride` injects a fake `chat.completions.create`
 *   client (provider "openai"). It captures the request and answers from the scenario script (text, or tool calls).
 * - Anthropic shape: provider "claude" with baseURL https://fake-anthropic.invalid. The runtime's own Claude code
 *   (claudeMessagesStream / claudeMessagesCreate / the Claude tool loop) calls fetch(`${base}/v1/messages`); the
 *   fetch guard routes that URL to an in-process fake that returns JSON or an SSE stream.
 * - Tools: the tool runtime is initialised for the scenario's scope first, then the network-bound tools
 *   (web_search, web_fetch, gmail_*) get their `execute` replaced by canned results. The executor, the loop
 *   wrappers (wrapWebContent, userContextId injection) and the file tools (ls/read/grep on a fixture workspace)
 *   all run for real. Any other network-bound tool (coinbase_*, browser_agent) throws if called.
 * - Missions: hud/lib/missions/workflow/executors/ai-executors.ts and hud/lib/missions/llm/providers.ts are
 *   TypeScript inside the Next app. They are transpiled with `typescript` and run in a vm (same technique as
 *   scripts/smoke/scheduler/src-mission-agent-runtime-smoke.mjs); only the integrations store and provider
 *   selection are stubbed, fetch is the guarded one. So the mission AI node and completeWithConfiguredLlm run for
 *   real and the captured payload is exactly what the provider would receive.
 *
 * Usage:  node scripts/smoke/token-efficiency/token-baseline-harness.mjs [--out <file.json>] [--quiet]
 *                 [--include-requests] (full captured payloads in the JSON) [--verbose] (runtime logs)
 *   (env NOVA_TOKEN_BASELINE_OUT works like --out). Without --out the JSON goes to the temp data dir only.
 * Needs `npm run build:agent-core` (dist/ tool modules); `npm run smoke:token-baseline` does that first.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

// Keep every embedding / memory path local and the environment the same on every machine.
process.env.NOVA_EMBEDDING_PROVIDER = "local";
process.env.NOVA_EXEC_APPROVAL_MODE = process.env.NOVA_EXEC_APPROVAL_MODE || "ask";

import { isolatedDataDir } from "../lib/isolated-data-dir.mjs";
import {
  FAKE_CLAUDE_BASE_URL,
  FAKE_OPENAI_BASE_URL,
  computeCallMetrics,
  createCapture,
  createFakeClaudeHandler,
  createFakeOpenAiClient,
  describeRequest,
  formatMetricsTable,
  installNetworkGuard,
  summarizeMetrics,
} from "./token-harness-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    if (!token.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || String(next).startsWith("--")) out[token.slice(2)] = "1";
    else {
      out[token.slice(2)] = String(next);
      i += 1;
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const outPath = String(args.out || process.env.NOVA_TOKEN_BASELINE_OUT || "").trim();
const quiet = args.quiet === "1";

// ── Capture + fake providers + network guard ─────────────────────────────────────────────────────────────────

const capture = createCapture();
let scenarioState = null;

async function responder(request) {
  const d = describeRequest(request);
  const state = scenarioState;
  if (!state) throw new Error("model called outside a scenario");
  if (d.hasTools && state.plan && state.planIndex < state.plan.length) {
    const step = state.plan[state.planIndex];
    state.planIndex += 1;
    return { toolCalls: step };
  }
  return { text: state.reply(d.lastUserText, request) };
}

const fakeOpenAiClient = createFakeOpenAiClient({ capture, responder });
const fakeClaude = createFakeClaudeHandler({ capture, responder });

// Plain-HTTP OpenAI-compatible endpoint (used by the mission provider code, which calls fetch directly).
async function fakeOpenAiHttp(url, init = {}) {
  const body = JSON.parse(String(init.body || "{}"));
  const copy = capture.push("openai", body, { stream: false });
  const answer = await responder(copy);
  return new Response(JSON.stringify({
    id: "chatcmpl-fake-mission",
    object: "chat.completion",
    model: body.model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: String(answer.text || "") } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

const guard = installNetworkGuard({
  [`${FAKE_CLAUDE_BASE_URL}/v1/messages`]: fakeClaude,
  [`${FAKE_OPENAI_BASE_URL}/chat/completions`]: fakeOpenAiHttp,
});

// Runtime modules (after the guard so nothing can escape at import time).
const { handleInput } = await import(
  pathToFileURL(path.join(repoRoot, "src/runtime/modules/chat/core/chat-handler/index.js")).href
);
const { toolRuntime } = await import(
  pathToFileURL(path.join(repoRoot, "src/runtime/modules/infrastructure/config/index.js")).href
);

const MODELS = { openai: "gpt-5.6-terra", claude: "claude-sonnet-5" };

function runtimeSelectionOverride(shape) {
  if (shape === "claude") {
    return {
      activeChatRuntime: {
        provider: "claude",
        connected: true,
        apiKey: "fake-claude-key",
        baseURL: FAKE_CLAUDE_BASE_URL,
        model: MODELS.claude,
        routeReason: "token-baseline",
        rankedCandidates: ["claude"],
      },
      activeOpenAiCompatibleClient: null,
      selectedChatModel: MODELS.claude,
    };
  }
  return {
    activeChatRuntime: {
      provider: "openai",
      connected: true,
      apiKey: "fake-openai-key",
      baseURL: FAKE_OPENAI_BASE_URL,
      model: MODELS.openai,
      routeReason: "token-baseline",
      rankedCandidates: ["openai"],
    },
    activeOpenAiCompatibleClient: fakeOpenAiClient,
    selectedChatModel: MODELS.openai,
  };
}

// ── Canned tool results ──────────────────────────────────────────────────────────────────────────────────────

const toolLog = [];
const NETWORK_TOOL = /^(web_search|web_fetch|browser_agent|gmail_|coinbase_)/;

const WEB_SEARCH_RESULTS = [
  ["Node.js 24 becomes LTS: what changed", "https://nodejs.org/en/blog/release/v24-lts", "Node.js 24 enters Long Term Support with V8 13.6, npm 11, a stable permission model and URLPattern as a global."],
  ["Node 24 release notes (full changelog)", "https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V24.md", "Semver-major changes, deprecations and the complete commit list for the 24.x line."],
  ["Upgrading to Node.js 24: a practical checklist", "https://example-dev-blog.test/upgrading-node-24", "Test native add-ons, check deprecated APIs such as url.parse and plan the move off Node 20 before its end of life."],
  ["What the Node 24 permission model means for CLIs", "https://example-security.test/node-24-permissions", "The --permission flag is no longer experimental; file system and child process access can be scoped per process."],
  ["Node.js release schedule", "https://github.com/nodejs/release#release-schedule", "Active LTS and maintenance dates for every release line, including 22.x and 24.x."],
];

// Same layout as the real web_search tool (src/tools/web/web-search): "[n] title\nurl\nsnippet", 6,000-char cap.
function cannedWebSearch() {
  const lines = WEB_SEARCH_RESULTS.map(([title, url, snippet], i) => `[${i + 1}] ${title}\n${url}\n${snippet}`);
  return lines.join("\n\n").slice(0, 6000);
}

function cannedWebFetch(input) {
  const url = String(input?.url || WEB_SEARCH_RESULTS[0][1]);
  const sections = [
    ["Highlights", "Node.js 24 is now the Active LTS line. It ships V8 13.6 with Float16Array, explicit resource management (`using`) and RegExp.escape, plus npm 11 as the bundled package manager."],
    ["Permission model", "The permission model graduates from experimental. Start a process with `--permission` and grant `--allow-fs-read`, `--allow-fs-write`, `--allow-child-process` or `--allow-worker` as needed. Denied operations throw ERR_ACCESS_DENIED."],
    ["Web platform APIs", "URLPattern is available as a global. The built-in test runner waits for subtests automatically, and `fetch` (undici 7) supports more of the WHATWG spec."],
    ["Deprecations and removals", "`url.parse()` now emits a runtime deprecation warning; use the WHATWG URL API. `tls.createSecurePair` is removed. Several `fs` constants moved to `fs.constants` only."],
    ["Support timeline", "Node.js 24 receives active support until October 2026 and security fixes until April 2028. Node.js 20 reaches end of life in April 2026; teams should upgrade to 22 or 24."],
    ["Upgrade advice", "Run the test suite with `--pending-deprecation`, rebuild native add-ons against the new ABI, and check tooling (TypeScript, bundlers, test runners) for Node 24 support before switching production images."],
  ];
  const body = sections.map(([h, p]) => `## ${h}\n\n${p}\n\n${p}`).join("\n\n");
  return `# Node.js 24 becomes LTS: what changed\n\nSource: ${url}\n\n${body}`;
}

const GMAIL_ROWS = [
  { id: "m1", from: "Dana Kim <dana@acme-corp.test>", subject: "Contract redlines due Thursday - action required", snippet: "Hi, legal needs your sign-off on the attached redlines by Thursday noon. Can you confirm you have reviewed sections 4 and 7?", labels: ["UNREAD", "IMPORTANT", "INBOX"] },
  { id: "m2", from: "GitHub <noreply@github.test>", subject: "[nova] CI failed on main (build #1842)", snippet: "The workflow smoke-tests failed on commit 98a821c. 3 jobs failed, 12 passed.", labels: ["UNREAD", "INBOX"] },
  { id: "m3", from: "Priya Shah <priya@partner.test>", subject: "Re: Q4 integration timeline", snippet: "Thanks for the update. Could we move the demo to next Tuesday? Our team is out Friday.", labels: ["UNREAD", "INBOX"] },
  { id: "m4", from: "The Weekly Digest <digest@news.test>", subject: "Your weekly newsletter: 10 links worth reading", snippet: "This week: databases, design systems, and a newsletter about newsletters.", labels: ["UNREAD", "CATEGORY_PROMOTIONS"] },
  { id: "m5", from: "Billing <billing@cloudhost.test>", subject: "Invoice due: October hosting", snippet: "Your invoice INV-20931 for $214.00 is due in 5 days. Pay online to avoid interruption.", labels: ["UNREAD", "INBOX"] },
  { id: "m6", from: "Sam Rivera <sam@acme-corp.test>", subject: "Lunch next week?", snippet: "Free Wednesday or Thursday? There is a new ramen place near the office.", labels: ["UNREAD", "INBOX"] },
];

function gmailRow(row, index) {
  const day = String(22 - Math.floor(index / 3)).padStart(2, "0");
  return {
    id: row.id,
    threadId: `t-${row.id}`,
    labels: row.labels,
    from: row.from,
    to: "Jack <jack@example.test>",
    subject: row.subject,
    date: `Mon, ${day} Sep 2026 0${index + 1}:15:00 -0400`,
    messageIdHeader: `<${row.id}.smoke@mail.test>`,
    replyTo: "",
    snippet: row.snippet,
    internalDate: String(Date.parse(`2026-09-${day}T0${index + 1}:15:00-04:00`)),
  };
}

const CHECKED_AT_MS = Date.parse("2026-09-23T13:00:00.000Z");
const CANNED_TOOLS = {
  web_search: cannedWebSearch,
  web_fetch: cannedWebFetch,
  gmail_list_messages: () => JSON.stringify({
    ok: true, kind: "gmail_list_messages", source: "gmail", email: "jack@example.test",
    count: GMAIL_ROWS.length, messages: GMAIL_ROWS.map(gmailRow), checkedAtMs: CHECKED_AT_MS,
  }),
  gmail_classify_importance: () => JSON.stringify({
    ok: true, kind: "gmail_classify_importance", source: "gmail", count: GMAIL_ROWS.length,
    classified: GMAIL_ROWS.map((row, i) => {
      const score = row.labels.includes("IMPORTANT") ? 8 : /invoice due|action required/i.test(row.subject) ? 5 : /newsletter/i.test(row.subject) ? 0 : 2;
      return { ...gmailRow(row, i), priority: score >= 5 ? "high" : score <= 0 ? "low" : "normal", score };
    }),
    checkedAtMs: CHECKED_AT_MS,
  }),
  gmail_get_message: (input) => {
    const index = Math.max(0, GMAIL_ROWS.findIndex((row) => row.id === String(input?.messageId || "")));
    return JSON.stringify({ ok: true, kind: "gmail_get_message", source: "gmail", message: gmailRow(GMAIL_ROWS[index], index), checkedAtMs: CHECKED_AT_MS });
  },
};

async function prepareToolScope({ userContextId, workspaceDir }) {
  const state = await toolRuntime.initToolRuntimeIfNeeded({ userContextId, workspaceDir });
  assert.ok(Array.isArray(state?.tools) && state.tools.length > 0, "tool runtime did not initialise (run npm run build:agent-core)");
  for (const tool of state.tools) {
    if (tool.__tokenHarnessStub) continue;
    const originalExecute = tool.execute;
    const name = String(tool.name || "");
    tool.execute = async (input, context) => {
      toolLog.push({ scenario: capture.current.scenario, shape: capture.current.shape, tool: name });
      if (CANNED_TOOLS[name]) return CANNED_TOOLS[name](input);
      if (NETWORK_TOOL.test(name)) throw new Error(`[token-harness] network tool ${name} has no canned result`);
      return originalExecute(input, context);
    };
    tool.__tokenHarnessStub = true;
  }
  return state;
}

// ── Scenario scripts ─────────────────────────────────────────────────────────────────────────────────────────

const CHAT_TURNS = [
  ["Hey Nova, good morning.", "Good morning! What are we working on today?"],
  ["I'm planning a small dinner party for six people on Saturday. Can you help me put together a menu?",
    "Happy to. A relaxed three-course menu for six:\n\n- Starter: burrata with roasted cherry tomatoes, basil and grilled sourdough\n- Main: herb-roasted chicken thighs with lemon potatoes and a big green salad\n- Dessert: olive oil cake with whipped mascarpone and berries\n\nEverything scales easily and most of it can be prepped ahead. Any dietary needs I should plan around?"],
  ["One guest is vegetarian and another can't eat nuts. Adjust the menu for that.",
    "Updated menu:\n\n- Starter: burrata and tomatoes stays (nut-free; skip pesto, which usually has pine nuts)\n- Main: herb-roasted chicken, plus a vegetarian main of stuffed peppers with rice, feta and herbs\n- Sides: lemon potatoes and green salad with a mustard vinaigrette (no nut oils)\n- Dessert: olive oil cake, made without almond flour\n\nCheck store-bought bread and cake decorations for nut warnings."],
  ["What can I prepare the day before to save time?",
    "Day before:\n\n1. Bake the olive oil cake and store it wrapped at room temperature.\n2. Make the vinaigrette.\n3. Stuff the peppers and refrigerate them uncooked.\n4. Marinate the chicken overnight.\n5. Wash and dry the salad greens.\n\nOn the day you only roast, assemble the starter and whip the mascarpone."],
  ["Give me a shopping list grouped by store section.",
    "Produce: cherry tomatoes (500 g), basil, 4 bell peppers, 1.5 kg potatoes, 3 lemons, salad greens, berries, garlic, parsley\nMeat: 12 chicken thighs\nDairy: 2 burrata, feta (200 g), mascarpone (250 g), cream, butter, eggs\nBakery: 1 sourdough loaf (check nut warnings)\nPantry: olive oil, rice, Dijon mustard, sugar, flour, baking powder, salt, pepper"],
  ["How long should the chicken and the potatoes roast, and how hot should the oven be?",
    "Roast both at 220 C (425 F). Potatoes need about 45 minutes, so start them first; add the chicken thighs for the last 35 to 40 minutes. The chicken is done at 74 C (165 F) inside. Put the stuffed peppers in for the final 30 minutes on the lower rack."],
  ["Suggest a simple dessert that fits the dietary constraints.",
    "The olive oil cake already works: it is vegetarian and nut-free as long as you use plain flour. For something even simpler, macerate the berries with sugar and lemon and serve them over the whipped mascarpone with a crisp shortbread (check the label for nuts)."],
  ["Draft a short, friendly invitation message for the guests.",
    "Hi all! I'm hosting a small dinner at my place this Saturday at 7 pm. Nothing fancy: good food, good company. Let me know if you can make it and whether you have any dietary needs I should know about. Hope to see you there!"],
  ["Summarize the final plan in exactly 3 bullet points.",
    "- Menu: burrata starter, roast chicken plus stuffed peppers, lemon potatoes, salad and olive oil cake (vegetarian and nut-free options covered)\n- Prep: bake the cake, marinate the chicken and stuff the peppers the day before\n- Saturday: roast at 220 C, assemble the starter, and whip the mascarpone just before dessert"],
  ["Thanks, that's really helpful!", "You're welcome! Enjoy the dinner, and tell me how the cake turns out."],
];

function chatReply(lastUserText) {
  const hit = CHAT_TURNS.find(([user]) => lastUserText.includes(user.slice(0, 40)));
  return hit ? hit[1] : "Understood. Here is a concise answer based on what you shared.";
}

const WEB_TURN = "What's the latest news about the Node.js 24 LTS release? Browse the web and summarize the key changes.";
const WEB_PLAN = [
  [{ name: "web_search", input: { query: "Node.js 24 LTS release key changes" } }],
  [{ name: "web_fetch", input: { url: WEB_SEARCH_RESULTS[0][1] } }],
];
const WEB_REPLY = "Node.js 24 is now the Active LTS line. Key changes:\n\n- V8 13.6 (Float16Array, `using`, RegExp.escape) and npm 11\n- The permission model is stable (`--permission` with fine-grained allow flags)\n- URLPattern is a global; the test runner auto-awaits subtests\n- `url.parse()` is runtime-deprecated; `tls.createSecurePair` is removed\n\nSupport runs to April 2028; Node 20 is end of life in April 2026. Sources: nodejs.org release post and the v24 changelog.";

const AGENT_TASK_PROMPT = "Review the project in this workspace: look at the layout, go through the README and the server entry point, "
  + "collect every TODO comment, check whether the Express 5 migration notes affect us, and produce a short report of the "
  + "open work with file references.";
const AGENT_TASK_PLAN = [
  [{ name: "ls", input: { path: "." } }],
  [{ name: "read", input: { path: "README.md" } }],
  [{ name: "read", input: { path: "src/server.js" } }],
  [{ name: "grep", input: { pattern: "TODO", path: "." } }],
  [{ name: "web_search", input: { query: "Express 5 migration breaking changes" } }],
];
const AGENT_TASK_REPLY = "Open work report:\n\n1. src/server.js: TODO add request timeouts and graceful shutdown.\n2. src/routes/users.js: TODO validate the email query parameter; TODO paginate the list endpoint.\n3. notes/TODO.md: rate limiting and structured logging are still open.\n\nExpress 5 impact: path-to-regexp v8 changes wildcard syntax (`/*` must be named) and rejected promises now reach the error handler, so the try/catch wrappers in src/routes/users.js can be removed. No blockers found.";

const GMAIL_PROMPT = "Triage my unread mail from the last 24 hours: tell me what needs a reply today, what can wait, and what is noise. "
  + "Give me a prioritized list with one suggested next step each.";
const GMAIL_PLAN = [
  [{ name: "gmail_list_messages", input: { query: "is:unread newer_than:1d", maxResults: 10 } }],
  [{ name: "gmail_classify_importance", input: { query: "is:unread newer_than:1d", maxResults: 10 } }],
  [{ name: "gmail_get_message", input: { messageId: "m1" } }, { name: "gmail_get_message", input: { messageId: "m3" } }],
];
const GMAIL_REPLY = "Reply today:\n1. Dana Kim - contract redlines due Thursday: confirm sections 4 and 7 are reviewed.\n2. Priya Shah - Q4 timeline: accept or counter the Tuesday demo slot.\n\nCan wait:\n3. Billing - invoice INV-20931 due in 5 days: schedule payment.\n4. Sam Rivera - lunch: reply by Wednesday.\n5. GitHub - CI failure on main: check build #1842 when you are back at your desk.\n\nNoise:\n6. Weekly Digest newsletter: archive.";

const WORKSPACE_FILES = {
  "README.md": "# Orders API\n\nSmall Express service that exposes users and orders for the internal dashboard.\n\n## Running\n\n```\nnpm install\nnpm start\n```\n\nThe server listens on PORT (default 3000). See notes/TODO.md for open work.\n",
  "package.json": JSON.stringify({ name: "orders-api", version: "0.4.2", main: "src/server.js", scripts: { start: "node src/server.js", test: "node --test" }, dependencies: { express: "^5.1.0" } }, null, 2) + "\n",
  "src/server.js": "const express = require(\"express\");\nconst users = require(\"./routes/users\");\n\nconst app = express();\napp.use(express.json());\napp.use(\"/users\", users);\n\n// TODO: add request timeouts and graceful shutdown\napp.listen(process.env.PORT || 3000, () => {\n  console.log(\"orders-api listening\");\n});\n",
  "src/routes/users.js": "const { Router } = require(\"express\");\nconst router = Router();\n\n// TODO: validate the email query parameter\nrouter.get(\"/\", async (req, res, next) => {\n  try {\n    // TODO: paginate the list endpoint\n    res.json([]);\n  } catch (error) {\n    next(error);\n  }\n});\n\nmodule.exports = router;\n",
  "notes/TODO.md": "# Open work\n\n- [ ] Rate limiting on public routes\n- [ ] Structured logging (pino)\n- [x] Move to Express 5\n",
};

function createFixtureWorkspace(name) {
  const dir = path.join(isolatedDataDir, "token-baseline-workspaces", name);
  for (const [rel, content] of Object.entries(WORKSPACE_FILES)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
  return dir;
}

// ── Scenario runners ─────────────────────────────────────────────────────────────────────────────────────────

const scenarioResults = [];

function begin(scenario, shape, { plan = null, reply }) {
  capture.current = { scenario, shape };
  scenarioState = { plan, planIndex: 0, reply };
}

function summarizeTurn(result) {
  return {
    route: String(result?.route || ""),
    responseRoute: String(result?.responseRoute || ""),
    ok: result?.ok !== false,
    promptTokens: Number(result?.promptTokens || 0),
    completionTokens: Number(result?.completionTokens || 0),
    cachedInputTokens: result?.cachedInputTokens ?? null,
    cacheWriteInputTokens: result?.cacheWriteInputTokens ?? null,
    toolCalls: Array.isArray(result?.toolCalls) ? result.toolCalls : [],
    error: String(result?.error || ""),
  };
}

async function runChat10(shape) {
  const userContextId = `tb-chat-${shape}`;
  const conversationId = `tb-chat-${shape}-thread`;
  begin("chat-10-turn", shape, { reply: chatReply });
  const turns = [];
  for (const [text] of CHAT_TURNS) {
    const result = await handleInput(text, {
      source: "hud",
      sender: "hud-user",
      voice: false,
      userContextId,
      conversationId,
      sessionKeyHint: `agent:nova:hud:user:${userContextId}:dm:${conversationId}`,
      runtimeSelectionOverride: runtimeSelectionOverride(shape),
    });
    turns.push(summarizeTurn(result));
  }
  return turns;
}

async function runWebResearch(shape) {
  const userContextId = `tb-web-${shape}`;
  const conversationId = `tb-web-${shape}-thread`;
  await prepareToolScope({ userContextId });
  begin("web-research", shape, { plan: WEB_PLAN, reply: () => WEB_REPLY });
  const result = await handleInput(WEB_TURN, {
    source: "hud",
    sender: "hud-user",
    voice: false,
    userContextId,
    conversationId,
    sessionKeyHint: `agent:nova:hud:user:${userContextId}:dm:${conversationId}`,
    runtimeSelectionOverride: runtimeSelectionOverride(shape),
  });
  return [summarizeTurn(result)];
}

async function runAgentTask(scenario, shape, { prompt, plan, reply }) {
  const userContextId = `tb-${scenario}-${shape}`;
  const taskId = `tb-${scenario}-${shape}-task`;
  const workspaceDir = createFixtureWorkspace(`${scenario}-${shape}`);
  await prepareToolScope({ userContextId, workspaceDir });
  begin(scenario, shape, { plan, reply: () => reply });
  // Same options the agent-task service passes (src/runtime/modules/agent-tasks/index.js executeTask).
  const result = await handleInput(prompt, {
    voice: false,
    source: "agent-task",
    sender: "agent-task",
    userContextId,
    conversationId: `agent-task-${taskId}`,
    sessionKeyHint: `agent-task:${userContextId}:${taskId}`,
    preferredProvider: shape,
    preferredModel: MODELS[shape],
    autonomousTask: true,
    permissionMode: "default",
    approvedTools: [],
    taskId,
    workspaceDir,
    worktreePath: "",
    executionFenceCheck: () => {},
    consumeTaskApproval: () => {},
    reserveTaskEffect: () => {},
    customInstructions:
      "Execute this as an autonomous background task. Use available Nova integrations and tools when needed. "
      + "Return a clear final result describing completed work and any blockers.",
    runtimeSelectionOverride: runtimeSelectionOverride(shape),
  });
  return [summarizeTurn(result)];
}

// ── Mission (TypeScript executor + provider, transpiled into a vm) ───────────────────────────────────────────

const require = createRequire(import.meta.url);
const ts = require("typescript");
const tsModuleCache = new Map();

function resolveTsSpecifier(fromFile, specifier) {
  let base = null;
  if (specifier.startsWith("@/")) base = path.join(repoRoot, "hud", specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), `${base}.js`, path.join(base, "index.js")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function loadTsModule(file, stubs, sandboxGlobals) {
  if (tsModuleCache.has(file)) return tsModuleCache.get(file).exports;
  const source = fs.readFileSync(file, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: path.basename(file),
  }).outputText;
  const module = { exports: {} };
  tsModuleCache.set(file, module);
  const nodeRequire = createRequire(file);
  const sandbox = {
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier === "server-only") return {};
      if (Object.prototype.hasOwnProperty.call(stubs, specifier)) return stubs[specifier];
      const resolved = resolveTsSpecifier(file, specifier);
      if (resolved && /\.tsx?$/.test(resolved)) return loadTsModule(resolved, stubs, sandboxGlobals);
      if (resolved) return nodeRequire(resolved);
      return nodeRequire(specifier);
    },
    process,
    console,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    Response,
    Headers,
    setTimeout,
    clearTimeout,
    crypto,
    Intl,
    ...sandboxGlobals,
  };
  vm.runInNewContext(compiled, sandbox, { filename: `${file}.cjs` });
  return module.exports;
}

const MISSION_UPSTREAM_TEXT = [
  "Source: Hacker News front page (fetched 2026-09-23 07:00)",
  ...Array.from({ length: 18 }, (_, i) => `${i + 1}. ${[
    "Show HN: A local-first notes app with CRDT sync",
    "Postgres 19 beta adds incremental materialized views",
    "The hidden cost of retry storms in distributed systems",
    "Rust 2027 edition planning kicks off",
    "Why we moved our CI to self-hosted runners",
    "An illustrated guide to prompt caching",
  ][i % 6]} (${120 + i * 17} points, ${30 + i * 5} comments) - ${"A detailed discussion covering design trade-offs, benchmarks and real-world migration stories from teams running it in production. ".repeat(2)}`),
].join("\n");

async function runMission(shape) {
  const fakeConfig = {
    activeLlmProvider: shape,
    openai: { connected: true, apiKey: "fake-openai-key", baseUrl: FAKE_OPENAI_BASE_URL, defaultModel: MODELS.openai },
    claude: { connected: true, apiKey: "fake-claude-key", baseUrl: FAKE_CLAUDE_BASE_URL, defaultModel: MODELS.claude },
    grok: { connected: false, apiKey: "", baseUrl: "", defaultModel: "" },
    gemini: { connected: false, apiKey: "", baseUrl: "", defaultModel: "" },
  };
  const stubs = {
    "@/lib/integrations/store/server-store": { loadIntegrationsConfig: async () => fakeConfig },
    "@/lib/integrations/llm/provider-selection": {
      resolveConfiguredLlmProvider: (config) => ({ provider: config.activeLlmProvider, model: config[config.activeLlmProvider].defaultModel }),
    },
  };
  tsModuleCache.clear();
  const executors = loadTsModule(
    path.join(repoRoot, "hud/lib/missions/workflow/executors/ai-executors.ts"),
    stubs,
    { fetch: guard.fetch },
  );
  const nodes = [
    { id: "trigger", type: "schedule-trigger", label: "Every morning", position: { x: 0, y: 0 }, triggerMode: "daily", triggerTime: "07:00", triggerTimezone: "America/New_York" },
    { id: "fetch", type: "web-search", label: "Fetch front page", position: { x: 200, y: 0 }, query: "Hacker News front page" },
    {
      id: "summarize",
      type: "ai-summarize",
      label: "Summarize",
      position: { x: 400, y: 0 },
      prompt: "Summarize today's top stories for a busy engineer. Group by theme, keep each item to one line, and end with the single most important story.",
      systemPrompt: "You are Nova's mission briefing writer. Be concise, factual and neutral. Use plain text bullets.",
    },
    { id: "out", type: "telegram-output", label: "Send", position: { x: 600, y: 0 } },
  ];
  const mission = {
    id: `tb-mission-${shape}`,
    userId: `tb-mission-${shape}`,
    label: "Morning tech briefing",
    description: "",
    category: "research",
    tags: [],
    status: "active",
    version: 1,
    nodes,
    connections: [
      { id: "c1", sourceNodeId: "trigger", sourcePort: "main", targetNodeId: "fetch", targetPort: "main" },
      { id: "c2", sourceNodeId: "fetch", sourcePort: "main", targetNodeId: "summarize", targetPort: "main" },
      { id: "c3", sourceNodeId: "summarize", sourcePort: "main", targetNodeId: "out", targetPort: "main" },
    ],
    variables: [],
    settings: { timezone: "America/New_York", retryOnFail: false, retryCount: 0 },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const nodeOutputs = new Map([
    ["trigger", { ok: true, text: "" }],
    ["fetch", { ok: true, text: MISSION_UPSTREAM_TEXT, data: { query: "Hacker News front page" } }],
  ]);
  begin("mission-run", shape, { reply: () => "- Tooling: local-first notes app with CRDT sync; CI moved to self-hosted runners\n- Data: Postgres 19 beta adds incremental materialized views\n- Reliability: retry storms explained\n\nMost important: Postgres 19 incremental materialized views." });
  const ctx = {
    missionId: mission.id,
    missionLabel: mission.label,
    runId: `tb-mission-run-${shape}`,
    runKey: "token-baseline",
    attempt: 1,
    now: new Date("2026-09-23T11:00:00.000Z"),
    runSource: "trigger",
    mission,
    nodeOutputs,
    variables: {},
    scope: { userId: mission.userId },
    userContextId: mission.userId,
    conversationId: "",
    sessionKey: "",
    resolveExpr: (template) => String(template || ""),
  };
  const output = await executors.executeAiSummarize(nodes[2], ctx);
  assert.equal(output?.ok, true, `mission ai-summarize failed: ${output?.error || "unknown"}`);
  return [{ route: "mission", responseRoute: "ai-summarize", ok: true, provider: output?.data?.provider || "", usage: output?.data?.usage ?? null }];
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────────────────

const SCENARIOS = [
  ["chat-10-turn", runChat10],
  ["web-research", runWebResearch],
  ["agent-task", (shape) => runAgentTask("agent-task", shape, { prompt: AGENT_TASK_PROMPT, plan: AGENT_TASK_PLAN, reply: AGENT_TASK_REPLY })],
  ["gmail-triage", (shape) => runAgentTask("gmail-triage", shape, { prompt: GMAIL_PROMPT, plan: GMAIL_PLAN, reply: GMAIL_REPLY })],
  ["mission-run", runMission],
];
const SHAPES = ["openai", "claude"];

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ status: "PASS", name });
  } catch (error) {
    checks.push({ status: "FAIL", name, detail: error instanceof Error ? error.message : String(error) });
  }
}

// Silence the runtime's own console chatter so the report stays readable (restored before printing).
const originalLog = console.log;
const originalInfo = console.info;
const originalWarn = console.warn;
const runtimeWarnings = [];
if (!args.verbose) {
  console.log = () => {};
  console.info = () => {};
  console.warn = (...parts) => runtimeWarnings.push(parts.map(String).join(" ").slice(0, 300));
}

for (const [scenario, runner] of SCENARIOS) {
  for (const shape of SHAPES) {
    const before = capture.calls.length;
    let turns = [];
    let error = "";
    try {
      turns = await runner(shape);
    } catch (err) {
      error = err instanceof Error ? `${err.message}` : String(err);
    }
    const calls = capture.calls.slice(before).filter((c) => c.scenario === scenario);
    scenarioResults.push({ scenario, shape, turns, error, calls, planStepsUsed: scenarioState?.planIndex ?? 0, planSteps: scenarioState?.plan?.length ?? 0 });
  }
}
scenarioState = null;
console.log = originalLog;
console.info = originalInfo;
console.warn = originalWarn;

// ── Invariants ───────────────────────────────────────────────────────────────────────────────────────────────

check("no real network calls were attempted", () => {
  assert.deepEqual(guard.violations, [], `blocked: ${JSON.stringify(guard.violations.slice(0, 5))}`);
});
for (const r of scenarioResults) {
  check(`${r.scenario}/${r.shape}: ran without error and captured >= 1 model call`, () => {
    assert.equal(r.error, "", r.error);
    assert.ok(r.calls.length >= 1, "no model call captured");
    assert.ok(r.calls.every((c) => c.shape === r.shape), "a call used the other provider shape");
  });
  if (r.planSteps > 0) {
    check(`${r.scenario}/${r.shape}: every scripted tool step was sent with the tool schemas`, () => {
      assert.equal(r.planStepsUsed, r.planSteps, `used ${r.planStepsUsed}/${r.planSteps} tool steps`);
      const toolCalls = r.calls.filter((c) => Array.isArray(c.request.tools) && c.request.tools.length > 0);
      assert.ok(toolCalls.length >= r.planSteps + 1, `only ${toolCalls.length} tool-loop requests`);
    });
  }
}
check("chat-10-turn: 10 turns answered through the LLM path for both shapes", () => {
  for (const r of scenarioResults.filter((x) => x.scenario === "chat-10-turn")) {
    assert.equal(r.turns.length, 10);
    const llmTurns = r.turns.filter((t) => t.ok && !["calendar", "gmail", "web_research", "market", "crypto"].includes(t.route));
    assert.equal(llmTurns.length, 10, `${r.shape}: routes ${r.turns.map((t) => t.responseRoute).join(",")}`);
  }
});

// ── Report ───────────────────────────────────────────────────────────────────────────────────────────────────

const report = {
  generatedBy: "scripts/smoke/token-efficiency/token-baseline-harness.mjs",
  estimator: "countApproxTokens = ceil(chars / 3.5) (src/runtime/core/context-prompt)",
  serialization: {
    openai: "JSON(tools ?? []) + \\n + JSON(messages)",
    claude: "JSON(tools ?? []) + \\n + JSON(system) + \\n + JSON(messages)",
    stablePrefix: "leading chars identical to the previous call's serialization (same scenario + shape)",
    inputSize: "JSON(messages) for openai, JSON(system)+JSON(messages) for claude; tools reported separately",
  },
  models: MODELS,
  environment: { node: process.version, platform: process.platform },
  scenarios: scenarioResults.map((r) => {
    const metrics = computeCallMetrics(r.calls);
    return {
      scenario: r.scenario,
      shape: r.shape,
      error: r.error,
      turns: r.turns,
      summary: summarizeMetrics(metrics),
      calls: metrics,
      requestSha256: r.calls.map((c) => crypto.createHash("sha256").update(JSON.stringify(c.request)).digest("hex").slice(0, 16)),
      ...(args["include-requests"] === "1" ? { requests: r.calls.map((c) => c.request) } : {}),
    };
  }),
  toolExecutions: toolLog,
  checks,
};

if (!quiet) {
  console.log("Token baseline (offline, fake model). ~tok = ceil(chars/3.5). prefix = leading chars identical to the previous call.");
  console.log(`Serialization: openai = ${report.serialization.openai}; claude = ${report.serialization.claude}\n`);
  for (const s of report.scenarios) {
    console.log(formatMetricsTable(`== ${s.scenario} [${s.shape}] ${s.error ? `ERROR: ${s.error}` : ""}`, s.calls));
    const routes = s.turns.map((t) => t.responseRoute || t.route).join(", ");
    console.log(`  routes: ${routes}\n`);
  }
}

const jsonTarget = outPath ? path.resolve(outPath) : path.join(isolatedDataDir, "token-baseline.json");
fs.mkdirSync(path.dirname(jsonTarget), { recursive: true });
fs.writeFileSync(jsonTarget, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`JSON results: ${jsonTarget}${outPath ? "" : " (temp dir, removed on exit; pass --out <file> to keep)"}`);

for (const c of checks) console.log(`[${c.status}] ${c.name}${c.detail ? ` :: ${c.detail}` : ""}`);
const failed = checks.filter((c) => c.status === "FAIL").length;
console.log(`\ntoken-baseline: ${checks.length - failed} checks passed, ${failed} failed`);
if (failed > 0 && runtimeWarnings.length > 0) {
  console.log(`runtime warnings (first 10):\n  ${runtimeWarnings.slice(0, 10).join("\n  ")}`);
}
guard.restore();
process.exit(failed > 0 ? 1 : 0);
