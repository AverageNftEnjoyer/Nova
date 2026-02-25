import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequestScheduler } from "../../../src/runtime/infrastructure/request-scheduler.js";
import {
  loadIdentityIntelligenceSnapshot,
  syncIdentityIntelligenceFromTurn,
} from "../../../src/runtime/modules/context/identity/engine.js";

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

function parseJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return String(fs.readFileSync(filePath, "utf8") || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

await run("Concurrent scheduler load keeps identity profiles divergent per user", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-identity-divergence-"));
  const workspaceA = path.join(root, "user-context", "user-a");
  const workspaceB = path.join(root, "user-context", "user-b");
  await fsp.mkdir(path.join(workspaceA, "profile"), { recursive: true });
  await fsp.mkdir(path.join(workspaceA, "logs"), { recursive: true });
  await fsp.mkdir(path.join(workspaceB, "profile"), { recursive: true });
  await fsp.mkdir(path.join(workspaceB, "logs"), { recursive: true });

  const scheduler = createRequestScheduler({
    strictUserIsolation: true,
    maxInFlightGlobal: 4,
    maxInFlightPerUser: 1,
    maxInFlightPerConversation: 1,
    maxQueueSize: 120,
    maxQueueSizePerUser: 80,
    supersedeQueuedByKey: false,
  });

  let inFlight = 0;
  let maxInFlightSeen = 0;
  const jobs = [];
  for (let i = 0; i < 20; i += 1) {
    jobs.push(
      scheduler.enqueue({
        lane: "default",
        userId: "user-a",
        conversationId: "shared-thread",
        supersedeKey: `user-a-${i}`,
        run: async () => {
          inFlight += 1;
          maxInFlightSeen = Math.max(maxInFlightSeen, inFlight);
          await sleep((i % 4) * 5);
          syncIdentityIntelligenceFromTurn({
            userContextId: "user-a",
            workspaceDir: workspaceA,
            source: "scheduler_smoke",
            conversationId: "shared-thread",
            sessionKey: "agent:nova:hud:user:user-a:dm:shared-thread",
            userInputText: i % 2 === 0
              ? "Call me Alpha and keep it concise."
              : "Call me Alpha and give a short answer.",
            nlpConfidence: 1,
            preferenceCapture: {
              preferences: {
                preferredName: "Alpha",
              },
            },
          });
          inFlight = Math.max(0, inFlight - 1);
          return "user-a";
        },
      }),
    );
    jobs.push(
      scheduler.enqueue({
        lane: "default",
        userId: "user-b",
        conversationId: "shared-thread",
        supersedeKey: `user-b-${i}`,
        run: async () => {
          inFlight += 1;
          maxInFlightSeen = Math.max(maxInFlightSeen, inFlight);
          await sleep((i % 3) * 7);
          syncIdentityIntelligenceFromTurn({
            userContextId: "user-b",
            workspaceDir: workspaceB,
            source: "scheduler_smoke",
            conversationId: "shared-thread",
            sessionKey: "agent:nova:hud:user:user-b:dm:shared-thread",
            userInputText: i % 2 === 0
              ? "Call me Beta and keep responses detailed."
              : "Call me Beta and provide step by step detail.",
            nlpConfidence: 1,
            preferenceCapture: {
              preferences: {
                preferredName: "Beta",
              },
            },
          });
          inFlight = Math.max(0, inFlight - 1);
          return "user-b";
        },
      }),
    );
  }

  await Promise.all(jobs);
  assert.equal(maxInFlightSeen >= 2, true, "expected cross-user scheduler concurrency >= 2");

  const snapshotA = loadIdentityIntelligenceSnapshot({
    userContextId: "user-a",
    workspaceDir: workspaceA,
  }).snapshot;
  const snapshotB = loadIdentityIntelligenceSnapshot({
    userContextId: "user-b",
    workspaceDir: workspaceB,
  }).snapshot;

  assert.equal(snapshotA.stableTraits.preferredName.selectedValue, "Alpha");
  assert.equal(snapshotB.stableTraits.preferredName.selectedValue, "Beta");
  assert.notEqual(
    snapshotA.stableTraits.preferredName.selectedValue,
    snapshotB.stableTraits.preferredName.selectedValue,
  );
  assert.equal(snapshotA.dynamicPreferences.responseVerbosity.selectedValue, "concise");
  assert.equal(snapshotB.dynamicPreferences.responseVerbosity.selectedValue, "detailed");

  const auditAPath = path.join(workspaceA, "logs", "identity-intelligence.jsonl");
  const auditBPath = path.join(workspaceB, "logs", "identity-intelligence.jsonl");
  const auditA = parseJsonl(auditAPath);
  const auditB = parseJsonl(auditBPath);
  assert.equal(auditA.length >= 20, true);
  assert.equal(auditB.length >= 20, true);
  assert.equal(auditA.every((entry) => String(entry.userContextId || "") === "user-a"), true);
  assert.equal(auditB.every((entry) => String(entry.userContextId || "") === "user-b"), true);
  assert.equal(auditA.some((entry) => String(entry.eventType || "") === "identity_turn_sync"), true);
  assert.equal(auditB.some((entry) => String(entry.eventType || "") === "identity_turn_sync"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
const skipCount = results.filter((result) => result.status === "SKIP").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
