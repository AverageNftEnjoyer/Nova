import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readKv, readSessions, readTranscript, userContextDir } from "../lib/user-state-readers.mjs";

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

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonl(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8")
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
  } catch {
    return [];
  }
}

// File-based artifacts (logs/) live under the data dir; sessions, transcripts and follow-up state are nova.db rows.
function resolveScopedRoot(_baseDir, userContextId) {
  return userContextDir(userContextId);
}

const workspaceRoot = process.cwd();
const chatHandlerModule = await import(
  pathToFileURL(path.join(workspaceRoot, "src/runtime/modules/chat/core/chat-handler/index.js")).href,
);
const configModule = await import(
  pathToFileURL(path.join(workspaceRoot, "src/runtime/modules/infrastructure/config/index.js")).href,
);
const { handleInput } = chatHandlerModule;
const { sessionRuntime } = configModule;
const remindersStateModule = await import(
  pathToFileURL(path.join(workspaceRoot, "src/runtime/modules/services/reminders/follow-up-state/index.js")).href,
);
const { upsertReminderFollowUpState } = remindersStateModule;

async function runUserReminderFlow({ userContextId, conversationId, capturedHints }) {
  const sessionKeyHint = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;
  const runtimeSelectionOverride = {
    activeChatRuntime: {
      provider: "smoke-test",
      connected: true,
      apiKey: "smoke-test-key",
      model: "smoke-test-model",
      routeReason: "smoke-override",
      rankedCandidates: ["smoke-test"],
    },
    activeOpenAiCompatibleClient: null,
    selectedChatModel: "smoke-test-model",
  };
  const remindersWorker = async (text, ctx, _llmCtx, requestHints) => {
    if (ctx?.sessionId) {
      sessionRuntime.appendTranscriptTurn(ctx.sessionId, "user", String(ctx.raw_text || text || ""), {
        source: ctx.source,
        sender: ctx.sender || null,
        sessionKey: ctx.sessionKey || undefined,
        conversationId: ctx.conversationId || undefined,
      });
    }
    capturedHints.push({
      text: String(text || ""),
      requestHints: requestHints && typeof requestHints === "object" ? { ...requestHints } : {},
      userContextId: String(ctx?.userContextId || ""),
    });
    const reply = /\bchange\b/i.test(String(text || ""))
      ? "Reminder updated to 6pm."
      : "Reminder created for 5pm.";
    if (ctx?.sessionId) {
      sessionRuntime.appendTranscriptTurn(ctx.sessionId, "assistant", reply, {
        source: ctx.source,
        sender: "nova",
        sessionKey: ctx.sessionKey || undefined,
        conversationId: ctx.conversationId || undefined,
      });
    }
    return {
      route: "reminder",
      responseRoute: "reminder",
      ok: true,
      reply,
    };
  };

  const prompts = [
    "reminder status",
    "change it",
  ];
  for (const prompt of prompts) {
    const out = await handleInput(prompt, {
      source: "hud",
      sender: "hud-user",
      voice: false,
      userContextId,
      conversationId,
      sessionKeyHint,
      runtimeSelectionOverride,
      remindersWorker,
    });
    assert.equal(String(out?.route || ""), "reminder", "expected reminder route");
    assert.equal(String(out?.responseRoute || ""), "reminder", "expected reminder responseRoute");
    assert.equal(String(out?.sessionKey || ""), sessionKeyHint, "session key drifted");
    assert.equal(String(out?.reply || "").trim().length > 0, true, "empty reply");
  }

  return sessionKeyHint;
}

async function runRealReminderFlow({ userContextId, conversationId, prompts }) {
  const sessionKeyHint = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;
  const runtimeSelectionOverride = {
    activeChatRuntime: {
      provider: "smoke-test",
      connected: true,
      apiKey: "smoke-test-key",
      model: "smoke-test-model",
      routeReason: "smoke-override",
      rankedCandidates: ["smoke-test"],
    },
    activeOpenAiCompatibleClient: null,
    selectedChatModel: "smoke-test-model",
  };

  for (const prompt of prompts) {
    const out = await handleInput(prompt, {
      source: "hud",
      sender: "hud-user",
      voice: false,
      userContextId,
      conversationId,
      sessionKeyHint,
      runtimeSelectionOverride,
    });
    assert.equal(String(out?.route || ""), "reminder", "expected reminder route");
    assert.equal(String(out?.responseRoute || ""), "reminder", "expected reminder responseRoute");
    assert.equal(String(out?.sessionKey || ""), sessionKeyHint, "session key drifted");
    assert.equal(String(out?.reply || "").trim().length > 0, true, "empty reply");
  }

  return sessionKeyHint;
}

await run("REM-LIVE-1 reminders lane preserves follow-up hints across a stable thread", async () => {
  const userContextId = `smoke-reminders-live-${Date.now()}`;
  const conversationId = "reminders-live-thread-a";
  const capturedHints = [];
  await runUserReminderFlow({ userContextId, conversationId, capturedHints });

  assert.equal(capturedHints.length, 2);
  assert.equal(capturedHints[0]?.requestHints?.remindersShortTermFollowUp, false);
  assert.equal(capturedHints[1]?.requestHints?.remindersShortTermFollowUp, true);
  assert.equal(String(capturedHints[1]?.requestHints?.remindersShortTermContextSummary || "").trim().length > 0, true);
});

