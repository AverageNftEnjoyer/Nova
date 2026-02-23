import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

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

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function loadTelegramModule(harness) {
  const source = read("hud/lib/notifications/telegram.ts");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: "telegram.ts",
  }).outputText;

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier === "server-only") return {};
      if (specifier === "@/lib/integrations/server-store") {
        return {
          loadIntegrationsConfig: async () => harness.config,
        };
      }
      throw new Error(`Unexpected require in Telegram smoke harness: ${specifier}`);
    },
    process,
    console,
    Buffer,
    Headers,
    AbortController,
    fetch: (...args) => harness.fetchImpl(...args),
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(compiled, sandbox, { filename: "telegram.harness.cjs" });
  return module.exports;
}

const previousEnv = {
  NOVA_TELEGRAM_SEND_TIMEOUT_MS: process.env.NOVA_TELEGRAM_SEND_TIMEOUT_MS,
  NOVA_TELEGRAM_SEND_MAX_RETRIES: process.env.NOVA_TELEGRAM_SEND_MAX_RETRIES,
  NOVA_TELEGRAM_SEND_RETRY_BASE_MS: process.env.NOVA_TELEGRAM_SEND_RETRY_BASE_MS,
};
process.env.NOVA_TELEGRAM_SEND_TIMEOUT_MS = "5";
process.env.NOVA_TELEGRAM_SEND_MAX_RETRIES = "1";
process.env.NOVA_TELEGRAM_SEND_RETRY_BASE_MS = "1";

const harness = {
  config: {
    telegram: {
      connected: true,
      botToken: "test-token",
      chatIds: ["chat-alpha"],
    },
  },
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ ok: true }),
  }),
};

const { sendTelegramMessage } = loadTelegramModule(harness);

await run("P21-T1 Telegram HTML output preserves allowed tags and escapes unsafe markup", async () => {
  let capturedBody = null;
  harness.config = {
    telegram: {
      connected: true,
      botToken: "token-html",
      chatIds: ["chat-html"],
    },
  };
  harness.fetchImpl = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body || "{}"));
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
    };
  };

  const result = await sendTelegramMessage(
    {
      text: "<script>alert(1)</script><b>Bold</b> & <i>safe</i>",
      parseMode: "HTML",
    },
    { userId: "smoke-user-telegram" },
  );

  assert.equal(Array.isArray(result), true);
  assert.equal(result.length, 1);
  assert.equal(result[0].ok, true);
  assert.equal(typeof capturedBody?.text, "string");
  assert.equal(capturedBody.parse_mode, "HTML");
  assert.equal(capturedBody.text.includes("<script>"), false);
  assert.equal(capturedBody.text.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), true);
  assert.equal(capturedBody.text.includes("<b>Bold</b>"), true);
  assert.equal(capturedBody.text.includes("<i>safe</i>"), true);
  assert.equal(capturedBody.text.includes("&amp;"), true);
});

await run("P21-T2 Telegram retries after timeout abort and succeeds on retry", async () => {
  let callCount = 0;
  harness.config = {
    telegram: {
      connected: true,
      botToken: "token-timeout",
      chatIds: ["chat-timeout"],
    },
  };
  harness.fetchImpl = async (_url, init) => {
    callCount += 1;
    if (callCount === 1) {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted by timeout")));
      });
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
    };
  };

  const result = await sendTelegramMessage(
    {
      text: "retry please",
      chatIds: ["chat-timeout"],
    },
    { userId: "smoke-user-telegram" },
  );

  assert.equal(callCount, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0].ok, true);
});

await run("P21-T3 Telegram multi-chat returns partial failure matrix with deduped recipients", async () => {
  const seenChatIds = [];
  harness.config = {
    telegram: {
      connected: true,
      botToken: "token-matrix",
      chatIds: ["chat-a", "chat-b", "chat-a", "chat-c"],
    },
  };
  harness.fetchImpl = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const chatId = String(body.chat_id || "");
    seenChatIds.push(chatId);
    if (chatId === "chat-b") {
      return {
        ok: false,
        status: 400,
        headers: new Headers(),
        json: async () => ({ description: "Bad Request: chat not found" }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
    };
  };

  const result = await sendTelegramMessage(
    {
      text: "matrix run",
    },
    { userId: "smoke-user-telegram" },
  );

  assert.deepEqual(seenChatIds, ["chat-a", "chat-b", "chat-c"]);
  assert.equal(result.length, 3);
  assert.equal(result.filter((row) => row.ok).length, 2);
  assert.equal(result.filter((row) => !row.ok).length, 1);
  const failure = result.find((row) => !row.ok);
  assert.equal(failure?.chatId, "chat-b");
  assert.equal(String(failure?.error || "").includes("chat not found"), true);
});

if (typeof previousEnv.NOVA_TELEGRAM_SEND_TIMEOUT_MS === "string") {
  process.env.NOVA_TELEGRAM_SEND_TIMEOUT_MS = previousEnv.NOVA_TELEGRAM_SEND_TIMEOUT_MS;
} else {
  delete process.env.NOVA_TELEGRAM_SEND_TIMEOUT_MS;
}
if (typeof previousEnv.NOVA_TELEGRAM_SEND_MAX_RETRIES === "string") {
  process.env.NOVA_TELEGRAM_SEND_MAX_RETRIES = previousEnv.NOVA_TELEGRAM_SEND_MAX_RETRIES;
} else {
  delete process.env.NOVA_TELEGRAM_SEND_MAX_RETRIES;
}
if (typeof previousEnv.NOVA_TELEGRAM_SEND_RETRY_BASE_MS === "string") {
  process.env.NOVA_TELEGRAM_SEND_RETRY_BASE_MS = previousEnv.NOVA_TELEGRAM_SEND_RETRY_BASE_MS;
} else {
  delete process.env.NOVA_TELEGRAM_SEND_RETRY_BASE_MS;
}

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
