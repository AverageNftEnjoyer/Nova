import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const results = [];
const requireCjs = createRequire(import.meta.url);

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

function transpileAndLoad(relativePath, requireMap, extraGlobals = {}) {
  const source = read(relativePath);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: path.basename(relativePath),
  }).outputText;

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier in requireMap) return requireMap[specifier];
      if (specifier === "server-only") return {};
      if (specifier.startsWith("node:")) return requireCjs(specifier);
      throw new Error(`Unexpected require for ${relativePath}: ${specifier}`);
    },
    process,
    console,
    Buffer,
    URL,
    Headers,
    Request,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    ...extraGlobals,
  };
  vm.runInNewContext(compiled, sandbox, { filename: `${relativePath}.cjs` });
  return module.exports;
}

const envBackup = {
  NOVA_DISCORD_SEND_TIMEOUT_MS: process.env.NOVA_DISCORD_SEND_TIMEOUT_MS,
  NOVA_DISCORD_SEND_MAX_RETRIES: process.env.NOVA_DISCORD_SEND_MAX_RETRIES,
  NOVA_DISCORD_SEND_RETRY_BASE_MS: process.env.NOVA_DISCORD_SEND_RETRY_BASE_MS,
  NOVA_DISCORD_SEND_RETRY_JITTER_MS: process.env.NOVA_DISCORD_SEND_RETRY_JITTER_MS,
  NOVA_DISCORD_SEND_CONCURRENCY: process.env.NOVA_DISCORD_SEND_CONCURRENCY,
  NOVA_DISCORD_MAX_TARGETS: process.env.NOVA_DISCORD_MAX_TARGETS,
  NOVA_DISCORD_SEND_DISABLED: process.env.NOVA_DISCORD_SEND_DISABLED,
};

process.env.NOVA_DISCORD_SEND_TIMEOUT_MS = "10";
process.env.NOVA_DISCORD_SEND_MAX_RETRIES = "2";
process.env.NOVA_DISCORD_SEND_RETRY_BASE_MS = "1";
process.env.NOVA_DISCORD_SEND_RETRY_JITTER_MS = "2";
process.env.NOVA_DISCORD_SEND_CONCURRENCY = "2";
process.env.NOVA_DISCORD_MAX_TARGETS = "8";
process.env.NOVA_DISCORD_SEND_DISABLED = "0";

const discordHarness = {
  configByUser: new Map(),
  fetchImpl: async () => ({
    ok: true,
    status: 204,
    headers: new Headers(),
    text: async () => "",
  }),
};

const discordModule = transpileAndLoad(
  "hud/lib/notifications/discord.ts",
  {
    "@/lib/integrations/server-store": {
      loadIntegrationsConfig: async (scope) => {
        const userId = String(scope?.userId || scope?.user?.id || "").trim();
        if (discordHarness.configByUser.has(userId)) return discordHarness.configByUser.get(userId);
        return {
          discord: {
            connected: true,
            webhookUrls: [],
          },
        };
      },
    },
  },
  {
    fetch: (...args) => discordHarness.fetchImpl(...args),
  },
);

const {
  sendDiscordMessage,
  isValidDiscordWebhookUrl,
  isRetryableDiscordStatus,
  computeDeliverySummary,
  redactWebhookTarget,
} = discordModule;

await run("P22-D1 unit validator rejects bad domains/protocol/private IP and accepts canonical webhook URL", async () => {
  assert.equal(isValidDiscordWebhookUrl("https://discord.com/api/webhooks/123456/abc-Token_ok"), true);
  assert.equal(isValidDiscordWebhookUrl("http://discord.com/api/webhooks/123456/abc"), false);
  assert.equal(isValidDiscordWebhookUrl("https://example.com/api/webhooks/123456/abc"), false);
  assert.equal(isValidDiscordWebhookUrl("https://127.0.0.1/api/webhooks/123456/abc"), false);
  assert.equal(isValidDiscordWebhookUrl("https://discord.com/api/not-webhooks/123456/abc"), false);
});

