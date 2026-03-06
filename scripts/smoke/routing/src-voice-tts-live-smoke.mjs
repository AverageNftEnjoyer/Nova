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

function resolveUserContextRootCandidates(baseDir, userContextId) {
  return [
    path.join(baseDir, ".user", "user-context", userContextId),
    path.join(baseDir, "src", ".user", "user-context", userContextId),
  ];
}

function resolveScopedRoot(baseDir, userContextId, sessionKeyHint) {
  const candidates = resolveUserContextRootCandidates(baseDir, userContextId);
  return candidates.find((candidate) => {
    const sessions = readJson(path.join(candidate, "state", "sessions.json"), {});
    return Boolean(sessions[sessionKeyHint]);
  }) || candidates.find((candidate) => fs.existsSync(candidate))
    || candidates[0];
}

const args = parseArgs(process.argv.slice(2));
const baseUserContextId = String(
  args["user-context-id"]
  || process.env.NOVA_SMOKE_USER_CONTEXT_ID
  || `voice-tts-live-${Date.now()}`
).trim();
const workspaceRoot = process.cwd();

const chatHandlerModule = await import(
  pathToFileURL(path.join(workspaceRoot, "src/runtime/modules/chat/core/chat-handler/index.js")).href,
);
const configModule = await import(
  pathToFileURL(path.join(workspaceRoot, "src/runtime/modules/infrastructure/config/index.js")).href,
);
const shortTermContextModule = await import(
  pathToFileURL(path.join(workspaceRoot, "src/runtime/modules/chat/core/short-term-context-engine/index.js")).href,
);
const { handleInput } = chatHandlerModule;
const { sessionRuntime } = configModule;
const { readShortTermContextState } = shortTermContextModule;

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

