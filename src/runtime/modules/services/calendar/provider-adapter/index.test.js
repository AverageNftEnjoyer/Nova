import test from "node:test";
import assert from "node:assert/strict";

import { createCalendarProviderAdapter } from "./index.js";

test("provider adapter creates standalone Google Calendar event and broadcasts update", async () => {
  const broadcasts = [];
  const adapter = createCalendarProviderAdapter({
    googleCalendarHudAdapter: {
      async create(input) {
        assert.equal(input.title, "dentist appointment");
        return {
          ok: true,
          event: {
            id: "abc123",
            summary: "dentist appointment",
            description: "",
            start: { dateTime: "2026-03-13T19:00:00.000Z", timeZone: "America/New_York" },
            end: { dateTime: "2026-03-13T20:00:00.000Z", timeZone: "America/New_York" },
            status: "confirmed",
          },
        };
      },
    },
    broadcastCalendarEventUpdated(payload) {
      broadcasts.push(payload);
    },
  });

  const result = await adapter.createStandaloneEvent({
    userContextId: "user-a",
    title: "dentist appointment",
    startAt: "2026-03-13T19:00:00.000Z",
    endAt: "2026-03-13T20:00:00.000Z",
    timeZone: "America/New_York",
  });

  assert.equal(result.ok, true);
  assert.equal(result.event?.id, "gcal::abc123");
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0]?.eventId, "gcal::abc123");
});

test("provider adapter rejects ambiguous standalone update matches", async () => {
  const adapter = createCalendarProviderAdapter({
    googleCalendarHudAdapter: {
      async list() {
        return {
          ok: true,
          events: [
            {
              id: "abc123",
              summary: "dentist appointment",
              start: { dateTime: "2026-03-13T19:00:00.000Z", timeZone: "America/New_York" },
              end: { dateTime: "2026-03-13T20:00:00.000Z", timeZone: "America/New_York" },
            },
            {
              id: "def456",
              summary: "dentist appointment",
              start: { dateTime: "2026-03-15T19:00:00.000Z", timeZone: "America/New_York" },
              end: { dateTime: "2026-03-15T20:00:00.000Z", timeZone: "America/New_York" },
            },
          ],
        };
      },
    },
  });

  const result = await adapter.updateStandaloneEvent({
    userContextId: "user-a",
    title: "dentist appointment",
    startAt: "2026-03-20T19:00:00.000Z",
    endAt: "2026-03-20T20:00:00.000Z",
    timeZone: "America/New_York",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "calendar.event_ambiguous");
});

test("provider adapter deletes a matched standalone Google Calendar event", async () => {
  const deletes = [];
  const broadcasts = [];
  const adapter = createCalendarProviderAdapter({
    googleCalendarHudAdapter: {
      async list() {
        return {
          ok: true,
          events: [{
            id: "abc123",
            summary: "dentist appointment",
            start: { dateTime: "2026-03-13T19:00:00.000Z", timeZone: "America/New_York" },
            end: { dateTime: "2026-03-13T20:00:00.000Z", timeZone: "America/New_York" },
          }],
        };
      },
      async delete(input) {
        deletes.push(input.eventId);
        return { ok: true };
      },
    },
    broadcastCalendarEventUpdated(payload) {
      broadcasts.push(payload);
    },
  });

  const result = await adapter.deleteStandaloneEvent({
    userContextId: "user-a",
    title: "dentist appointment",
    matchStartAt: "2026-03-13T19:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(deletes, ["abc123"]);
  assert.equal(broadcasts[0]?.patch?.status, "cancelled");
});
