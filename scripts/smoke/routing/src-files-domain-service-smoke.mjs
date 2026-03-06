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

const filesServiceModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "services",
  "files",
  "index.js",
)).href;

const { runFilesDomainService } = await import(filesServiceModulePath);

await run("P42-C1 files service enforces scoped context", async () => {
  const out = await runFilesDomainService({
    text: "list files",
    userContextId: "",
    conversationId: "",
    sessionKey: "",
  });
  assert.equal(out?.ok, false);
  assert.equal(out?.code, "files.context_missing");
  assert.equal(out?.route, "files");
});

await run("P42-C2 files service routes list operation through ls tool adapter", async () => {
  const out = await runFilesDomainService({
    text: "list files in .",
    userContextId: "files-user",
    conversationId: "files-thread",
    sessionKey: "agent:nova:hud:user:files-user:dm:files-thread",
    llmCtx: {
      runtimeTools: {
        async executeToolUse() {
          return { content: "f README.md\nf package.json\nd src" };
        },
      },
      availableTools: [{ name: "ls" }],
    },
  });
  assert.equal(out?.ok, true);
  assert.equal(out?.route, "files");
  assert.equal(out?.code, "files.list_ok");
  assert.equal(out?.provider, "tool_runtime");
  assert.equal(out?.telemetry?.toolName, "ls");
  assert.equal(String(out?.reply || "").includes("list result"), true);
});

await run("P42-C3 files service keeps unsupported prompts on lane", async () => {
  const out = await runFilesDomainService({
    text: "tell me a joke",
    userContextId: "files-user",
    conversationId: "files-thread",
    sessionKey: "agent:nova:hud:user:files-user:dm:files-thread",
    llmCtx: {},
  });
  assert.equal(out?.ok, true);
  assert.equal(out?.route, "files");
  assert.equal(out?.code, "files.unsupported_command");
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
