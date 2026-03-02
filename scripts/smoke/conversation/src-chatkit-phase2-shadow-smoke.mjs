import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const mod = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/telemetry/chatkit-shadow/index.js")).href
);

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
}

try {
  process.env.NOVA_CHATKIT_SHADOW_MODE = "0";
  let decision = mod.shouldRunChatKitShadow({
    userContextId: "u1",
    conversationId: "c1",
    route: "chat",
    turnId: "t1",
  });
  assert.equal(decision.run, false);
  assert.equal(decision.reason, "shadow_disabled");

  process.env.NOVA_CHATKIT_SHADOW_MODE = "1";
  process.env.NOVA_CHATKIT_SHADOW_SAMPLE_PERCENT = "100";
  process.env.NOVA_CHATKIT_SHADOW_INTENTS = "chat,crypto";
  decision = mod.shouldRunChatKitShadow({
    userContextId: "u1",
    conversationId: "c1",
    route: "chat",
    turnId: "t1",
  });
  assert.equal(decision.run, true, "shadow policy should schedule when sampled and intent allowed");

  decision = mod.shouldRunChatKitShadow({
    userContextId: "u1",
    conversationId: "c1",
    route: "mission_confirm_prompt",
    turnId: "t1",
  });
  assert.equal(decision.run, false, "intent filtering should block mission route");
  assert.equal(decision.reason, "intent_filtered");

  process.env.NOVA_CHATKIT_SHADOW_INTENTS = "chat,crypto,mission,weather,memory,other";
  process.env.NOVA_CHATKIT_ENABLED = "0";
  const result = await mod.runChatKitShadowEvaluation({
    userContextId: "u1",
    conversationId: "c1",
    route: "chat",
    turnId: "t1",
    prompt: "hello",
    baselineProvider: "openai",
    baselineModel: "gpt-5-nano",
    baselineLatencyMs: 1200,
    baselineOk: true,
  });
  assert.equal(result.skipped, false, "evaluation should execute shadow runner path");
  assert.equal(result.ok, false, "chatkit-disabled runner should return non-ok result without throwing");

  console.log("[src-chatkit-phase2-shadow-smoke] PASS");
} finally {
  resetEnv();
}

