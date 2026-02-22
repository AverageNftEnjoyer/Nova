import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

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

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const cleanup = await import(
  pathToFileURL(path.join(process.cwd(), "hud/lib/server/thread-transcript-cleanup.js")).href,
);

const {
  buildHudSessionKey,
  collectThreadCleanupHints,
  normalizeUserContextId,
  pruneThreadTranscripts,
} = cleanup;

const smokeUser = String(process.env.NOVA_SMOKE_USER_CONTEXT_ID || "").trim() || "smoke-user-transcript-delete";
const normalizedUserContextId = normalizeUserContextId(smokeUser);

const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "nova-hud-thread-delete-"));
const workspaceRoot = path.join(tmpRoot, "workspace");
const scopedRoot = path.join(workspaceRoot, ".agent", "user-context", normalizedUserContextId);
const scopedSessionsPath = path.join(scopedRoot, "sessions.json");
const scopedTranscriptDir = path.join(scopedRoot, "transcripts");

await run("T1 canonical thread id cleanup removes scoped session and transcript", async () => {
  const threadId = "thread-smoke-001";
  const sessionId = "session-smoke-canonical";
  const sessionKey = buildHudSessionKey(smokeUser, threadId);
  const transcriptPath = path.join(scopedTranscriptDir, `${sessionId}.jsonl`);

  await writeJson(scopedSessionsPath, {
    [sessionKey]: {
      sessionId,
      sessionKey,
      userContextId: normalizedUserContextId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  });
  await mkdir(scopedTranscriptDir, { recursive: true });
  await writeFile(
    transcriptPath,
    `${JSON.stringify({ role: "user", content: "hello", timestamp: Date.now(), meta: { sessionKey, conversationId: threadId } })}\n`,
    "utf8",
  );

  const result = await pruneThreadTranscripts(workspaceRoot, smokeUser, threadId);
  assert.equal(result.removedSessionEntries >= 1, true, "expected at least one removed session entry");
  assert.equal(result.removedTranscriptFiles >= 1, true, "expected at least one removed transcript");

  const remainingStore = JSON.parse(await readFile(scopedSessionsPath, "utf8"));
  assert.equal(Object.keys(remainingStore).length, 0, "expected scoped sessions store to be empty");
  const transcriptExists = await readFile(transcriptPath, "utf8").then(() => true).catch(() => false);
  assert.equal(transcriptExists, false, "expected canonical transcript file to be deleted");
});

await run("T2 optimistic sessionConversationId hint cleanup removes mapped transcript", async () => {
  const threadId = "thread-smoke-002";
  const optimisticConversationId = "opt-smoke-002";
  const sessionId = "session-smoke-optimistic";
  const sessionKey = buildHudSessionKey(smokeUser, optimisticConversationId);
  const transcriptPath = path.join(scopedTranscriptDir, `${sessionId}.jsonl`);
  const keepPath = path.join(scopedTranscriptDir, "session-should-stay.jsonl");

  await writeJson(scopedSessionsPath, {
    [sessionKey]: {
      sessionId,
      sessionKey,
      userContextId: normalizedUserContextId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    "agent:nova:hud:user:other-user:dm:keep": {
      sessionId: "session-should-stay",
      sessionKey: "agent:nova:hud:user:other-user:dm:keep",
      userContextId: normalizedUserContextId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  });

  await writeFile(
    transcriptPath,
    `${JSON.stringify({ role: "user", content: "only optimistic id in key", timestamp: Date.now(), meta: { sessionKey } })}\n`,
    "utf8",
  );
  await writeFile(
    keepPath,
    `${JSON.stringify({ role: "user", content: "keep this transcript", timestamp: Date.now(), meta: { sessionKey: "agent:nova:hud:user:other-user:dm:keep" } })}\n`,
    "utf8",
  );

  const hints = collectThreadCleanupHints(threadId, [
    {
      metadata: {
        sessionConversationId: optimisticConversationId,
        sessionKey,
      },
    },
  ]);

  assert.equal(
    hints.sessionConversationIds.includes(optimisticConversationId),
    true,
    "expected optimistic session conversation id hint",
  );
  assert.equal(hints.sessionKeys.includes(sessionKey), true, "expected session key hint");

  const result = await pruneThreadTranscripts(workspaceRoot, smokeUser, threadId, {
    sessionConversationIds: hints.sessionConversationIds,
    sessionKeys: hints.sessionKeys,
  });
  assert.equal(result.removedSessionEntries >= 1, true, "expected mapped session entry removal");
  assert.equal(result.removedTranscriptFiles >= 1, true, "expected mapped transcript removal");

  const transcriptExists = await readFile(transcriptPath, "utf8").then(() => true).catch(() => false);
  assert.equal(transcriptExists, false, "expected optimistic transcript file to be deleted");
  const keepExists = await readFile(keepPath, "utf8").then(() => true).catch(() => false);
  assert.equal(keepExists, true, "expected unrelated transcript to remain");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});

if (failCount > 0) process.exit(1);
