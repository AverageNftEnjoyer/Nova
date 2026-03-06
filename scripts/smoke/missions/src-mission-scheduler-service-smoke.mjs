import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const schedulerModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "services", "missions", "scheduler", "index.js")).href,
);

const { ensureMissionSchedulerStarted } = schedulerModule;

let starts = 0;
const result = ensureMissionSchedulerStarted({
  startScheduler() {
    starts += 1;
    return { running: true };
  },
});

assert.equal(result?.running, true);
assert.equal(starts, 1);

console.log("[mission-scheduler-service:smoke] shared mission scheduler service is stable.");
