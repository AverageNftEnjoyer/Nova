import { sessionRuntime } from "../../../../infrastructure/config/index.js";

function normalizeText(value = "") {
  return String(value || "").trim();
}

export function appendScopedTranscriptTurn(ctx = {}, role = "user", content = "", meta = {}) {
  const sessionId = normalizeText(ctx?.sessionId);
  const text = String(content || "");
  if (!sessionId || !text.trim()) return false;

  sessionRuntime.appendTranscriptTurn(sessionId, role, text, {
    source: ctx?.source,
    sender: role === "assistant" ? "nova" : ctx?.sender || null,
    sessionKey: normalizeText(ctx?.sessionKey) || undefined,
    conversationId: normalizeText(ctx?.conversationId) || undefined,
    ...meta,
  });
  return true;
}

export function appendScopedTranscriptExchange(ctx = {}, userText = "", assistantText = "", meta = {}) {
  appendScopedTranscriptTurn(ctx, "user", userText, meta.user || {});
  appendScopedTranscriptTurn(ctx, "assistant", assistantText, meta.assistant || {});
}
