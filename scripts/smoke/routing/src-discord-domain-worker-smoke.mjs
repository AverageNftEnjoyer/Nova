import assert from "node:assert/strict";
import fs from "node:fs";
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

const constantsModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "core", "constants", "index.js")).href,
);
const discordServiceModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "services", "discord", "index.js")).href,
);

const { USER_CONTEXT_ROOT } = constantsModule;
const { runDiscordDomainService } = discordServiceModule;

function writeScopedConfig(userContextId, discordConfig) {
  const scopedDir = path.join(USER_CONTEXT_ROOT, userContextId, "state");
  fs.mkdirSync(scopedDir, { recursive: true });
  fs.writeFileSync(
    path.join(scopedDir, "integrations-config.json"),
    JSON.stringify({ discord: discordConfig }, null, 2),
    "utf8",
  );
}

const createdUsers = [];
function trackUser(userContextId) {
  createdUsers.push(userContextId);
  return userContextId;
}

await run("P31-D1 Discord service enforces user-scoped isolation for webhook targets", async () => {
  const userA = trackUser("smoke-discord-user-a");
  const userB = trackUser("smoke-discord-user-b");
  const webhookA = "https://discord.com/api/webhooks/81001/tokenA";
  const webhookB = "https://discord.com/api/webhooks/81002/tokenB";
  writeScopedConfig(userA, { connected: true, webhookUrls: [webhookA] });
  writeScopedConfig(userB, { connected: true, webhookUrls: [webhookB] });

  const seen = [];
  const okResponse = {
    ok: true,
    status: 204,
    headers: new Headers(),
    text: async () => "",
  };
  await runDiscordDomainService({
    text: "ship status update",
    userContextId: userA,
    conversationId: "thread-a",
    sessionKey: "agent:nova:hud:user:smoke-discord-user-a:dm:thread-a",
    fetchImpl: async (url) => {
      seen.push(String(url));
      return okResponse;
    },
  });
  assert.deepEqual(seen, [webhookA]);
});

await run("P31-D2 Discord service redacts webhook secrets in validation errors", async () => {
  const user = trackUser("smoke-discord-redaction");
  writeScopedConfig(user, { connected: true, webhookUrls: ["https://discord.com/api/webhooks/82001/tokenC"] });
  const rawWebhook = "https://discord.com/api/webhooks/999999999/super-secret-token";
  const result = await runDiscordDomainService({
    text: "hello",
    userContextId: user,
    conversationId: "thread-redaction",
    sessionKey: "agent:nova:hud:user:smoke-discord-redaction:dm:thread-redaction",
    requestHints: {
      discord: {
        targets: [{ type: "webhook", webhookUrl: `${rawWebhook}/invalid` }],
      },
    },
  });
  assert.equal(result?.ok, false);
  assert.equal(result?.code, "discord_target_invalid_webhook");
  assert.equal(String(result?.message || "").includes("super-secret-token"), false);
  assert.equal(String(result?.message || "").includes("discord:webhook:"), true);
});

await run("P31-D3 Discord failure path is normalized with deterministic codes and redacted targets", async () => {
  const user = trackUser("smoke-discord-failure");
  const webhook = "https://discord.com/api/webhooks/83001/tokenD";
  writeScopedConfig(user, { connected: true, webhookUrls: [webhook] });
  const result = await runDiscordDomainService({
    text: "notify release",
    userContextId: user,
    conversationId: "thread-failure",
    sessionKey: "agent:nova:hud:user:smoke-discord-failure:dm:thread-failure",
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () => "unknown webhook",
    }),
  });
  assert.equal(result?.ok, false);
  assert.equal(result?.code, "discord_delivery_all_failed");
  assert.equal(Array.isArray(result?.meta?.errors), true);
  assert.equal(String(result?.meta?.errors?.[0]?.code || ""), "discord_provider_http_non_retryable");
  assert.equal(String(result?.meta?.errors?.[0]?.target || "").includes("tokenD"), false);
});

await run("P31-D4 Discord target validation enforces channel id format", async () => {
  const user = trackUser("smoke-discord-channel");
  writeScopedConfig(user, { connected: true, webhookUrls: [] });
  const result = await runDiscordDomainService({
    text: "post to channel",
    userContextId: user,
    conversationId: "thread-channel",
    sessionKey: "agent:nova:hud:user:smoke-discord-channel:dm:thread-channel",
    requestHints: {
      discord: {
        targets: [
          {
            type: "webhook",
            webhookUrl: "https://discord.com/api/webhooks/84001/tokenE",
            channelId: "channel-prod",
          },
        ],
      },
    },
  });
  assert.equal(result?.ok, false);
  assert.equal(result?.code, "discord_target_invalid_channel");
});

for (const user of createdUsers) {
  try {
    const scopedRoot = path.join(USER_CONTEXT_ROOT, user);
    if (fs.existsSync(scopedRoot)) fs.rmSync(scopedRoot, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors for smoke environment
  }
}

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);

