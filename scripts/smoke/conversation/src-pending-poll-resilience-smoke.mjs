import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

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

function assertIncludesAll(source, tokens, prefix = "missing token") {
  for (const token of tokens) {
    assert.equal(source.includes(token), true, `${prefix}: ${token}`);
  }
}

const [
  useNovaStateSource,
  useConversationsSource,
  conversationActionsSource,
  messagesRouteSource,
  chatHandlerSource,
  specialHandlersSource,
] = await Promise.all([
  readFile(path.join(process.cwd(), "hud/lib/chat/hooks/useNovaState.ts"), "utf8"),
  readFile(path.join(process.cwd(), "hud/lib/chat/hooks/useConversations.ts"), "utf8"),
  readFile(path.join(process.cwd(), "hud/lib/chat/hooks/use-conversations/conversation-actions.ts"), "utf8"),
  readFile(path.join(process.cwd(), "hud/app/api/threads/[threadId]/messages/route.ts"), "utf8"),
  readFile(path.join(process.cwd(), "src/runtime/modules/chat/core/chat-handler.js"), "utf8"),
  readFile(path.join(process.cwd(), "src/runtime/modules/chat/core/chat-special-handlers.js"), "utf8"),
]);

await run("P1 chat hook removed legacy merge hook pipeline", async () => {
  assert.equal(useConversationsSource.includes("useAgentMessageMerge"), false);
  assert.equal(useConversationsSource.includes("agent-merge"), false);
  assertIncludesAll(
    useConversationsSource,
    [
      "chatTransportEvents: ChatTransportEvent[]",
      "processedTransportSeqRef",
      "applyTransportEventToConversation",
      "if (event.type === \"assistant_stream_done\")",
    ],
    "single-stream reducer token missing",
  );
});

await run("P2 transport model ignores assistant plain message payloads", async () => {
  assertIncludesAll(
    useNovaStateSource,
    [
      "export type ChatTransportEvent",
      "setChatTransportEvents",
      "if (msg.role === \"assistant\") {",
      "Assistant plain `message` payloads are non-authoritative for chat rendering.",
      "pushChatTransportEvent({",
      "type: \"assistant_stream_start\"",
      "type: \"assistant_stream_delta\"",
      "type: \"assistant_stream_done\"",
    ],
    "transport event token missing",
  );
});

await run("P3 runtime emits stream lifecycle for duplicate and workflow replies", async () => {
  assert.equal(chatHandlerSource.includes("broadcastMessage(\"assistant\""), false);
  assert.equal(specialHandlersSource.includes("broadcastMessage(\"assistant\""), false);
  assertIncludesAll(
    chatHandlerSource,
    [
      "emitSingleChunkAssistantStream(",
      "broadcastAssistantStreamStart(streamId",
      "broadcastAssistantStreamDone(streamId",
    ],
    "duplicate stream token missing",
  );
  assertIncludesAll(
    specialHandlersSource,
    [
      "emitWorkflowAssistantReply",
      "broadcastAssistantStreamStart(streamId",
      "broadcastAssistantStreamDone(streamId",
    ],
    "workflow stream token missing",
  );
});

await run("P4 persistence route uses idempotent incremental upsert", async () => {
  assertIncludesAll(
    messagesRouteSource,
    [
      "stableUuidFromSeed",
      "buildStableMessageRowId",
      ".upsert(rows, { onConflict: \"id\" })",
    ],
    "upsert token missing",
  );
  assert.equal(messagesRouteSource.includes(".from(\"messages\")\n    .delete()"), false);
});

await run("P5 commit-boundary sync writes are explicit (not merge-loop timers)", async () => {
  assertIncludesAll(
    conversationActionsSource,
    [
      "void syncServerMessages(updated).catch(() => {})",
    ],
    "user commit sync token missing",
  );
  assertIncludesAll(
    useConversationsSource,
    [
      "if (syncConversationIds.size > 0)",
      "void syncServerMessages(convo).catch(() => {})",
    ],
    "assistant done sync token missing",
  );
  assert.equal(useConversationsSource.includes("scheduleServerSync"), false);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
