import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createRequestScheduler } from "../../../src/runtime/infrastructure/request-scheduler.js";
import { createSessionRuntime } from "../../../src/session/runtime-compat.js";
import { applyMemoryFactsToWorkspace } from "../../../src/runtime/modules/chat/core/chat-utils.js";
import { extractAutoMemoryFacts } from "../../../src/memory/runtime-compat.js";

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await run("Scheduler isolates conversation concurrency by user context", async () => {
  const scheduler = createRequestScheduler({
    strictUserIsolation: true,
    maxInFlightPerUser: 2,
    maxInFlightPerConversation: 1,
    maxQueueSize: 20,
    maxQueueSizePerUser: 20,
  });

  let inFlight = 0;
  let maxInFlightSeen = 0;

  const runJob = async () => {
    inFlight += 1;
    maxInFlightSeen = Math.max(maxInFlightSeen, inFlight);
    await sleep(80);
    inFlight = Math.max(0, inFlight - 1);
  };

  await Promise.all([
    scheduler.enqueue({ lane: "default", userId: "user-a", conversationId: "thread-1", supersedeKey: "thread-1", run: runJob }),
    scheduler.enqueue({ lane: "default", userId: "user-b", conversationId: "thread-1", supersedeKey: "thread-1", run: runJob }),
  ]);

  assert.equal(maxInFlightSeen >= 2, true, "same conversationId across users should not serialize execution");
});

await run("Scheduler supersede keys do not cross user boundaries", async () => {
  const scheduler = createRequestScheduler({
    strictUserIsolation: true,
    maxInFlightPerUser: 1,
    maxInFlightPerConversation: 1,
    maxQueueSize: 20,
    maxQueueSizePerUser: 20,
  });

  const aLock = scheduler.enqueue({
    lane: "default",
    userId: "user-a",
    conversationId: "thread-shared",
    supersedeKey: "thread-shared",
    run: async () => {
      await sleep(120);
      return "a-lock";
    },
  });

  await sleep(10);

  const bQueued = scheduler.enqueue({
    lane: "default",
    userId: "user-b",
    conversationId: "thread-shared",
    supersedeKey: "thread-shared",
    run: async () => "b-queued",
  });

  const aOld = scheduler.enqueue({
    lane: "default",
    userId: "user-a",
    conversationId: "thread-shared",
    supersedeKey: "thread-shared",
    run: async () => "a-old",
  });

  const aNew = scheduler.enqueue({
    lane: "default",
    userId: "user-a",
    conversationId: "thread-shared",
    supersedeKey: "thread-shared",
    run: async () => "a-new",
  });

  const [aLockResult, bResult, aOldResult, aNewResult] = await Promise.all([
    aLock,
    bQueued,
    aOld.catch((err) => err),
    aNew,
  ]);

  assert.equal(aLockResult, "a-lock");
  assert.equal(bResult, "b-queued", "user-b queued work should survive user-a supersede");
  assert.equal(String(aOldResult?.code || ""), "superseded", "only older user-a queued work should be superseded");
  assert.equal(aNewResult, "a-new");
});

await run("Scheduler enforces bounded global inflight under fan-out load", async () => {
  const scheduler = createRequestScheduler({
    strictUserIsolation: true,
    maxInFlightGlobal: 3,
    maxInFlightPerUser: 2,
    maxInFlightPerConversation: 1,
    maxQueueSize: 60,
    maxQueueSizePerUser: 60,
  });

  let inFlight = 0;
  let maxInFlightSeen = 0;
  const jobs = [];
  for (let i = 0; i < 12; i += 1) {
    jobs.push(
      scheduler.enqueue({
        lane: "default",
        userId: `user-${i}`,
        conversationId: `thread-${i}`,
        supersedeKey: `thread-${i}`,
        run: async () => {
          inFlight += 1;
          maxInFlightSeen = Math.max(maxInFlightSeen, inFlight);
          await sleep(50);
          inFlight = Math.max(0, inFlight - 1);
          return i;
        },
      }),
    );
  }

  await Promise.all(jobs);
  assert.equal(maxInFlightSeen <= 3, true, `expected max inflight <= 3, got ${maxInFlightSeen}`);
  const snapshot = scheduler.getSnapshot();
  assert.equal(Number(snapshot.maxInFlightGlobal), 3);
});

await run("HUD fallback session keys are user-scoped when conversation hint is missing", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-hud-fallback-key-"));
  const runtime = createSessionRuntime({
    sessionStorePath: path.join(tmpRoot, "sessions.json"),
    transcriptDir: path.join(tmpRoot, "transcripts"),
    sessionIdleMinutes: 120,
    sessionMainKey: "main",
  });

  const a = runtime.resolveSessionContext({
    source: "hud",
    sender: "hud-user:user-a",
    userContextId: "user-a",
  });
  const b = runtime.resolveSessionContext({
    source: "hud",
    sender: "hud-user:user-b",
    userContextId: "user-b",
  });

  assert.equal(a.sessionKey.includes(":hud:user:user-a:"), true);
  assert.equal(b.sessionKey.includes(":hud:user:user-b:"), true);
  assert.notEqual(a.sessionKey, b.sessionKey);
});

