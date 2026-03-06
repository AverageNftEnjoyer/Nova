import assert from "node:assert/strict";

import {
  withVoiceRuntimeContext,
  getBusy,
  setBusy,
  getMuted,
  setMuted,
  getCurrentVoice,
  setCurrentVoice,
  getVoiceEnabled,
  setVoiceEnabled,
  getSuppressVoiceWakeUntilMs,
  setSuppressVoiceWakeUntilMs,
} from "../../../src/runtime/modules/audio/voice/index.js";

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

await run("VOICE-TTS-RUNTIME-1 per-user voice runtime state stays isolated across async contexts", async () => {
  const voiceUserA = "voice-runtime-a";
  const voiceUserB = "voice-runtime-b";

  await withVoiceRuntimeContext(voiceUserA, async () => {
    setMuted(false);
    setBusy(true);
    setCurrentVoice("peter");
    setVoiceEnabled(true);
    setSuppressVoiceWakeUntilMs(111);
    await Promise.resolve();
    assert.equal(getMuted(), false);
    assert.equal(getBusy(), true);
    assert.equal(getCurrentVoice(), "peter");
    assert.equal(getVoiceEnabled(), true);
    assert.equal(getSuppressVoiceWakeUntilMs(), 111);
  });

  await withVoiceRuntimeContext(voiceUserB, async () => {
    assert.equal(getMuted(), true);
    assert.equal(getBusy(), false);
    assert.equal(getCurrentVoice(), "default");
    assert.equal(getVoiceEnabled(), false);
    assert.equal(getSuppressVoiceWakeUntilMs(), 0);

    setMuted(true);
    setBusy(false);
    setCurrentVoice("mord");
    setVoiceEnabled(false);
    setSuppressVoiceWakeUntilMs(222);
    await Promise.resolve();
    assert.equal(getCurrentVoice(), "mord");
    assert.equal(getSuppressVoiceWakeUntilMs(), 222);
  });

  assert.equal(getCurrentVoice({ userContextId: voiceUserA }), "peter");
  assert.equal(getCurrentVoice({ userContextId: voiceUserB }), "mord");
  assert.equal(getBusy({ userContextId: voiceUserA }), true);
  assert.equal(getBusy({ userContextId: voiceUserB }), false);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
