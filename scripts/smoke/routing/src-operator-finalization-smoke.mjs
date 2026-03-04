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

const finalizationModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler", "operator-finalization", "index.js")).href,
);
const { deriveHandleInputRuntimeContext, finalizeHandleInputTurn } = finalizationModule;

await run("P21-C1 derive context resolves user/session/conversation fields", async () => {
  const context = deriveHandleInputRuntimeContext(
    {
      opts: {
        sessionKeyHint: "agent:nova:hud:user:user-1:dm:thread-1",
        nlpBypass: true,
      },
      source: "hud",
    },
    {
      sessionRuntime: {
        resolveUserContextId: () => "user-1",
      },
      resolveConversationId: () => "thread-1",
    },
  );
  assert.equal(context.userContextId, "user-1");
  assert.equal(context.sessionKey, "agent:nova:hud:user:user-1:dm:thread-1");
  assert.equal(context.conversationId, "thread-1");
  assert.equal(context.nlpBypass, true);
});

await run("P21-C2 finalize stamps org-chart hints and writes normalized dev log payload", async () => {
  const result = {
    route: "chat",
    ok: true,
    reply: "hello world",
    provider: "openai",
    model: "gpt-5",
    latencyMs: 24,
    toolCalls: [],
  };
  let appendedPayload = null;
  let shadowPayload = null;
  finalizeHandleInputTurn(
    {
      startedAt: Date.now() - 100,
      userInputText: "hello",
      source: "hud",
      sender: "hud-user",
      runtimeContext: {
        userContextId: "user-1",
        conversationId: "thread-1",
        sessionKey: "agent:nova:hud:user:user-1:dm:thread-1",
        nlpBypass: false,
      },
      result,
      caughtError: null,
    },
    {
      ensureSummaryRequestHintsWithOrgChart: (_summary, hints) => ({
        ...hints,
        orgChartPath: { operatorId: "nova-operator" },
      }),
      appendDevConversationLog: (payload) => {
        appendedPayload = payload;
      },
      normalizeInboundUserText: (text) => `normalized:${String(text || "")}`,
      runChatKitShadowEvaluation: async (payload) => {
        shadowPayload = payload;
      },
      describeUnknownError: (err) => String(err?.message || err || ""),
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(result.requestHints?.orgChartPath?.operatorId, "nova-operator");
  assert.equal(appendedPayload?.route, "chat");
  assert.equal(appendedPayload?.cleanedInputText, "normalized:hello");
  assert.equal(appendedPayload?.requestHints?.orgChartPath?.operatorId, "nova-operator");
  assert.equal(shadowPayload?.baselineOk, true);
});

await run("P21-C3 finalize error fallback logs unclassified route with mapped error", async () => {
  let appendedPayload = null;
  finalizeHandleInputTurn(
    {
      startedAt: Date.now() - 80,
      userInputText: "test",
      source: "hud",
      sender: "hud-user",
      runtimeContext: {
        userContextId: "user-2",
        conversationId: "thread-2",
        sessionKey: "agent:nova:hud:user:user-2:dm:thread-2",
        nlpBypass: true,
      },
      result: null,
      caughtError: new Error("boom"),
    },
    {
      ensureSummaryRequestHintsWithOrgChart: () => ({}),
      appendDevConversationLog: (payload) => {
        appendedPayload = payload;
      },
      normalizeInboundUserText: (text) => String(text || ""),
      runChatKitShadowEvaluation: async () => {},
      describeUnknownError: (err) => `mapped:${String(err?.message || err || "")}`,
    },
  );
  assert.equal(appendedPayload?.route, "unclassified");
  assert.equal(appendedPayload?.ok, false);
  assert.equal(appendedPayload?.error, "mapped:boom");
  assert.equal(appendedPayload?.nlpBypass, true);
});

await run("P21-C4 shadow evaluation rejection is swallowed by finalizer", async () => {
  let invoked = false;
  finalizeHandleInputTurn(
    {
      startedAt: Date.now() - 40,
      userInputText: "shadow",
      source: "hud",
      sender: "hud-user",
      runtimeContext: {
        userContextId: "user-3",
        conversationId: "thread-3",
        sessionKey: "agent:nova:hud:user:user-3:dm:thread-3",
        nlpBypass: false,
      },
      result: { route: "chat", ok: true, reply: "ok" },
      caughtError: null,
    },
    {
      ensureSummaryRequestHintsWithOrgChart: () => ({}),
      appendDevConversationLog: () => {},
      normalizeInboundUserText: (text) => String(text || ""),
      runChatKitShadowEvaluation: async () => {
        invoked = true;
        throw new Error("shadow-fail");
      },
      describeUnknownError: (err) => String(err?.message || err || ""),
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(invoked, true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
