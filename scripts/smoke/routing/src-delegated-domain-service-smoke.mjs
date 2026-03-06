import assert from "node:assert/strict";

import { runCalendarDomainService } from "../../../src/runtime/modules/services/calendar/index.js";
import { runVoiceDomainService } from "../../../src/runtime/modules/services/voice/index.js";
import { runTtsDomainService } from "../../../src/runtime/modules/services/tts/index.js";
import { runRemindersDomainService } from "../../../src/runtime/modules/services/reminders/index.js";

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

await run("Delegated lane services normalize context and route metadata", async () => {
  const executeChatRequest = async () => ({
    ok: true,
    route: "chat",
    responseRoute: "chat",
    reply: "ack",
    telemetry: {},
  });
  const ctx = {
    userContextId: "smoke-user",
    conversationId: "smoke-thread",
    sessionKey: "agent:nova:hud:user:smoke-user:dm:smoke-thread",
  };
  const requestHints = { testHint: true };

  const calendar = await runCalendarDomainService({ text: "calendar status", ctx, requestHints, executeChatRequest });
  const voice = await runVoiceDomainService({ text: "voice status", ctx, requestHints, executeChatRequest });
  const tts = await runTtsDomainService({ text: "tts status", ctx, requestHints, executeChatRequest });
  const reminders = await runRemindersDomainService({ text: "reminder status", ctx, requestHints, executeChatRequest });

  assert.equal(calendar.ok, true);
  assert.equal(voice.ok, true);
  assert.equal(tts.ok, true);
  assert.equal(reminders.ok, true);
  assert.equal(String(calendar.telemetry?.domain || ""), "calendar");
  assert.equal(String(voice.telemetry?.domain || ""), "voice");
  assert.equal(String(tts.telemetry?.domain || ""), "tts");
  assert.equal(String(reminders.telemetry?.domain || ""), "reminders");
  assert.equal(String(reminders.followUpState?.persistent || false), "true");
});

await run("Calendar domain service surfaces explicit failure metadata from its scoped provider adapter", async () => {
  const ctx = {
    userContextId: "smoke-user",
    conversationId: "smoke-thread",
    sessionKey: "agent:nova:hud:user:smoke-user:dm:smoke-thread",
  };
  const providerAdapter = {
    id: "calendar-smoke-adapter",
    providerId: "calendar-smoke-adapter",
    describeWindow: () => "this week",
    formatWhen: () => "soon",
    async listAgenda() {
      return { ok: false, events: [] };
    },
  };

  const calendar = await runCalendarDomainService({ text: "calendar", ctx }, { providerAdapter });
  assert.equal(calendar.ok, false);
  assert.equal(String(calendar.code || ""), "calendar.agenda_failed");
  assert.equal(String(calendar.reply || "").length > 0, true);
  assert.equal(String(calendar.telemetry?.provider || ""), "calendar-smoke-adapter");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
