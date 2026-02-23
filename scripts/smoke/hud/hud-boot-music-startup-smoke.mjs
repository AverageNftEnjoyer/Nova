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

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

function readBootMusicConfig() {
  const sourcePath = path.join(process.cwd(), "hud/components/boot/Nova-Bootup.tsx");
  const source = fs.readFileSync(sourcePath, "utf8");
  const pick = (name) => {
    const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`));
    if (!match) throw new Error(`Unable to read ${name} from ${sourcePath}`);
    return Number(match[1]);
  };
  return {
    retryMs: pick("BOOT_MUSIC_RETRY_MS"),
    quickRetryMs: pick("BOOT_MUSIC_QUICK_RETRY_MS"),
    maxAttempts: pick("BOOT_MUSIC_MAX_ATTEMPTS"),
  };
}

class VirtualClock {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.events = [];
    this.clearedIds = new Set();
  }

  setTimeout(callback, delayMs) {
    const id = this.nextId++;
    this.events.push({
      id,
      at: this.now + Math.max(0, Number(delayMs) || 0),
      callback,
      intervalMs: null,
      canceled: false,
    });
    return id;
  }

  setInterval(callback, intervalMs) {
    const id = this.nextId++;
    this.events.push({
      id,
      at: this.now + Math.max(0, Number(intervalMs) || 0),
      callback,
      intervalMs: Math.max(0, Number(intervalMs) || 0),
      canceled: false,
    });
    return id;
  }

  clear(id) {
    this.clearedIds.add(id);
    const item = this.events.find((event) => event.id === id);
    if (item) item.canceled = true;
  }

  run(maxTimeMs = 20_000) {
    while (true) {
      this.events = this.events
        .filter((event) => !event.canceled && !this.clearedIds.has(event.id))
        .sort((a, b) => (a.at - b.at) || (a.id - b.id));
      const next = this.events[0];
      if (!next) break;
      if (next.at > maxTimeMs) break;
      this.events.shift();
      this.now = next.at;
      next.callback();
      if (!next.canceled && !this.clearedIds.has(next.id) && next.intervalMs !== null) {
        next.at = this.now + next.intervalMs;
        this.events.push(next);
      }
    }
  }
}

function simulateBootMusicStart({
  retryMs,
  quickRetryMs,
  maxAttempts,
  startOnAttempt,
  userChangedAtMs = null,
}) {
  const clock = new VirtualClock();
  const events = [];
  let attempts = 0;
  let started = false;
  let startedAtMs = null;
  let intervalStopAtMs = null;
  let retryTimerId = null;

  const tryPlayBootMusic = () => {
    if (started) return;
    attempts += 1;
    events.push({ kind: "attempt", attempt: attempts, atMs: clock.now });
    if (Number.isFinite(startOnAttempt) && attempts >= startOnAttempt) {
      started = true;
      startedAtMs = clock.now;
      events.push({ kind: "started", attempt: attempts, atMs: clock.now });
    }
  };

  tryPlayBootMusic();
  clock.setTimeout(() => {
    if (!started) tryPlayBootMusic();
  }, quickRetryMs);

  retryTimerId = clock.setInterval(() => {
    if (started || attempts >= maxAttempts) {
      if (retryTimerId !== null) {
        clock.clear(retryTimerId);
        intervalStopAtMs = clock.now;
      }
      return;
    }
    tryPlayBootMusic();
  }, retryMs);

  if (Number.isFinite(userChangedAtMs) && userChangedAtMs >= 0) {
    clock.setTimeout(() => {
      if (started) return;
      events.push({ kind: "active_user_changed", atMs: clock.now });
      tryPlayBootMusic();
    }, userChangedAtMs);
  }

  clock.run(20_000);
  return { attempts, startedAtMs, intervalStopAtMs, events };
}

const config = readBootMusicConfig();

await run("B1 boot music timing constants are present and sane", async () => {
  assert.equal(config.quickRetryMs > 0, true);
  assert.equal(config.retryMs >= config.quickRetryMs, true);
  assert.equal(config.maxAttempts >= 2, true);
});

await run("B2 immediate autoplay success starts at t+0ms", async () => {
  const runResult = simulateBootMusicStart({ ...config, startOnAttempt: 1 });
  assert.equal(runResult.startedAtMs, 0);
  assert.equal(runResult.attempts, 1);
});

await run("B3 blocked autoplay then retry starts at expected quick retry window", async () => {
  const runResult = simulateBootMusicStart({ ...config, startOnAttempt: 2 });
  assert.equal(runResult.startedAtMs, config.quickRetryMs);
  assert.equal(runResult.attempts, 2);
});

await run("B4 delayed autoplay start surfaces exact interval retry timing", async () => {
  const runResult = simulateBootMusicStart({ ...config, startOnAttempt: 4 });
  assert.equal(runResult.startedAtMs, config.retryMs * 2);
  assert.equal(runResult.attempts, 4);
});

await run("B5 no successful start stops at max attempts cap", async () => {
  const runResult = simulateBootMusicStart({ ...config, startOnAttempt: Number.POSITIVE_INFINITY });
  assert.equal(runResult.startedAtMs, null);
  assert.equal(runResult.attempts, config.maxAttempts);
  assert.equal(Number.isFinite(runResult.intervalStopAtMs), true);
});

await run("B6 active user change can trigger an earlier retry", async () => {
  const userChangedAtMs = Math.max(1, Math.floor(config.quickRetryMs / 2));
  const runResult = simulateBootMusicStart({
    ...config,
    startOnAttempt: 2,
    userChangedAtMs,
  });
  assert.equal(runResult.startedAtMs, userChangedAtMs);
  assert.equal(runResult.attempts, 2);
  assert.equal(runResult.startedAtMs < config.quickRetryMs, true);
});

const insightImmediate = simulateBootMusicStart({ ...config, startOnAttempt: 1 });
const insightQuickRetry = simulateBootMusicStart({ ...config, startOnAttempt: 2 });
const insightDelayed = simulateBootMusicStart({ ...config, startOnAttempt: 4 });
const insightNever = simulateBootMusicStart({ ...config, startOnAttempt: Number.POSITIVE_INFINITY });

console.log("\nBoot Music Startup Insights");
console.log(
  `Config: quickRetryMs=${config.quickRetryMs} retryMs=${config.retryMs} maxAttempts=${config.maxAttempts}`,
);
console.log(
  `Scenario immediate_success: start_at=${insightImmediate.startedAtMs}ms attempts=${insightImmediate.attempts}`,
);
console.log(
  `Scenario quick_retry_success: start_at=${insightQuickRetry.startedAtMs}ms attempts=${insightQuickRetry.attempts}`,
);
console.log(
  `Scenario delayed_success_attempt4: start_at=${insightDelayed.startedAtMs}ms attempts=${insightDelayed.attempts}`,
);
console.log(
  `Scenario no_success_cap: start_at=${insightNever.startedAtMs} attempts=${insightNever.attempts} interval_stop_at=${insightNever.intervalStopAtMs}ms`,
);

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
