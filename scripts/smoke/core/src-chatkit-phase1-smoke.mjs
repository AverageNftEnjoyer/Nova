import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(path.join(process.cwd(), "dist/integrations/chatkit/index.js")).href;
const chatkit = await import(moduleUrl);

const originalEnv = { ...process.env };

function restoreEnv() {
  process.env = { ...originalEnv };
}

function testDisabledByDefault() {
  delete process.env.NOVA_CHATKIT_ENABLED;
  delete process.env.OPENAI_API_KEY;
  const config = chatkit.resolveChatKitRuntimeConfig();
  const validation = chatkit.validateChatKitRuntimeConfig(config);
  assert.equal(config.enabled, false, "ChatKit should be disabled by default");
  assert.equal(validation.ok, true, "Disabled ChatKit config should still validate");
}

function testEnabledRequiresApiKey() {
  process.env.NOVA_CHATKIT_ENABLED = "1";
  delete process.env.OPENAI_API_KEY;
  const config = chatkit.resolveChatKitRuntimeConfig();
  const validation = chatkit.validateChatKitRuntimeConfig(config);
  assert.equal(config.enabled, true, "ChatKit should be enabled");
  assert.equal(validation.ok, false, "Enabled ChatKit without key must fail validation");
  assert.equal(
    validation.issues.some((item) => item.field === "OPENAI_API_KEY"),
    true,
    "Validation should include OPENAI_API_KEY issue",
  );
}

function testEnabledWithApiKeyPasses() {
  process.env.NOVA_CHATKIT_ENABLED = "true";
  process.env.OPENAI_API_KEY = "sk-test-not-real";
  process.env.NOVA_CHATKIT_MODEL = "gpt-5-mini";
  process.env.NOVA_CHATKIT_REASONING_EFFORT = "low";
  process.env.NOVA_CHATKIT_TIMEOUT_MS = "12000";
  const config = chatkit.resolveChatKitRuntimeConfig();
  const validation = chatkit.validateChatKitRuntimeConfig(config);
  assert.equal(validation.ok, true, "Enabled ChatKit with key should validate");
  assert.equal(config.model, "gpt-5-mini");
  assert.equal(config.reasoningEffort, "low");
  assert.equal(config.timeoutMs, 12000);
}

try {
  testDisabledByDefault();
  testEnabledRequiresApiKey();
  testEnabledWithApiKeyPasses();
  console.log("[src-chatkit-phase1-smoke] PASS");
} finally {
  restoreEnv();
}

