import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
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

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function toModuleUrl(relativePath) {
  return pathToFileURL(path.join(process.cwd(), relativePath)).href;
}

await run("Phase 12 relocated runtime modules exist under src", async () => {
  const files = [
    "src/providers/runtime-compat/index.js",
    "src/memory/runtime-compat/index.js",
    "src/session/runtime-compat.js",
    "src/tools/runtime/runtime-compat/index.js",
    "src/runtime/audio/wake-runtime-compat/index.js",
    "src/runtime/core/config/index.js",
  ];
  for (const file of files) {
    assert.equal(fs.existsSync(path.join(process.cwd(), file)), true, `${file} missing`);
  }
});

await run("Runtime smoke scripts use src-owned runtime paths", async () => {
  const scriptFiles = [
    "scripts/smoke/core/runtime-smoke.mjs",
    "scripts/smoke/core/src-provider-smoke.mjs",
    "scripts/smoke/core/src-session-parity.mjs",
    "scripts/smoke/routing/src-tool-loop-smoke.mjs",
    "scripts/smoke/conversation/src-memory-convergence-smoke.mjs",
    "scripts/smoke/conversation/src-persona-context-smoke.mjs",
    "scripts/smoke/routing/src-transport-stability-smoke.mjs",
  ];
  for (const file of scriptFiles) {
    const content = read(file);
    assert.equal(content.includes("agent/modules"), false, `${file} still references agent/modules`);
    assert.equal(content.includes("agent/runtime"), false, `${file} still references agent/runtime`);
  }
});

await run("src runtime core import graph no longer references agent/modules or agent/runtime", async () => {
  const runtimeFiles = [
    "src/runtime/core/entrypoint/index.js",
    "src/runtime/infrastructure/hud-gateway/index.js",
    "src/runtime/audio/voice-loop/index.js",
    "src/runtime/core/config/index.js",
  ];
  for (const file of runtimeFiles) {
    const content = read(file);
    assert.equal(content.includes("agent/modules"), false, `${file} still imports agent/modules`);
    assert.equal(content.includes("agent/runtime"), false, `${file} still imports agent/runtime`);
  }
});

await run("Relocated providers + memory modules export runtime functions", async () => {
  const providers = await import(toModuleUrl("src/providers/runtime-compat/index.js"));
  const memory = await import(toModuleUrl("src/memory/runtime-compat/index.js"));
  assert.equal(typeof providers.loadIntegrationsRuntime, "function");
  assert.equal(typeof providers.resolveConfiguredChatRuntime, "function");
  assert.equal(typeof providers.describeUnknownError, "function");
  assert.equal(typeof memory.extractAutoMemoryFacts, "function");
  assert.equal(typeof memory.upsertMemoryFactInMarkdown, "function");
});

await run("Relocated session runtime remains functional", async () => {
  const { createSessionRuntime } = await import(toModuleUrl("src/session/runtime-compat.js"));
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-phase12-session-"));
  const runtime = createSessionRuntime({
    sessionStorePath: path.join(tmpRoot, "sessions.json"),
    transcriptDir: path.join(tmpRoot, "transcripts"),
    sessionIdleMinutes: 60,
    sessionMainKey: "main",
  });
  const resolved = runtime.resolveSessionContext({
    source: "hud",
    sender: "hud-user:user-a",
    userContextId: "user-a",
    sessionKeyHint: "agent:nova:hud:user:user-a:dm:conv-1",
  });
  assert.equal(typeof resolved.sessionKey, "string");
  assert.equal(typeof resolved.sessionEntry?.sessionId, "string");
});

await run("Relocated tools + wake runtime exports stay usable", async () => {
  const { createToolRuntime } = await import(toModuleUrl("src/tools/runtime/runtime-compat/index.js"));
  const { createWakeWordRuntime } = await import(toModuleUrl("src/runtime/audio/wake-runtime-compat/index.js"));
  assert.equal(typeof createToolRuntime, "function");
  assert.equal(typeof createWakeWordRuntime, "function");
  const wake = createWakeWordRuntime({ wakeWord: "nova", wakeWordVariants: ["nova", "nava"] });
  assert.equal(wake.containsWakeWord("hey nova status"), true);
  assert.equal(wake.containsWakeWord("hello there"), false);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
