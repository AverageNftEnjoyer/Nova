import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

function resolveSmokeUserContextId() {
  const explicit = String(
    process.env.NOVA_SMOKE_USER_CONTEXT_ID
    || process.env.NOVA_USER_CONTEXT_ID
    || process.env.USER_CONTEXT_ID
    || "",
  ).trim();
  if (explicit) return explicit;

  const root = path.join(process.cwd(), ".agent", "user-context");
  if (!fs.existsSync(root)) return "";
  const candidates = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .filter(Boolean);
  if (candidates.length === 1) return candidates[0];
  return "";
}

const userContextId = resolveSmokeUserContextId();
if (!userContextId) {
  record(
    "SKIP",
    "HUD thread-delete canary requires NOVA_SMOKE_USER_CONTEXT_ID",
    "Set NOVA_SMOKE_USER_CONTEXT_ID to run scoped create/message/delete transcript canary.",
  );
  summarize(results[0]);
  process.exit(0);
}

const { handleInput } = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/core/chat-handler.js")).href,
);
const cleanup = await import(
  pathToFileURL(path.join(process.cwd(), "hud/lib/server/thread-transcript-cleanup.js")).href,
);
const audit = await import(
  pathToFileURL(path.join(process.cwd(), "hud/lib/server/thread-delete-audit.js")).href,
);

const { collectThreadCleanupHints, pruneThreadTranscripts } = cleanup;
const { appendThreadDeleteAuditLog } = audit;

const ts = Date.now();
const conversationId = `thread-delete-canary-${ts}-thread`;
const sessionKeyHint = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;
const scopedRoot = path.join(process.cwd(), ".agent", "user-context", userContextId);
const sessionsPath = path.join(scopedRoot, "state", "sessions.json");
const logsDir = path.join(scopedRoot, "logs");
const auditLogPath = path.join(logsDir, "thread-delete-audit.jsonl");
const alertLogPath = path.join(logsDir, "thread-delete-alerts.jsonl");

let transcriptPath = "";

function parseJsonLines(raw) {
  return String(raw || "")
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

await run("C1 create real HUD thread turn writes scoped session + transcript", async () => {
  const result = await handleInput(
    "Canary: reply with one short sentence.",
    {
      source: "hud",
      sender: "hud-user",
      voice: false,
      userContextId,
      conversationId,
      sessionKeyHint,
    },
  );

  assert.equal(String(result?.reply || "").trim().length > 0, true, "expected non-empty reply");
  assert.equal(String(result?.sessionKey || "").trim(), sessionKeyHint, "expected stable session key");

  const sessions = JSON.parse(await fsp.readFile(sessionsPath, "utf8"));
  const scopedEntry = sessions[sessionKeyHint];
  assert.equal(Boolean(scopedEntry?.sessionId), true, "expected scoped session entry");

  transcriptPath = path.join(scopedRoot, "transcripts", `${scopedEntry.sessionId}.jsonl`);
  const transcriptExists = await fsp.readFile(transcriptPath, "utf8").then(() => true).catch(() => false);
  assert.equal(transcriptExists, true, "expected scoped transcript file before delete");
});

await run("C2 delete thread cleanup removes scoped transcript file", async () => {
  const hints = collectThreadCleanupHints(conversationId, [
    {
      metadata: {
        conversationId,
        sessionConversationId: conversationId,
        sessionKey: sessionKeyHint,
      },
    },
  ]);

  const cleanupResult = await pruneThreadTranscripts(process.cwd(), userContextId, conversationId, {
    sessionConversationIds: hints.sessionConversationIds,
    sessionKeys: hints.sessionKeys,
  });

  assert.equal(cleanupResult.removedSessionEntries >= 1, true, "expected removed session entries");
  assert.equal(cleanupResult.removedTranscriptFiles >= 1, true, "expected removed transcript files");

  const transcriptExists = await fsp.readFile(transcriptPath, "utf8").then(() => true).catch(() => false);
  assert.equal(transcriptExists, false, "expected scoped transcript file to be deleted");

  const sessions = JSON.parse(await fsp.readFile(sessionsPath, "utf8"));
  assert.equal(Boolean(sessions[sessionKeyHint]), false, "expected session key to be pruned");

  const auditWrite = await appendThreadDeleteAuditLog({
    workspaceRoot: process.cwd(),
    threadId: conversationId,
    userContextId,
    removedSessionEntries: cleanupResult.removedSessionEntries,
    removedTranscriptFiles: cleanupResult.removedTranscriptFiles,
    cleanupError: "",
    threadMessageCount: 1,
  });
  assert.equal(Boolean(auditWrite?.alertTriggered), false, "expected no alert for healthy cleanup");
});

await run("C3 audit log records required delete telemetry fields", async () => {
  const rows = parseJsonLines(await fsp.readFile(auditLogPath, "utf8"));
  const target = rows.filter((row) => String(row?.threadId || "") === conversationId).at(-1);
  assert.equal(Boolean(target), true, "expected audit row for canary thread");
  assert.equal(String(target.userContextId || ""), userContextId, "expected matching userContextId");
  assert.equal(Number.isFinite(Number(target.removedSessionEntries)), true, "missing removedSessionEntries");
  assert.equal(Number.isFinite(Number(target.removedTranscriptFiles)), true, "missing removedTranscriptFiles");
  assert.equal(typeof target.cleanupError === "string", true, "missing cleanupError");
});

await run("C4 cleanupError and zero-removal cases trigger alert log", async () => {
  const cleanupErrorThreadId = `${conversationId}-error`;
  const zeroRemovalThreadId = `${conversationId}-zero`;

  const a1 = await appendThreadDeleteAuditLog({
    workspaceRoot: process.cwd(),
    threadId: cleanupErrorThreadId,
    userContextId,
    removedSessionEntries: 0,
    removedTranscriptFiles: 0,
    cleanupError: "simulated cleanup failure",
    threadMessageCount: 1,
  });
  assert.equal(Boolean(a1?.alertTriggered), true, "expected alert for cleanupError");

  const a2 = await appendThreadDeleteAuditLog({
    workspaceRoot: process.cwd(),
    threadId: zeroRemovalThreadId,
    userContextId,
    removedSessionEntries: 1,
    removedTranscriptFiles: 0,
    cleanupError: "",
    threadMessageCount: 2,
  });
  assert.equal(Boolean(a2?.alertTriggered), true, "expected alert for non-empty zero-removal");

  const alerts = parseJsonLines(await fsp.readFile(alertLogPath, "utf8"));
  const hasCleanupErrorAlert = alerts.some(
    (row) => String(row?.threadId || "") === cleanupErrorThreadId && String(row?.reason || "") === "cleanup_error",
  );
  const hasZeroRemovalAlert = alerts.some(
    (row) =>
      String(row?.threadId || "") === zeroRemovalThreadId
      && String(row?.reason || "") === "missing_transcript_removal_for_non_empty_thread",
  );
  assert.equal(hasCleanupErrorAlert, true, "missing cleanup_error alert row");
  assert.equal(hasZeroRemovalAlert, true, "missing zero-removal alert row");
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
const skipCount = results.filter((result) => result.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
