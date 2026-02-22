import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createSessionRuntime } from "../../../src/session/runtime-compat.js";

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

const storeModule = await import(pathToFileURL(path.join(process.cwd(), "dist", "session", "store.js")).href);
const resolveModule = await import(pathToFileURL(path.join(process.cwd(), "dist", "session", "resolve.js")).href);
const keyModule = await import(pathToFileURL(path.join(process.cwd(), "dist", "session", "key.js")).href);

const { SessionStore } = storeModule;
const { resolveSession } = resolveModule;
const { resolveUserContextId: resolveSrcUserContextId } = keyModule;

function makeSrcSessionConfig(rootDir) {
  return {
    scope: "per-channel-peer",
    dmScope: "main",
    storePath: path.join(rootDir, "sessions.json"),
    transcriptDir: path.join(rootDir, "transcripts"),
    userContextRoot: path.join(rootDir, "user-context"),
    mainKey: "main",
    resetMode: "idle",
    resetAtHour: 4,
    idleMinutes: 120,
    maxHistoryTurns: 50,
    dmHistoryTurns: 100,
    transcriptsEnabled: true,
    maxTranscriptLines: 400,
    transcriptRetentionDays: 30,
  };
}

async function createHarness() {
  const legacyRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-session-legacy-"));
  const srcRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-session-src-"));

  const legacy = createSessionRuntime({
    sessionStorePath: path.join(legacyRoot, "sessions.json"),
    transcriptDir: path.join(legacyRoot, "transcripts"),
    userContextRoot: path.join(legacyRoot, "user-context"),
    sessionIdleMinutes: 120,
    sessionMainKey: "main",
    transcriptsEnabled: true,
    maxTranscriptLines: 400,
    transcriptRetentionDays: 30,
  });

  const srcConfig = makeSrcSessionConfig(srcRoot);
  const srcStore = new SessionStore(srcConfig);

  return {
    legacyRoot,
    srcRoot,
    legacy,
    srcConfig,
    srcStore,
  };
}

function toInboundMessage(opts) {
  const source = String(opts.source || "hud");
  const sender = String(opts.sender || "");
  return {
    text: "smoke",
    senderId: sender || "anonymous",
    channel: source,
    chatType: "direct",
    timestamp: Date.now(),
    source,
    sender,
    sessionKeyHint: String(opts.sessionKeyHint || ""),
    userContextId: String(opts.userContextId || ""),
  };
}

await run("Session key and user-context parity matrix (legacy vs src)", async () => {
  const cases = [
    {
      name: "hud-main",
      opts: { source: "hud", sender: "hud-user:user-a", userContextId: "user-a" },
    },
    {
      name: "voice-dm",
      opts: { source: "voice", sender: "Mic_A" },
    },
    {
      name: "api-dm",
      opts: { source: "api", sender: "service-bot" },
    },
    {
      name: "explicit-key",
      opts: { sessionKeyHint: "agent:nova:hud:user:user-c:dm:conv-9" },
    },
  ];

  for (const row of cases) {
    const harness = await createHarness();
    const inbound = toInboundMessage(row.opts);

    const legacyResolved = harness.legacy.resolveSessionContext(row.opts);
    const srcResolved = resolveSession({
      config: harness.srcConfig,
      store: harness.srcStore,
      agentName: "nova",
      inboundMessage: inbound,
      model: "smoke-model",
      now: legacyResolved.sessionEntry.updatedAt,
    });

    assert.equal(srcResolved.sessionKey, legacyResolved.sessionKey, `${row.name}: sessionKey`);
    assert.equal(
      String(srcResolved.sessionEntry.userContextId || ""),
      String(legacyResolved.sessionEntry.userContextId || ""),
      `${row.name}: session userContextId`,
    );
    assert.equal(
      resolveSrcUserContextId(inbound),
      harness.legacy.resolveUserContextId(row.opts),
      `${row.name}: resolveUserContextId`,
    );
  }
});

