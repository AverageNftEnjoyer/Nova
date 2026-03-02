import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

await run("HTOI-1 HUD gateway emits immediate thinking state for hud_message", async () => {
  const gatewaySource = read("src/runtime/infrastructure/hud-gateway/index.js");
  assert.equal(gatewaySource.includes("if (data.type === \"hud_message\" && data.content)"), true);
  assert.equal(gatewaySource.includes("broadcastState(\"thinking\", incomingUserId);"), true);
  assert.equal(gatewaySource.includes("broadcastThinkingStatus(\"Analyzing request\", incomingUserId);"), true);
});

await run("HTOI-2 HUD gateway enforces minimum visible thinking presence", async () => {
  const gatewaySource = read("src/runtime/infrastructure/hud-gateway/index.js");
  assert.equal(gatewaySource.includes("HUD_MIN_THINKING_PRESENCE_MS"), true);
  assert.equal(gatewaySource.includes("const thinkingShownAt = Date.now();"), true);
  assert.equal(gatewaySource.includes("if (shownForMs < HUD_MIN_THINKING_PRESENCE_MS)"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);

