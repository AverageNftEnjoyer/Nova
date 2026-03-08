import test from "node:test";
import assert from "node:assert/strict";

import { parseStandaloneCalendarEventCommand, isStandaloneCalendarCrudPrompt } from "./index.js";
import { shouldBuildWorkflowFromPrompt } from "../../../chat/routing/intent-router/index.js";

const NOW = new Date("2026-03-08T14:00:00Z");

test("parses create command for standalone Google Calendar event", () => {
  const result = parseStandaloneCalendarEventCommand(
    "add dentist appointment Friday at 3 PM to my Google Calendar",
    { now: NOW, timezone: "America/New_York" },
  );
  assert.ok(result);
  assert.equal(result?.action, "create");
  assert.equal(result?.title, "dentist appointment");
  assert.equal(result?.startAt, "2026-03-13T19:00:00.000Z");
  assert.equal(result?.endAt, "2026-03-13T20:00:00.000Z");
  assert.equal(new Date(result?.endAt || 0).getTime() - new Date(result?.startAt || 0).getTime(), 60 * 60 * 1000);
});

test("parses update command with existing date match and new date", () => {
  const result = parseStandaloneCalendarEventCommand(
    "move dentist appointment Friday at 3 PM on my calendar to Friday at 4 PM",
    { now: NOW, timezone: "America/New_York" },
  );
  assert.ok(result);
  assert.equal(result?.action, "update");
  assert.equal(result?.title, "dentist appointment");
  assert.equal(result?.matchStartAt, "2026-03-13T19:00:00.000Z");
  assert.equal(result?.startAt, "2026-03-13T20:00:00.000Z");
  assert.equal(result?.endAt, "2026-03-13T21:00:00.000Z");
  assert.equal(new Date(result?.endAt || 0).getTime() - new Date(result?.startAt || 0).getTime(), 60 * 60 * 1000);
});

test("parses create command using requested timezone instead of server timezone", () => {
  const result = parseStandaloneCalendarEventCommand(
    "add product sync Friday at 3 PM to my Google Calendar",
    { now: NOW, timezone: "America/Los_Angeles" },
  );
  assert.ok(result);
  assert.equal(result?.startAt, "2026-03-13T22:00:00.000Z");
  assert.equal(result?.endAt, "2026-03-13T23:00:00.000Z");
});

test("parses explicit duration for standalone Google Calendar event", () => {
  const result = parseStandaloneCalendarEventCommand(
    "add board meeting next monday at 10 AM for 2 hours to my Google Calendar",
    { now: NOW, timezone: "America/New_York" },
  );
  assert.ok(result);
  assert.equal(result?.title, "board meeting");
  assert.equal(result?.startAt, "2026-03-16T14:00:00.000Z");
  assert.equal(result?.endAt, "2026-03-16T16:00:00.000Z");
});

test("parses delete command with title only", () => {
  const result = parseStandaloneCalendarEventCommand(
    "delete dentist appointment from my Google Calendar",
    { now: NOW, timezone: "America/New_York" },
  );
  assert.ok(result);
  assert.equal(result?.action, "delete");
  assert.equal(result?.title, "dentist appointment");
  assert.equal(result?.ok, true);
});

test("standalone calendar CRUD prompt no longer triggers mission build routing", () => {
  const prompt = "create a dentist appointment Friday at 3 PM on my Google Calendar";
  assert.equal(isStandaloneCalendarCrudPrompt(prompt), true);
  assert.equal(shouldBuildWorkflowFromPrompt(prompt), false);
});

test("mission workflow prompts still trigger mission build routing", () => {
  const prompt = "create a daily tech news digest mission at 8 AM";
  assert.equal(isStandaloneCalendarCrudPrompt(prompt), false);
  assert.equal(shouldBuildWorkflowFromPrompt(prompt), true);
});
