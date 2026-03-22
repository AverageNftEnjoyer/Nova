import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";

import { USER_CONTEXT_ROOT } from "../../../core/constants/index.js";

const STORE_FILE_NAME = "home-notes.json";
const STORE_VERSION = 1;
const MAX_NOTES = 300;
const MAX_CONTENT_CHARS = 400;

const writesByPath = new Map();
const locksByUser = new Map();

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

function defaultStore() {
  return {
    version: STORE_VERSION,
    updatedAt: new Date().toISOString(),
    notes: [],
  };
}

function resolveUserStateDir(userContextId = "") {
  const uid = sanitizeUserContextId(userContextId);
  if (!uid) return "";
  return path.join(USER_CONTEXT_ROOT, uid, "state");
}

export function resolveHomeNotesStorePath(userContextId = "") {
  const stateDir = resolveUserStateDir(userContextId);
  if (!stateDir) return "";
  return path.join(stateDir, STORE_FILE_NAME);
}

async function atomicWriteJson(filePath, payload) {
  const resolved = path.resolve(filePath);
  const previous = writesByPath.get(resolved) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(path.dirname(resolved), { recursive: true });
      const tmpPath = `${resolved}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
      await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await rename(tmpPath, resolved);
    });
  writesByPath.set(resolved, next);
  try {
    await next;
  } finally {
    if (writesByPath.get(resolved) === next) writesByPath.delete(resolved);
  }
}

function normalizeNote(raw = null) {
  if (!raw || typeof raw !== "object") return null;
  const id = sanitizeNoteId(raw.id || "");
  const content = normalizeContent(raw.content || "");
  if (!id || !content) return null;

  const createdAt = String(raw.createdAt || "").trim() || new Date().toISOString();
  const updatedAt = String(raw.updatedAt || "").trim() || createdAt;
  const createdBy = normalizeSource(raw.createdBy || "manual");
  const updatedBy = normalizeSource(raw.updatedBy || createdBy);
  const conversationId = sanitizeConversationId(raw.conversationId || "");

  return {
    id,
    content,
    createdAt,
    updatedAt,
    createdBy,
    updatedBy,
    ...(conversationId ? { conversationId } : {}),
  };
}

function normalizeStore(raw = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const notes = Array.isArray(source.notes)
    ? source.notes.map((note) => normalizeNote(note)).filter(Boolean)
    : [];

  const sortedNotes = [...notes]
    .sort((a, b) => {
      const byUpdated = Date.parse(String(b.updatedAt || "")) - Date.parse(String(a.updatedAt || ""));
      if (Number.isFinite(byUpdated) && byUpdated !== 0) return byUpdated;
      return String(b.id || "").localeCompare(String(a.id || ""));
    })
    .slice(0, MAX_NOTES);

  return {
    version: STORE_VERSION,
    updatedAt: String(source.updatedAt || "").trim() || new Date().toISOString(),
    notes: sortedNotes,
  };
}

async function loadStore(userContextId = "") {
  const storePath = resolveHomeNotesStorePath(userContextId);
  if (!storePath) return { storePath: "", store: defaultStore() };

  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8"));
    return { storePath, store: normalizeStore(parsed) };
  } catch {
    const next = defaultStore();
    await atomicWriteJson(storePath, next);
    return { storePath, store: next };
  }
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

async function withUserLock(userContextId = "", work = async () => ({})) {
  const uid = sanitizeUserContextId(userContextId);
  if (!uid) return { ok: false, error: "invalid_user_context" };

  const previous = locksByUser.get(uid) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => work(uid));

  locksByUser.set(uid, next);
  try {
    return await next;
  } finally {
    if (locksByUser.get(uid) === next) locksByUser.delete(uid);
  }
}

export async function listHomeNotes({ userContextId = "", limit = 150 } = {}) {
  const uid = sanitizeUserContextId(userContextId);
  if (!uid) return [];
  const { store } = await loadStore(uid);
  const nextLimit = Math.max(1, Math.min(500, Number.parseInt(String(limit || 150), 10) || 150));
  return [...store.notes].slice(0, nextLimit);
}

export async function createHomeNote({ userContextId = "", content = "", source = "manual", conversationId = "" } = {}) {
  const normalizedContent = normalizeContent(content);
  if (!normalizedContent) {
    return { ok: false, code: "notes.content_missing", message: "Note content is required.", note: null };
  }

  return withUserLock(userContextId, async (uid) => {
    const { storePath, store } = await loadStore(uid);
    const now = new Date().toISOString();
    const note = normalizeNote({
      id: `note-${randomUUID().slice(0, 8)}`,
      content: normalizedContent,
      createdAt: now,
      updatedAt: now,
      createdBy: normalizeSource(source),
      updatedBy: normalizeSource(source),
      conversationId: sanitizeConversationId(conversationId),
    });
    const nextStore = normalizeStore({
      ...store,
      updatedAt: now,
      notes: [note, ...store.notes],
    });
    await atomicWriteJson(storePath, nextStore);
    return { ok: true, code: "notes.create_ok", message: "Note created.", note };
  });
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

  return withUserLock(userContextId, async (uid) => {
    const { storePath, store } = await loadStore(uid);
    const targetIndex = store.notes.findIndex((note) => sanitizeNoteId(note.id) === normalizedNoteId);
    if (targetIndex < 0) {
      return { ok: false, code: "notes.not_found", message: "Note not found.", note: null };
    }

    const now = new Date().toISOString();
    const updated = normalizeNote({
      ...store.notes[targetIndex],
      content: normalizedContent,
      updatedAt: now,
      updatedBy: normalizeSource(source),
    });

    const nextNotes = [...store.notes];
    nextNotes[targetIndex] = updated;
    const nextStore = normalizeStore({
      ...store,
      updatedAt: now,
      notes: nextNotes,
    });
    await atomicWriteJson(storePath, nextStore);
    return { ok: true, code: "notes.update_ok", message: "Note updated.", note: updated };
  });
}

export async function deleteHomeNote({ userContextId = "", noteId = "" } = {}) {
  const normalizedNoteId = sanitizeNoteId(noteId);
  if (!normalizedNoteId) {
    return { ok: false, code: "notes.id_missing", message: "Note id is required.", deleted: false };
  }

  return withUserLock(userContextId, async (uid) => {
    const { storePath, store } = await loadStore(uid);
    const nextNotes = store.notes.filter((note) => sanitizeNoteId(note.id) !== normalizedNoteId);
    if (nextNotes.length === store.notes.length) {
      return { ok: false, code: "notes.not_found", message: "Note not found.", deleted: false };
    }
    const nextStore = normalizeStore({
      ...store,
      updatedAt: new Date().toISOString(),
      notes: nextNotes,
    });
    await atomicWriteJson(storePath, nextStore);
    return { ok: true, code: "notes.delete_ok", message: "Note deleted.", deleted: true };
  });
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

