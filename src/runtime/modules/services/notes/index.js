import { randomUUID } from "node:crypto";

import { nowIso, tx } from "../../../../db/index.js";

const MAX_NOTES = 300;
const MAX_CONTENT_CHARS = 400;

function sanitizeUserContextId(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function sanitizeConversationId(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function sanitizeNoteId(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
}

function normalizeSource(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "nova") return "nova";
  return "manual";
}

function normalizeContent(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTENT_CHARS);
}

function rowToNote(row) {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by === "nova" ? "nova" : "manual",
    updatedBy: row.updated_by === "nova" ? "nova" : "manual",
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
  };
}

function selectNote(db, uid, noteId) {
  const row = db.prepare("SELECT * FROM notes WHERE user_id = ? AND id = ?").get(uid, noteId);
  return row ? rowToNote(row) : null;
}

/** Keeps only the newest MAX_NOTES rows (updated_at, then id, descending) for this user. */
function trimToLimit(db, uid) {
  db.prepare(
    `DELETE FROM notes WHERE user_id = ? AND id NOT IN (
       SELECT id FROM notes WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?
     )`,
  ).run(uid, uid, MAX_NOTES);
}

function notePreview(content = "") {
  const normalized = normalizeContent(content);
  if (!normalized) return "";
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function normalizeCommandText(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

const CREATE_PATTERNS = [
  /^(?:hey\s+)?(?:nova[,:\-\s]+)?(?:note\s+down|jot\s+down|write\s+down)\s+(.+)$/i,
  /^(?:hey\s+)?(?:nova[,:\-\s]+)?(?:add|create|save)\s+(?:a\s+)?note(?:\s+that|\s+to)?\s*[:\-]?\s*(.+)$/i,
  /^(?:hey\s+)?(?:nova[,:\-\s]+)?note\s*[:\-]\s*(.+)$/i,
];

const UPDATE_LAST_PATTERN = /^(?:hey\s+)?(?:nova[,:\-\s]+)?(?:update|edit|change)\s+(?:the\s+)?last\s+note(?:\s+to)?\s*[:\-]?\s*(.+)$/i;
const UPDATE_ID_PATTERN = /^(?:hey\s+)?(?:nova[,:\-\s]+)?(?:update|edit|change)\s+note\s+([a-z0-9-]{4,40})(?:\s+to)?\s*[:\-]?\s*(.+)$/i;

const DELETE_LAST_PATTERN = /^(?:hey\s+)?(?:nova[,:\-\s]+)?(?:delete|remove)\s+(?:the\s+)?last\s+note\b/i;
const DELETE_ID_PATTERN = /^(?:hey\s+)?(?:nova[,:\-\s]+)?(?:delete|remove)\s+note\s+([a-z0-9-]{4,40})\b/i;

const LIST_PATTERN = /^(?:hey\s+)?(?:nova[,:\-\s]+)?(?:show|list|read|what\s+are)\s+(?:my\s+)?notes\b/i;

export function parseHomeNoteCommand(text = "") {
  const normalized = normalizeCommandText(text);
  if (!normalized) return { matched: false, action: "" };

  for (const pattern of CREATE_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const content = normalizeContent(match[1] || "");
    if (!content) {
      return {
        matched: true,
        action: "create",
        ok: false,
        code: "notes.content_missing",
        message: "Note content is required.",
      };
    }
    return {
      matched: true,
      action: "create",
      ok: true,
      content,
    };
  }

  const updateLastMatch = normalized.match(UPDATE_LAST_PATTERN);
  if (updateLastMatch) {
    const content = normalizeContent(updateLastMatch[1] || "");
    if (!content) {
      return {
        matched: true,
        action: "update",
        ok: false,
        code: "notes.content_missing",
        message: "Updated note content is required.",
      };
    }
    return {
      matched: true,
      action: "update",
      ok: true,
      useLast: true,
      content,
    };
  }

  const updateIdMatch = normalized.match(UPDATE_ID_PATTERN);
  if (updateIdMatch) {
    const noteId = sanitizeNoteId(updateIdMatch[1] || "");
    const content = normalizeContent(updateIdMatch[2] || "");
    if (!noteId || !content) {
      return {
        matched: true,
        action: "update",
        ok: false,
        code: "notes.update_invalid",
        message: "Provide a note id and new content.",
      };
    }
    return {
      matched: true,
      action: "update",
      ok: true,
      noteId,
      content,
    };
  }

  if (DELETE_LAST_PATTERN.test(normalized)) {
    return {
      matched: true,
      action: "delete",
      ok: true,
      useLast: true,
    };
  }

  const deleteIdMatch = normalized.match(DELETE_ID_PATTERN);
  if (deleteIdMatch) {
    const noteId = sanitizeNoteId(deleteIdMatch[1] || "");
    if (!noteId) {
      return {
        matched: true,
        action: "delete",
        ok: false,
        code: "notes.delete_invalid",
        message: "Provide a valid note id to delete.",
      };
    }
    return {
      matched: true,
      action: "delete",
      ok: true,
      noteId,
    };
  }

  if (LIST_PATTERN.test(normalized)) {
    return {
      matched: true,
      action: "list",
      ok: true,
    };
  }

  return { matched: false, action: "" };
}

export async function listHomeNotes({ userContextId = "", limit = 150 } = {}) {
  const uid = sanitizeUserContextId(userContextId);
  if (!uid) return [];
  const nextLimit = Math.max(1, Math.min(500, Number.parseInt(String(limit || 150), 10) || 150));
  const rows = tx(
    (db) =>
      db
        .prepare("SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?")
        .all(uid, nextLimit),
    "deferred",
  );
  return rows.map(rowToNote);
}

export async function createHomeNote({ userContextId = "", content = "", source = "manual", conversationId = "" } = {}) {
  const normalizedContent = normalizeContent(content);
  if (!normalizedContent) {
    return { ok: false, code: "notes.content_missing", message: "Note content is required.", note: null };
  }
  const uid = sanitizeUserContextId(userContextId);
  if (!uid) return { ok: false, error: "invalid_user_context" };

  const now = nowIso();
  const by = normalizeSource(source);
  const noteId = `note-${randomUUID().slice(0, 8)}`;
  const note = tx((db) => {
    db.prepare(
      `INSERT INTO notes (user_id, id, content, created_at, updated_at, created_by, updated_by, conversation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(uid, noteId, normalizedContent, now, now, by, by, sanitizeConversationId(conversationId) || null);
    trimToLimit(db, uid);
    return selectNote(db, uid, noteId);
  });
  return { ok: true, code: "notes.create_ok", message: "Note created.", note };
}

export async function updateHomeNote({ userContextId = "", noteId = "", content = "", source = "manual" } = {}) {
  const normalizedNoteId = sanitizeNoteId(noteId);
  const normalizedContent = normalizeContent(content);
  if (!normalizedNoteId) {
    return { ok: false, code: "notes.id_missing", message: "Note id is required.", note: null };
  }
  if (!normalizedContent) {
    return { ok: false, code: "notes.content_missing", message: "Note content is required.", note: null };
  }
  const uid = sanitizeUserContextId(userContextId);
  if (!uid) return { ok: false, error: "invalid_user_context" };

  const note = tx((db) => {
    const info = db
      .prepare("UPDATE notes SET content = ?, updated_at = ?, updated_by = ? WHERE user_id = ? AND id = ?")
      .run(normalizedContent, nowIso(), normalizeSource(source), uid, normalizedNoteId);
    if (info.changes === 0) return null;
    trimToLimit(db, uid);
    return selectNote(db, uid, normalizedNoteId);
  });
  if (!note) return { ok: false, code: "notes.not_found", message: "Note not found.", note: null };
  return { ok: true, code: "notes.update_ok", message: "Note updated.", note };
}

export async function deleteHomeNote({ userContextId = "", noteId = "" } = {}) {
  const normalizedNoteId = sanitizeNoteId(noteId);
  if (!normalizedNoteId) {
    return { ok: false, code: "notes.id_missing", message: "Note id is required.", deleted: false };
  }
  const uid = sanitizeUserContextId(userContextId);
  if (!uid) return { ok: false, error: "invalid_user_context" };

  const removed = tx(
    (db) => db.prepare("DELETE FROM notes WHERE user_id = ? AND id = ?").run(uid, normalizedNoteId).changes > 0,
  );
  if (!removed) return { ok: false, code: "notes.not_found", message: "Note not found.", deleted: false };
  return { ok: true, code: "notes.delete_ok", message: "Note deleted.", deleted: true };
}

async function resolveTargetNoteId({ userContextId = "", noteId = "", useLast = false } = {}) {
  const explicit = sanitizeNoteId(noteId);
  if (explicit) return explicit;
  if (!useLast) return "";
  const notes = await listHomeNotes({ userContextId, limit: 1 });
  return sanitizeNoteId(notes[0]?.id || "");
}

export async function runHomeNoteCommandService(input = {}) {
  const text = normalizeCommandText(input.text || "");
  const userContextId = sanitizeUserContextId(input.userContextId || input.ctx?.userContextId || "");
  const conversationId = sanitizeConversationId(input.conversationId || input.ctx?.conversationId || "");

  const parsed = parseHomeNoteCommand(text);
  if (!parsed.matched) {
    return { handled: false };
  }
  if (parsed.ok === false) {
    return {
      handled: true,
      ok: false,
      code: parsed.code || "notes.command_invalid",
      message: parsed.message || "Notes command was invalid.",
      reply: parsed.message || "I need more detail for that notes command.",
    };
  }

  if (!userContextId) {
    return {
      handled: true,
      ok: false,
      code: "notes.context_missing",
      message: "Missing user context id for notes command.",
      reply: "I need your user context before I can manage notes.",
    };
  }

  if (parsed.action === "create") {
    const created = await createHomeNote({
      userContextId,
      content: parsed.content || "",
      source: "nova",
      conversationId,
    });
    if (!created.ok || !created.note) {
      return {
        handled: true,
        ok: false,
        code: created.code || "notes.create_failed",
        message: created.message || "Failed to create note.",
        reply: created.message || "I couldn't save that note.",
      };
    }
    return {
      handled: true,
      ok: true,
      code: created.code,
      message: created.message,
      reply: `Note saved (${created.note.id}): ${notePreview(created.note.content)}`,
      note: created.note,
    };
  }

  if (parsed.action === "update") {
    const targetId = await resolveTargetNoteId({
      userContextId,
      noteId: parsed.noteId || "",
      useLast: parsed.useLast === true,
    });
    if (!targetId) {
      return {
        handled: true,
        ok: false,
        code: "notes.not_found",
        message: "No target note was found to update.",
        reply: "I couldn't find that note to update.",
      };
    }
    const updated = await updateHomeNote({
      userContextId,
      noteId: targetId,
      content: parsed.content || "",
      source: "nova",
    });
    if (!updated.ok || !updated.note) {
      return {
        handled: true,
        ok: false,
        code: updated.code || "notes.update_failed",
        message: updated.message || "Failed to update note.",
        reply: updated.message || "I couldn't update that note.",
      };
    }
    return {
      handled: true,
      ok: true,
      code: updated.code,
      message: updated.message,
      reply: `Updated note (${updated.note.id}): ${notePreview(updated.note.content)}`,
      note: updated.note,
    };
  }

  if (parsed.action === "delete") {
    const targetId = await resolveTargetNoteId({
      userContextId,
      noteId: parsed.noteId || "",
      useLast: parsed.useLast === true,
    });
    if (!targetId) {
      return {
        handled: true,
        ok: false,
        code: "notes.not_found",
        message: "No target note was found to delete.",
        reply: "I couldn't find that note to delete.",
      };
    }
    const removed = await deleteHomeNote({ userContextId, noteId: targetId });
    if (!removed.ok) {
      return {
        handled: true,
        ok: false,
        code: removed.code || "notes.delete_failed",
        message: removed.message || "Failed to delete note.",
        reply: removed.message || "I couldn't delete that note.",
      };
    }
    return {
      handled: true,
      ok: true,
      code: removed.code,
      message: removed.message,
      reply: `Deleted note (${targetId}).`,
    };
  }

  if (parsed.action === "list") {
    const notes = await listHomeNotes({ userContextId, limit: 5 });
    if (notes.length === 0) {
      return {
        handled: true,
        ok: true,
        code: "notes.list_empty",
        message: "No notes found.",
        reply: "You do not have any notes yet.",
      };
    }
    const lines = notes.map((note, index) => `${index + 1}. (${note.id}) ${notePreview(note.content)}`);
    return {
      handled: true,
      ok: true,
      code: "notes.list_ok",
      message: "Notes listed.",
      reply: `Your recent notes:\n${lines.join("\n")}`,
      notes,
    };
  }

  return {
    handled: true,
    ok: false,
    code: "notes.command_unsupported",
    message: "Unsupported notes command.",
    reply: "I can create, update, delete, or list notes.",
  };
}

