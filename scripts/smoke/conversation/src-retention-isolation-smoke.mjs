import assert from "node:assert/strict";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";

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

async function read(relativePath) {
  return await readFile(path.join(process.cwd(), relativePath), "utf8");
}

async function listFilesRecursive(rootDir) {
  const out = [];
  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      out.push(fullPath);
    }
  }
  await walk(rootDir);
  return out;
}

const threadsRoute = await read("hud/app/api/threads/route.ts");
const threadMessagesRoute = await read("hud/app/api/threads/[threadId]/messages/route.ts");
const accountDeleteRoute = await read("hud/app/api/account/delete/route.ts");
const conversationsHook = await read("hud/lib/chat/hooks/useConversations.ts");
const hudGateway = await read("src/runtime/infrastructure/hud-gateway/index.js");
const runtimeConstants = await read("src/runtime/core/constants/index.js");
const sessionStore = await read("src/session/store.ts");
const sessionRuntimeCompat = await read("src/session/runtime-compat.js");

await run("R1 thread reads are user-scoped and message IDs are stabilized", async () => {
  assert.equal(threadsRoute.includes('.eq("user_id", userId)'), true);
  assert.equal(threadsRoute.includes('.from("messages")'), true);
  assert.equal(threadsRoute.includes("stableMessageId"), true);
  assert.equal(threadsRoute.includes("seenMessageIdsByThread"), true);
});

await run("R2 thread message writes are idempotent and non-destructive", async () => {
  assert.equal(threadMessagesRoute.includes("buildStableMessageRowId"), true);
  assert.equal(threadMessagesRoute.includes('.upsert(rows, { onConflict: "id" })'), true);
  assert.equal(threadMessagesRoute.includes('.from("messages")\n      .delete('), false);
});

await run("R3 assistant transport routing is strict to explicit conversation IDs", async () => {
  assert.equal(conversationsHook.includes("strict thread isolation"), true);
  assert.equal(conversationsHook.includes('if (role === "assistant") {'), true);
  assert.equal(conversationsHook.includes("return \"\""), true);
});

await run("R4 websocket broadcast path enforces userContext scoping for chat events", async () => {
  assert.equal(hudGateway.includes("SCOPED_ONLY_EVENT_TYPES"), true);
  assert.equal(hudGateway.includes('"assistant_stream_start"'), true);
  assert.equal(hudGateway.includes('"assistant_stream_delta"'), true);
  assert.equal(hudGateway.includes('"assistant_stream_done"'), true);
  assert.equal(hudGateway.includes("resolveEventUserContextId"), true);
  assert.equal(hudGateway.includes("if (!targetUserContextId && SCOPED_ONLY_EVENT_TYPES.has(eventType)) return;"), true);
});

await run("R5 message deletes exist only on explicit account-delete endpoint", async () => {
  assert.equal(accountDeleteRoute.includes('.from("messages").delete().eq("user_id", userId)'), true);
  const apiRoot = path.join(process.cwd(), "hud", "app", "api");
  const files = await listFilesRecursive(apiRoot);
  const matches = [];
  for (const filePath of files) {
    const source = await readFile(filePath, "utf8").catch(() => "");
    if (source.includes('.from("messages").delete(') || source.includes('.from("messages").delete().')) {
      matches.push(path.relative(process.cwd(), filePath).replace(/\\/g, "/"));
    }
  }
  assert.deepEqual(matches.sort(), ["hud/app/api/account/delete/route.ts"]);
});

await run("R6 transcript retention defaults are persistence-first (no auto trim/prune)", async () => {
  assert.equal(runtimeConstants.includes("SESSION_MAX_TRANSCRIPT_LINES"), true);
  assert.equal(runtimeConstants.includes("NOVA_SESSION_MAX_TRANSCRIPT_LINES\", 0"), true);
  assert.equal(runtimeConstants.includes("NOVA_SESSION_TRANSCRIPT_RETENTION_DAYS\", 0"), true);
  assert.equal(
    sessionStore.includes("? Math.trunc(Number(extended.maxTranscriptLines))\n      : 0;"),
    true,
  );
  assert.equal(
    sessionStore.includes("? Math.trunc(Number(extended.transcriptRetentionDays))\n      : 0;"),
    true,
  );
  assert.equal(sessionRuntimeCompat.includes("maxTranscriptLines = 0"), true);
  assert.equal(sessionRuntimeCompat.includes("transcriptRetentionDays = 0"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
