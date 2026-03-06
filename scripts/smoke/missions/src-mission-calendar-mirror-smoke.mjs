import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const calendarModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "services", "missions", "calendar-mirror", "index.js")).href,
);

const { syncMissionScheduleToGoogleCalendar } = calendarModule;

const createdEvents = [];
const deletedEvents = [];

await syncMissionScheduleToGoogleCalendar(
  {
    mission: {
      id: "mission-cal-smoke",
      userId: "calendar-smoke-user",
      label: "Calendar Smoke Mission",
      description: "Smoke calendar sync",
      status: "active",
      settings: {},
      nodes: [
        {
          id: "n1",
          type: "schedule-trigger",
          triggerMode: "daily",
          triggerTime: "09:15",
          triggerTimezone: "America/New_York",
        },
      ],
    },
    scope: {
      user: { id: "calendar-smoke-user" },
      userId: "calendar-smoke-user",
    },
  },
  {
    async loadIntegrationsConfig() {
      return {
        gcalendar: {
          connected: true,
          activeAccountId: "acct-1",
          permissions: { allowCreate: true, allowDelete: true },
          accounts: [
            {
              id: "acct-1",
              email: "user@example.com",
              enabled: true,
              scopes: ["https://www.googleapis.com/auth/calendar.events"],
            },
          ],
        },
      };
    },
    async createCalendarEvent(payload) {
      createdEvents.push(payload);
      return { id: "evt-1", htmlLink: "https://example.test/event/evt-1" };
    },
    async deleteCalendarEvent(eventId) {
      deletedEvents.push(eventId);
      return { ok: true };
    },
    estimateDurationMs() {
      return 30 * 60 * 1000;
    },
    toIsoInTimezone(dayStamp, time) {
      return `${dayStamp}T${time}:00.000Z`;
    },
    getLocalParts(date) {
      const iso = new Date(date).toISOString();
      return {
        dayStamp: iso.slice(0, 10),
        weekday: "fri",
      };
    },
    resolveTimezone(value) {
      return value || "UTC";
    },
    warn() {},
    info() {},
  },
);

assert.equal(createdEvents.length, 1);
assert.equal(deletedEvents.length, 0);

console.log("[mission-calendar-mirror:smoke] shared mission calendar mirror service is stable.");
