import assert from "node:assert/strict";
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

const userContextId = String(process.env.NOVA_SMOKE_USER_CONTEXT_ID || "").trim();
if (!userContextId) {
  record(
    "SKIP",
    "Workstream E session-key smoke requires NOVA_SMOKE_USER_CONTEXT_ID",
    "Set env var and rerun for real user-context session continuity checks.",
  );
  summarize(results[0]);
  process.exit(0);
}

const chatHandlerModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/core/chat-handler/index.js")).href,
);
const useConversationsSource = await import("node:fs/promises").then((fsp) =>
  fsp.readFile(path.join(process.cwd(), "hud/lib/chat/hooks/useConversations.ts"), "utf8"),
);
const conversationActionsSource = await import("node:fs/promises").then((fsp) =>
  fsp.readFile(path.join(process.cwd(), "hud/lib/chat/hooks/use-conversations/conversation-actions.ts"), "utf8"),
);
const conversationSharedSource = await import("node:fs/promises").then((fsp) =>
  fsp.readFile(path.join(process.cwd(), "hud/lib/chat/hooks/use-conversations/shared.ts"), "utf8"),
);
const chatShellControllerSource = await import("node:fs/promises").then((fsp) =>
  fsp.readFile(path.join(process.cwd(), "hud/app/chat/components/chat-shell-controller.tsx"), "utf8"),
);
const useNovaStateSource = await import("node:fs/promises").then((fsp) =>
  fsp.readFile(path.join(process.cwd(), "hud/lib/chat/hooks/useNovaState.ts"), "utf8"),
);

const { handleInput } = chatHandlerModule;

const ts = Date.now();
const optimisticConversationId = `${ts}-optsmoke`;
const serverConversationId = `srv-${ts}-mapped`;
const sessionKeyHint = `agent:nova:hud:user:${userContextId}:dm:${optimisticConversationId}`;

await run("E1 runtime keeps stable session key across optimistic/server conversation id remap", async () => {
  const prompts = [
    { conversationId: optimisticConversationId, text: "Confirm session continuity with one short sentence." },
    { conversationId: serverConversationId, text: "Now continue in the same conversation and reply with one word." },
    { conversationId: serverConversationId, text: "State the current conversation id you received in one line." },
  ];

  const observedSessionKeys = new Set();
  for (const prompt of prompts) {
    const result = await handleInput(prompt.text, {
      source: "hud",
      sender: "hud-user",
      voice: false,
      userContextId,
      conversationId: prompt.conversationId,
      sessionKeyHint,
    });
    const reply = String(result?.reply || "").trim();
    assert.equal(reply.length > 0, true, `empty reply for conversation=${prompt.conversationId}`);
    const sessionKey = String(result?.sessionKey || "").trim();
    assert.equal(sessionKey.length > 0, true, "missing sessionKey in runtime summary");
    observedSessionKeys.add(sessionKey);
  }

  assert.equal(observedSessionKeys.size, 1, `expected one stable session key, got ${[...observedSessionKeys].join(", ")}`);
  assert.equal(observedSessionKeys.has(sessionKeyHint), true, "runtime did not honor provided sessionKeyHint");
});

await run("E2 HUD hook keeps canonical session id mapping across optimistic/server merges", async () => {
  const requiredGroups = [
    ["const reconcileOptimisticConversationMappings = useCallback(", useConversationsSource],
    ["optimisticMap.set(localId, matchedServerConvo.id)", useConversationsSource],
    ["sessionMap.set(matchedServerConvo.id, canonicalSessionId)", useConversationsSource],
    ["const resolveConversationSelectionId = useCallback(", useConversationsSource],
    ["const selectedActiveId = resolveConversationSelectionId(activeId || \"\", mergedConvos)", useConversationsSource],
    ["const selectedLocalId = resolveConversationSelectionId(id, conversations)", conversationActionsSource],
    ["reconcileOptimisticConversationMappings(localSnapshot, convos)", useConversationsSource],
    ["reconcileOptimisticConversationMappings(conversations, remote)", conversationActionsSource],
  ];
  for (const [token, source] of requiredGroups) {
    assert.equal(source.includes(token), true, `missing conversation mapping token: ${token}`);
  }
});

