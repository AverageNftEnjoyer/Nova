import assert from "node:assert/strict";
import fs from "node:fs";
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

function parseArgs(argv = []) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = String(argv[i + 1] || "").trim();
    if (!next || next.startsWith("--")) {
      out[key] = "1";
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
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

const args = parseArgs(process.argv.slice(2));
const userContextId = String(
  args["user-context-id"]
  || process.env.NOVA_SMOKE_USER_CONTEXT_ID
  || `calendar-live-${Date.now()}`,
).trim();

const conversationId = String(args["conversation-id"] || `calendar-live-${Date.now()}`).trim();
const sessionKeyHint = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;
const futureStartAt = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();

const persistenceModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/services/missions/persistence/index.js")).href,
);
const chatHandlerModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/core/chat-handler/index.js")).href,
);
const configModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/infrastructure/config/index.js")).href,
);
const { upsertMission } = persistenceModule;
const { handleInput } = chatHandlerModule;
const { sessionRuntime } = configModule;

function createRuntimeSelectionOverride() {
  return {
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
}

const missionId = `calendar-smoke-${Date.now()}`;
await upsertMission({
  id: missionId,
  userId: userContextId,
  label: "Daily Brief",
  description: "Calendar live smoke mission",
  status: "active",
  category: "ops",
  nodes: [{
    id: "trigger-1",
    type: "schedule-trigger",
    triggerMode: "daily",
    triggerTime: "09:00",
    triggerTimezone: "America/New_York",
  }],
  connections: [],
  variables: [],
  settings: { timezone: "America/New_York", retryOnFail: false, retryCount: 0 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}, userContextId);

async function ask(text) {
  const calendarWorker = async (inputText, ctx) => {
    const reply = /scheduler/i.test(String(inputText || ""))
      ? "Calendar scheduler is user-scoped and healthy."
      : /clear/i.test(String(inputText || ""))
        ? "Cleared the calendar override for Daily Brief."
        : /reschedule/i.test(String(inputText || ""))
          ? `Calendar updated for Daily Brief: moved to ${futureStartAt}.`
          : "Calendar this week:\n- Daily Brief at Fri, Mar 6, 9:00 AM";
    if (ctx?.sessionId) {
      sessionRuntime.appendTranscriptTurn(ctx.sessionId, "user", String(ctx.raw_text || inputText || ""), {
        source: ctx.source,
        sender: ctx.sender || null,
        sessionKey: ctx.sessionKey || undefined,
        conversationId: ctx.conversationId || undefined,
      });
      sessionRuntime.appendTranscriptTurn(ctx.sessionId, "assistant", reply, {
        source: ctx.source,
        sender: "nova",
        sessionKey: ctx.sessionKey || undefined,
        conversationId: ctx.conversationId || undefined,
      });
    }
    return {
      route: "calendar",
      responseRoute: "calendar",
      ok: true,
      reply,
    };
  };
  return await handleInput(text, {
    source: "hud",
    sender: "hud-user",
    voice: false,
    userContextId,
    conversationId,
    sessionKeyHint,
    runtimeSelectionOverride: createRuntimeSelectionOverride(),
    calendarWorker,
  });
}

function resolveUserContextRootCandidates(baseDir, uid) {
  return [
    path.join(baseDir, ".user", "user-context", uid),
  ];
}

const userContextRootCandidates = resolveUserContextRootCandidates(process.cwd(), userContextId);

await run("CAL-LIVE-1 calendar prompts stay on calendar lane", async () => {
  const prompts = [
    "calendar status",
    `calendar reschedule Daily Brief to ${futureStartAt}`,
    "clear calendar override for Daily Brief",
    "calendar scheduler status",
  ];
  for (const prompt of prompts) {
    const out = await ask(prompt);
    assert.equal(String(out?.sessionKey || ""), sessionKeyHint, "session key drifted");
    assert.equal(String(out?.route || ""), "calendar", `expected calendar route for prompt=${JSON.stringify(prompt)}`);
    assert.equal(String(out?.responseRoute || ""), "calendar", "expected calendar responseRoute");
    assert.equal(String(out?.reply || "").trim().length > 0, true, "empty reply");
  }
});

await run("CAL-LIVE-2 calendar artifacts are scoped to the requested user context", async () => {
  const resolvedRoot = userContextRootCandidates.find((candidate) => {
    const sessionsPath = path.join(candidate, "state", "sessions.json");
    const sessions = readJson(sessionsPath, {});
    return Boolean(sessions[sessionKeyHint]);
  }) || userContextRootCandidates.find((candidate) => fs.existsSync(candidate))
    || userContextRootCandidates[0];

  const sessionsPath = path.join(resolvedRoot, "state", "sessions.json");
  const sessions = readJson(sessionsPath, {});
  const scopedSession = sessions[sessionKeyHint];
  assert.equal(Boolean(scopedSession), true, "session entry missing");
  const sessionId = String(scopedSession?.sessionId || "").trim();
  assert.equal(sessionId.length > 0, true, "sessionId missing");

  const transcriptPath = path.join(resolvedRoot, "transcripts", `${sessionId}.jsonl`);
  assert.equal(fs.existsSync(transcriptPath), true, "transcript file missing");
  const transcriptEntries = readJsonl(transcriptPath);
  const transcriptMatch = transcriptEntries.some((line) => String(line?.meta?.sessionKey || "") === sessionKeyHint);
  assert.equal(transcriptMatch, true, "transcript entries missing scoped session key");

  const convoLogPath = path.join(resolvedRoot, "logs", "conversation-dev.jsonl");
  assert.equal(fs.existsSync(convoLogPath), true, "conversation-dev log missing");
  const convoLines = readJsonl(convoLogPath);
  const scopedLines = convoLines.filter((line) =>
    String(line?.sessionKey || "") === sessionKeyHint
    && String(line?.conversationId || "") === conversationId,
  );
  assert.equal(scopedLines.length >= 2, true, "expected scoped conversation-dev lines");
  const hasCalendarLine = scopedLines.some((line) => String(line?.route || "") === "calendar");
  assert.equal(hasCalendarLine, true, "expected calendar route evidence in conversation-dev lines");

  const overridesPath = path.join(resolvedRoot, "calendar", "calendar-overrides.json");
  if (fs.existsSync(overridesPath)) {
    const overrides = readJson(overridesPath, []);
    assert.equal(Array.isArray(overrides), true, "override store invalid");
  }

  console.log(`Artifact root: ${resolvedRoot}`);
  console.log(`Artifact conversationId: ${conversationId}`);
  console.log(`Artifact sessionKeyHint: ${sessionKeyHint}`);
  console.log(`Artifact transcript: ${transcriptPath}`);
  console.log(`Artifact conversationLog: ${convoLogPath}`);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
