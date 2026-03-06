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
  || `platform-contract-live-${Date.now()}`,
).trim();
const conversationId = String(
  args["conversation-id"]
  || process.env.NOVA_SMOKE_CONVERSATION_ID
  || "platform-contract-live-thread",
).trim();
const sessionKeyHint = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;

const workspaceRoot = process.cwd();
const chatHandlerModule = await import(
  pathToFileURL(path.join(workspaceRoot, "src/runtime/modules/chat/core/chat-handler/index.js")).href,
);
const chatUtilsModule = await import(
  pathToFileURL(path.join(workspaceRoot, "src/runtime/modules/chat/core/chat-utils/index.js")).href,
);
const shortTermModule = await import(
  pathToFileURL(path.join(workspaceRoot, "src/runtime/modules/chat/core/short-term-context-engine/index.js")).href,
);

const { handleInput } = chatHandlerModule;
const { getPendingMissionConfirm, clearPendingMissionConfirm } = chatUtilsModule;
const { readShortTermContextState, clearShortTermContextState } = shortTermModule;

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

function resolveScopedRoot(baseDir, scopedUserContextId) {
  const candidates = [
    path.join(baseDir, ".user", "user-context", scopedUserContextId),
    path.join(baseDir, "src", ".user", "user-context", scopedUserContextId),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

async function ask(prompt) {
  return await handleInput(prompt, {
    source: "hud",
    sender: "hud-user",
    voice: false,
    userContextId,
    conversationId,
    sessionKeyHint,
    runtimeSelectionOverride: createRuntimeSelectionOverride(),
  });
}

await run("PLATFORM-LIVE-1 mission confirmation flow stays on a stable scoped thread", async () => {
  clearPendingMissionConfirm({ userContextId, conversationId });
  clearShortTermContextState({ userContextId, conversationId, domainId: "mission_task" });

  const out1 = await ask("bill reminder on discord every friday at 5pm");
  const out2 = await ask("also make it daily at 6pm on discord");

  assert.equal(String(out1?.route || "").startsWith("mission_confirm"), true, `unexpected route=${out1?.route}`);
  assert.equal(String(out2?.route || "").startsWith("mission_confirm"), true, `unexpected route=${out2?.route}`);

  const pending = getPendingMissionConfirm({ userContextId, conversationId });
  const missionContext = readShortTermContextState({ userContextId, conversationId, domainId: "mission_task" });
  assert.equal(Boolean(pending?.prompt), true, "pending mission prompt missing");
  assert.equal(Boolean(missionContext?.slots?.pendingPrompt), true, "mission short-term prompt missing");
  assert.equal(String(missionContext?.slots?.pendingPrompt || ""), String(pending?.prompt || ""));
});

await run("PLATFORM-LIVE-2 artifacts and persisted mission state remain user-scoped", async () => {
  const scopedRoot = resolveScopedRoot(workspaceRoot, userContextId);
  const sessionsPath = path.join(scopedRoot, "state", "sessions.json");
  const sessions = readJson(sessionsPath, {});
  const sessionEntry = sessions[sessionKeyHint];
  assert.equal(Boolean(sessionEntry), true, "session entry missing");
  assert.equal(String(sessionEntry?.userContextId || ""), userContextId, "session user mismatch");

  const sessionId = String(sessionEntry?.sessionId || "").trim();
  assert.equal(sessionId.length > 0, true, "sessionId missing");

  const transcriptPath = path.join(scopedRoot, "transcripts", `${sessionId}.jsonl`);
  const logPath = path.join(scopedRoot, "logs", "conversation-dev.jsonl");
  const statePath = path.join(scopedRoot, "state", "short-term-context-state.json");

  assert.equal(fs.existsSync(transcriptPath), true, "transcript missing");
  assert.equal(fs.existsSync(logPath), true, "conversation log missing");
  assert.equal(fs.existsSync(statePath), true, "short-term context state missing");

  const transcriptEntries = readJsonl(transcriptPath);
  const logEntries = readJsonl(logPath);
  const transcriptHasPrompt = transcriptEntries.some((entry) => String(entry?.content || "").includes("bill reminder on discord every friday at 5pm"));
  const transcriptHasReply = transcriptEntries.some((entry) => String(entry?.content || "").includes("Do you want me to create it now?"));
  const logScoped = logEntries.some((entry) => (
    String(entry?.userContextId || "") === userContextId
    && String(entry?.conversationId || "") === conversationId
    && String(entry?.sessionKey || "") === sessionKeyHint
  ));
  assert.equal(transcriptHasPrompt, true, "transcript missing scoped user prompt");
  assert.equal(transcriptHasReply, true, "transcript missing assistant confirmation");
  assert.equal(logScoped, true, "conversation log missing scoped conversation");

  const state = readJson(statePath, {});
  const recordKey = `${conversationId}::mission_task`;
  assert.equal(Boolean(state?.records?.[recordKey]), true, "mission task record missing");

  console.log(JSON.stringify({
    userContextId,
    conversationId,
    sessionKeyHint,
    transcriptPath,
    logPath,
    statePath,
  }, null, 2));
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
