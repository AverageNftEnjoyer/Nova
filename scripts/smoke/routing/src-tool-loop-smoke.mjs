import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createToolRuntime } from "../../../src/tools/runtime/index.js";
import { describeUnknownError } from "../../../src/providers/runtime/index.js";

const results = [];

function assertPathExists(filePath, label) {
  assert.equal(fs.existsSync(filePath), true, `${label} missing: ${filePath}`);
}

function resolveExistingPath(candidates, label) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`${label} moved; checked: ${candidates.join(", ")}`);
}

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

const distCoreRegistryPath = path.join(process.cwd(), "dist", "tools", "core", "registry", "index.js");
const distCoreExecutorPath = path.join(process.cwd(), "dist", "tools", "core", "executor", "index.js");
const distCoreProtocolPath = path.join(process.cwd(), "dist", "tools", "core", "protocol", "index.js");
const distBuiltinExecPath = path.join(process.cwd(), "dist", "tools", "builtin", "exec", "index.js");
const distWebSearchPath = path.join(process.cwd(), "dist", "tools", "web", "web-search", "index.js");
assertPathExists(distCoreRegistryPath, "tool core registry module");
assertPathExists(distCoreExecutorPath, "tool core executor module");
assertPathExists(distCoreProtocolPath, "tool core protocol module");
assertPathExists(distBuiltinExecPath, "tool builtin exec module");
assertPathExists(distWebSearchPath, "tool web search module");

const coreRegistryModule = await import(pathToFileURL(distCoreRegistryPath).href);
const coreExecutorModule = await import(pathToFileURL(distCoreExecutorPath).href);
const coreProtocolModule = await import(pathToFileURL(distCoreProtocolPath).href);
const linkUnderstandingPath = resolveExistingPath(
  [
    path.join(
      process.cwd(),
      "src",
      "runtime",
      "modules",
      "chat",
      "analysis",
      "link-understanding",
      "index.js",
    ),
    path.join(
      process.cwd(),
      "src",
      "runtime",
      "modules",
      "chat",
      "analysis",
      "link-understanding.js",
    ),
  ],
  "link understanding module",
);
const linkUnderstandingModule = await import(
  pathToFileURL(linkUnderstandingPath).href,
);

const { createToolRegistry } = coreRegistryModule;
const { executeToolUse } = coreExecutorModule;
const {
  toOpenAiToolDefinitions,
  openAiToolCallToAnthropicToolUse,
} = coreProtocolModule;
const { extractLinksFromMessage, runLinkUnderstanding, formatLinkUnderstandingForPrompt } =
  linkUnderstandingModule;

function createRuntime(overrides = {}) {
  return createToolRuntime({
    enabled: true,
    memoryEnabled: false,
    rootDir: process.cwd(),
    memoryDbPath: path.join(process.env.NOVA_DATA_DIR, "memory.smoke.db"),
    memorySourceDir: path.join(process.cwd(), "memory"),
    enabledTools: ["read", "write", "edit", "ls", "grep", "exec", "web_search", "web_fetch"],
    execApprovalMode: "ask",
    safeBinaries: ["echo", "node"],
    webSearchProvider: "brave",
    webSearchApiKey: "",
    memoryConfig: {
      embeddingProvider: "local",
      embeddingModel: "text-embedding-3-small",
      embeddingApiKey: "",
      chunkSize: 400,
      chunkOverlap: 80,
      hybridVectorWeight: 0.7,
      hybridBm25Weight: 0.3,
      topK: 5,
    },
    describeUnknownError,
    ...overrides,
  });
}

await run("P5-C0 tool modules are organized under subfolders", async () => {
  const toolRoot = path.join(process.cwd(), "src", "tools");
  const rootEntries = fs.readdirSync(toolRoot, { withFileTypes: true });
  const rootFiles = rootEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  assert.equal(
    rootFiles.length,
    0,
    `src/tools root must not contain loose files: ${rootFiles.join(", ")}`,
  );
  for (const requiredDir of ["core", "builtin", "web", "runtime"]) {
    assert.equal(
      rootEntries.some((entry) => entry.isDirectory() && entry.name === requiredDir),
      true,
      `missing required tools subfolder: ${requiredDir}`,
    );
  }
  assert.equal(typeof createToolRegistry, "function");
  assert.equal(typeof executeToolUse, "function");
  assert.equal(typeof toOpenAiToolDefinitions, "function");
});

