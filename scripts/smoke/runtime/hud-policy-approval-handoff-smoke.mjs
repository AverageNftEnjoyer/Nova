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

const modulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "infrastructure",
  "hud-gateway",
  "message-handler",
  "index.js",
)).href;

const { handleHudGatewayMessage } = await import(modulePath);

await run("HPAH-1 accepted HUD op token grants persisted policy approval with scoped session key", async () => {
  const grantCalls = [];
  const ackCalls = [];
  const handleInputCalls = [];
  const acceptedKeys = [];
  const wsMessages = [];
  const ws = {
    readyState: 1,
    send(payload) {
      wsMessages.push(String(payload || ""));
    },
  };

  await handleHudGatewayMessage({
    ws,
    raw: Buffer.from(JSON.stringify({
      type: "hud_message",
      content: "reply to my latest gmail message",
      userId: "tenant-alpha",
      conversationId: "thread-alpha",
      opToken: "op-123",
      sender: "hud-user",
    })),
    connectionRateState: new Map(),
    deps: {
      checkWindowRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
      WS_CONN_RATE_MAX: 10,
      WS_CONN_RATE_WINDOW_MS: 1000,
      ensureSocketUserContextBinding: async () => ({ ok: true, userContextId: "tenant-alpha" }),
      stopSpeaking: () => {},
      getSystemMetrics: async () => ({}),
      hudRequestScheduler: {
        async enqueue({ run: runTask }) {
          return await runTask();
        },
        getSnapshot: () => ({}),
      },
      CALENDAR_EMIT_EVENT_TYPES: new Set(),
      sanitizeCalendarEventId: () => "",
      sanitizeCalendarPatch: () => ({}),
      sanitizeCalendarConflicts: () => [],
      broadcastCalendarEventUpdated: () => {},
      broadcastCalendarRescheduled: () => {},
      broadcastCalendarConflict: () => {},
      VOICE_MAP: {},
      getCurrentVoice: () => "nova",
      getVoiceEnabled: () => true,
      getBusy: () => false,
      setBusy: () => {},
      speak: async () => {},
      broadcastState: () => {},
      normalizeUserContextId: (value) => String(value || "").trim().toLowerCase(),
      wsContextBySocket: new WeakMap(),
      checkWsUserRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
      sessionRuntime: {
        normalizeUserContextId: (value) => String(value || "").trim().toLowerCase(),
      },
      sendHudStreamError: () => {
        throw new Error("sendHudStreamError should not be called");
      },
      trackConversationOwner: () => {},
      normalizeHudOpToken: (value) => String(value || "").trim(),
      reserveHudOpToken: () => ({ status: "reserved", key: "tenant-alpha::op-123" }),
      sendHudMessageAck: (_ws, payload) => {
        ackCalls.push(payload);
      },
      classifyHudRequestLane: () => "gmail",
      broadcastThinkingStatus: () => {},
      HUD_MIN_THINKING_PRESENCE_MS: 0,
      markHudOpTokenAccepted: (key, conversationId) => {
        acceptedKeys.push({ key, conversationId });
      },
      grantPolicyApproval: (payload) => {
        grantCalls.push(payload);
      },
      markHudWorkStart: () => {},
      markHudWorkEnd: () => {},
      handleInput: async (text, opts) => {
        handleInputCalls.push({ text, opts });
      },
      releaseHudOpTokenReservation: () => {},
      toErrorDetails: () => ({ message: "unused", code: "", status: 0, type: "" }),
      getMuted: () => false,
      setSuppressVoiceWakeUntilMs: () => {},
      broadcast: () => {},
      describeUnknownError: (error) => String(error?.message || error || ""),
      voiceProviderAdapter: {
        updateUserState: () => {},
      },
    },
  });

  assert.equal(wsMessages.length, 0);
  assert.equal(acceptedKeys.length, 1);
  assert.deepEqual(acceptedKeys[0], {
    key: "tenant-alpha::op-123",
    conversationId: "thread-alpha",
  });
  assert.equal(grantCalls.length, 1);
  assert.deepEqual(grantCalls[0], {
    userContextId: "tenant-alpha",
    conversationId: "thread-alpha",
    sessionKey: "agent:nova:hud:user:tenant-alpha:dm:thread-alpha",
    source: "hud_op_token",
  });
  assert.equal(ackCalls.length, 1);
  assert.equal(ackCalls[0]?.duplicate, false);
  assert.equal(handleInputCalls.length, 1);
  assert.equal(handleInputCalls[0]?.text, "reply to my latest gmail message");
  assert.equal(handleInputCalls[0]?.opts?.hudOpToken, "op-123");
  assert.equal(handleInputCalls[0]?.opts?.sessionKeyHint, "agent:nova:hud:user:tenant-alpha:dm:thread-alpha");
  assert.equal(handleInputCalls[0]?.opts?.userContextId, "tenant-alpha");
  assert.equal(handleInputCalls[0]?.opts?.conversationId, "thread-alpha");
});

