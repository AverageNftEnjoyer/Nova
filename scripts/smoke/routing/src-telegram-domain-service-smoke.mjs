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

const telegramServiceModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "services",
  "telegram",
  "index.js",
)).href;
const { runTelegramDomainService } = await import(telegramServiceModulePath);

await run("P31-C1 telegram service resolves config by userContextId without cross-user leakage", async () => {
  const resolverCalls = [];
  const loadIntegrationsState = async (userContextId) => {
    resolverCalls.push(String(userContextId));
    if (userContextId === "tenant-a") {
      return {
        connected: true,
        providerId: "telegram-bot-api",
        apiBaseUrl: "https://telegram-a.example",
        botToken: "token-a",
        chatIds: ["111"],
      };
    }
    return {
      connected: true,
      providerId: "telegram-bot-api",
      apiBaseUrl: "https://telegram-b.example",
      botToken: "token-b",
      chatIds: ["222"],
    };
  };
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

  const outA = await runTelegramDomainService({
    text: "send Telegram update: hello A",
    userContextId: "tenant-a",
    conversationId: "thread-a",
    sessionKey: "agent:nova:hud:user:tenant-a:dm:thread-a",
  }, { loadIntegrationsState, adapterRegistry });
  const outB = await runTelegramDomainService({
    text: "send Telegram update: hello B",
    userContextId: "tenant-b",
    conversationId: "thread-b",
    sessionKey: "agent:nova:hud:user:tenant-b:dm:thread-b",
  }, { loadIntegrationsState, adapterRegistry });

  assert.equal(outA.ok, true);
  assert.equal(outA.operations[0]?.chatId, "111");
  assert.equal(outA.context.userContextId, "tenant-a");
  assert.equal(outB.ok, true);
  assert.equal(outB.operations[0]?.chatId, "222");
  assert.equal(outB.context.userContextId, "tenant-b");
  assert.deepEqual(resolverCalls, ["tenant-a", "tenant-b"]);
});

await run("P31-C2 telegram service failure path returns normalized deterministic envelope", async () => {
  const out = await runTelegramDomainService({
    text: "send this to telegram",
    userContextId: "tenant-c",
    conversationId: "thread-c",
    sessionKey: "agent:nova:hud:user:tenant-c:dm:thread-c",
  }, {
    loadIntegrationsState: async () => ({
      connected: true,
      providerId: "telegram-bot-api",
      apiBaseUrl: "https://telegram-c.example",
      botToken: "token-c",
      chatIds: ["333"],
    }),
    adapterRegistry: {
      "telegram-bot-api": {
        id: "telegram-bot-api",
        async sendMessage() {
          return {
            ok: false,
            status: 429,
            attempts: 2,
            errorCode: "telegram.provider_rate_limited",
            errorMessage: "Too Many Requests",
          };
        },
        async getStatus() {
          return { ok: true, status: 200, attempts: 1, responseBody: { ok: true } };
        },
      },
    },
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "telegram.send_failed");
  assert.equal(out.route, "telegram");
  assert.equal(out.responseRoute, "telegram");
  assert.equal(typeof out.reply, "string");
  assert.equal(out.operations.length, 1);
  assert.equal(out.operations[0]?.errorCode, "telegram.provider_rate_limited");
  assert.equal(Number(out.telemetry?.attemptCount || 0) >= 2, true);
});

await run("P31-C3 telegram service uses integration-state adapter and redacts token-like provider errors", async () => {
  const integrationStateCalls = [];
  const botToken = "123456789:ABCDEF_TOKEN_EXAMPLE_1234567890";
  const out = await runTelegramDomainService({
    text: "send Telegram update: redact this",
    userContextId: "tenant-d",
    conversationId: "thread-d",
    sessionKey: "agent:nova:hud:user:tenant-d:dm:thread-d",
  }, {
    integrationStateAdapter: {
      id: "telegram-integration-state-adapter",
      getState: (userContextId) => {
        integrationStateCalls.push(String(userContextId));
        return {
          connected: true,
          providerId: "telegram-bot-api",
          apiBaseUrl: "https://telegram-d.example",
          botToken,
          chatIds: ["444"],
        };
      },
    },
    adapterRegistry: {
      "telegram-bot-api": {
        id: "telegram-bot-api",
        async sendMessage() {
          return {
            ok: false,
            status: 500,
            attempts: 1,
            errorCode: "telegram.provider_unavailable",
            errorMessage: `request to https://telegram-d.example/bot${botToken}/sendMessage failed`,
          };
        },
        async getStatus() {
          return { ok: true, status: 200, attempts: 1, responseBody: { ok: true } };
        },
      },
    },
  });

  assert.deepEqual(integrationStateCalls, ["tenant-d"]);
  assert.equal(out.ok, false);
  assert.equal(out.operations.length, 1);
  assert.equal(out.operations[0]?.errorMessage.includes(botToken), false);
  assert.equal(out.operations[0]?.errorMessage.includes("telegram:bot-token"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