await run("P5-C1 Tool registry parity (runtime vs src canonical registry)", async () => {
  const runtime = createRuntime();
  const state = await runtime.initToolRuntimeIfNeeded();
  const runtimeTools = state.tools;

  const canonicalTools = createToolRegistry(
    {
      enabledTools: ["read", "write", "edit", "ls", "grep", "exec", "web_search", "web_fetch"],
      execApprovalMode: "ask",
      safeBinaries: ["echo", "node"],
      webSearchProvider: "brave",
      webSearchApiKey: "",
    },
    {
      workspaceDir: process.cwd(),
      memoryManager: null,
    },
  );

  const normalize = (tool) => ({
    name: String(tool.name || ""),
    description: String(tool.description || ""),
    schema: JSON.stringify(tool.input_schema || {}),
  });

  const runtimeNorm = runtimeTools.map(normalize).sort((a, b) => a.name.localeCompare(b.name));
  const canonicalNorm = canonicalTools.map(normalize).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(runtimeNorm, canonicalNorm);
});

await run("P5-C2 Tool execution parity + shared conversion layer", async () => {
  const runtime = createRuntime();
  const state = await runtime.initToolRuntimeIfNeeded();
  const tools = state.tools;

  const runtimeDefs = runtime.toOpenAiToolDefinitions(tools);
  const canonicalDefs = toOpenAiToolDefinitions(tools);
  assert.deepEqual(runtimeDefs, canonicalDefs);

  const toolCall = {
    id: "call_123",
    function: {
      name: "read",
      arguments: JSON.stringify({ path: "package.json" }),
    },
  };
  const runtimeToolUse = runtime.toOpenAiToolUseBlock(toolCall);
  const canonicalToolUse = openAiToolCallToAnthropicToolUse(toolCall, "fallback");
  assert.deepEqual(runtimeToolUse, canonicalToolUse);

  const runtimeResult = await state.executeToolUse(runtimeToolUse, tools);
  const canonicalResult = await executeToolUse(canonicalToolUse, tools);
  assert.equal(runtimeResult.is_error, canonicalResult.is_error);
  assert.ok(String(runtimeResult.content).includes("\"name\""));
  assert.ok(String(canonicalResult.content).includes("\"name\""));
});

await run("P5-C3 exec approval mode enforcement (ask|auto|off)", async () => {
  const getExecTool = async (approvalMode) => {
    const runtime = createRuntime({ execApprovalMode: approvalMode });
    const state = await runtime.initToolRuntimeIfNeeded();
    const tool = state.tools.find((candidate) => candidate.name === "exec");
    assert.ok(tool, `missing exec tool for mode ${approvalMode}`);
    return tool;
  };

  const askExec = await getExecTool("ask");
  const askResult = await askExec.execute({ command: "unsafe_binary_for_approval_check --version" });
  assert.ok(String(askResult).toLowerCase().includes("pending approval"));

  const autoExec = await getExecTool("auto");
  const autoResult = await autoExec.execute({ command: "node -v" });
  const autoText = String(autoResult || "").toLowerCase();
  assert.equal(autoText.includes("pending approval"), false);
  assert.equal(autoText.includes("disabled"), false);

  const offExec = await getExecTool("off");
  const offResult = await offExec.execute({ command: "echo NOVA_EXEC_MODE_OFF" });
  assert.ok(String(offResult).toLowerCase().includes("disabled"));
});

await run("P17-C1 dangerous tools are blocked by default policy", async () => {
  const dangerousTools = [
    {
      name: "apply_patch",
      description: "dangerous patch executor",
      input_schema: { type: "object" },
      execute: async () => "should never run",
    },
  ];
  const result = await executeToolUse(
    {
      id: "danger_1",
      name: "apply_patch",
      input: { patch: "x" },
      type: "tool_use",
    },
    dangerousTools,
  );
  assert.equal(result.is_error, true);
  assert.equal(String(result.content).toLowerCase().includes("blocked by policy"), true);
});

