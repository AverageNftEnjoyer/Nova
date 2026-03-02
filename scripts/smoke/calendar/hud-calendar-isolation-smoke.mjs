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

await run("Calendar API routes enforce authenticated user scoping", () => {
  const eventsRoute = read("hud/app/api/calendar/events/route.ts");
  const rescheduleRoute = read("hud/app/api/calendar/reschedule/route.ts");
  const conflictsRoute = read("hud/app/api/calendar/conflicts/route.ts");

  for (const route of [eventsRoute, rescheduleRoute, conflictsRoute]) {
    assert.equal(route.includes("requireSupabaseApiUser"), true);
    assert.equal(route.includes("const userId = verified.user.id"), true);
    assert.equal(route.includes("checkUserRateLimit(userId"), true);
  }

  assert.equal(eventsRoute.includes("aggregateCalendarEvents(userId"), true);
  assert.equal(rescheduleRoute.includes("aggregateCalendarEvents(userId"), true);
  assert.equal(conflictsRoute.includes("aggregateCalendarEvents(userId"), true);
});

await run("Reschedule store persists per-user overrides under user-context path", () => {
  const store = read("hud/lib/calendar/reschedule-store/index.ts");
  assert.equal(store.includes('path.join(resolveWorkspaceRoot(), ".agent", "user-context")'), true);
  assert.equal(store.includes("resolveUserContextRoot()"), true);
  assert.equal(store.includes("resolveOverridesFile(uid)"), true);
  assert.equal(store.includes("missionId"), true);
  assert.equal(store.includes("userId"), true);
});

await run("Calendar websocket event types are scoped-only and user-bound", () => {
  const gateway = read("src/runtime/infrastructure/hud-gateway/index.js");
  assert.equal(gateway.includes('"calendar:event:updated"'), true);
  assert.equal(gateway.includes('"calendar:rescheduled"'), true);
  assert.equal(gateway.includes('"calendar:conflict"'), true);
  assert.equal(gateway.includes('if (data.type === "calendar_emit")'), true);
  assert.equal(gateway.includes("ensureSocketUserContextBinding(ws"), true);
  assert.equal(gateway.includes("userContextId: emitBind.userContextId"), true);
});

const pass = results.filter((row) => row.status === "PASS").length;
const fail = results.filter((row) => row.status === "FAIL").length;
for (const row of results) {
  const detail = row.detail ? ` :: ${row.detail}` : "";
  console.log(`[${row.status}] ${row.name}${detail}`);
}
console.log(`\nSummary: pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);
