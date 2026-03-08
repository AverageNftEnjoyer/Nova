import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.NOVA_WS_STREAM_DELTA_BATCH_MS = "20";
process.env.NOVA_WS_BUFFERED_AMOUNT_SOFT_LIMIT_BYTES = "64";
process.env.NOVA_HUD_STATE_COMPACT_WINDOW_MS = "120";
process.env.NOVA_HUD_THINKING_STATUS_COMPACT_WINDOW_MS = "120";

const gatewayModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/infrastructure/hud-gateway/index.js")).href,
);
const messageHandlerModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/infrastructure/hud-gateway/message-handler/index.js")).href,
);

const {
  __hudGatewayTestUtils,
  broadcastAssistantStreamDelta,
  broadcastAssistantStreamDone,
  broadcastAssistantStreamStart,
  broadcastState,
  broadcastThinkingStatus,
  sendWsPayload,
} = gatewayModule;
const { handleHudGatewayMessage } = messageHandlerModule;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakeSocket() {
  const sent = [];
  const closed = [];
  return {
    readyState: 1,
    bufferedAmount: 0,
    sent,
    closed,
    send(payload) {
      sent.push(JSON.parse(payload));
    },
    close(code, reason) {
      closed.push({ code, reason });
      this.readyState = 3;
    },
  };
}

await run("P1-WS-1 assistant stream deltas batch per scoped socket set and stay user-scoped", async () => {
  __hudGatewayTestUtils.resetState();
  const socketA = createFakeSocket();
  const socketB = createFakeSocket();
  __hudGatewayTestUtils.setServer({ clients: new Set([socketA, socketB]) });
  __hudGatewayTestUtils.bindSocketToUserContext(socketA, "user-a");
  __hudGatewayTestUtils.bindSocketToUserContext(socketB, "user-b");
  socketA.sent.length = 0;
  socketB.sent.length = 0;

  broadcastAssistantStreamStart("stream-1", "hud", undefined, "thread-a", "user-a");
  broadcastAssistantStreamDelta("stream-1", "hel", "hud", undefined, "thread-a", "user-a");
  broadcastAssistantStreamDelta("stream-1", "lo", "hud", undefined, "thread-a", "user-a");

  await sleep(35);

  assert.deepEqual(
    socketA.sent.map((entry) => entry.type),
    ["assistant_stream_start", "assistant_stream_delta"],
  );
  assert.equal(socketA.sent[1].content, "hello");
  assert.equal(socketB.sent.length, 0, "other users must not receive scoped assistant deltas");

  broadcastAssistantStreamDone("stream-1", "hud", undefined, "thread-a", "user-a");
  assert.deepEqual(
    socketA.sent.map((entry) => entry.type),
    ["assistant_stream_start", "assistant_stream_delta", "assistant_stream_done"],
  );
  assert.equal(__hudGatewayTestUtils.getPendingAssistantStreamDeltaCount(), 0);
});

await run("P1-WS-2 slow consumers are closed and unbound by the guarded sender", async () => {
  __hudGatewayTestUtils.resetState();
  const slowSocket = createFakeSocket();
  __hudGatewayTestUtils.bindSocketToUserContext(slowSocket, "slow-user");
  slowSocket.sent.length = 0;
  slowSocket.bufferedAmount = 10 * 1024 * 1024;

  const delivered = sendWsPayload(slowSocket, JSON.stringify({ type: "state", state: "thinking", ts: Date.now() }));

  assert.equal(delivered, false);
  assert.equal(slowSocket.closed.length, 1);
  assert.deepEqual(slowSocket.closed[0], { code: 1013, reason: "slow_consumer" });
  assert.equal(__hudGatewayTestUtils.getScopedSocketCount("slow-user"), 0);
});

await run("P1-WS-3 message-handler routes direct replies through backpressure-aware sendWsPayload", async () => {
  const writes = [];
  const socket = createFakeSocket();

  await handleHudGatewayMessage({
    ws: socket,
    raw: Buffer.from(JSON.stringify({ type: "request_system_metrics" })),
    connectionRateState: { count: 0, resetAt: Date.now() + 1_000 },
    deps: {
      checkWindowRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
      WS_CONN_RATE_MAX: 10,
      WS_CONN_RATE_WINDOW_MS: 1_000,
      getSystemMetrics: async () => ({ cpu: { usage: 12 } }),
      hudRequestScheduler: { getSnapshot: () => ({ pending: 0 }) },
      describeUnknownError: (error) => (error instanceof Error ? error.message : String(error)),
      sendWsPayload: (_ws, payload) => {
        writes.push(JSON.parse(payload));
        return true;
      },
    },
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].type, "system_metrics");
  assert.equal(socket.sent.length, 0, "request_system_metrics should use injected sendWsPayload");
});

await run("P1-WS-4 duplicate state and thinking-status chatter is compacted per user window", async () => {
  __hudGatewayTestUtils.resetState();
  const socket = createFakeSocket();
  __hudGatewayTestUtils.setServer({ clients: new Set([socket]) });
  __hudGatewayTestUtils.bindSocketToUserContext(socket, "compact-user");
  socket.sent.length = 0;

  broadcastState("thinking", "compact-user");
  broadcastState("thinking", "compact-user");
  broadcastThinkingStatus("Analyzing request", "compact-user");
  broadcastThinkingStatus("Analyzing request", "compact-user");

  assert.deepEqual(
    socket.sent.map((entry) => `${entry.type}:${entry.state || entry.status || ""}`),
    ["state:thinking", "thinking_status:Analyzing request"],
  );

  await sleep(140);

  broadcastState("thinking", "compact-user");
  broadcastThinkingStatus("Analyzing request", "compact-user");

  assert.deepEqual(
    socket.sent.map((entry) => `${entry.type}:${entry.state || entry.status || ""}`),
    [
      "state:thinking",
      "thinking_status:Analyzing request",
      "state:thinking",
      "thinking_status:Analyzing request",
    ],
  );
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
