import { createHash } from "crypto";

const INBOUND_TEXT_DEDUPE_MS = 6000;
const INBOUND_ID_DEDUPE_MS = 15 * 60 * 1000;
const INBOUND_DEDUPE_MAX = 5000;

const seenByKey = new Map();

function normalizeText(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function prune(nowMs) {
  if (seenByKey.size <= INBOUND_DEDUPE_MAX) return;
  const entries = [...seenByKey.entries()].sort((a, b) => (a[1]?.ts || 0) - (b[1]?.ts || 0));
  const removeCount = Math.max(1, entries.length - INBOUND_DEDUPE_MAX);
  for (let i = 0; i < removeCount; i += 1) {
    const key = entries[i]?.[0];
    if (!key) continue;
    seenByKey.delete(key);
  }
  for (const [key, info] of seenByKey.entries()) {
    const ttl = info?.kind === "id" ? INBOUND_ID_DEDUPE_MS : INBOUND_TEXT_DEDUPE_MS;
    if (nowMs - Number(info?.ts || 0) > ttl) {
      seenByKey.delete(key);
    }
  }
}

function buildTextFingerprint(text) {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

function buildScope(params) {
  const source = String(params?.source || "").trim().toLowerCase() || "hud";
  const sender = String(params?.sender || "").trim().toLowerCase() || "unknown";
  const sessionKey = String(params?.sessionKey || "").trim().toLowerCase();
  const userContextId = String(params?.userContextId || "").trim().toLowerCase();
  return `${source}|${userContextId}|${sessionKey}|${sender}`;
}

function isWithinWindow(info, nowMs) {
  const ttl = info?.kind === "id" ? INBOUND_ID_DEDUPE_MS : INBOUND_TEXT_DEDUPE_MS;
  return nowMs - Number(info?.ts || 0) <= ttl;
}

function checkSeen(key, nowMs) {
  const last = seenByKey.get(key);
  return Boolean(last && isWithinWindow(last, nowMs));
}

function markSeen(key, nowMs, kind) {
  seenByKey.set(key, { ts: nowMs, kind });
}

export function shouldSkipDuplicateInbound(params) {
  const nowMs = Date.now();
  prune(nowMs);

  const scope = buildScope(params);
  const inboundMessageId = String(params?.inboundMessageId || "").trim();
  const normalized = normalizeText(params?.text);
  if (!normalized) return false;

  const textHash = buildTextFingerprint(normalized);
  const textKey = `text|${scope}|${textHash}`;

  // Prefer strong ID-based dedupe first.
  if (inboundMessageId) {
    const idKey = `id|${scope}|${inboundMessageId}`;
    if (checkSeen(idKey, nowMs)) {
      return true;
    }
    // Guard against retries that changed message IDs but repeated the same content.
    if (checkSeen(textKey, nowMs)) {
      markSeen(idKey, nowMs, "id");
      return true;
    }
    markSeen(idKey, nowMs, "id");
    markSeen(textKey, nowMs, "text");
    return false;
  }

  if (checkSeen(textKey, nowMs)) {
    return true;
  }
  markSeen(textKey, nowMs, "text");
  return false;
}
