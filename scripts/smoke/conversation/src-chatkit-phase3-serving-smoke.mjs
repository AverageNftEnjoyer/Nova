import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const mod = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/telemetry/chatkit-serving/index.js")).href
);

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
}

try {
  process.env.NOVA_CHATKIT_SERVE_MODE = "0";
  let decision = mod.shouldServeChatKit({
    userContextId: "u1",
    conversationId: "c1",
    intentClass: "chat",
    turnId: "t1",
  });
  assert.equal(decision.serve, false);
  assert.equal(decision.reason, "serve_disabled");

  process.env.NOVA_CHATKIT_SERVE_MODE = "1";
  process.env.NOVA_CHATKIT_SERVE_SAMPLE_PERCENT = "100";
  process.env.NOVA_CHATKIT_SERVE_INTENTS = "chat";
  decision = mod.shouldServeChatKit({
    userContextId: "u1",
    conversationId: "c1",
    intentClass: "chat",
    turnId: "t1",
  });
  assert.equal(decision.serve, true, "serve policy should allow chat intent at 100% sample");

  decision = mod.shouldServeChatKit({
    userContextId: "u1",
    conversationId: "c1",
    intentClass: "mission",
    turnId: "t1",
  });
  assert.equal(decision.serve, false, "serve policy should block non-allowed intents");
  assert.equal(decision.reason, "intent_filtered");

  process.env.NOVA_CHATKIT_ENABLED = "0";
  const result = await mod.runChatKitServeAttempt({
    prompt: "hello",
    userContextId: "u1",
    conversationId: "c1",
    intentClass: "chat",
    turnId: "t1",
  });
  assert.equal(result.used, false, "serve attempt should gracefully fall back when ChatKit runtime disabled");
  assert.equal(typeof result.reason === "string", true);

  console.log("[src-chatkit-phase3-serving-smoke] PASS");
} finally {
  resetEnv();
}

