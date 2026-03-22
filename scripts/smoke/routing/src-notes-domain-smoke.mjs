import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
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

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

const workspaceRoot = process.cwd();

const chatHandlerModule = await import(pathToFileURL(path.join(
  workspaceRoot,
  "src",
  "runtime",
  "modules",
  "chat",
  "core",
  "chat-handler",
  "index.js",
)).href);

const notesServiceModule = await import(pathToFileURL(path.join(
  workspaceRoot,
  "src",
  "runtime",
  "modules",
  "services",
  "notes",
  "index.js",
)).href);

const { handleInput } = chatHandlerModule;
const { listHomeNotes } = notesServiceModule;

await run("NOTES-SMOKE-1 creates note from hud-scoped command", async () => {
  const userContextId = `smoke-notes-${Date.now()}-a`;
  const conversationId = "notes-smoke-thread-a";
  const sessionKeyHint = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;

  const out = await handleInput("nova note down I need to see mom this week", {
    source: "hud",
    sender: "hud-user",
    voice: false,
    userContextId,
    conversationId,
    sessionKeyHint,
  });

  assert.equal(String(out?.route || ""), "notes");
  assert.equal(String(out?.responseRoute || ""), "notes");
  assert.equal(out?.ok, true);

  const notes = await listHomeNotes({ userContextId, limit: 10 });
  assert.equal(notes.some((note) => String(note.content || "").includes("see mom this week")), true);
});

await run("NOTES-SMOKE-2 notes remain isolated per user context", async () => {
  const stamp = Date.now();
  const userA = `smoke-notes-${stamp}-a`;
  const userB = `smoke-notes-${stamp}-b`;
  const conversationA = "notes-smoke-thread-iso-a";
  const conversationB = "notes-smoke-thread-iso-b";

  await handleInput("nova note down alpha scoped note", {
    source: "hud",
    sender: "hud-user",
    voice: false,
    userContextId: userA,
    conversationId: conversationA,
    sessionKeyHint: `agent:nova:hud:user:${userA}:dm:${conversationA}`,
  });

  await handleInput("nova note down bravo scoped note", {
    source: "hud",
    sender: "hud-user",
    voice: false,
    userContextId: userB,
    conversationId: conversationB,
    sessionKeyHint: `agent:nova:hud:user:${userB}:dm:${conversationB}`,
  });

  const notesA = await listHomeNotes({ userContextId: userA, limit: 20 });
  const notesB = await listHomeNotes({ userContextId: userB, limit: 20 });

  assert.equal(notesA.some((note) => String(note.content || "").includes("alpha scoped")), true);
  assert.equal(notesA.some((note) => String(note.content || "").includes("bravo scoped")), false);
  assert.equal(notesB.some((note) => String(note.content || "").includes("bravo scoped")), true);
  assert.equal(notesB.some((note) => String(note.content || "").includes("alpha scoped")), false);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);

