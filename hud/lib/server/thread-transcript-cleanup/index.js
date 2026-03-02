import path from "node:path";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";

export function normalizeUserContextId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function normalizeToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeConversationId(value) {
  return String(value ?? "").trim();
}

function normalizeSessionKey(value) {
  return String(value ?? "").trim();
}

export function buildHudSessionKey(userContextId, threadId) {
  return `agent:nova:hud:user:${normalizeUserContextId(userContextId)}:dm:${normalizeConversationId(threadId)}`;
}

export function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseSessionConversationIdFromSessionKey(sessionKey) {
  const normalized = normalizeSessionKey(sessionKey);
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  const marker = ":dm:";
  const idx = lower.lastIndexOf(marker);
  if (idx < 0) return "";
  return normalized.slice(idx + marker.length).trim();
}

export function collectThreadCleanupHints(threadId, messageRows = []) {
  const sessionConversationIds = new Set();
  const sessionKeys = new Set();

  const normalizedThreadId = normalizeConversationId(threadId);
  if (normalizedThreadId) sessionConversationIds.add(normalizedThreadId);

  for (const row of Array.isArray(messageRows) ? messageRows : []) {
    const metadata = row && typeof row === "object" ? row.metadata : null;
    if (!metadata || typeof metadata !== "object") continue;

    const sessionConversationId = normalizeConversationId(metadata.sessionConversationId);
    if (sessionConversationId) sessionConversationIds.add(sessionConversationId);

    const metadataConversationId = normalizeConversationId(metadata.conversationId);
    if (metadataConversationId) sessionConversationIds.add(metadataConversationId);

    const sessionKey = normalizeSessionKey(metadata.sessionKey);
    if (sessionKey) {
      sessionKeys.add(sessionKey);
      const derivedSessionConversationId = parseSessionConversationIdFromSessionKey(sessionKey);
      if (derivedSessionConversationId) sessionConversationIds.add(derivedSessionConversationId);
    }
  }

  return {
    sessionConversationIds: Array.from(sessionConversationIds),
    sessionKeys: Array.from(sessionKeys),
  };
}

function keyMatchesConversationId(sessionKey, conversationId) {
  const keyLower = normalizeToken(sessionKey);
  const idLower = normalizeToken(conversationId);
  if (!keyLower || !idLower) return false;
  return keyLower.endsWith(`:dm:${idLower}`);
}

function keyMatchesAnyConversationId(sessionKey, conversationIds) {
  for (const conversationId of conversationIds) {
    if (keyMatchesConversationId(sessionKey, conversationId)) return true;
  }
  return false;
}

function buildSessionKeyLookup(sessionKeys, userContextId, conversationIds) {
  const lookup = new Set();
  for (const key of sessionKeys) {
    const normalized = normalizeSessionKey(key);
    if (normalized) lookup.add(normalized.toLowerCase());
  }
  for (const conversationId of conversationIds) {
    const normalizedConversationId = normalizeConversationId(conversationId);
    if (!normalizedConversationId) continue;
    const key = buildHudSessionKey(userContextId, normalizedConversationId);
    lookup.add(normalizeToken(key));
  }
  return lookup;
}

async function pruneSessionStoreByConversationKeys(storePath, conversationIds, sessionKeyLookup) {
  const rawStore = await readFile(storePath, "utf8").catch(() => "");
  if (!rawStore) return { removedSessionEntries: 0, sessionIds: new Set() };

  let removedSessionEntries = 0;
  const sessionIds = new Set();

  try {
    const parsed = JSON.parse(rawStore);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { removedSessionEntries, sessionIds };
    }

    for (const [sessionKey, entry] of Object.entries(parsed)) {
      const normalizedKey = normalizeSessionKey(sessionKey);
      if (!normalizedKey) continue;
      const normalizedLookupKey = normalizeToken(normalizedKey);
      const matchesSessionKey = sessionKeyLookup.has(normalizedLookupKey);
      const matchesConversationId = keyMatchesAnyConversationId(normalizedKey, conversationIds);
      if (!matchesSessionKey && !matchesConversationId) continue;
      const sessionId = String(entry?.sessionId || "").trim();
      if (sessionId) sessionIds.add(sessionId);
      delete parsed[sessionKey];
      removedSessionEntries += 1;
    }

    if (removedSessionEntries > 0) {
      await writeFile(storePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    }
  } catch {
    // Ignore malformed session store and continue with transcript scan.
  }

  return { removedSessionEntries, sessionIds };
}

