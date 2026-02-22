import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createToolRuntime } from "../../../src/tools/runtime/runtime-compat.js";
import { describeUnknownError } from "../../../src/providers/runtime-compat.js";

const results = [];

function assertPathExists(filePath, label) {
  assert.equal(fs.existsSync(filePath), true, `${label} missing: ${filePath}`);
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

const distCoreRegistryPath = path.join(process.cwd(), "dist", "tools", "core", "registry.js");
const distCoreExecutorPath = path.join(process.cwd(), "dist", "tools", "core", "executor.js");
const distCoreProtocolPath = path.join(process.cwd(), "dist", "tools", "core", "protocol.js");
const distBuiltinExecPath = path.join(process.cwd(), "dist", "tools", "builtin", "exec.js");
const distWebSearchPath = path.join(process.cwd(), "dist", "tools", "web", "web-search.js");
assertPathExists(distCoreRegistryPath, "tool core registry module");
assertPathExists(distCoreExecutorPath, "tool core executor module");
assertPathExists(distCoreProtocolPath, "tool core protocol module");
assertPathExists(distBuiltinExecPath, "tool builtin exec module");
assertPathExists(distWebSearchPath, "tool web search module");

const coreRegistryModule = await import(pathToFileURL(distCoreRegistryPath).href);
const coreExecutorModule = await import(pathToFileURL(distCoreExecutorPath).href);
const coreProtocolModule = await import(pathToFileURL(distCoreProtocolPath).href);
const linkUnderstandingPath = path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "analysis",
  "link-understanding.js",
);
assert.equal(
  fs.existsSync(linkUnderstandingPath),
  true,
  `link understanding module moved; update smoke import path: ${linkUnderstandingPath}`,
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
    memoryDbPath: path.join(process.cwd(), ".agent", "memory.smoke.db"),
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

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
