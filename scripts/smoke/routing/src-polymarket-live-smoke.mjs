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

const workspaceRoot = process.cwd();
const chatHandlerModule = await import(
  pathToFileURL(path.join(workspaceRoot, "src/runtime/modules/chat/core/chat-handler/index.js")).href,
);
const configModule = await import(
  pathToFileURL(path.join(workspaceRoot, "src/runtime/modules/infrastructure/config/index.js")).href,
);
const { handleInput } = chatHandlerModule;
const { sessionRuntime } = configModule;

async function runUserPolymarketFlow({ userContextId, conversationId, capturedHints }) {
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
  const polymarketWorker = async (text, ctx, _llmCtx, requestHints) => {
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
    const reply = /more odds/i.test(String(text || ""))
      ? "More Polymarket odds for BTC over 150k."
      : "Polymarket odds loaded for BTC over 150k.";
    if (ctx?.sessionId) {
      sessionRuntime.appendTranscriptTurn(ctx.sessionId, "assistant", reply, {
        source: ctx.source,
        sender: "nova",
        sessionKey: ctx.sessionKey || undefined,
        conversationId: ctx.conversationId || undefined,
      });
    }
    return {
      route: "polymarket",
      responseRoute: "polymarket",
      ok: true,
      reply,
    };
  };

  const prompts = [
    "show polymarket odds for btc over 150k by year end",
    "more odds on that market",
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
      polymarketWorker,
    });
    assert.equal(String(out?.route || ""), "polymarket", "expected polymarket route");
    assert.equal(String(out?.responseRoute || ""), "polymarket", "expected polymarket responseRoute");
    assert.equal(String(out?.sessionKey || ""), sessionKeyHint, "session key drifted");
    assert.equal(String(out?.reply || "").trim().length > 0, true, "empty reply");
  }

  return sessionKeyHint;
}

await run("POLY-LIVE-1 polymarket lane preserves follow-up hints across a stable thread", async () => {
  const userContextId = `smoke-polymarket-live-${Date.now()}`;
  const conversationId = "polymarket-live-thread-a";
  const capturedHints = [];
  await runUserPolymarketFlow({ userContextId, conversationId, capturedHints });

  assert.equal(capturedHints.length, 2);
  assert.equal(capturedHints[0]?.requestHints?.polymarketShortTermFollowUp, false);
  assert.equal(capturedHints[1]?.requestHints?.polymarketShortTermFollowUp, true);
  assert.equal(String(capturedHints[1]?.requestHints?.polymarketShortTermContextSummary || "").trim().length > 0, true);
});

await run("POLY-LIVE-2 polymarket artifacts remain scoped to the requesting user", async () => {
  const userA = `smoke-polymarket-live-${Date.now()}-a`;
  const userB = `smoke-polymarket-live-${Date.now()}-b`;
  const conversationId = "polymarket-live-thread-shared";
  const capturedHintsA = [];
  const capturedHintsB = [];
  const sessionKeyA = await runUserPolymarketFlow({ userContextId: userA, conversationId, capturedHints: capturedHintsA });
  const sessionKeyB = await runUserPolymarketFlow({ userContextId: userB, conversationId, capturedHints: capturedHintsB });

  const rootA = resolveScopedRoot(workspaceRoot, userA, sessionKeyA);
  const rootB = resolveScopedRoot(workspaceRoot, userB, sessionKeyB);
  const sessionsA = readJson(path.join(rootA, "state", "sessions.json"), {});
  const sessionsB = readJson(path.join(rootB, "state", "sessions.json"), {});
  const sessionIdA = String(sessionsA?.[sessionKeyA]?.sessionId || "").trim();
  const sessionIdB = String(sessionsB?.[sessionKeyB]?.sessionId || "").trim();
  assert.equal(sessionIdA.length > 0, true, "user A session missing");
  assert.equal(sessionIdB.length > 0, true, "user B session missing");

  const transcriptA = path.join(rootA, "transcripts", `${sessionIdA}.jsonl`);
  const transcriptB = path.join(rootB, "transcripts", `${sessionIdB}.jsonl`);
  assert.equal(fs.existsSync(transcriptA), true, "user A transcript missing");
  assert.equal(fs.existsSync(transcriptB), true, "user B transcript missing");

  const transcriptLinesA = readJsonl(transcriptA);
  const transcriptLinesB = readJsonl(transcriptB);
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
  assert.equal(convoLinesA.some((line) => String(line?.route || "") === "polymarket"), true, "user A log missing polymarket route");
  assert.equal(convoLinesB.some((line) => String(line?.route || "") === "polymarket"), true, "user B log missing polymarket route");

  console.log(`Polymarket artifact root A: ${rootA}`);
  console.log(`Polymarket artifact root B: ${rootB}`);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
