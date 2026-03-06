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

const remindersServiceModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "services",
  "reminders",
  "index.js",
)).href;
const followUpStateModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "services",
  "reminders",
  "follow-up-state",
  "index.js",
)).href;
const shortTermContextModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "chat",
  "core",
  "short-term-context-engine",
  "index.js",
)).href;

const { runRemindersDomainService } = await import(remindersServiceModulePath);
const followUpStateModule = await import(followUpStateModulePath);
const shortTermContextModule = await import(shortTermContextModulePath);

await run("P34-C1 reminders service handles primary create/update/remove path without generic delegation", async () => {
  let delegatedCalls = 0;
  const userContextId = "tenant-reminder-a";
  const conversationId = "thread-reminder-a";
  const sessionKey = "agent:nova:hud:user:tenant-reminder-a:dm:thread-reminder-a";

  const createOut = await runRemindersDomainService({
    text: "set a reminder to submit payroll at 5pm",
    userContextId,
    conversationId,
    sessionKey,
    requestHints: {
      remindersShortTermFollowUp: true,
    },
    executeChatRequest: async () => {
      delegatedCalls += 1;
      return { ok: true, route: "chat", reply: "delegated" };
    },
  });

  assert.equal(createOut.ok, true);
  assert.equal(createOut.route, "reminder");
  assert.equal(createOut.responseRoute, "reminder");
  assert.equal(createOut.followUpState?.persistent, true);
  assert.equal(createOut.telemetry.userContextId, userContextId);
  assert.equal(createOut.telemetry.conversationId, conversationId);
  assert.equal(String(createOut.code || "").startsWith("reminders.create_"), true);

  const updateOut = await runRemindersDomainService({
    text: "update reminder to submit payroll at 6pm",
    userContextId,
    conversationId,
    sessionKey,
    executeChatRequest: async () => {
      delegatedCalls += 1;
      return { ok: true, route: "chat", reply: "delegated" };
    },
  });
  assert.equal(updateOut.ok, true);
  assert.equal(String(updateOut.code || "").startsWith("reminders.update_"), true);

  const removeOut = await runRemindersDomainService({
    text: "cancel this reminder",
    userContextId,
    conversationId,
    sessionKey,
    executeChatRequest: async () => {
      delegatedCalls += 1;
      return { ok: true, route: "chat", reply: "delegated" };
    },
  });
  assert.equal(removeOut.ok, true);
  assert.equal(String(removeOut.code || "").startsWith("reminders.remove_"), true);
  assert.equal(delegatedCalls, 0);
});

await run("P34-C1b reminders service keeps unknown prompts on-lane without delegated fallback", async () => {
  let delegatedCalls = 0;
  const out = await runRemindersDomainService({
    text: "help me think through my priorities this afternoon",
    userContextId: "tenant-reminder-a",
    conversationId: "thread-reminder-a",
    sessionKey: "agent:nova:hud:user:tenant-reminder-a:dm:thread-reminder-a",
    ctx: {
      userContextId: "tenant-reminder-a",
      conversationId: "thread-reminder-a",
      sessionKey: "agent:nova:hud:user:tenant-reminder-a:dm:thread-reminder-a",
    },
    llmCtx: {
      activeChatRuntime: {
        provider: "openai",
      },
    },
    requestHints: {},
    executeChatRequest: async () => {
      delegatedCalls += 1;
      return {
        ok: true,
        route: "reminder",
        responseRoute: "reminder",
        reply: "Delegated reminder planning response.",
      };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.route, "reminder");
  assert.equal(out.responseRoute, "reminder");
  assert.equal(String(out.code || ""), "reminders.unsupported_prompt");
  assert.equal(out.requestHints?.remindersUnsupportedPrompt, true);
  assert.equal(String(out.reply || "").includes("I can create, update, remove, or show reminders"), true);
  assert.equal(delegatedCalls, 0);
});

await run("P34-C2 shared short-term context engine persists reminder follow-up state across fresh module load", async () => {
  const userContextId = `smoke-reminders-${Date.now()}`;
  const conversationId = "thread-reminder-persist";

  const firstWrite = shortTermContextModule.upsertShortTermContextState({
    userContextId,
    conversationId,
    domainId: "reminders",
    topicAffinityId: "reminder_create",
    slots: {
      reminderId: "r-100",
      lastUserText: "set a reminder for 5pm",
    },
  });
  assert.equal(firstWrite?.slots?.reminderId, "r-100");

  const reloadedModule = await import(`${shortTermContextModulePath}?reload=${Date.now()}`);
  const reloadedRead = reloadedModule.readShortTermContextState({
    userContextId,
    conversationId,
    domainId: "reminders",
  });
  assert.equal(reloadedRead?.topicAffinityId, "reminder_create");
  assert.equal(reloadedRead?.slots?.reminderId, "r-100");
});

await run("P34-C3 reminder follow-up state is user-scoped and stored under the user state directory", async () => {
  const userA = `smoke-reminders-${Date.now()}-a`;
  const userB = `smoke-reminders-${Date.now()}-b`;
  const conversationId = "thread-shared";

  shortTermContextModule.upsertShortTermContextState({
    userContextId: userA,
    conversationId,
    domainId: "reminders",
    topicAffinityId: "reminder_update",
    slots: { reminderId: "rem-a" },
  });
  shortTermContextModule.upsertShortTermContextState({
    userContextId: userB,
    conversationId,
    domainId: "reminders",
    topicAffinityId: "reminder_remove",
    slots: { reminderId: "rem-b" },
  });

  const readA = shortTermContextModule.readShortTermContextState({
    userContextId: userA,
    conversationId,
    domainId: "reminders",
  });
  const readB = shortTermContextModule.readShortTermContextState({
    userContextId: userB,
    conversationId,
    domainId: "reminders",
  });
  const storePathA = followUpStateModule.resolveReminderFollowUpStorePath(userA);

  assert.equal(readA?.slots?.reminderId, "rem-a");
  assert.equal(readB?.slots?.reminderId, "rem-b");
  assert.equal(readA?.slots?.reminderId === readB?.slots?.reminderId, false);
  assert.equal(fs.existsSync(storePathA), true);
  assert.equal(
    storePathA.toLowerCase().includes(path.join(".user", "user-context", userA.toLowerCase(), "state").toLowerCase()),
    true,
  );
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
