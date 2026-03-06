import assert from "node:assert/strict";

import { runGmailDomainService } from "../../../src/runtime/modules/services/gmail/index.js";

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

function buildLlmCtx(responsesByTool = {}) {
  return {
    runtimeTools: {
      async executeToolUse(toolUse) {
        const toolName = String(toolUse?.name || "");
        const response = responsesByTool[toolName];
        if (typeof response === "function") {
          return { content: JSON.stringify(await response(toolUse?.input || {})) };
        }
        return { content: JSON.stringify(response || { ok: false, errorCode: "NO_FIXTURE", safeMessage: "missing fixture" }) };
      },
    },
    availableTools: Object.keys(responsesByTool).map((name) => ({ name })),
    activeChatRuntime: { provider: "openai" },
  };
}

const baseCtx = {
  userContextId: "gmail-smoke-user",
  conversationId: "gmail-smoke-thread",
  sessionKey: "agent:nova:hud:user:gmail-smoke-user:dm:gmail-smoke-thread",
};

await run("GMAIL-DOM-1 gmail service returns scoped capabilities summary from runtime tools", async () => {
  const out = await runGmailDomainService({
    text: "gmail status",
    ctx: baseCtx,
    llmCtx: buildLlmCtx({
      gmail_capabilities: {
        ok: true,
        data: {
          connected: true,
          email: "user@example.com",
          scopes: ["gmail.readonly"],
          missingScopes: [],
        },
      },
    }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.route, "gmail");
  assert.equal(out.responseRoute, "gmail");
  assert.equal(out.telemetry.userContextId, "gmail-smoke-user");
  assert.equal(String(out.reply || "").includes("Gmail status: connected."), true);
  assert.deepEqual(out.toolCalls, ["gmail_capabilities"]);
});

await run("GMAIL-DOM-2 gmail service lists unread messages through gmail tool adapter", async () => {
  let observedQuery = "";
  const out = await runGmailDomainService({
    text: "show my unread emails",
    ctx: baseCtx,
    llmCtx: buildLlmCtx({
      gmail_list_messages: async (input) => {
        observedQuery = String(input?.query || "");
        return {
          ok: true,
          count: 2,
          messages: [
            { id: "msg-1", from: "ceo@example.com", subject: "Quarterly plan" },
            { id: "msg-2", from: "ops@example.com", subject: "Incident follow-up" },
          ],
        };
      },
    }),
  });

  assert.equal(out.ok, true);
  assert.equal(observedQuery, "is:unread newer_than:14d");
  assert.equal(String(out.reply || "").includes("Quarterly plan"), true);
  assert.deepEqual(out.toolCalls, ["gmail_list_messages"]);
});

await run("GMAIL-DOM-3 gmail draft prompts stay on-lane with explicit confirmation requirements", async () => {
  const out = await runGmailDomainService({
    text: "draft reply to message abc12345: Thanks, I will handle this today.",
    ctx: baseCtx,
    llmCtx: buildLlmCtx({}),
  });

  assert.equal(out.ok, true);
  assert.equal(String(out.code || ""), "gmail.confirm_required");
  assert.equal(out.requestHints?.gmailPendingAction, "reply_draft");
  assert.equal(out.requestHints?.gmailMessageId, "abc12345");
  assert.equal(String(out.reply || "").includes("requires explicit approval flow"), true);
  assert.deepEqual(out.toolCalls, []);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