await run("P22-D2 unit retry classifier treats 429/5xx as retryable and 4xx as non-retryable", async () => {
  assert.equal(isRetryableDiscordStatus(429), true);
  assert.equal(isRetryableDiscordStatus(503), true);
  assert.equal(isRetryableDiscordStatus(500), true);
  assert.equal(isRetryableDiscordStatus(404), false);
  assert.equal(isRetryableDiscordStatus(400), false);
});

await run("P22-D3 unit partial delivery status computes all-target vs partial outcomes", async () => {
  const allSuccess = computeDeliverySummary([{ webhookId: "w1", ok: true, status: 204 }]);
  const partial = computeDeliverySummary([
    { webhookId: "w1", ok: true, status: 204 },
    { webhookId: "w2", ok: false, status: 429, error: "rate" },
  ]);
  const allFailed = computeDeliverySummary([{ webhookId: "w1", ok: false, status: 500, error: "boom" }]);
  assert.equal(allSuccess.status, "all_succeeded");
  assert.equal(partial.status, "partial");
  assert.equal(partial.okCount, 1);
  assert.equal(partial.failCount, 1);
  assert.equal(allFailed.status, "all_failed");
});

await run("P22-D4 unit integrations store encrypts/decrypts Discord webhook URLs at rest", async () => {
  const storeSource = read("hud/lib/integrations/server-store.ts");
  assert.equal(
    storeSource.includes("raw.discord.webhookUrls.map((url) => unwrapStoredSecret(url))"),
    true,
  );
  assert.equal(
    storeSource.includes("webhookUrls: config.discord.webhookUrls.map((url) => wrapStoredSecret(url)).filter(Boolean)"),
    true,
  );
});

await run("P22-D5 failure timeout path handles hung Discord endpoint without deadlock", async () => {
  const target = "https://discord.com/api/webhooks/101/timeout-token";
  discordHarness.configByUser.set("user-timeout", {
    discord: {
      connected: true,
      webhookUrls: [target],
    },
  });
  let calls = 0;
  discordHarness.fetchImpl = async (_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("timeout-abort")));
    });
  };

  const rows = await sendDiscordMessage({ text: "timeout test" }, { userId: "user-timeout" });
  assert.equal(calls >= 1, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].status, 0);
});

await run("P22-D6 failure retry/backoff+jitter under 429 succeeds on later attempt", async () => {
  const target = "https://discord.com/api/webhooks/102/rate-limit-token";
  discordHarness.configByUser.set("user-429", {
    discord: {
      connected: true,
      webhookUrls: [target],
    },
  });
  let calls = 0;
  discordHarness.fetchImpl = async () => {
    calls += 1;
    if (calls < 3) {
      return {
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "0" }),
        text: async () => "rate limited",
      };
    }
    return {
      ok: true,
      status: 204,
      headers: new Headers(),
      text: async () => "",
    };
  };

  const rows = await sendDiscordMessage({ text: "retry test" }, { userId: "user-429" });
  assert.equal(calls, 3);
  assert.equal(rows[0].ok, true);
  assert.equal(Number(rows[0].attempts || 0) >= 3, true);
});

await run("P22-D7 failure burst target send respects concurrency cap and dedupes duplicate webhook URLs", async () => {
  process.env.NOVA_DISCORD_SEND_CONCURRENCY = "2";
  const targets = [
    "https://discord.com/api/webhooks/201/a",
    "https://discord.com/api/webhooks/202/b",
    "https://discord.com/api/webhooks/203/c",
    "https://discord.com/api/webhooks/201/a",
  ];
  discordHarness.configByUser.set("user-burst", {
    discord: {
      connected: true,
      webhookUrls: targets,
    },
  });
  let inFlight = 0;
  let maxInFlight = 0;
  const seen = [];
  discordHarness.fetchImpl = async (url) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    seen.push(String(url));
    await new Promise((resolve) => setTimeout(resolve, 8));
    inFlight -= 1;
    return {
      ok: true,
      status: 204,
      headers: new Headers(),
      text: async () => "",
    };
  };

  const rows = await sendDiscordMessage({ text: "burst test" }, { userId: "user-burst" });
  assert.equal(rows.length, 3);
  assert.equal(maxInFlight <= 2, true);
  assert.equal(new Set(seen).size, 3);
});

