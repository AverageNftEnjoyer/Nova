/**
 * OpenAI request tuning (chat-handler/prompt-recovery resolveOpenAiRequestTuning).
 *
 * GPT-5.6 models reject reasoning_effort "minimal" (supported: none/low/medium/high/xhigh/max), so strict
 * passes must send "low" for them. Older gpt-5 models keep "minimal"; non-gpt-5 and non-OpenAI get no tuning.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";

import { resolveOpenAiRequestTuning } from "../../../src/runtime/modules/chat/core/chat-handler/prompt-recovery/index.js";

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

await run("RT-1 gpt-5.6 strict sends low, never minimal", async () => {
  for (const model of ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna", "GPT-5.6-Terra"]) {
    assert.deepEqual(resolveOpenAiRequestTuning("openai", model, { strict: true }), { verbosity: "low", reasoning_effort: "low" });
  }
});

await run("RT-2 gpt-5.6 default pass is unchanged", async () => {
  assert.deepEqual(resolveOpenAiRequestTuning("openai", "gpt-5.6-terra"), { verbosity: "medium", reasoning_effort: "low" });
});

await run("RT-3 older gpt-5 models keep minimal in strict mode", async () => {
  assert.equal(resolveOpenAiRequestTuning("openai", "gpt-5-mini", { strict: true }).reasoning_effort, "minimal");
  assert.equal(resolveOpenAiRequestTuning("openai", "gpt-5", { strict: true }).reasoning_effort, "minimal");
});

await run("RT-4 gpt-5-pro sends no reasoning_effort; non-gpt-5 and non-OpenAI get no tuning", async () => {
  assert.equal("reasoning_effort" in resolveOpenAiRequestTuning("openai", "gpt-5-pro", { strict: true }), false);
  assert.deepEqual(resolveOpenAiRequestTuning("openai", "gpt-4.1-mini", { strict: true }), {});
  assert.deepEqual(resolveOpenAiRequestTuning("grok", "gpt-5.6-terra", { strict: true }), {});
});

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
const failed = results.filter((result) => result.status === "FAIL").length;
console.log(`\nopenai-request-tuning: ${results.length - failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