function compileTranscriptPatterns(conversationIds, sessionKeyLookup) {
  const patterns = [];

  for (const sessionKey of sessionKeyLookup) {
    if (!sessionKey) continue;
    patterns.push({
      type: "includes",
      value: sessionKey,
    });
  }

  for (const conversationId of conversationIds) {
    const normalizedConversationId = normalizeConversationId(conversationId);
    if (!normalizedConversationId) continue;
    patterns.push({
      type: "regex",
      value: new RegExp(`:dm:${escapeRegExp(normalizedConversationId)}(?:$|["\\s])`, "i"),
    });
    patterns.push({
      type: "regex",
      value: new RegExp(`"conversationId"\\s*:\\s*"${escapeRegExp(normalizedConversationId)}"`, "i"),
    });
    patterns.push({
      type: "regex",
      value: new RegExp(`"sessionConversationId"\\s*:\\s*"${escapeRegExp(normalizedConversationId)}"`, "i"),
    });
  }

  return patterns;
}

function transcriptMatchesCleanupPatterns(rawTranscript, patterns) {
  const normalizedRaw = String(rawTranscript || "");
  if (!normalizedRaw) return false;
  const rawLower = normalizedRaw.toLowerCase();

  for (const pattern of patterns) {
    if (pattern.type === "includes") {
      if (rawLower.includes(pattern.value)) return true;
      continue;
    }
    if (pattern.type === "regex" && pattern.value.test(normalizedRaw)) return true;
  }
  return false;
}

export async function pruneThreadTranscripts(workspaceRoot, userId, threadId, opts = {}) {
  const userContextId = normalizeUserContextId(userId);
  const normalizedThreadId = normalizeConversationId(threadId);
  if (!userContextId || !normalizedThreadId) {
    return { removedSessionEntries: 0, removedTranscriptFiles: 0 };
  }

  const sessionConversationIds = new Set([normalizedThreadId]);
  for (const alias of Array.isArray(opts.sessionConversationIds) ? opts.sessionConversationIds : []) {
    const normalizedAlias = normalizeConversationId(alias);
    if (normalizedAlias) sessionConversationIds.add(normalizedAlias);
  }

  const sessionKeyLookup = buildSessionKeyLookup(
    Array.isArray(opts.sessionKeys) ? opts.sessionKeys : [],
    userContextId,
    sessionConversationIds,
  );
  const transcriptPatterns = compileTranscriptPatterns(sessionConversationIds, sessionKeyLookup);

  const userContextDir = path.join(workspaceRoot, ".agent", "user-context", userContextId);
  const sessionStorePath = path.join(userContextDir, "state", "sessions.json");
  const legacyScopedSessionStorePath = path.join(userContextDir, "sessions.json");
  const legacySessionStorePath = path.join(workspaceRoot, ".agent", "sessions.json");
  const scopedTranscriptDir = path.join(userContextDir, "transcripts");
  const legacyTranscriptDir = path.join(workspaceRoot, ".agent", "transcripts");

  let removedSessionEntries = 0;
  let removedTranscriptFiles = 0;
  const sessionIds = new Set();

  const scopedSessionPrune = await pruneSessionStoreByConversationKeys(
    sessionStorePath,
    sessionConversationIds,
    sessionKeyLookup,
  );
  removedSessionEntries += scopedSessionPrune.removedSessionEntries;
  for (const sessionId of scopedSessionPrune.sessionIds) sessionIds.add(sessionId);

  const legacyScopedSessionPrune = await pruneSessionStoreByConversationKeys(
    legacyScopedSessionStorePath,
    sessionConversationIds,
    sessionKeyLookup,
  );
  removedSessionEntries += legacyScopedSessionPrune.removedSessionEntries;
  for (const sessionId of legacyScopedSessionPrune.sessionIds) sessionIds.add(sessionId);

  const legacySessionPrune = await pruneSessionStoreByConversationKeys(
    legacySessionStorePath,
    sessionConversationIds,
    sessionKeyLookup,
  );
  removedSessionEntries += legacySessionPrune.removedSessionEntries;
  for (const sessionId of legacySessionPrune.sessionIds) sessionIds.add(sessionId);

  for (const sessionId of sessionIds) {
    const scopedPath = path.join(scopedTranscriptDir, `${sessionId}.jsonl`);
    const legacyPath = path.join(legacyTranscriptDir, `${sessionId}.jsonl`);
    const scopedExists = await readFile(scopedPath, "utf8").then(() => true).catch(() => false);
    if (scopedExists) {
      await rm(scopedPath, { force: true }).catch(() => {});
      removedTranscriptFiles += 1;
    }
    const legacyExists = await readFile(legacyPath, "utf8").then(() => true).catch(() => false);
    if (legacyExists) {
      await rm(legacyPath, { force: true }).catch(() => {});
      removedTranscriptFiles += 1;
    }
  }

  const scanAndPrune = async (dirPath) => {
    const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) continue;
      const filePath = path.join(dirPath, entry.name);
      const raw = await readFile(filePath, "utf8").catch(() => "");
      if (!raw) continue;
      if (!transcriptMatchesCleanupPatterns(raw, transcriptPatterns)) continue;
      await rm(filePath, { force: true }).catch(() => {});
      removedTranscriptFiles += 1;
    }
  };

  await scanAndPrune(scopedTranscriptDir);
  await scanAndPrune(legacyTranscriptDir);

  return { removedSessionEntries, removedTranscriptFiles };
}
