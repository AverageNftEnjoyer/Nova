import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), "utf8");
}

await run("Scheduler consumes calendar overrides from reschedule-store", () => {
  const scheduler = read("hud/lib/notifications/scheduler/index.ts");
  const schedulerCore = read("src/runtime/modules/services/missions/scheduler-core/index.js");
  assert.equal(scheduler.includes("getRescheduleOverride"), true);
  assert.equal(schedulerCore.includes("const rescheduleOverride ="), true);
  assert.equal(schedulerCore.includes("getRescheduleOverride(liveMission.userId, liveMission.id)"), true);
  assert.equal(schedulerCore.includes("const missionForGate ="), true);
  assert.equal(schedulerCore.includes("scheduledAtOverride: rescheduleOverride.overriddenTime"), true);
  assert.equal(schedulerCore.includes("inputSnapshot.scheduledAtOverride = rescheduleOverride.overriddenTime"), true);
  assert.equal(schedulerCore.includes("scheduledAtOverride: undefined"), false);
});

await run("Calendar reschedule API writes and removes overrides", () => {
  const patchRoute = read("hud/app/api/calendar/reschedule/route.ts");
  const deleteRoute = read("hud/app/api/calendar/reschedule/[missionId]/route.ts");
  assert.equal(patchRoute.includes("setRescheduleOverride(userId, missionId, newStartAt, originalTime)"), true);
  assert.equal(deleteRoute.includes("deleteRescheduleOverride(userId, missionId)"), true);
});

await run("Calendar page publishes websocket calendar events after reschedule actions", () => {
  const page = read("hud/app/missions/calendar/page.tsx");
  assert.equal(page.includes("onPublishCalendarEvent"), true);
  assert.equal(page.includes('eventType: "calendar:rescheduled"'), true);
  assert.equal(page.includes('eventType: "calendar:event:updated"'), true);
  assert.equal(page.includes('eventType: "calendar:conflict"'), true);
  assert.equal(page.includes("publishCalendarEvent"), true);
});

await run("HUD useNovaState supports calendar event transport + emit channel", () => {
  const hook = read("hud/lib/chat/hooks/useNovaState.ts");
  assert.equal(hook.includes('type: "calendar:event:updated"'), true);
  assert.equal(hook.includes('type: "calendar:rescheduled"'), true);
  assert.equal(hook.includes('type: "calendar:conflict"'), true);
  assert.equal(hook.includes('type: "calendar_emit"'), true);
  assert.equal(hook.includes("publishCalendarEvent"), true);
});

const pass = results.filter((row) => row.status === "PASS").length;
const fail = results.filter((row) => row.status === "FAIL").length;
for (const row of results) {
  const detail = row.detail ? ` :: ${row.detail}` : "";
  console.log(`[${row.status}] ${row.name}${detail}`);
}
console.log(`\nSummary: pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);