await run("Transcript routing parity for user-scoped sessions", async () => {
  const harness = await createHarness();
  const opts = {
    source: "hud",
    sender: "hud-user:user-a",
    userContextId: "user-a",
    sessionKeyHint: "agent:nova:hud:user:user-a:dm:conv-1",
  };
  const inbound = toInboundMessage(opts);

  const legacyResolved = harness.legacy.resolveSessionContext(opts);
  const srcResolved = resolveSession({
    config: harness.srcConfig,
    store: harness.srcStore,
    agentName: "nova",
    inboundMessage: inbound,
    model: "smoke-model",
  });

  harness.legacy.appendTranscriptTurn(legacyResolved.sessionEntry.sessionId, "user", "legacy hello");
  harness.srcStore.appendTurnBySessionId(srcResolved.sessionEntry.sessionId, "user", "src hello");

  const legacyScopedPath = path.join(
    harness.legacyRoot,
    "user-context",
    "user-a",
    "transcripts",
    `${legacyResolved.sessionEntry.sessionId}.jsonl`,
  );
  const srcScopedPath = path.join(
    harness.srcRoot,
    "user-context",
    "user-a",
    "transcripts",
    `${srcResolved.sessionEntry.sessionId}.jsonl`,
  );
  const legacyGlobalPath = path.join(
    harness.legacyRoot,
    "transcripts",
    `${legacyResolved.sessionEntry.sessionId}.jsonl`,
  );
  const srcGlobalPath = path.join(
    harness.srcRoot,
    "transcripts",
    `${srcResolved.sessionEntry.sessionId}.jsonl`,
  );

  assert.equal(fs.existsSync(legacyScopedPath), true);
  assert.equal(fs.existsSync(srcScopedPath), true);
  assert.equal(fs.existsSync(legacyGlobalPath), false);
  assert.equal(fs.existsSync(srcGlobalPath), false);

  const legacyReloaded = harness.legacy.resolveSessionContext(opts);
  const srcReloaded = harness.srcStore.loadTranscript(srcResolved.sessionEntry.sessionId, "user-a");
  assert.equal(legacyReloaded.transcript.some((turn) => String(turn.content).includes("legacy hello")), true);
  assert.equal(srcReloaded.some((turn) => String(turn.content).includes("src hello")), true);
});

await run("Idle reset parity (legacy vs src)", async () => {
  const harness = await createHarness();
  const opts = { source: "api", sender: "service-bot" };
  const inbound = toInboundMessage(opts);

  const legacyFirst = harness.legacy.resolveSessionContext(opts);
  const srcFirst = resolveSession({
    config: harness.srcConfig,
    store: harness.srcStore,
    agentName: "nova",
    inboundMessage: inbound,
    model: "smoke-model",
  });

  const oldTimestamp = Date.now() - 4 * 60 * 60 * 1000;

  const legacyStorePath = path.join(harness.legacyRoot, "user-context", "service-bot", "sessions.json");
  const legacyStore = JSON.parse(fs.readFileSync(legacyStorePath, "utf8"));
  legacyStore[legacyFirst.sessionKey].updatedAt = oldTimestamp;
  fs.writeFileSync(legacyStorePath, JSON.stringify(legacyStore, null, 2), "utf8");

  const srcStorePath = path.join(harness.srcRoot, "user-context", "service-bot", "sessions.json");
  const srcStoreData = JSON.parse(fs.readFileSync(srcStorePath, "utf8"));
  srcStoreData[srcFirst.sessionKey].updatedAt = oldTimestamp;
  fs.writeFileSync(srcStorePath, JSON.stringify(srcStoreData, null, 2), "utf8");

  const legacySecond = harness.legacy.resolveSessionContext(opts);
  const srcSecond = resolveSession({
    config: harness.srcConfig,
    store: harness.srcStore,
    agentName: "nova",
    inboundMessage: inbound,
    model: "smoke-model",
  });

  assert.notEqual(legacyFirst.sessionEntry.sessionId, legacySecond.sessionEntry.sessionId);
  assert.notEqual(srcFirst.sessionEntry.sessionId, srcSecond.sessionEntry.sessionId);
  assert.equal(srcSecond.isNewSession, true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
const skipCount = results.filter((result) => result.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
