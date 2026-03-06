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

const dispatchModule = await import(
  pathToFileURL(path.join(
    process.cwd(),
    "src",
    "runtime",
    "modules",
    "chat",
    "core",
    "chat-handler",
    "operator-dispatch-routing",
    "index.js",
  )).href,
);
const serviceModule = await import(
  pathToFileURL(path.join(
    process.cwd(),
    "src",
    "runtime",
    "modules",
    "services",
    "telegram",
    "index.js",
  )).href,
);
const { routeOperatorDispatch } = dispatchModule;
const { runTelegramDomainService } = serviceModule;

await run("P31-T1 telegram lane stress preserves userContext isolation across concurrent runs", async () => {
  const updates = [];
  const serviceCalls = [];
  const integrationStateByUser = new Map([
    ["tenant-a", { connected: true, providerId: "telegram-bot-api", apiBaseUrl: "https://tg-a.example", botToken: "token-a", chatIds: ["1001"] }],
    ["tenant-b", { connected: true, providerId: "telegram-bot-api", apiBaseUrl: "https://tg-b.example", botToken: "token-b", chatIds: ["2002"] }],
  ]);

  const adapterRegistry = {
    "telegram-bot-api": {
      id: "telegram-bot-api",
      async sendMessage(input = {}) {
        return {
          ok: true,
          status: 200,
          attempts: 1,
          responseBody: { ok: true, result: { message_id: Number(input.chatId) } },
        };
      },
      async getStatus() {
        return { ok: true, status: 200, attempts: 1, responseBody: { ok: true, result: { username: "bot" } } };
      },
    },
  };

  const makeInput = (userContextId, conversationId) => ({
    text: "send Telegram update: isolation test",
    ctx: {
      source: "hud",
      sender: "hud-user",
      userContextId,
      conversationId,
      sessionKey: `agent:nova:hud:user:${userContextId}:dm:${conversationId}`,
      useVoice: false,
    },
    llmCtx: {},
    requestHints: {},
    shouldRouteToTelegram: true,
    telegramShortTermFollowUp: true,
    telegramPolicy: { resolveTopicAffinityId: () => "telegram_send" },
    telegramShortTermContext: null,
    telegramShortTermContextSnapshot: null,
    userContextId,
    conversationId,
    sessionKey: `agent:nova:hud:user:${userContextId}:dm:${conversationId}`,
    activeChatRuntime: { provider: "openai" },
    delegateToOrgChartWorker: async (payload) => await payload.run(),
    telegramWorker: async (text, ctx, _llmCtx, requestHints) => {
      serviceCalls.push({
        userContextId: ctx.userContextId,
        conversationId: ctx.conversationId,
      });
      const result = await runTelegramDomainService({
        text,
        userContextId: ctx.userContextId,
        conversationId: ctx.conversationId,
        sessionKey: ctx.sessionKey,
        requestHints,
      }, {
        integrationStateAdapter: {
          id: "telegram-integration-state-adapter",
          getState: (contextId) => integrationStateByUser.get(contextId),
        },
        adapterRegistry,
      });
      return {
        route: "telegram",
        responseRoute: "telegram",
        ok: result.ok,
        reply: result.reply,
        error: result.ok ? "" : result.code,
      };
    },
    executeChatRequest: async () => ({ route: "chat", ok: false }),
    upsertShortTermContextState: (payload) => updates.push(payload),
  });

  const [outA, outB] = await Promise.all([
    routeOperatorDispatch(makeInput("tenant-a", "thread-a")),
    routeOperatorDispatch(makeInput("tenant-b", "thread-b")),
  ]);

  assert.equal(outA.ok, true);
  assert.equal(outB.ok, true);
  assert.equal(updates.length, 2);
  assert.equal(updates[0]?.userContextId !== updates[1]?.userContextId, true);
  assert.equal(updates[0]?.conversationId !== updates[1]?.conversationId, true);
  assert.deepEqual(serviceCalls.map((entry) => entry.userContextId).sort(), ["tenant-a", "tenant-b"]);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