await run("E3 chat handoff resolves optimistic/server convo remap before pending send", async () => {
  const requiredTokens = [
    "const resolvedPendingConvoId = pendingConvoId",
    "resolveConversationIdForAgent(pendingConvoId) || pendingConvoId",
    "if (resolvedPendingConvoId && resolvedPendingConvoId !== activeConvo.id)",
    "void handleSelectConvo(resolvedPendingConvoId)",
    "const activeUserId = getActiveUserId()",
    "if (!activeUserId) {",
    "pendingBootSendHandledRef.current = true",
    "sessionStorage.removeItem(PENDING_CHAT_SESSION_KEY)",
  ];
  for (const token of requiredTokens) {
    assert.equal(
      chatShellControllerSource.includes(token),
      true,
      `missing chat-shell remap token: ${token}`,
    );
  }
  const activeUserCheckIdx = chatShellControllerSource.indexOf("const activeUserId = getActiveUserId()");
  const clearPendingIdx = chatShellControllerSource.indexOf("pendingBootSendHandledRef.current = true", activeUserCheckIdx);
  assert.equal(activeUserCheckIdx >= 0 && clearPendingIdx > activeUserCheckIdx, true, "pending message cleared before user id check");
});

await run("E4 thinking indicator and assistant echo dedupe guards are present", async () => {
  const shellTokenSets = [
    [
      "const isBackendThinking = novaState === \"thinking\"",
      "const isThinking = isBackendThinking || localThinking || activeConversationStreaming",
      "setLocalThinking(true)",
    ],
    [
      "const isThinking = useMemo(() => {",
      "if (novaState === \"thinking\") return true",
      "if (streamingAssistantId) return true",
      "if (activeConversationStreaming) return true",
    ],
    [
      "const activeConversationStreaming = useMemo(() => {",
      "for (let i = chatTransportEvents.length - 1; i >= 0; i -= 1)",
      "if (event.type === \"assistant_stream_done\") return false",
      "if (event.type === \"assistant_stream_start\" || event.type === \"assistant_stream_delta\") return true",
    ],
  ];
  const shellGuardPresent = shellTokenSets.some((tokenSet) =>
    tokenSet.every((token) => chatShellControllerSource.includes(token)));
  assert.equal(shellGuardPresent, true, "missing thinking guard implementation in chat shell controller");

  const dedupeTokenSets = [
    [
      "const ASSISTANT_ECHO_DEDUP_MS",
      "Backend can emit a final assistant \"message\" event right after stream completion.",
      "const closeInTime = Math.abs(incomingTs - lastTs) <= ASSISTANT_ECHO_DEDUP_MS",
      "if (closeInTime && (sameText || semanticallySame)) {",
    ],
    [
      "const HUD_USER_ECHO_DEDUPE_MS",
      "assistant_msg:${conversationId}:${normalizedForDedupe}",
      "if (msg.role === \"assistant\") {",
      "Stream lifecycle events are the single source of truth.",
    ],
  ];
  const dedupeGuardPresent = dedupeTokenSets.some((tokenSet) =>
    tokenSet.every((token) => useConversationsSource.includes(token) || useNovaStateSource.includes(token)));
  assert.equal(dedupeGuardPresent, true, "missing assistant dedupe guard implementation");
});

await run("E5 optimistic/server thread merge prevents duplicate sidebar rows and misrouted replies", async () => {
  const requiredGroups = [
    ["const optimisticIdToServerIdRef = useRef<Map<string, string>>(new Map())", useConversationsSource],
    ["if (mappedServerId && remoteIds.has(mappedServerId)) return false", conversationSharedSource],
    ["const preSyncNext = beforeSyncConversations", conversationActionsSource],
    [".map((c) => (c.id === convo.id || c.id === serverConvo.id ? seededServerConvo : c))", conversationActionsSource],
    ["persist(preSyncNext, preSyncActive)", conversationActionsSource],
  ];
  for (const [token, source] of requiredGroups) {
    assert.equal(source.includes(token), true, `missing optimistic/server reconciliation token: ${token}`);
  }

  const preSyncPersistIdx = conversationActionsSource.indexOf("persist(preSyncNext, preSyncActive)");
  const syncIdx = conversationActionsSource.indexOf("const synced = await syncServerMessages(seededServerConvo)");
  assert.equal(
    preSyncPersistIdx >= 0 && syncIdx > preSyncPersistIdx,
    true,
    "optimistic conversation replacement should happen before server message sync",
  );
});

await run("E6 async optimistic replacement preserves currently active conversation", async () => {
  const requiredGroups = [
    ["const latestActiveConvoIdRef = useRef<string>(\"\")", useConversationsSource],
    ["latestActiveConvoIdRef.current = String(activeConvo?.id || \"\").trim()", useConversationsSource],
    ["const latestActiveId = latestActiveConvoIdRef.current", conversationActionsSource],
    ["const refreshedActiveId = latestActiveConvoIdRef.current", conversationActionsSource],
  ];
  for (const [token, source] of requiredGroups) {
    assert.equal(source.includes(token), true, `missing active-conversation race guard token: ${token}`);
  }
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
