import assert from "node:assert/strict";
import test from "node:test";

import { createToolRegistry } from "../core/registry.js";

function createTools(enabledTools: string[]) {
  return createToolRegistry(
    {
      enabledTools,
      execApprovalMode: "ask",
      safeBinaries: [],
      webSearchProvider: "brave",
      webSearchApiKey: "",
    },
    {
      workspaceDir: process.cwd(),
      memoryManager: null,
    },
  );
}

test("tool registry includes browser_agent when enabled", () => {
  const tools = createTools(["browser_agent"]);
  const toolNames = new Set(tools.map((tool) => tool.name));
  assert.equal(toolNames.has("browser_agent"), true);
});

test("browser_agent validates required scoped session format", async () => {
  const tools = createTools(["browser_agent"]);
  const tool = tools.find((entry) => entry.name === "browser_agent");
  assert.ok(tool, "browser_agent tool should be registered");

  const missingSession = await tool!.execute({ command: "snapshot" });
  assert.match(String(missingSession), /session is required/i);

  const invalidSession = await tool!.execute({
    session: "default",
    command: "snapshot",
  });
  assert.match(String(invalidSession), /browser:<usercontextid>:<conversationid>/i);
});

test("browser_agent blocks --session override in args", async () => {
  const tools = createTools(["browser_agent"]);
  const tool = tools.find((entry) => entry.name === "browser_agent");
  assert.ok(tool, "browser_agent tool should be registered");

  const output = await tool!.execute({
    session: "browser:user-a:thread-1",
    command: "snapshot",
    args: ["--session", "other"],
  });
  assert.match(String(output), /do not pass --session/i);

  const outputWithInlineValue = await tool!.execute({
    session: "browser:user-a:thread-1",
    command: "snapshot",
    args: ["--session=other"],
  });
  assert.match(String(outputWithInlineValue), /do not pass --session=other/i);
});

test("browser_agent rejects option-like commands", async () => {
  const tools = createTools(["browser_agent"]);
  const tool = tools.find((entry) => entry.name === "browser_agent");
  assert.ok(tool, "browser_agent tool should be registered");

  const output = await tool!.execute({
    session: "browser:user-a:thread-1",
    command: "--help",
  });
  assert.match(String(output), /command must match/i);
});