await run("P5-C4 link understanding extracts + compacts URL context", async () => {
  const prompt = [
    "Summarize [release notes](https://example.com/release-notes)",
    "and also check https://example.com/blog/post?id=7",
    "plus duplicate https://example.com/release-notes",
  ].join(" ");
  const links = extractLinksFromMessage(prompt, { maxLinks: 3 });
  assert.equal(Array.isArray(links), true);
  assert.equal(links.length, 2);
  assert.equal(links.includes("https://example.com/release-notes"), true);
  assert.equal(links.includes("https://example.com/blog/post?id=7"), true);

  const runtimeTools = {
    executeToolUse: async (toolUse) => {
      const url = String(toolUse?.input?.url || "");
      return {
        content: [
          "# Example Page",
          "",
          `Source: ${url}`,
          "",
          "This release includes stability improvements and workflow performance updates.",
          "Token handling was improved and duplicate messages are now filtered.",
        ].join("\n"),
      };
    },
  };

  const result = await runLinkUnderstanding({
    text: prompt,
    query: "release stability updates duplicate messages",
    maxLinks: 2,
    maxCharsPerLink: 420,
    runtimeTools,
    availableTools: [{ name: "web_fetch" }],
  });

  assert.equal(Array.isArray(result.outputs), true);
  assert.equal(result.outputs.length, 2);
  assert.equal(result.outputs[0].includes("Source: https://example.com/"), true);
  assert.equal(result.outputs[0].includes("Title: Example Page"), true);

  const formatted = formatLinkUnderstandingForPrompt(result.outputs, 900);
  assert.equal(formatted.includes("[Link 1]"), true);
  assert.equal(formatted.length <= 900 + 20, true);
});

// ── Stage 2: tool output caps (src/tools/core/output-caps), through the real executor ─────────────────────────

const distOutputCapsPath = path.join(process.cwd(), "dist", "tools", "core", "output-caps", "index.js");
const distMemoryToolsPath = path.join(process.cwd(), "dist", "tools", "builtin", "memory-tools", "index.js");
const { TRUNCATION_MARKER_PREFIX } = await import(pathToFileURL(distOutputCapsPath).href);
const { createMemoryTools } = await import(pathToFileURL(distMemoryToolsPath).href);

/** The JSON arguments of the follow-up call a truncation marker names, e.g. `call read with {...}.` */
function followUpInput(content, toolName) {
  const markerAt = content.lastIndexOf(TRUNCATION_MARKER_PREFIX);
  if (markerAt < 0) return null;
  // Only a paging marker names a follow-up call; a note such as an over-long line does not.
  const match = content.slice(markerAt).match(new RegExp(`call ${toolName} with (\\{.*\\})\\.\\]$`));
  return match ? JSON.parse(match[1]) : null;
}

/** Pages through a tool by following its markers; returns every page body (markers stripped) and the call count. */
async function followPages(tools, toolName, firstInput, maxCalls = 50) {
  const bodies = [];
  let input = firstInput;
  let calls = 0;
  while (input && calls < maxCalls) {
    const result = await executeToolUse({ id: `page_${calls}`, name: toolName, input, type: "tool_use" }, tools);
    calls += 1;
    assert.equal(result.is_error, undefined, `page ${calls} failed: ${String(result.content).slice(0, 200)}`);
    const content = String(result.content);
    const markerAt = content.lastIndexOf(`\n\n${TRUNCATION_MARKER_PREFIX}`);
    bodies.push({ content, body: markerAt >= 0 ? content.slice(0, markerAt) : content });
    input = followUpInput(content, toolName);
  }
  return { bodies, calls };
}

