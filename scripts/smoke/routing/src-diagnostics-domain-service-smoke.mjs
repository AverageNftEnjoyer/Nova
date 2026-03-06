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

const diagnosticsServiceModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "services",
  "diagnostics",
  "index.js",
)).href;

const { runDiagnosticsDomainService } = await import(diagnosticsServiceModulePath);

await run("P40-C1 diagnostics domain service enforces scoped context", async () => {
  const out = await runDiagnosticsDomainService({
    text: "run diagnostics",
    userContextId: "",
    conversationId: "",
    sessionKey: "",
  });

  assert.equal(out?.ok, false);
  assert.equal(out?.code, "diagnostics.context_missing");
  assert.equal(out?.route, "diagnostic");
  assert.equal(out?.responseRoute, "diagnostic");
});

await run("P40-C2 diagnostics status command returns runtime snapshot on-lane", async () => {
  const out = await runDiagnosticsDomainService({
    text: "run diagnostics",
    userContextId: "diag-user",
    conversationId: "diag-thread",
    sessionKey: "agent:nova:hud:user:diag-user:dm:diag-thread",
    llmCtx: {
      selectedChatModel: "gpt-5",
      activeChatRuntime: { provider: "openai" },
      canRunToolLoop: true,
      canRunWebSearch: true,
      canRunWebFetch: false,
      availableTools: [{ name: "web_search" }, { name: "file_read" }],
      turnPolicy: { likelyNeedsToolRuntime: true, likelyNeedsFreshInfo: true },
      executionPolicy: { canRunToolLoop: true, canRunWebSearch: true, canRunWebFetch: false, selectedToolCount: 2 },
      latencyTelemetry: { stages: { runtime_tool_init: 24, provider_select: 9 } },
    },
  });

  assert.equal(out?.ok, true);
  assert.equal(out?.route, "diagnostic");
  assert.equal(out?.code, "diagnostics.status_ok");
  assert.equal(out?.provider, "runtime_diagnostics");
  assert.equal(out?.telemetry?.userContextId, "diag-user");
  assert.equal(out?.diagnostics?.availableToolCount, 2);
  assert.equal(String(out?.reply || "").includes("Diagnostics runtime status"), true);
});

await run("P40-C3 diagnostics unsupported prompts stay on diagnostics lane", async () => {
  const out = await runDiagnosticsDomainService({
    text: "sing me a song",
    userContextId: "diag-user",
    conversationId: "diag-thread",
    sessionKey: "agent:nova:hud:user:diag-user:dm:diag-thread",
    llmCtx: {},
  });

  assert.equal(out?.ok, true);
  assert.equal(out?.route, "diagnostic");
  assert.equal(out?.code, "diagnostics.unsupported_command");
  assert.equal(String(out?.reply || "").includes("Diagnostics can report runtime status"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