await run("HPAH-2 hud messages without op tokens do not grant policy approval", async () => {
  let grantCount = 0;

  await handleHudGatewayMessage({
    ws: {
      readyState: 1,
      send() {},
    },
    raw: Buffer.from(JSON.stringify({
      type: "hud_message",
      content: "show gmail status",
      userId: "tenant-beta",
      conversationId: "thread-beta",
      sender: "hud-user",
    })),
    connectionRateState: new Map(),
    deps: {
      checkWindowRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
      WS_CONN_RATE_MAX: 10,
      WS_CONN_RATE_WINDOW_MS: 1000,
      ensureSocketUserContextBinding: async () => ({ ok: true, userContextId: "tenant-beta" }),
      stopSpeaking: () => {},
      getSystemMetrics: async () => ({}),
      hudRequestScheduler: {
        async enqueue({ run: runTask }) {
          return await runTask();
        },
        getSnapshot: () => ({}),
      },
      CALENDAR_EMIT_EVENT_TYPES: new Set(),
      sanitizeCalendarEventId: () => "",
      sanitizeCalendarPatch: () => ({}),
      sanitizeCalendarConflicts: () => [],
      broadcastCalendarEventUpdated: () => {},
      broadcastCalendarRescheduled: () => {},
      broadcastCalendarConflict: () => {},
      VOICE_MAP: {},
      getCurrentVoice: () => "nova",
      getVoiceEnabled: () => true,
      getBusy: () => false,
      setBusy: () => {},
      speak: async () => {},
      broadcastState: () => {},
      normalizeUserContextId: (value) => String(value || "").trim().toLowerCase(),
      wsContextBySocket: new WeakMap(),
      checkWsUserRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
      sessionRuntime: {
        normalizeUserContextId: (value) => String(value || "").trim().toLowerCase(),
      },
      sendHudStreamError: () => {
        throw new Error("sendHudStreamError should not be called");
      },
      trackConversationOwner: () => {},
      normalizeHudOpToken: (value) => String(value || "").trim(),
      reserveHudOpToken: () => ({ status: "reserved", key: "" }),
      sendHudMessageAck: () => {},
      classifyHudRequestLane: () => "gmail",
      broadcastThinkingStatus: () => {},
      HUD_MIN_THINKING_PRESENCE_MS: 0,
      markHudOpTokenAccepted: () => {},
      grantPolicyApproval: () => {
        grantCount += 1;
      },
      markHudWorkStart: () => {},
      markHudWorkEnd: () => {},
      handleInput: async () => {},
      releaseHudOpTokenReservation: () => {},
      toErrorDetails: () => ({ message: "unused", code: "", status: 0, type: "" }),
      getMuted: () => false,
      setSuppressVoiceWakeUntilMs: () => {},
      broadcast: () => {},
      describeUnknownError: (error) => String(error?.message || error || ""),
      voiceProviderAdapter: {
        updateUserState: () => {},
      },
    },
  });

  assert.equal(grantCount, 0);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