await run("P5-C5 read caps a huge file to a 400-line window and its markers page through the whole file", async () => {
  const dir = fs.mkdtempSync(path.join(process.env.NOVA_DATA_DIR, "caps-read-"));
  const lines = Array.from({ length: 1_234 }, (_, i) => `line ${i + 1}: ${"x".repeat(40)}`);
  fs.writeFileSync(path.join(dir, "big.log"), `${lines.join("\n")}\n`, "utf8");
  // A minified-style file: 3 lines of 40k characters each, past the read character budget.
  const wide = Array.from({ length: 3 }, (_, i) => `${i}`.repeat(40_000));
  fs.writeFileSync(path.join(dir, "wide.js"), wide.join("\n"), "utf8");
  const tools = createToolRegistry(
    { enabledTools: ["read"], execApprovalMode: "ask", safeBinaries: [], webSearchProvider: "brave", webSearchApiKey: "" },
    { workspaceDir: dir, memoryManager: null },
  );

  const { bodies, calls } = await followPages(tools, "read", { path: "big.log" });
  assert.equal(calls, 4, `expected 4 windows (400+400+400+34 lines), got ${calls}`);
  assert.equal(bodies[0].body.split("\n").length, 400, "first window is not 400 lines");
  assert.match(bodies[0].content, /showed lines 1-400 of 1,234; 834 more lines not shown\. To get more, call read with \{"path": "big\.log", "startLine": 401, "endLine": 800\}\.\]$/);
  assert.equal(bodies.map((b) => b.body).join("\n"), lines.join("\n"), "paged windows do not reassemble the file");

  const explicit = await executeToolUse({ id: "r2", name: "read", input: { path: "big.log", startLine: 1000, endLine: 1010 }, type: "tool_use" }, tools);
  assert.equal(String(explicit.content).split("\n")[0], lines[999], "explicit range ignored");

  // Lines longer than the whole character budget: one line per call, cut, and the cut is stated.
  const widePages = await followPages(tools, "read", { path: "wide.js" });
  assert.equal(widePages.calls, 3, `expected one call per oversized line, got ${widePages.calls}`);
  for (const page of widePages.bodies) {
    assert.ok(page.content.length <= 33_000, `wide page is ${page.content.length} chars`);
    assert.match(page.content, /is 40,000 characters long; showed the first 32,000/);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

await run("P5-C6 memory_get pages a huge doc by offset; other tools get a capped result with a how-to marker", async () => {
  const source = Array.from({ length: 4_000 }, (_, i) => `Fact ${i}: the deploy key rotates every ${i % 7} days.`).join("\n");
  const memoryManager = { getSourceContentByChunkId: async (id) => (id === "chunk-1" ? source : null), search: async () => [] };
  const memoryTools = createMemoryTools(memoryManager);
  const { bodies, calls } = await followPages(memoryTools, "memory_get", { chunk_id: "chunk-1" });
  assert.ok(source.length > 150_000, "fixture too small");
  assert.ok(calls >= Math.ceil(source.length / 12_000) && calls <= Math.ceil(source.length / 10_800), `unexpected page count ${calls} for ${source.length} chars`);
  for (const page of bodies) assert.ok(page.content.length <= 13_000, `memory_get page is ${page.content.length} chars`);
  assert.equal(bodies.map((b) => b.body).join(""), source, "memory_get pages do not reassemble the source");

  // exec: a command printing 200k characters is cut to the registry's 8,000 with a marker that says how to get more.
  const runtime = createRuntime({ execApprovalMode: "auto" });
  const state = await runtime.initToolRuntimeIfNeeded();
  const execResult = await state.executeToolUse(
    { id: "e1", name: "exec", input: { command: "node -e \"process.stdout.write('y'.repeat(200000))\"" }, type: "tool_use" },
    state.tools,
  );
  const execText = String(execResult.content);
  assert.ok(execText.length < 8_600, `exec output is ${execText.length} chars`);
  assert.match(execText, /showed characters 1-8,000 of 200,000; 192,000 more characters not shown\. To get more, re-run the command/);

  // A tool with no registry entry still cannot return an unbounded blob.
  const blob = [{ name: "blob_tool", description: "test", riskLevel: "safe", input_schema: { type: "object" }, execute: async () => "z".repeat(500_000) }];
  const blobResult = await executeToolUse({ id: "b1", name: "blob_tool", input: {}, type: "tool_use" }, blob);
  assert.ok(String(blobResult.content).length < 65_000, "unregistered tool output was not capped");
  assert.ok(String(blobResult.content).includes(TRUNCATION_MARKER_PREFIX), "unregistered tool cap has no marker");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
