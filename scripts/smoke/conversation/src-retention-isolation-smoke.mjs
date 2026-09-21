import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
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

// Normalize CRLF so multi-line source-token assertions do not depend on the checkout's line endings.
async function read(relativePath) {
  return (await readFile(path.join(process.cwd(), relativePath), "utf8")).replace(/\r\n/g, "\n");
}

async function listFilesRecursive(rootDir) {
  const out = [];
  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      out.push(fullPath);
    }
  }
  await walk(rootDir);
  return out;
}

const { createSessionRuntime } = await import(
  pathToFileURL(path.join(process.cwd(), "src/session/runtime/index.js")).href,
);
const sessionsDb = await import(pathToFileURL(path.join(process.cwd(), "src/session/sqlite-store/index.js")).href);

const threadsRoute = await read("hud/app/api/threads/route.ts");
const threadMessagesRoute = await read("hud/app/api/threads/[threadId]/messages/route.ts");
const accountDeleteRoute = await read("hud/app/api/account/delete/route.ts");
const conversationsHook = await read("hud/lib/chat/hooks/useConversations.ts");
const hudGateway = await read("src/runtime/infrastructure/hud-gateway/index.js");
const runtimeConstants = await read("src/runtime/core/constants/index.js");
const sessionStore = await read("src/session/store/index.ts");
const sessionRuntimeSource = await read("src/session/runtime/index.js");

await run("R1 thread reads are user-scoped and message IDs are stabilized", async () => {
  // Threads/messages are read from nova.db through the user-scoped session store (was Supabase .eq("user_id", ...)).
  assert.equal(threadsRoute.includes("listThreads(userId)"), true);
  assert.equal(threadsRoute.includes("listThreadMessages(userId)"), true);
  assert.equal(threadsRoute.includes("stableMessageId"), true);
  assert.equal(threadsRoute.includes("seenMessageIdsByThread"), true);

  // Behavior: one user's threads and messages are never visible to another user.
  const a = "retention-user-a";
  const b = "retention-user-b";
  const threadA = sessionsDb.createThread(a, "A thread");
  sessionsDb.createThread(b, "B thread");
  const at = new Date().toISOString();
  sessionsDb.upsertThreadMessages(a, threadA.id, [{ id: "r1-a-1", role: "user", content: "secret of A", createdAt: at }]);
  assert.equal(sessionsDb.listThreads(a).some((t) => t.id === threadA.id), true);
  assert.equal(sessionsDb.listThreads(b).some((t) => t.id === threadA.id), false);
  assert.equal(sessionsDb.listThreadMessages(b).some((m) => m.content === "secret of A"), false);
  // Another user cannot write into A's thread either.
  assert.equal(sessionsDb.upsertThreadMessages(b, threadA.id, [{ id: "r1-b-1", role: "user", content: "x", createdAt: at }]), null);
});

await run("R2 thread message writes are idempotent and non-destructive", async () => {
  assert.equal(threadMessagesRoute.includes("buildStableMessageRowId"), true);
  assert.equal(threadMessagesRoute.includes("upsertThreadMessages(userId, threadId, rows)"), true);
  assert.equal(/DELETE\s+FROM\s+messages/i.test(threadMessagesRoute), false);
  assert.equal(/\.delete\(\)/.test(threadMessagesRoute), false);

  // Behavior: re-sending the same ids upserts in place; writing a subset never removes other messages.
  const userId = "retention-user-r2";
  const thread = sessionsDb.createThread(userId, "R2");
  const at = new Date().toISOString();
  const msg = (id, content) => ({ id, role: "user", content, createdAt: at });
  sessionsDb.upsertThreadMessages(userId, thread.id, [msg("m1", "one"), msg("m2", "two")]);
  sessionsDb.upsertThreadMessages(userId, thread.id, [msg("m1", "one (edited)")]);
  const rows = sessionsDb.listThreadMessages(userId).filter((m) => m.threadId === thread.id);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((m) => m.id === "m1").content, "one (edited)");
  assert.equal(rows.find((m) => m.id === "m2").content, "two");
});

await run("R3 assistant transport routing is strict to explicit conversation IDs", async () => {
  assert.equal(conversationsHook.includes("strict thread isolation"), true);
  assert.equal(conversationsHook.includes('if (role === "assistant") {'), true);
  assert.equal(conversationsHook.includes('return ""'), true);
});

await run("R4 websocket broadcast path enforces userContext scoping for chat events", async () => {
  assert.equal(hudGateway.includes("SCOPED_ONLY_EVENT_TYPES"), true);
  assert.equal(hudGateway.includes('"assistant_stream_start"'), true);
  assert.equal(hudGateway.includes('"assistant_stream_delta"'), true);
  assert.equal(hudGateway.includes('"assistant_stream_done"'), true);
  assert.equal(hudGateway.includes("resolveEventUserContextId"), true);
  assert.equal(hudGateway.includes("hasScopedConversationContext"), true);
  assert.equal(hudGateway.includes("if (!hasScopedConversationContext(resolvedUserContextId, normalizedConversationId)) return;"), true);
  assert.equal(hudGateway.includes("if (!targetUserContextId && SCOPED_ONLY_EVENT_TYPES.has(eventType)) return;"), true);
});

