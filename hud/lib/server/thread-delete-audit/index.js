import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";

const THREAD_DELETE_AUDIT_LOG_FILE = "thread-delete-audit.jsonl";
const THREAD_DELETE_ALERT_LOG_FILE = "thread-delete-alerts.jsonl";

function normalizeUserContextId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function normalizeCount(value) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

async function appendJsonl(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

export async function appendThreadDeleteAuditLog(input) {
  const workspaceRoot = String(input?.workspaceRoot || "").trim();
  const userContextId = normalizeUserContextId(input?.userContextId);
  const threadId = String(input?.threadId || "").trim();
  if (!workspaceRoot || !userContextId || !threadId) return { alertTriggered: false };

  const removedSessionEntries = normalizeCount(input?.removedSessionEntries);
  const removedTranscriptFiles = normalizeCount(input?.removedTranscriptFiles);
  const threadMessageCount = normalizeCount(input?.threadMessageCount);
  const cleanupError = String(input?.cleanupError || "").trim();
  const timestamp = new Date().toISOString();

  const payload = {
    ts: timestamp,
    threadId,
    userContextId,
    removedSessionEntries,
    removedTranscriptFiles,
    cleanupError,
  };

  const logsDir = path.join(workspaceRoot, ".agent", "user-context", userContextId, "logs");
  await appendJsonl(path.join(logsDir, THREAD_DELETE_AUDIT_LOG_FILE), payload);

  const nonEmptyThread = threadMessageCount > 0;
  const alertTriggered = Boolean(cleanupError) || (nonEmptyThread && removedTranscriptFiles === 0);
  if (!alertTriggered) return { alertTriggered: false };

  const reason = cleanupError
    ? "cleanup_error"
    : "missing_transcript_removal_for_non_empty_thread";
  await appendJsonl(path.join(logsDir, THREAD_DELETE_ALERT_LOG_FILE), {
    ...payload,
    reason,
    threadMessageCount,
  });
  console.warn(
    `[ThreadDeleteAlert] userContextId=${userContextId} threadId=${threadId} reason=${reason} removedSessionEntries=${removedSessionEntries} removedTranscriptFiles=${removedTranscriptFiles}`,
  );
  return { alertTriggered: true };
}
