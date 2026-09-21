import test from "node:test";
import assert from "node:assert/strict";

import {
  createHomeNote,
  deleteHomeNote,
  listHomeNotes,
  parseHomeNoteCommand,
  runHomeNoteCommandService,
  updateHomeNote,
} from "./index.js";

test("parseHomeNoteCommand detects create phrase", () => {
  const parsed = parseHomeNoteCommand("nova note down I need to see mom this week");
  assert.equal(parsed.matched, true);
  assert.equal(parsed.action, "create");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.content, "I need to see mom this week");
});

test("home notes store supports create/update/delete lifecycle", async () => {
  const userContextId = `notes-lifecycle-${Date.now()}`;

  const created = await createHomeNote({
    userContextId,
    content: "pay electric bill on friday",
    source: "manual",
  });
  assert.equal(created.ok, true);
  assert.equal(Boolean(created.note?.id), true);

  const listed = await listHomeNotes({ userContextId, limit: 20 });
  assert.equal(listed.length >= 1, true);
  assert.equal(listed[0]?.id, created.note?.id);

  const updated = await updateHomeNote({
    userContextId,
    noteId: created.note?.id || "",
    content: "pay electric bill this friday at 5pm",
    source: "manual",
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.note?.content, "pay electric bill this friday at 5pm");

  const removed = await deleteHomeNote({
    userContextId,
    noteId: created.note?.id || "",
  });
  assert.equal(removed.ok, true);

  const finalList = await listHomeNotes({ userContextId, limit: 20 });
  assert.equal(finalList.some((note) => note.id === created.note?.id), false);
});

test("home notes are user-context isolated", async () => {
  const stamp = Date.now();
  const userA = `notes-iso-${stamp}-a`;
  const userB = `notes-iso-${stamp}-b`;

  const createA = await createHomeNote({ userContextId: userA, content: "alpha secret note", source: "manual" });
  const createB = await createHomeNote({ userContextId: userB, content: "bravo secret note", source: "manual" });

  assert.equal(createA.ok, true);
  assert.equal(createB.ok, true);

  const notesA = await listHomeNotes({ userContextId: userA, limit: 20 });
  const notesB = await listHomeNotes({ userContextId: userB, limit: 20 });

  assert.equal(notesA.some((note) => note.content.includes("alpha secret")), true);
  assert.equal(notesA.some((note) => note.content.includes("bravo secret")), false);
  assert.equal(notesB.some((note) => note.content.includes("bravo secret")), true);
  assert.equal(notesB.some((note) => note.content.includes("alpha secret")), false);
});

test("runHomeNoteCommandService creates note from nova note-down command", async () => {
  const userContextId = `notes-command-${Date.now()}`;
  const conversationId = "notes-command-thread";
  const result = await runHomeNoteCommandService({
    text: "nova note down call mom this week",
    userContextId,
    conversationId,
  });

  assert.equal(result.handled, true);
  assert.equal(result.ok, true);
  assert.equal(result.code, "notes.create_ok");

  const notes = await listHomeNotes({ userContextId, limit: 10 });
  assert.equal(notes.some((note) => note.content === "call mom this week"), true);
});

test("home notes keep only the newest 300 per user and cap content length", async () => {
  const userContextId = `notes-cap-${Date.now()}`;
  const first = await createHomeNote({ userContextId, content: "x".repeat(900), source: "manual" });
  assert.equal(first.note?.content.length, 400);
  await new Promise((resolve) => setTimeout(resolve, 5)); // strictly older updated_at than the rest
  for (let i = 0; i < 300; i += 1) {
    await createHomeNote({ userContextId, content: `note ${i}`, source: "manual" });
  }
  const notes = await listHomeNotes({ userContextId, limit: 500 });
  assert.equal(notes.length, 300);
  assert.equal(notes.some((note) => note.id === first.note?.id), false, "oldest note is evicted");
});

test("home notes reject a missing user context without touching storage", async () => {
  const created = await createHomeNote({ userContextId: "", content: "orphan" });
  assert.equal(created.ok, false);
  assert.equal(created.error, "invalid_user_context");
  assert.deepEqual(await listHomeNotes({ userContextId: "" }), []);
});