async function runLaneFlow({
  userContextId,
  conversationId,
  prompts,
  lane,
}) {
  const sessionKeyHint = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;
  const runtimeSelectionOverride = createRuntimeSelectionOverride();
  const outputs = [];
  const voiceWorker = lane === "voice"
    ? async (text, ctx, _llmCtx, requestHints) => {
      const reply = /status/i.test(String(text || "")) ? "Voice is muted." : "Voice muted.";
      if (ctx?.sessionId) {
        sessionRuntime.appendTranscriptTurn(ctx.sessionId, "user", String(ctx.raw_text || text || ""), {
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
      return { route: "voice", responseRoute: "voice", ok: true, reply, requestHints };
    }
    : undefined;
  const ttsWorker = lane === "tts"
    ? async (text, ctx, _llmCtx, requestHints) => {
      const reply = /stop/i.test(String(text || "")) ? "Stopped TTS playback." : "TTS is ready.";
      if (ctx?.sessionId) {
        sessionRuntime.appendTranscriptTurn(ctx.sessionId, "user", String(ctx.raw_text || text || ""), {
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
      return { route: "tts", responseRoute: "tts", ok: true, reply, requestHints };
    }
    : undefined;

  for (const prompt of prompts) {
    const out = await handleInput(prompt, {
      source: "hud",
      sender: "hud-user",
      voice: false,
      userContextId,
      conversationId,
      sessionKeyHint,
      runtimeSelectionOverride,
      voiceWorker,
      ttsWorker,
    });

    assert.equal(String(out?.sessionKey || ""), sessionKeyHint, "session key drifted");
    assert.equal(String(out?.route || ""), lane, `expected ${lane} route`);
    assert.equal(String(out?.responseRoute || ""), lane, `expected ${lane} responseRoute`);
    assert.equal(String(out?.reply || "").trim().length > 0, true, "empty reply");
    assert.equal(String(out?.telemetry?.userContextId || ""), userContextId, "user context drifted");
    assert.equal(String(out?.telemetry?.conversationId || ""), conversationId, "conversation drifted");
    assert.equal(String(out?.requestHints?.operatorLane?.id || ""), lane, `expected ${lane} operator lane`);
    assert.equal(String(out?.requestHints?.operatorWorker?.agentId || ""), `${lane}-agent`, `expected ${lane} worker`);
    outputs.push(out);
  }

  return { sessionKeyHint, outputs };
}

await run("VT-LIVE-1 voice lane routes through the real voice worker/service path with stable session context", async () => {
  const userContextId = `${baseUserContextId}-voice`;
  const conversationId = "voice-live-thread";
  const { outputs } = await runLaneFlow({
    userContextId,
    conversationId,
    prompts: ["mute voice", "voice status"],
    lane: "voice",
  });

  assert.equal(outputs.some((entry) => String(entry?.reply || "").includes("muted")), true);
});

await run("VT-LIVE-2 tts lane routes through the real tts worker/service path with stable session context", async () => {
  const userContextId = `${baseUserContextId}-tts`;
  const conversationId = "tts-live-thread";
  const { outputs } = await runLaneFlow({
    userContextId,
    conversationId,
    prompts: ["tts status", "stop tts"],
    lane: "tts",
  });

  assert.equal(outputs.some((entry) => String(entry?.reply || "").includes("Stopped TTS playback")), true);
});

await run("VT-LIVE-3 voice and tts artifacts remain user-scoped across shared conversation ids", async () => {
  const sharedConversationId = "voice-tts-shared-thread";
  const expectations = [
    { userContextId: `${baseUserContextId}-voice-a`, lane: "voice", prompt: "mute voice", domainId: "voice" },
    { userContextId: `${baseUserContextId}-voice-b`, lane: "voice", prompt: "mute voice", domainId: "voice" },
    { userContextId: `${baseUserContextId}-tts-a`, lane: "tts", prompt: "tts status", domainId: "tts" },
    { userContextId: `${baseUserContextId}-tts-b`, lane: "tts", prompt: "stop tts", domainId: "tts" },
  ];

  for (const expected of expectations) {
    const { sessionKeyHint } = await runLaneFlow({
      userContextId: expected.userContextId,
      conversationId: sharedConversationId,
      prompts: [expected.prompt],
      lane: expected.lane,
    });

    const root = resolveScopedRoot(workspaceRoot, expected.userContextId, sessionKeyHint);
    const sessions = readJson(path.join(root, "state", "sessions.json"), {});
    const sessionEntry = sessions[sessionKeyHint];
    assert.equal(Boolean(sessionEntry), true, `session missing for ${expected.userContextId}`);
    const sessionId = String(sessionEntry?.sessionId || "").trim();
    assert.equal(sessionId.length > 0, true, `sessionId missing for ${expected.userContextId}`);

    const transcriptPath = path.join(root, "transcripts", `${sessionId}.jsonl`);
    assert.equal(fs.existsSync(transcriptPath), true, `transcript missing for ${expected.userContextId}`);
    const transcriptLines = readJsonl(transcriptPath);
    assert.equal(
      transcriptLines.some((line) => String(line?.meta?.sessionKey || "") === sessionKeyHint),
      true,
      `session key missing in transcript for ${expected.userContextId}`,
    );

    const convoLines = readJsonl(path.join(root, "logs", "conversation-dev.jsonl"))
      .filter((line) => String(line?.sessionKey || "") === sessionKeyHint);
    assert.equal(
      convoLines.some((line) => String(line?.route || "") === expected.lane),
      true,
      `conversation log missing ${expected.lane} route for ${expected.userContextId}`,
    );

    const shortTermState = readShortTermContextState({
      userContextId: expected.userContextId,
      conversationId: sharedConversationId,
      domainId: expected.domainId,
    });
    assert.equal(Boolean(shortTermState?.userContextId), true, `short-term state missing for ${expected.userContextId}`);
    assert.equal(String(shortTermState?.userContextId || ""), expected.userContextId.toLowerCase(), `short-term state user mismatch for ${expected.userContextId}`);

    console.log(`Voice/TTS artifact root (${expected.userContextId}): ${root}`);
  }
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