await run("P22-D8 failure invalid secret or disabled integration blocks send", async () => {
  discordHarness.configByUser.set("user-disabled", {
    discord: {
      connected: false,
      webhookUrls: ["https://discord.com/api/webhooks/301/abc"],
    },
  });
  await assert.rejects(
    () => sendDiscordMessage({ text: "blocked" }, { userId: "user-disabled" }),
    /disabled/i,
  );
});

await run("P22-D9 failure stale/rotated webhook URL returns per-target error and remains isolated", async () => {
  discordHarness.configByUser.set("user-rotated", {
    discord: {
      connected: true,
      webhookUrls: ["https://discord.com/api/webhooks/401/stale-token"],
    },
  });
  discordHarness.fetchImpl = async () => ({
    ok: false,
    status: 404,
    headers: new Headers(),
    text: async () => "unknown webhook",
  });
  const rows = await sendDiscordMessage({ text: "rotated token" }, { userId: "user-rotated" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].status, 404);
  assert.equal(rows[0].retryable, false);
});

await run("P22-D10 failure cross-user isolation prevents user A send from using user B Discord config", async () => {
  const aUrl = "https://discord.com/api/webhooks/501/a-token";
  const bUrl = "https://discord.com/api/webhooks/502/b-token";
  discordHarness.configByUser.set("user-a", {
    discord: {
      connected: true,
      webhookUrls: [aUrl],
    },
  });
  discordHarness.configByUser.set("user-b", {
    discord: {
      connected: true,
      webhookUrls: [bUrl],
    },
  });
  const seen = [];
  discordHarness.fetchImpl = async (url) => {
    seen.push(String(url));
    return {
      ok: true,
      status: 204,
      headers: new Headers(),
      text: async () => "",
    };
  };

  await sendDiscordMessage({ text: "for A only" }, { user: { id: "user-a" } });
  assert.deepEqual(seen, [aUrl]);
});

await run("P22-D11 integration PATCH /api/integrations/config rejects invalid Discord URLs and invalid enable states", async () => {
  const configRoute = transpileAndLoad("hud/app/api/integrations/config/route.ts", {
    "next/server": {
      NextResponse: {
        json: (body, init = {}) =>
          new Response(JSON.stringify(body), {
            status: Number(init.status || 200),
            headers: { "Content-Type": "application/json" },
          }),
      },
    },
    "@/lib/integrations/server-store": {
      loadIntegrationsConfig: async () => ({
        telegram: { connected: false, botToken: "", chatIds: [] },
        discord: { connected: false, webhookUrls: [] },
        brave: { connected: false, apiKey: "" },
        coinbase: {
          connected: false, apiKey: "", apiSecret: "", connectionMode: "api_key_pair", requiredScopes: [],
          lastSyncAt: "", lastSyncStatus: "never", lastSyncErrorCode: "none", lastSyncErrorMessage: "",
          lastFreshnessMs: 0, reportTimezone: "America/New_York", reportCurrency: "USD", reportCadence: "daily",
        },
        openai: { connected: false, apiKey: "", baseUrl: "", defaultModel: "" },
        claude: { connected: false, apiKey: "", baseUrl: "", defaultModel: "" },
        grok: { connected: false, apiKey: "", baseUrl: "", defaultModel: "" },
        gemini: { connected: false, apiKey: "", baseUrl: "", defaultModel: "" },
        gmail: {
          connected: false, email: "", scopes: [], accounts: [], activeAccountId: "",
          oauthClientId: "", oauthClientSecret: "", redirectUri: "", accessTokenEnc: "", refreshTokenEnc: "", tokenExpiry: 0,
        },
        activeLlmProvider: "openai",
        agents: {},
        updatedAt: new Date().toISOString(),
      }),
      updateIntegrationsConfig: async (next) => ({ ...next, updatedAt: new Date().toISOString() }),
    },
    "@/lib/integrations/agent-runtime-sync": { syncAgentRuntimeIntegrationsSnapshot: async () => {} },
    "@/lib/coinbase/reporting": {
      createCoinbaseStore: async () => ({ purgeUserData: () => ({}), appendAuditLog: () => {}, close: () => {} }),
    },
    "@/lib/supabase/server": {
      requireSupabaseApiUser: async () => ({ verified: { user: { id: "discord-smoke-user" } }, unauthorized: null }),
    },
    "@/lib/workspace/root": {
      resolveWorkspaceRoot: () => process.cwd(),
    },
    "@/lib/notifications/discord": {
      isValidDiscordWebhookUrl,
      redactWebhookTarget,
    },
  });

  const invalidUrlReq = new Request("http://localhost/api/integrations/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ discord: { connected: true, webhookUrls: "https://evil.example/webhook" } }),
  });
  const invalidUrlRes = await configRoute.PATCH(invalidUrlReq);
  assert.equal(invalidUrlRes.status, 400);

  const invalidEnableReq = new Request("http://localhost/api/integrations/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ discord: { connected: true, webhookUrls: "" } }),
  });
  const invalidEnableRes = await configRoute.PATCH(invalidEnableReq);
  assert.equal(invalidEnableRes.status, 400);
});

