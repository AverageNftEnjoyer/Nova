import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-thread-cleanup-"));
const previousDataDir = process.env.NOVA_DATA_DIR;
process.env.NOVA_DATA_DIR = tempRoot;

const db = await import(pathToFileURL(path.join(process.cwd(), "src/db/index.js")).href);
const sessions = await import(pathToFileURL(path.join(process.cwd(), "src/session/sqlite-store/index.js")).href);
const cleanup = await import(
  pathToFileURL(path.join(process.cwd(), "hud/lib/server/thread-transcript-cleanup/index.js")).href,
);

const results = [];
async function run(name, fn) {
  try {
    await fn();
    results.push({ status: "PASS", name });
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.message : String(error) });
  }
}

const userId = "smoke-user-transcript-delete";

await run("T1 canonical thread cleanup removes SQLite session and transcript rows", async () => {
  const threadId = "thread-smoke-001";
  const sessionId = "session-smoke-canonical";
  const sessionKey = cleanup.buildHudSessionKey(userId, threadId);
  sessions.putSessionEntry(userId, sessionKey, {
    sessionId,
    sessionKey,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  sessions.appendSessionTurn(userId, sessionId, { role: "user", content: "hello", timestamp: Date.now() });

  const result = await cleanup.pruneThreadTranscripts("unused", userId, threadId);
  assert.equal(result.removedSessionEntries, 1);
  assert.equal(result.removedTranscriptFiles, 1);
  assert.equal(sessions.getSessionEntry(userId, sessionKey), null);
  assert.deepEqual(sessions.loadSessionTurns(userId, sessionId), []);
});

await run("T2 optimistic conversation hint cleanup is scoped", async () => {
  const threadId = "thread-smoke-002";
  const optimisticId = "opt-smoke-002";
  const sessionKey = cleanup.buildHudSessionKey(userId, optimisticId);
  const keepKey = cleanup.buildHudSessionKey(userId, "keep");
  sessions.putSessionEntry(userId, sessionKey, { sessionId: "session-opt", sessionKey, createdAt: 1, updatedAt: 1 });
  sessions.putSessionEntry(userId, keepKey, { sessionId: "session-keep", sessionKey: keepKey, createdAt: 1, updatedAt: 1 });
  sessions.appendSessionTurn(userId, "session-opt", { role: "user", content: "remove", timestamp: 1 });
  sessions.appendSessionTurn(userId, "session-keep", { role: "user", content: "keep", timestamp: 1 });

  const hints = cleanup.collectThreadCleanupHints(threadId, [{
    metadata: { sessionConversationId: optimisticId, sessionKey },
  }]);
  const result = await cleanup.pruneThreadTranscripts("unused", userId, threadId, hints);
  assert.equal(result.removedSessionEntries, 1);
  assert.equal(result.removedTranscriptFiles, 1);
  assert.ok(sessions.getSessionEntry(userId, keepKey));
  assert.equal(sessions.loadSessionTurns(userId, "session-keep").length, 1);
});

db.closeDb();
if (previousDataDir === undefined) delete process.env.NOVA_DATA_DIR;
else process.env.NOVA_DATA_DIR = previousDataDir;
fs.rmSync(tempRoot, { recursive: true, force: true });

let failed = 0;
for (const result of results) {
  if (result.status === "FAIL") failed += 1;
  console.log(`[${result.status}] ${result.name}${result.detail ? ` :: ${result.detail}` : ""}`);
}
console.log(`\nSummary: pass=${results.length - failed} fail=${failed}`);
if (failed) process.exit(1);
