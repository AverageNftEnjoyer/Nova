import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const helpersModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "services", "missions", "generation-helpers", "index.js")).href,
);

const {
  deriveScheduleFromPrompt,
  inferRequestedOutputChannel,
  normalizeOutputChannelId,
} = helpersModule;

const schedule = deriveScheduleFromPrompt("Nova send me a digest every weekday at 7:30am ET");
assert.equal(schedule.time, "07:30");
assert.equal(schedule.timezone, "America/New_York");

assert.equal(normalizeOutputChannelId("gmail"), "email");
assert.equal(normalizeOutputChannelId(" telegram "), "telegram");

const outputSet = new Set(["email", "telegram", "webhook"]);
assert.equal(inferRequestedOutputChannel("Email me the report", outputSet, "telegram"), "email");
assert.equal(inferRequestedOutputChannel("Send this in Nova chat", outputSet, "email"), "telegram");
assert.equal(inferRequestedOutputChannel("Post to webhook", outputSet, "email"), "webhook");
assert.equal(inferRequestedOutputChannel("No preference", outputSet, "email"), "email");

console.log("[mission-generation-helpers:smoke] shared mission generation helpers are stable.");