await run("P22-D12 integration POST /api/integrations/test-discord redacts target identifiers", async () => {
  const routeModule = transpileAndLoad("hud/app/api/integrations/test-discord/route.ts", {
    "next/server": {
      NextResponse: {
        json: (body, init = {}) =>
          new Response(JSON.stringify(body), {
            status: Number(init.status || 200),
            headers: { "Content-Type": "application/json" },
          }),
      },
    },
    "@/lib/supabase/server": {
      requireSupabaseApiUser: async () => ({ verified: { user: { id: "discord-smoke-user" } }, unauthorized: null }),
    },
    "@/lib/security/rate-limit": {
      RATE_LIMIT_POLICIES: {
        integrationModelProbe: { windowMs: 60_000, max: 10 },
      },
      checkUserRateLimit: () => ({ allowed: true }),
      rateLimitExceededResponse: () => new Response("too many", { status: 429 }),
    },
    "@/lib/notifications/discord": {
      sendDiscordMessage: async () => [
        {
          webhookId: "discord:webhook:123***456",
          ok: true,
          status: 204,
          error: undefined,
          attempts: 1,
          retryable: false,
        },
      ],
    },
  });

  const res = await routeModule.POST(new Request("http://localhost/api/integrations/test-discord", { method: "POST" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(Array.isArray(body.results), true);
  assert.equal(String(JSON.stringify(body.results)).includes("https://discord.com/api/webhooks"), false);
  assert.equal(String(body.results[0].webhookId || "").startsWith("discord:webhook:"), true);
});

await run("P22-D13 integration mission workflow preserves per-target Discord outcomes", async () => {
  const executionSource = read("hud/lib/missions/workflow/execute-mission.ts");
  const outputExecutorSource = read("hud/lib/missions/workflow/executors/output-executors.ts");
  const dispatchSource = read("hud/lib/missions/output/dispatch.ts");
  assert.equal(dispatchSource.includes("dispatchNotification"), true);
  assert.equal(dispatchSource.includes("return await dispatchNotification"), true);
  assert.equal(outputExecutorSource.includes("data: results"), true);
  assert.equal(outputExecutorSource.includes('const first = results[0] ?? { ok: false, error: "No result returned" }'), true);
  assert.equal(executionSource.includes("outputs.push({ ok: output.ok, error: output.error, status: undefined })"), true);
  assert.equal(executionSource.includes("outputs.length === 0 || outputs.some((o) => o.ok)"), true);
});

await run("P22-D14 integration scheduler outage safeguards keep tick loop alive", async () => {
  const schedulerSource = read("hud/lib/notifications/scheduler.ts");
  assert.equal(schedulerSource.includes("if (state.tickInFlight)"), true);
  assert.equal(schedulerSource.includes("state.tickInFlight = false"), true);
  assert.equal(schedulerSource.includes("try {"), true);
  assert.equal(schedulerSource.includes("catch (error)"), true);
});

for (const key of Object.keys(envBackup)) {
  if (typeof envBackup[key] === "string") {
    process.env[key] = envBackup[key];
  } else {
    delete process.env[key];
  }
}

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
