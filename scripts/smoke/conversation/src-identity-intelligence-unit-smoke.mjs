import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const results = [];
const engine = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/context/identity/engine/index.js")).href,
);

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

function countApproxTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 3.5);
}

async function createWorkspace(prefix) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  await fsp.mkdir(path.join(root, "profile"), { recursive: true });
  await fsp.mkdir(path.join(root, "logs"), { recursive: true });
  return root;
}

function writeSeed(workspaceDir, data) {
  const seedPath = path.join(workspaceDir, "profile", "identity-seed.json");
  fs.writeFileSync(
    seedPath,
    `${JSON.stringify({
      schemaVersion: 1,
      source: "settings_sync",
      updatedAt: new Date().toISOString(),
      data,
    }, null, 2)}\n`,
    "utf8",
  );
}

await run("Identity scoring promotes explicit preference over seed defaults", async () => {
  const workspaceDir = await createWorkspace("nova-identity-unit-");
  writeSeed(workspaceDir, {
    assistantName: "Nova",
    userName: "Alex",
    communicationStyle: "casual",
    tone: "neutral",
    preferredLanguage: "English",
  });

  const outcome = engine.syncIdentityIntelligenceFromTurn({
    userContextId: "identity-user-a",
    workspaceDir,
    userInputText: "Call me Lex and keep it concise.",
    nlpConfidence: 1,
    preferenceCapture: {
      preferences: {
        preferredName: "Lex",
      },
    },
  });

  assert.equal(outcome.persisted, true);
  assert.equal(outcome.snapshot.stableTraits.preferredName.selectedValue, "Lex");
  assert.equal(outcome.snapshot.stableTraits.preferredName.selectedConfidence >= 0.58, true);
  assert.equal(outcome.snapshot.dynamicPreferences.responseVerbosity.selectedValue, "concise");
});

await run("Conflict + recency allows fresh memory updates to supersede stale values", async () => {
  const workspaceDir = await createWorkspace("nova-identity-unit-");
  const staleMs = Date.now() - 200 * 24 * 60 * 60 * 1000;
  engine.recordIdentityMemoryUpdate({
    userContextId: "identity-user-b",
    workspaceDir,
    memoryFact: "my preferred name is Alex",
    nowMs: staleMs,
  });
  const updated = engine.recordIdentityMemoryUpdate({
    userContextId: "identity-user-b",
    workspaceDir,
    memoryFact: "my preferred name is Jordan",
    nowMs: Date.now(),
  });

  assert.equal(updated.snapshot.stableTraits.preferredName.selectedValue, "Jordan");
  assert.equal(updated.decisions.some((decision) => decision.changed === true), true);
});

await run("Identity prompt output respects explicit token cap", async () => {
  const workspaceDir = await createWorkspace("nova-identity-unit-");
  const outcome = engine.syncIdentityIntelligenceFromTurn({
    userContextId: "identity-user-c",
    workspaceDir,
    userInputText: "Detailed step by step with sources please.",
    nlpConfidence: 1,
    runtimeAssistantName: "Nova",
    runtimeCommunicationStyle: "professional",
    runtimeTone: "direct",
    maxPromptTokens: 90,
  });
  const promptSection = String(outcome.promptSection || "");
  assert.equal(promptSection.includes("Identity intelligence layer"), true);
  assert.equal(countApproxTokens(promptSection) <= 90, true);
});

await run("Identity snapshots stay isolated per user context workspace", async () => {
  const workspaceA = await createWorkspace("nova-identity-unit-a-");
  const workspaceB = await createWorkspace("nova-identity-unit-b-");

  engine.recordIdentityMemoryUpdate({
    userContextId: "identity-user-a",
    workspaceDir: workspaceA,
    memoryFact: "my preferred name is Alpha",
  });
  engine.recordIdentityMemoryUpdate({
    userContextId: "identity-user-b",
    workspaceDir: workspaceB,
    memoryFact: "my preferred name is Beta",
  });

  const snapshotA = engine.loadIdentityIntelligenceSnapshot({
    userContextId: "identity-user-a",
    workspaceDir: workspaceA,
  }).snapshot;
  const snapshotB = engine.loadIdentityIntelligenceSnapshot({
    userContextId: "identity-user-b",
    workspaceDir: workspaceB,
  }).snapshot;

  assert.equal(snapshotA.stableTraits.preferredName.selectedValue, "Alpha");
  assert.equal(snapshotB.stableTraits.preferredName.selectedValue, "Beta");
  assert.notEqual(snapshotA.stableTraits.preferredName.selectedValue, snapshotB.stableTraits.preferredName.selectedValue);
});

await run("Corrupt snapshot metadata fails closed and recovers to fresh schema", async () => {
  const workspaceDir = await createWorkspace("nova-identity-unit-");
  const snapshotPath = path.join(workspaceDir, "profile", "identity-intelligence.json");
  fs.writeFileSync(snapshotPath, "{broken-json", "utf8");
  const loaded = engine.loadIdentityIntelligenceSnapshot({
    userContextId: "identity-user-d",
    workspaceDir,
  });
  assert.equal(Boolean(loaded.snapshot), true);
  assert.equal(loaded.snapshot.userContextId, "identity-user-d");
  assert.equal(loaded.snapshot.schemaVersion, 1);
  assert.equal(Boolean(loaded.recoveredCorruptPath), true);
});

await run("Sensitive inference policy blocks protected-class signals by default", async () => {
  const workspaceDir = await createWorkspace("nova-identity-unit-");
  const outcome = engine.recordIdentityMemoryUpdate({
    userContextId: "identity-user-e",
    workspaceDir,
    memoryFact: "my occupation is diabetic",
  });
  assert.equal(outcome.persisted, true);
  assert.equal(Array.isArray(outcome.rejectedSignals), true);
  assert.equal(outcome.rejectedSignals.length >= 1, true);
  assert.equal(
    outcome.rejectedSignals.some((signal) => String(signal.rejectedReason || "").includes("sensitive")),
    true,
  );
  assert.equal(String(outcome.snapshot?.stableTraits?.occupationContext?.selectedValue || ""), "");
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