await run("REM-LIVE-2 reminders artifacts and persisted follow-up state stay user-scoped", async () => {
  const userA = `smoke-reminders-live-${Date.now()}-a`;
  const userB = `smoke-reminders-live-${Date.now()}-b`;
  const conversationId = "reminders-live-thread-shared";
  const capturedHintsA = [];
  const capturedHintsB = [];
  const sessionKeyA = await runUserReminderFlow({ userContextId: userA, conversationId, capturedHints: capturedHintsA });
  const sessionKeyB = await runUserReminderFlow({ userContextId: userB, conversationId, capturedHints: capturedHintsB });

  const rootA = resolveScopedRoot(workspaceRoot, userA);
  const rootB = resolveScopedRoot(workspaceRoot, userB);
  const sessionsA = readSessions(userA);
  const sessionsB = readSessions(userB);
  const sessionIdA = String(sessionsA?.[sessionKeyA]?.sessionId || "").trim();
  const sessionIdB = String(sessionsB?.[sessionKeyB]?.sessionId || "").trim();
  assert.equal(sessionIdA.length > 0, true, "user A session missing");
  assert.equal(sessionIdB.length > 0, true, "user B session missing");

  const transcriptLinesA = readTranscript(userA, sessionIdA);
  const transcriptLinesB = readTranscript(userB, sessionIdB);
  assert.equal(transcriptLinesA.length > 0, true, "user A transcript missing");
  assert.equal(transcriptLinesB.length > 0, true, "user B transcript missing");
  assert.equal(readTranscript(userB, sessionIdA).length, 0, "user A transcript leaked to user B");
  assert.equal(readTranscript(userA, sessionIdB).length, 0, "user B transcript leaked to user A");
  assert.equal(
    transcriptLinesA.some((line) => String(line?.meta?.sessionKey || "") === sessionKeyA),
    true,
    "user A transcript missing scoped session key",
  );
  assert.equal(
    transcriptLinesB.some((line) => String(line?.meta?.sessionKey || "") === sessionKeyB),
    true,
    "user B transcript missing scoped session key",
  );

  const convoLinesA = readJsonl(path.join(rootA, "logs", "conversation-dev.jsonl"))
    .filter((line) => String(line?.sessionKey || "") === sessionKeyA);
  const convoLinesB = readJsonl(path.join(rootB, "logs", "conversation-dev.jsonl"))
    .filter((line) => String(line?.sessionKey || "") === sessionKeyB);
  assert.equal(convoLinesA.some((line) => String(line?.route || "") === "reminder"), true, "user A log missing reminder route");
  assert.equal(convoLinesB.some((line) => String(line?.route || "") === "reminder"), true, "user B log missing reminder route");

  // Follow-up state is a kv_state row (namespace "reminders-follow-up") scoped to each user.
  const recordKey = `${conversationId}::reminders`;
  const recordA = readKv(userA, "reminders-follow-up", recordKey);
  const recordB = readKv(userB, "reminders-follow-up", recordKey);
  assert.equal(Boolean(recordA), true, "user A reminder state missing");
  assert.equal(Boolean(recordB), true, "user B reminder state missing");
  assert.equal(String(recordA?.userContextId || ""), userA.toLowerCase());
  assert.equal(String(recordB?.userContextId || ""), userB.toLowerCase());
  assert.equal(recordA?.slots?.followUpResolved, true);
  assert.equal(recordB?.slots?.followUpResolved, true);

  console.log(`Reminder artifact root A: ${rootA}`);
  console.log(`Reminder artifact root B: ${rootB}`);
});

await run("REM-LIVE-3 real reminders worker writes scoped transcripts and logs", async () => {
  const userContextId = `smoke-reminders-real-${Date.now()}`;
  const conversationId = "reminders-real-thread";
  upsertReminderFollowUpState({
    userContextId,
    conversationId,
    domainId: "reminders",
    topicAffinityId: "reminder_create",
    slots: {
      reminderId: "rem-live-1",
      reminderText: "review the report at 5pm",
      lastAction: "create",
    },
    ttlMs: 180000,
  });
  const sessionKeyHint = await runRealReminderFlow({
    userContextId,
    conversationId,
    prompts: [
      "reminder status",
      "reminder status",
    ],
  });

  const root = resolveScopedRoot(workspaceRoot, userContextId);
  const sessions = readSessions(userContextId);
  const sessionId = String(sessions?.[sessionKeyHint]?.sessionId || "").trim();
  assert.equal(sessionId.length > 0, true, "real reminder session missing");

  const transcriptLines = readTranscript(userContextId, sessionId);
  assert.equal(transcriptLines.length > 0, true, "real reminder transcript missing");
  assert.equal(
    transcriptLines.some((line) => String(line?.meta?.sessionKey || "") === sessionKeyHint),
    true,
    "real reminder transcript missing scoped session key",
  );

  const convoLines = readJsonl(path.join(root, "logs", "conversation-dev.jsonl"))
    .filter((line) => String(line?.sessionKey || "") === sessionKeyHint);
  assert.equal(convoLines.some((line) => String(line?.route || "") === "reminder"), true, "real reminder log missing reminder route");

  console.log(`Reminder real-worker artifact root: ${root}`);
  console.log(`Reminder real-worker transcript turns: ${transcriptLines.length}`);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
