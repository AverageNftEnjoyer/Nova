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

function resolveScopedRoot(baseDir, userContextId, sessionKeyHint) {
  const candidates = [
    path.join(baseDir, ".user", "user-context", userContextId),
  ];
  return candidates.find((candidate) => {
    const sessions = readJson(path.join(candidate, "state", "sessions.json"), {});
    return Boolean(sessions[sessionKeyHint]);
  }) || candidates.find((candidate) => fs.existsSync(candidate))
    || candidates[0];
}

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

const args = parseArgs(process.argv.slice(2));
const baseUserContextId = String(
  args["user-context-id"]
  || process.env.NOVA_SMOKE_USER_CONTEXT_ID
  || `org-chart-live-${Date.now()}`,
).trim();
const sharedConversationId = String(
  args["conversation-id"]
  || process.env.NOVA_SMOKE_CONVERSATION_ID
  || "org-chart-live-shared-thread",
).trim();
const workspaceRoot = process.cwd();

const chatHandlerModule = await import(
  pathToFileURL(path.join(workspaceRoot, "src/runtime/modules/chat/core/chat-handler/index.js")).href,
);
const { handleInput } = chatHandlerModule;

async function runLaneFlow({ userContextId, conversationId, prompt, lane, operatorLaneId, workerAgentId }) {
  const sessionKeyHint = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;
  const out = await handleInput(prompt, {
    source: "hud",
    sender: "hud-user",
    voice: false,
    userContextId,
    conversationId,
    sessionKeyHint,
    runtimeSelectionOverride: createRuntimeSelectionOverride(),
  });

  assert.equal(String(out?.sessionKey || ""), sessionKeyHint, "session key drifted");
  assert.equal(String(out?.route || ""), lane, `expected ${lane} route`);
  assert.equal(String(out?.responseRoute || ""), lane, `expected ${lane} responseRoute`);
  assert.equal(String(out?.reply || "").trim().length > 0, true, "empty reply");
  assert.equal(String(out?.requestHints?.operatorLane?.id || ""), operatorLaneId || lane, `expected ${operatorLaneId || lane} operator lane`);
  assert.equal(String(out?.requestHints?.operatorWorker?.agentId || ""), workerAgentId, `expected ${workerAgentId} worker`);
  return { out, sessionKeyHint };
}

await run("ORG-LIVE-1 real org-chart flows stay isolated across users on a shared conversation id", async () => {
  const userA = `${baseUserContextId}-diag`;
  const userB = `${baseUserContextId}-voice`;

  const flowA = await runLaneFlow({
    userContextId: userA,
    conversationId: sharedConversationId,
    prompt: "run diagnostics latency",
    lane: "diagnostic",
    operatorLaneId: "diagnostics",
    workerAgentId: "diagnostics-agent",
  });
  const flowB = await runLaneFlow({
    userContextId: userB,
    conversationId: sharedConversationId,
    prompt: "mute voice",
    lane: "voice",
    workerAgentId: "voice-agent",
  });

  const rootA = resolveScopedRoot(workspaceRoot, userA, flowA.sessionKeyHint);
  const rootB = resolveScopedRoot(workspaceRoot, userB, flowB.sessionKeyHint);
  const sessionsA = readJson(path.join(rootA, "state", "sessions.json"), {});
  const sessionsB = readJson(path.join(rootB, "state", "sessions.json"), {});
  const sessionIdA = String(sessionsA?.[flowA.sessionKeyHint]?.sessionId || "").trim();
  const sessionIdB = String(sessionsB?.[flowB.sessionKeyHint]?.sessionId || "").trim();

  assert.equal(sessionIdA.length > 0, true, "user A session missing");
  assert.equal(sessionIdB.length > 0, true, "user B session missing");

  const transcriptA = readJsonl(path.join(rootA, "transcripts", `${sessionIdA}.jsonl`));
  const transcriptB = readJsonl(path.join(rootB, "transcripts", `${sessionIdB}.jsonl`));
  assert.equal(
    transcriptA.some((line) => String(line?.meta?.sessionKey || "") === flowA.sessionKeyHint),
    true,
    "user A transcript missing scoped session key",
  );
  assert.equal(
    transcriptB.some((line) => String(line?.meta?.sessionKey || "") === flowB.sessionKeyHint),
    true,
    "user B transcript missing scoped session key",
  );
  assert.equal(
    transcriptA.some((line) => String(line?.content || "").includes("run diagnostics latency")),
    true,
    "user A transcript missing diagnostics prompt",
  );
  assert.equal(
    transcriptB.some((line) => String(line?.content || "").includes("mute voice")),
    true,
    "user B transcript missing voice prompt",
  );
  assert.equal(
    transcriptA.some((line) => String(line?.content || "").includes("mute voice")),
    false,
    "user A transcript leaked user B prompt",
  );
  assert.equal(
    transcriptB.some((line) => String(line?.content || "").includes("run diagnostics latency")),
    false,
    "user B transcript leaked user A prompt",
  );

  const convoLinesA = readJsonl(path.join(rootA, "logs", "conversation-dev.jsonl"))
    .filter((line) => String(line?.sessionKey || "") === flowA.sessionKeyHint);
  const convoLinesB = readJsonl(path.join(rootB, "logs", "conversation-dev.jsonl"))
    .filter((line) => String(line?.sessionKey || "") === flowB.sessionKeyHint);
  assert.equal(
    convoLinesA.some((line) => String(line?.route || "") === "diagnostic" && String(line?.userContextId || "") === userA),
    true,
    "user A log missing scoped diagnostic route",
  );
  assert.equal(
    convoLinesB.some((line) => String(line?.route || "") === "voice" && String(line?.userContextId || "") === userB),
    true,
    "user B log missing scoped voice route",
  );
  assert.equal(
    convoLinesA.some((line) => String(line?.userContextId || "") === userB),
    false,
    "user A log leaked user B context",
  );
  assert.equal(
    convoLinesB.some((line) => String(line?.userContextId || "") === userA),
    false,
    "user B log leaked user A context",
  );

  const voiceStateB = readJson(path.join(rootB, "state", "voice-user-settings.json"), {});
  assert.equal(
    String(voiceStateB?.settings?.userContextId || ""),
    userB.toLowerCase(),
    "voice state user mismatch",
  );
  assert.equal(voiceStateB?.settings?.muted, true, "voice muted state missing");

  console.log(JSON.stringify({
    userA,
    userB,
    sharedConversationId,
    artifactRootA: rootA,
    artifactRootB: rootB,
    sessionKeyA: flowA.sessionKeyHint,
    sessionKeyB: flowB.sessionKeyHint,
  }, null, 2));
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
