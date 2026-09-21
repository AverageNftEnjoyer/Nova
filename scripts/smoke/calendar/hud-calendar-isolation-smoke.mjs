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
    assert.equal(route.includes("requireLocalUser"), true);
    assert.equal(route.includes("const { userId } = await requireLocalUser()"), true);
    assert.equal(route.includes("checkUserRateLimit(userId"), true);
  }

  assert.equal(eventsRoute.includes("aggregateCalendarEvents(userId"), true);
  assert.equal(rescheduleRoute.includes("aggregateCalendarEvents(userId"), true);
  assert.equal(conflictsRoute.includes("aggregateCalendarEvents(userId"), true);
});

await run("Reschedule store persists per-user overrides in SQLite, every statement scoped by user_id", () => {
  const wrapper = read("hud/lib/calendar/reschedule-store/index.ts");
  assert.equal(wrapper.includes("services/calendar/overrides-store/index.js"), true);
  assert.equal(wrapper.includes("missionId"), true);
  assert.equal(wrapper.includes("userId"), true);

  const store = read("src/runtime/modules/services/calendar/overrides-store/index.js");
  const statements = [...store.matchAll(/\.prepare\(\s*(`[^`]*`|"[^"]*")/g)].map((match) => match[1]);
  assert.equal(statements.length >= 5, true, "expected the store to use prepared statements");
  for (const sql of statements) {
    assert.equal(/user_id\s*=\s*\?/.test(sql) || /\(\s*user_id\b/.test(sql), true, `statement is not user-scoped: ${sql.slice(0, 60)}`);
  }
  assert.equal(store.includes('".user"'), false, "no file-based user-context path may remain");
});

await run("Calendar websocket event types are scoped-only and user-bound", () => {
  const gateway = read("src/runtime/infrastructure/hud-gateway/index.js");
  const gatewayMessageHandler = read("src/runtime/infrastructure/hud-gateway/message-handler/index.js");
  const combinedGateway = `${gateway}\n${gatewayMessageHandler}`;
  assert.equal(gateway.includes('"calendar:event:updated"'), true);
  assert.equal(gateway.includes('"calendar:rescheduled"'), true);
  assert.equal(gateway.includes('"calendar:conflict"'), true);
  assert.equal(combinedGateway.includes('if (data.type === "calendar_emit")'), true);
  assert.equal(combinedGateway.includes("ensureSocketUserContextBinding(ws"), true);
  assert.equal(combinedGateway.includes("userContextId: emitBind.userContextId"), true);
});

const pass = results.filter((row) => row.status === "PASS").length;
const fail = results.filter((row) => row.status === "FAIL").length;
for (const row of results) {
  const detail = row.detail ? ` :: ${row.detail}` : "";
  console.log(`[${row.status}] ${row.name}${detail}`);
}
console.log(`\nSummary: pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);
