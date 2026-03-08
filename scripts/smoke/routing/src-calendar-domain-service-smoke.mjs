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

const calendarServiceModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "services",
  "calendar",
  "index.js",
)).href;
const { runCalendarDomainService } = await import(calendarServiceModulePath);

await run("CAL-DOM-1 calendar service returns scoped agenda summary", async () => {
  const out = await runCalendarDomainService({
    text: "show my calendar today",
    userContextId: "calendar-a",
    conversationId: "thread-a",
    sessionKey: "agent:nova:hud:user:calendar-a:dm:thread-a",
  }, {
    providerAdapter: {
      providerId: "runtime_calendar",
      describeWindow: (value) => value === "today" ? "today" : "this week",
      formatWhen: () => "Fri, Mar 6, 9:00 AM",
      async listAgenda() {
        return {
          ok: true,
          events: [{
            id: "mission-1::2026-03-06",
            missionId: "mission-1",
            title: "Daily Brief",
            startAt: "2026-03-06T14:00:00.000Z",
            timezone: "America/New_York",
            conflict: false,
          }],
        };
      },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.route, "calendar");
  assert.equal(out.responseRoute, "calendar");
  assert.equal(out.reply.includes("Daily Brief"), true);
  assert.equal(out.telemetry.action, "agenda");
});

await run("CAL-DOM-2 calendar service persists direct reschedule action without delegated fallback", async () => {
  const out = await runCalendarDomainService({
    text: "reschedule Daily Brief to 2026-03-07T15:00:00.000Z",
    userContextId: "calendar-b",
    conversationId: "thread-b",
    sessionKey: "agent:nova:hud:user:calendar-b:dm:thread-b",
  }, {
    providerAdapter: {
      providerId: "runtime_calendar",
      async rescheduleMission() {
        return {
          ok: true,
          mission: { id: "mission-2", label: "Daily Brief" },
          conflict: false,
          override: { overriddenTime: "2026-03-07T15:00:00.000Z" },
        };
      },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.code, "calendar.reschedule_ok");
  assert.equal(out.reply.includes("Calendar updated for Daily Brief"), true);
  assert.equal(out.telemetry.action, "reschedule");
});

await run("CAL-DOM-3 calendar service returns deterministic scoped error when context is missing", async () => {
  const out = await runCalendarDomainService({
    text: "calendar status",
    userContextId: "",
    conversationId: "",
    sessionKey: "",
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "calendar.context_missing");
  assert.equal(out.route, "calendar");
  assert.equal(out.responseRoute, "calendar");
});

await run("CAL-DOM-4 standalone Google Calendar create stays on calendar lane", async () => {
  let called = false;
  const out = await runCalendarDomainService({
    text: "add dentist appointment Friday at 3 PM to my Google Calendar",
    userContextId: "calendar-c",
    conversationId: "thread-c",
    sessionKey: "agent:nova:hud:user:calendar-c:dm:thread-c",
  }, {
    providerAdapter: {
      providerId: "runtime_calendar",
      formatWhen: () => "Fri, Mar 13, 3:00 PM",
      async createStandaloneEvent(input) {
        called = true;
        assert.equal(input.title, "dentist appointment");
        return {
          ok: true,
          event: {
            id: "gcal::abc123",
            title: "dentist appointment",
            startAt: "2026-03-13T19:00:00.000Z",
            endAt: "2026-03-13T20:00:00.000Z",
            timezone: "America/New_York",
          },
        };
      },
    },
  });

  assert.equal(called, true);
  assert.equal(out.ok, true);
  assert.equal(out.telemetry.action, "create_event");
  assert.equal(out.reply.includes("Added dentist appointment"), true);
});

await run("CAL-DOM-5 standalone Google Calendar update failure returns provider message", async () => {
  const out = await runCalendarDomainService({
    text: "move dentist appointment Friday at 3 PM on my calendar to Friday at 4 PM",
    userContextId: "calendar-d",
    conversationId: "thread-d",
    sessionKey: "agent:nova:hud:user:calendar-d:dm:thread-d",
  }, {
    providerAdapter: {
      providerId: "runtime_calendar",
      formatWhen: () => "Fri, Mar 13, 4:00 PM",
      async updateStandaloneEvent() {
        return {
          ok: false,
          code: "calendar.event_ambiguous",
          message: "I found multiple matching events.",
        };
      },
    },
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "calendar.event_ambiguous");
  assert.equal(out.reply, "I found multiple matching events.");
});

await run("CAL-DOM-6 agenda reply is generic for mixed calendar events", async () => {
  const out = await runCalendarDomainService({
    text: "show my calendar today",
    userContextId: "calendar-e",
    conversationId: "thread-e",
    sessionKey: "agent:nova:hud:user:calendar-e:dm:thread-e",
  }, {
    providerAdapter: {
      providerId: "runtime_calendar",
      describeWindow: () => "today",
      formatWhen: () => "Fri, Mar 13, 3:00 PM",
      async listAgenda() {
        return {
          ok: true,
          events: [{
            id: "gcal::abc123",
            title: "dentist appointment",
            startAt: "2026-03-13T19:00:00.000Z",
            timezone: "America/New_York",
            conflict: false,
          }],
        };
      },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(/mission/i.test(out.reply), false);
  assert.equal(out.reply.includes("dentist appointment"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
