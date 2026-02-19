import assert from "node:assert/strict";
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

const executorModule = await import(
  pathToFileURL(path.join(process.cwd(), "dist", "tools", "executor.js")).href,
);
const { executeToolUse } = executorModule;

function toolUse(name, input = {}) {
  return {
    id: `tool_${name}_1`,
    name,
    input,
    type: "tool_use",
  };
}

const pluginFileTool = {
  name: "plugin_file_reader",
  description: "Plugin file reader",
  riskLevel: "safe",
  capabilities: ["filesystem.read"],
  input_schema: { type: "object" },
  execute: async () => "file_ok",
};

const pluginNetworkTool = {
  name: "plugin_network_fetcher",
  description: "Plugin network fetcher",
  riskLevel: "safe",
  capabilities: ["network.fetch"],
  input_schema: { type: "object" },
  execute: async () => "network_ok",
};

await run("P18-C1 plugin file/network tools are denied without grants", async () => {
  const context = {
    source: "phase18-smoke",
    enforceCapabilities: true,
    capabilityAllowlist: ["memory.read"],
  };
  const fileResult = await executeToolUse(toolUse(pluginFileTool.name), [pluginFileTool], context);
  const networkResult = await executeToolUse(
    toolUse(pluginNetworkTool.name),
    [pluginNetworkTool],
    context,
  );
  assert.equal(fileResult.is_error, true);
  assert.equal(networkResult.is_error, true);
  assert.equal(String(fileResult.content).toLowerCase().includes("capability policy"), true);
  assert.equal(String(networkResult.content).toLowerCase().includes("capability policy"), true);
});

await run("P18-C2 granted capabilities allow plugin tools to execute", async () => {
  const context = {
    source: "phase18-smoke",
    enforceCapabilities: true,
    capabilityAllowlist: ["filesystem.read", "network.fetch"],
  };
  const fileResult = await executeToolUse(toolUse(pluginFileTool.name), [pluginFileTool], context);
  const networkResult = await executeToolUse(
    toolUse(pluginNetworkTool.name),
    [pluginNetworkTool],
    context,
  );
  assert.equal(fileResult.is_error, undefined);
  assert.equal(networkResult.is_error, undefined);
  assert.equal(fileResult.content, "file_ok");
  assert.equal(networkResult.content, "network_ok");
});

await run("P18-C3 capability denylist blocks even when allowlisted", async () => {
  const context = {
    source: "phase18-smoke",
    enforceCapabilities: true,
    capabilityAllowlist: ["network.*"],
    capabilityDenylist: ["network.fetch"],
  };
  const networkResult = await executeToolUse(
    toolUse(pluginNetworkTool.name),
    [pluginNetworkTool],
    context,
  );
  assert.equal(networkResult.is_error, true);
  assert.equal(String(networkResult.content).toLowerCase().includes("capability policy"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
