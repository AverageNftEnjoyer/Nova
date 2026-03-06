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

const webResearchServiceModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "services",
  "web-research",
  "index.js",
)).href;

const { runWebResearchDomainService } = await import(webResearchServiceModulePath);

await run("P41-C1 web research service enforces scoped context", async () => {
  const out = await runWebResearchDomainService({
    text: "research ai news",
    userContextId: "",
    conversationId: "",
    sessionKey: "",
  });

  assert.equal(out?.ok, false);
  assert.equal(out?.code, "web_research.context_missing");
  assert.equal(out?.route, "web_research");
});

await run("P41-C2 web research service runs web_search through provider adapter", async () => {
  const out = await runWebResearchDomainService({
    text: "research latest ai model releases",
    userContextId: "wr-user",
    conversationId: "wr-thread",
    sessionKey: "agent:nova:hud:user:wr-user:dm:wr-thread",
    llmCtx: {
      runtimeTools: {
        async executeToolUse() {
          return {
            content: "[1] OpenAI Research Update\nhttps://example.com/openai\nNew model updates.\n\n[2] AI News Daily\nhttps://example.com/ai-news\nIndustry roundup.",
          };
        },
      },
      availableTools: [{ name: "web_search" }],
    },
  });

  assert.equal(out?.ok, true);
  assert.equal(out?.route, "web_research");
  assert.equal(out?.provider, "web_search");
  assert.equal(out?.telemetry?.resultCount, 2);
  assert.equal(Array.isArray(out?.researchResults), true);
  assert.equal(out?.researchResults?.length, 2);
  assert.equal(String(out?.reply || "").includes("Web research summary"), true);
});

await run("P41-C3 web research unsupported prompts stay on lane with deterministic guidance", async () => {
  const out = await runWebResearchDomainService({
    text: "play spotify",
    userContextId: "wr-user",
    conversationId: "wr-thread",
    sessionKey: "agent:nova:hud:user:wr-user:dm:wr-thread",
    llmCtx: {},
  });

  assert.equal(out?.ok, true);
  assert.equal(out?.route, "web_research");
  assert.equal(out?.code, "web_research.unsupported_command");
  assert.equal(String(out?.reply || "").includes("Web research can search current sources"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