await run("Rapid same-user thread switching keeps transcripts isolated by conversation session key", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-thread-switch-"));
  const runtime = createSessionRuntime({
    sessionStorePath: path.join(tmpRoot, "sessions.json"),
    transcriptDir: path.join(tmpRoot, "transcripts"),
    sessionIdleMinutes: 120,
    sessionMainKey: "main",
  });

  const optsA = {
    source: "hud",
    sender: "hud-user:user-a",
    userContextId: "user-a",
    conversationId: "thread-a",
    sessionKeyHint: "agent:nova:hud:user:user-a:dm:thread-a",
  };
  const optsB = {
    source: "hud",
    sender: "hud-user:user-a",
    userContextId: "user-a",
    conversationId: "thread-b",
    sessionKeyHint: "agent:nova:hud:user:user-a:dm:thread-b",
  };

  const a1 = runtime.resolveSessionContext(optsA);
  const b1 = runtime.resolveSessionContext(optsB);

  runtime.appendTranscriptTurn(a1.sessionEntry.sessionId, "user", "alpha-only-1");
  runtime.appendTranscriptTurn(b1.sessionEntry.sessionId, "user", "beta-only-1");
  runtime.appendTranscriptTurn(a1.sessionEntry.sessionId, "assistant", "alpha-only-2");
  runtime.appendTranscriptTurn(b1.sessionEntry.sessionId, "assistant", "beta-only-2");

  const a2 = runtime.resolveSessionContext(optsA);
  const b2 = runtime.resolveSessionContext(optsB);
  const aText = a2.transcript.map((entry) => String(entry.content || "")).join(" ");
  const bText = b2.transcript.map((entry) => String(entry.content || "")).join(" ");

  assert.equal(aText.includes("alpha-only-1"), true);
  assert.equal(aText.includes("beta-only-1"), false);
  assert.equal(bText.includes("beta-only-2"), true);
  assert.equal(bText.includes("alpha-only-2"), false);
});

await run("User memory writes remain isolated for similar prompts", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-memory-isolation-"));
  const userADir = path.join(tmpRoot, "user-context", "user-a");
  const userBDir = path.join(tmpRoot, "user-context", "user-b");
  await fsp.mkdir(userADir, { recursive: true });
  await fsp.mkdir(userBDir, { recursive: true });

  const factsA = extractAutoMemoryFacts("My timezone is America/New_York");
  const factsB = extractAutoMemoryFacts("My timezone is Europe/London");
  assert.equal(factsA.length > 0, true);
  assert.equal(factsB.length > 0, true);

  applyMemoryFactsToWorkspace(userADir, factsA);
  applyMemoryFactsToWorkspace(userBDir, factsB);

  const memoryA = await fsp.readFile(path.join(userADir, "MEMORY.md"), "utf8");
  const memoryB = await fsp.readFile(path.join(userBDir, "MEMORY.md"), "utf8");

  assert.equal(/america\/new_york/i.test(memoryA), true);
  assert.equal(/europe\/london/i.test(memoryA), false);
  assert.equal(/europe\/london/i.test(memoryB), true);
  assert.equal(/america\/new_york/i.test(memoryB), false);
});

await run("SessionStore does not cross-scan user contexts without explicit scope", async () => {
  const storeModule = await import(pathToFileURL(path.join(process.cwd(), "dist", "session", "store.js")).href);
  const { SessionStore } = storeModule;

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-session-store-isolation-"));
  const userContextRoot = path.join(root, "user-context");
  const userAPath = path.join(userContextRoot, "user-a", "sessions.json");
  const userBPath = path.join(userContextRoot, "user-b", "sessions.json");
  await fsp.mkdir(path.dirname(userAPath), { recursive: true });
  await fsp.mkdir(path.dirname(userBPath), { recursive: true });

  const sharedKey = "agent:nova:hud:main";
  await fsp.writeFile(
    userAPath,
    JSON.stringify({
      [sharedKey]: {
        sessionId: "sess-a",
        sessionKey: sharedKey,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokens: 0,
        model: "",
        userContextId: "user-a",
      },
    }, null, 2),
    "utf8",
  );
  await fsp.writeFile(
    userBPath,
    JSON.stringify({
      [sharedKey]: {
        sessionId: "sess-b",
        sessionKey: sharedKey,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokens: 0,
        model: "",
        userContextId: "user-b",
      },
    }, null, 2),
    "utf8",
  );

  const store = new SessionStore({
    scope: "per-channel-peer",
    dmScope: "main",
    storePath: path.join(root, "sessions.json"),
    transcriptDir: path.join(root, "transcripts"),
    userContextRoot,
    mainKey: "main",
    resetMode: "idle",
    resetAtHour: 4,
    idleMinutes: 120,
    maxHistoryTurns: 50,
    dmHistoryTurns: 100,
    transcriptsEnabled: true,
    maxTranscriptLines: 400,
    transcriptRetentionDays: 30,
  });

  const unscoped = store.getEntry(sharedKey);
  const scopedA = store.getEntry(sharedKey, "user-a");
  const scopedB = store.getEntry(sharedKey, "user-b");

  assert.equal(unscoped, null, "unscoped lookup must not pull another user's session");
  assert.equal(String(scopedA?.sessionId || ""), "sess-a");
  assert.equal(String(scopedB?.sessionId || ""), "sess-b");
});

await run("Gateway enforces scoped conversation ownership and scoped-only broadcast guards", async () => {
  const hudGatewaySource = fs.readFileSync(
    path.join(process.cwd(), "src/runtime/infrastructure/hud-gateway.js"),
    "utf8",
  );
  assert.equal(hudGatewaySource.includes("SCOPED_ONLY_EVENT_TYPES"), true);
  assert.equal(hudGatewaySource.includes("if (!targetUserContextId && SCOPED_ONLY_EVENT_TYPES.has(eventType)) return;"), true);
  assert.equal(hudGatewaySource.includes('status: "conflict"'), true);
  assert.equal(hudGatewaySource.includes("meta.conflicted === true"), true);
  assert.equal(hudGatewaySource.includes("missing conversation context"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
