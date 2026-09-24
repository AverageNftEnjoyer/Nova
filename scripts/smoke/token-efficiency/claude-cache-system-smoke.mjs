/**
 * Token-efficiency Stage 1c/1d: Claude `system` blocks with a prompt-cache breakpoint after the static part
 * (src/providers/runtime buildClaudeCachedSystem), and the tool-loop breakpoint on the latest message
 * (chat-handler/claude-tool-loop withLatestMessageCacheBreakpoint).
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";

import { buildClaudeCachedSystem } from "../../../src/providers/runtime/index.js";
import { withLatestMessageCacheBreakpoint } from "../../../src/runtime/modules/chat/core/chat-handler/claude-tool-loop/index.js";

const results = [];

async function run(name, fn) {
  try {
    await fn();
    results.push({ status: "PASS", name });
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.message : String(error) });
  }
}

await run("CC-1 static + per-turn -> two blocks, breakpoint on the static block only", async () => {
  assert.deepEqual(buildClaudeCachedSystem("STATIC", "TURN"), [
    { type: "text", text: "STATIC", cache_control: { type: "ephemeral" } },
    { type: "text", text: "TURN" },
  ]);
});

await run("CC-2 no per-turn part -> one cached block", async () => {
  assert.deepEqual(buildClaudeCachedSystem("STATIC", "  "), [
    { type: "text", text: "STATIC", cache_control: { type: "ephemeral" } },
  ]);
});

await run("CC-3 no static part -> plain string, no breakpoint", async () => {
  assert.equal(buildClaudeCachedSystem("", "TURN"), "TURN");
  assert.equal(buildClaudeCachedSystem("", ""), "");
});

await run("CC-4 content is preserved: joined blocks equal the single-string prompt", async () => {
  const blocks = buildClaudeCachedSystem("A\nB", "C");
  assert.equal(blocks.map((block) => block.text).join("\n\n"), "A\nB\n\nC");
});

await run("CC-5 tool loop: breakpoint on the last block of the latest message only, input not mutated", async () => {
  const toolResults = [
    { type: "tool_result", tool_use_id: "a", content: "one" },
    { type: "tool_result", tool_use_id: "b", content: "two" },
  ];
  const messages = [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "x" }] }, { role: "user", content: toolResults }];
  const marked = withLatestMessageCacheBreakpoint(messages);
  assert.deepEqual(marked[2].content[1].cache_control, { type: "ephemeral" });
  assert.equal("cache_control" in marked[2].content[0], false);
  assert.equal(marked[0], messages[0]);
  assert.equal("cache_control" in toolResults[1], false, "original tool_result must not be mutated");
});

await run("CC-6 tool loop: string content becomes a text block; empty content is left alone", async () => {
  assert.deepEqual(withLatestMessageCacheBreakpoint([{ role: "user", content: "go" }]), [
    { role: "user", content: [{ type: "text", text: "go", cache_control: { type: "ephemeral" } }] },
  ]);
  const empty = [{ role: "user", content: " " }];
  assert.equal(withLatestMessageCacheBreakpoint(empty), empty);
  assert.deepEqual(withLatestMessageCacheBreakpoint([]), []);
});

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
const failed = results.filter((result) => result.status === "FAIL").length;
console.log(`\nclaude-cache-system: ${results.length - failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