await run("R5 message deletes exist only on explicit delete endpoints", async () => {
  // Account delete purges every user-owned row (messages included) via purgeLocalUserData.
  assert.equal(accountDeleteRoute.includes("purgeLocalUserData(userContextId)"), true);
  // Message-deleting primitives (SQL or store helpers) may only be reached from explicit user-driven delete routes.
  const apiRoot = path.join(process.cwd(), "hud", "app", "api");
  const files = await listFilesRecursive(apiRoot);
  const matches = [];
  for (const filePath of files) {
    const source = await readFile(filePath, "utf8").catch(() => "");
    if (/DELETE\s+FROM\s+messages|\bdeleteThread\(|\bpurgeLocalUserData\(/i.test(source)) {
      matches.push(path.relative(process.cwd(), filePath).replace(/\\/g, "/"));
    }
  }
  assert.deepEqual(matches.sort(), ["hud/app/api/account/delete/route.ts", "hud/app/api/threads/[threadId]/route.ts"]);
  // The thread route only deletes from its DELETE handler, never from the write/patch paths.
  const threadRoute = await read("hud/app/api/threads/[threadId]/route.ts");
  const deleteHandlerAt = threadRoute.indexOf("export async function DELETE");
  assert.equal(deleteHandlerAt > 0, true);
  assert.equal(threadRoute.indexOf("deleteThread(") > deleteHandlerAt, true);
});

await run("R6 transcript retention defaults enable bounded pruning in prod", async () => {
  assert.equal(runtimeConstants.includes('NOVA_SESSION_MAX_TRANSCRIPT_LINES", 400'), true);
  assert.equal(runtimeConstants.includes('NOVA_SESSION_TRANSCRIPT_RETENTION_DAYS", 30'), true);
  assert.equal(
    sessionStore.includes("? Math.trunc(Number(extended.maxTranscriptLines))\n      : 400;"),
    true,
  );
  assert.equal(
    sessionStore.includes("? Math.trunc(Number(extended.transcriptRetentionDays))\n      : 30;"),
    true,
  );
  assert.equal(sessionRuntimeSource.includes("maxTranscriptLines = 400"), true);
  assert.equal(sessionRuntimeSource.includes("transcriptRetentionDays = 30"), true);
});

await run("R7 transcript append trims per-session transcripts to the configured line cap", async () => {
  // Transcripts are session_turns rows in nova.db; the runtime's legacy path options are accepted but ignored.
  const runtime = createSessionRuntime({
    sessionIdleMinutes: 120,
    sessionMainKey: "main",
    transcriptsEnabled: true,
    maxTranscriptLines: 3,
    transcriptRetentionDays: 30,
  });

  const session = runtime.resolveSessionContext({
    source: "hud",
    sender: "hud-user",
    userContextId: "retention-smoke-user",
    sessionKeyHint: "agent:nova:hud:user:retention-smoke-user:dm:trim-thread",
  });
  const { sessionId } = session.sessionEntry;

  for (let i = 0; i < 5; i += 1) {
    runtime.appendTranscriptTurn(sessionId, i % 2 === 0 ? "user" : "assistant", `turn-${i}`);
  }

  const turns = sessionsDb.loadSessionTurns("retention-smoke-user", sessionId);
  assert.equal(turns.length, 3);
  assert.equal(String(turns[0].content).includes("turn-2"), true);
  assert.equal(String(turns[2].content).includes("turn-4"), true);
});

await run("R8 transcript pruning removes stale user-scoped transcripts on session resolve", async () => {
  const runtime = createSessionRuntime({
    sessionIdleMinutes: 120,
    sessionMainKey: "main",
    transcriptsEnabled: true,
    maxTranscriptLines: 400,
    transcriptRetentionDays: 1,
  });

  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  sessionsDb.appendSessionTurn("retention-smoke-user", "stale-session", {
    role: "user",
    content: "stale",
    timestamp: threeDaysAgo,
  });
  sessionsDb.appendSessionTurn("retention-smoke-user", "fresh-session", {
    role: "user",
    content: "fresh",
    timestamp: Date.now(),
  });
  assert.equal(sessionsDb.loadSessionTurns("retention-smoke-user", "stale-session").length, 1);

  runtime.resolveSessionContext({
    source: "hud",
    sender: "hud-user",
    userContextId: "retention-smoke-user",
    sessionKeyHint: "agent:nova:hud:user:retention-smoke-user:dm:prune-thread",
  });

  assert.equal(sessionsDb.loadSessionTurns("retention-smoke-user", "stale-session").length, 0);
  assert.equal(sessionsDb.loadSessionTurns("retention-smoke-user", "fresh-session").length, 1);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
