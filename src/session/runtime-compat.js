import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

function normalizeToken(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) return "unknown";
  return trimmed.replace(/[^a-z0-9:_-]/g, "-");
}

function normalizeUserContextId(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 96);
}

function stableHashToken(value) {
  const input = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function deriveFallbackUserContextId(sessionKey, sourceHint = "") {
  const normalizedSource = normalizeToken(sourceHint || "").replace(/[^a-z0-9_-]/g, "-");
  const seed = String(sessionKey || "").trim() || normalizedSource || "session";
  const hash = stableHashToken(seed);
  const candidate = normalizeUserContextId(`${normalizedSource || "session"}-${hash}`);
  return candidate || `session-${hash}`;
}

export function createSessionRuntime({
  sessionStorePath,
  transcriptDir,
  userContextRoot = path.resolve(transcriptDir, "..", "user-context"),
  sessionIdleMinutes,
  sessionMainKey,
  transcriptsEnabled = true,
  maxTranscriptLines = 400,
  transcriptRetentionDays = 30,
}) {
  let lastTranscriptPruneAt = 0;
  let legacySessionMigrationDone = false;
  const sessionUserContextCache = new Map();
  const storeCacheByPath = new Map();
  const transcriptCacheByKey = new Map();
  const STORE_CACHE_TTL_MS = Math.max(
    500,
    Number.parseInt(process.env.NOVA_SESSION_STORE_CACHE_TTL_MS || "2000", 10) || 2000,
  );
  const TRANSCRIPT_CACHE_TTL_MS = Math.max(
    250,
    Number.parseInt(process.env.NOVA_TRANSCRIPT_CACHE_TTL_MS || "1200", 10) || 1200,
  );

  function ensureSessionStorePaths() {
    try {
      fs.mkdirSync(path.dirname(sessionStorePath), { recursive: true });
      fs.mkdirSync(userContextRoot, { recursive: true });
    } catch {
      // Ignore path bootstrap failures and let call sites handle downstream errors.
    }
  }

  function ensureStoreFile(storePath) {
    if (!storePath) return;
    migrateLegacyScopedStoreIfNeeded(storePath);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    if (!fs.existsSync(storePath)) {
      fs.writeFileSync(storePath, "{}", "utf8");
    }
  }

  function migrateLegacyScopedStoreIfNeeded(storePath) {
    if (!storePath || fs.existsSync(storePath)) return;
    if (path.basename(storePath) !== "sessions.json") return;
    if (path.basename(path.dirname(storePath)) !== "state") return;
    const userDir = path.dirname(path.dirname(storePath));
    const legacyScopedPath = path.join(userDir, "sessions.json");
    if (!fs.existsSync(legacyScopedPath)) return;
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    try {
      fs.renameSync(legacyScopedPath, storePath);
    } catch {
      try {
        fs.copyFileSync(legacyScopedPath, storePath);
      } catch {
        // Best effort migration.
      }
    }
  }

  function loadStoreFromPath(storePath, opts = {}) {
    if (!storePath) return {};
    const createIfMissing = opts.createIfMissing !== false;
    if (createIfMissing) {
      ensureStoreFile(storePath);
    } else if (!fs.existsSync(storePath)) {
      return {};
    }
    const now = Date.now();
    const cached = storeCacheByPath.get(storePath);
    if (cached && now - Number(cached.at || 0) < STORE_CACHE_TTL_MS && cached.store && typeof cached.store === "object") {
      try {
        const stat = fs.statSync(storePath);
        if (Number(stat.mtimeMs || 0) === Number(cached.mtimeMs || 0)) {
          return cached.store;
        }
      } catch {
        return cached.store;
      }
    }
    try {
      const raw = fs.readFileSync(storePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        let mtimeMs = 0;
        try {
          mtimeMs = Number(fs.statSync(storePath).mtimeMs || 0);
        } catch {}
        storeCacheByPath.set(storePath, { at: now, store: parsed, mtimeMs });
        return parsed;
      }
    } catch {}
    return {};
  }

  function saveStoreToPath(storePath, store) {
    if (!storePath) return;
    ensureStoreFile(storePath);
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
    let mtimeMs = 0;
    try {
      mtimeMs = Number(fs.statSync(storePath).mtimeMs || 0);
    } catch {}
    storeCacheByPath.set(storePath, { at: Date.now(), store, mtimeMs });
  }

  function getScopedSessionStorePath(userContextId) {
    const normalized = normalizeUserContextId(userContextId);
    if (!normalized) return "";
    return path.join(userContextRoot, normalized, "state", "sessions.json");
  }

  function loadSessionStoreForContext(userContextId, sessionKey = "") {
    const normalized =
      normalizeUserContextId(userContextId) ||
      parseSessionKeyUserContext(sessionKey) ||
      deriveFallbackUserContextId(sessionKey);
    const scopedPath = getScopedSessionStorePath(normalized);
    const scopedStore = loadStoreFromPath(scopedPath);
    if (sessionKey && !scopedStore[sessionKey]) {
      const legacyStore = loadStoreFromPath(sessionStorePath, { createIfMissing: false });
      const legacyEntry = legacyStore[sessionKey];
      if (legacyEntry && typeof legacyEntry === "object") {
        scopedStore[sessionKey] = {
          ...legacyEntry,
          userContextId: normalized,
        };
        saveStoreToPath(scopedPath, scopedStore);
      }
    }
    return {
      userContextId: normalized,
      storePath: scopedPath,
      store: scopedStore,
    };
  }

  function migrateLegacySessionStoreIfNeeded() {
    if (legacySessionMigrationDone) return;
    legacySessionMigrationDone = true;

    const legacyStore = loadStoreFromPath(sessionStorePath, { createIfMissing: false });
    const legacyKeys = Object.keys(legacyStore || {});
    if (legacyKeys.length === 0) return;

    const scopedStores = new Map();
    let mutated = false;

    for (const key of legacyKeys) {
      const entry = legacyStore[key];
      if (!entry || typeof entry !== "object") continue;
      const contextId =
        normalizeUserContextId(entry.userContextId || "") ||
        parseSessionKeyUserContext(entry.sessionKey || key);
      if (!contextId) continue;

      const scopedPath = getScopedSessionStorePath(contextId);
      if (!scopedPath) continue;
      if (!scopedStores.has(scopedPath)) {
        scopedStores.set(scopedPath, loadStoreFromPath(scopedPath));
      }
      const scopedStore = scopedStores.get(scopedPath);
      if (!scopedStore[key]) {
        scopedStore[key] = {
          ...entry,
          userContextId: contextId,
        };
        mutated = true;
      }
    }

    if (!mutated) return;
    for (const [scopedPath, scopedStore] of scopedStores.entries()) {
      saveStoreToPath(scopedPath, scopedStore);
    }
  }

  function buildSessionKeyFromInput(opts = {}) {
    const explicit = String(opts.sessionKeyHint || "").trim();
    if (explicit) return normalizeToken(explicit);

    const source = normalizeToken(opts.source || "hud");
    const sender = normalizeToken(opts.sender || "");
    const agent = "agent:nova";
    if (source === "hud") {
      const hudUserContextId = normalizeUserContextId(resolveUserContextId(opts) || "");
      if (hudUserContextId) {
        return `${agent}:hud:user:${hudUserContextId}:${normalizeToken(sessionMainKey)}`;
      }
      return `${agent}:hud:${normalizeToken(sessionMainKey)}`;
    }
    if (source === "voice") {
      return `${agent}:voice:dm:${sender || "local-mic"}`;
    }
    return `${agent}:${source}:dm:${sender || "anonymous"}`;
  }

  function resolveUserContextId(opts = {}) {
    const explicit = normalizeUserContextId(opts.userContextId || "");
    if (explicit) return explicit;

    const sender = String(opts.sender || "").trim();
    if (sender.startsWith("hud-user:")) {
      const fromSender = normalizeUserContextId(sender.slice("hud-user:".length));
      if (fromSender) return fromSender;
    }

    const source = normalizeToken(opts.source || "hud");
    if (source === "voice") {
      const voiceSender = normalizeUserContextId(sender || "local-mic");
      return voiceSender || "local-mic";
    }
    if (source !== "hud") {
      const senderFallback = normalizeUserContextId(sender);
      if (senderFallback) return senderFallback;
      const hinted = parseSessionKeyUserContext(String(opts.sessionKeyHint || ""));
      if (hinted) return hinted;
      return deriveFallbackUserContextId(String(opts.sessionKeyHint || ""), source);
    }

    const senderFallback = normalizeUserContextId(sender);
    if (senderFallback && senderFallback !== "hud-user") return senderFallback;
    return "";
  }

  function getLegacyTranscriptPath(sessionId) {
    return path.join(transcriptDir, `${sessionId}.jsonl`);
  }

  function getScopedTranscriptPath(sessionId, userContextId) {
    const normalized = normalizeUserContextId(userContextId);
    if (!normalized) return "";
    return path.join(userContextRoot, normalized, "transcripts", `${sessionId}.jsonl`);
  }

  function parseSessionKeyUserContext(sessionKey) {
    const normalizedKey = String(sessionKey || "").trim().toLowerCase();
    if (!normalizedKey) return "";
    const hudMarker = ":hud:user:";
    const hudIndex = normalizedKey.indexOf(hudMarker);
    if (hudIndex >= 0) {
      const tail = normalizedKey.slice(hudIndex + hudMarker.length);
      const candidate = normalizeUserContextId(tail.split(":")[0] || "");
      if (candidate) return candidate;
    }
    const voiceMarker = ":voice:dm:";
    const voiceIndex = normalizedKey.indexOf(voiceMarker);
    if (voiceIndex >= 0) {
      const tail = normalizedKey.slice(voiceIndex + voiceMarker.length);
      const candidate = normalizeUserContextId(tail.split(":")[0] || "");
      if (candidate) return candidate;
    }
    const dmMarker = ":dm:";
    const dmIndex = normalizedKey.lastIndexOf(dmMarker);
    if (dmIndex >= 0) {
      const tail = normalizedKey.slice(dmIndex + dmMarker.length);
      const candidate = normalizeUserContextId(tail.split(":")[0] || "");
      if (candidate && candidate !== "anonymous" && candidate !== "unknown") return candidate;
    }
    return "";
  }

  function resolveUserContextIdForSessionId(sessionId) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";
    const cached = sessionUserContextCache.get(normalizedSessionId);
    if (cached) return cached;

    let resolved = "";
    try {
      const legacyStore = loadStoreFromPath(sessionStorePath, { createIfMissing: false });
      for (const entry of Object.values(legacyStore)) {
        if (!entry || typeof entry !== "object") continue;
        if (String(entry.sessionId || "").trim() !== normalizedSessionId) continue;
        resolved = normalizeUserContextId(entry.userContextId || "");
        if (!resolved) resolved = parseSessionKeyUserContext(entry.sessionKey || "");
        break;
      }

      if (!resolved) {
        const contextDirs = fs.readdirSync(userContextRoot, { withFileTypes: true });
        for (const contextEntry of contextDirs) {
          if (!contextEntry.isDirectory()) continue;
          const scopedPath = getScopedSessionStorePath(contextEntry.name);
          let scopedStore = loadStoreFromPath(scopedPath, { createIfMissing: false });
          if (Object.keys(scopedStore).length === 0) {
            const legacyScopedPath = path.join(userContextRoot, contextEntry.name, "sessions.json");
            scopedStore = loadStoreFromPath(legacyScopedPath, { createIfMissing: false });
          }
          for (const entry of Object.values(scopedStore)) {
            if (!entry || typeof entry !== "object") continue;
            if (String(entry.sessionId || "").trim() !== normalizedSessionId) continue;
            resolved =
              normalizeUserContextId(entry.userContextId || "") ||
              normalizeUserContextId(contextEntry.name) ||
              parseSessionKeyUserContext(entry.sessionKey || "");
            break;
          }
          if (resolved) break;
        }
      }
    } catch {
      // Ignore and fallback to legacy transcript path.
    }

    if (resolved) sessionUserContextCache.set(normalizedSessionId, resolved);
    return resolved;
  }

  function readTranscriptFile(transcriptPath) {
    try {
      if (!fs.existsSync(transcriptPath)) return [];
      const raw = fs.readFileSync(transcriptPath, "utf8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function buildTranscriptCacheKey(sessionId, userContextId = "") {
    return `${String(sessionId || "").trim()}|${normalizeUserContextId(userContextId)}`;
  }

  function getCachedTranscript(sessionId, userContextId = "") {
    const key = buildTranscriptCacheKey(sessionId, userContextId);
    if (!key.startsWith("|") && transcriptCacheByKey.has(key)) {
      const entry = transcriptCacheByKey.get(key);
      if (entry && Date.now() - Number(entry.at || 0) < TRANSCRIPT_CACHE_TTL_MS && Array.isArray(entry.turns)) {
        return entry.turns;
      }
      transcriptCacheByKey.delete(key);
    }
    return null;
  }

  function setCachedTranscript(sessionId, userContextId = "", turns = []) {
    const key = buildTranscriptCacheKey(sessionId, userContextId);
    if (!key.startsWith("|")) {
      transcriptCacheByKey.set(key, { at: Date.now(), turns: Array.isArray(turns) ? turns : [] });
    }
  }

  function loadTranscript(sessionId, userContextId = "") {
    if (!transcriptsEnabled) return [];
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return [];

    const requestedContextId = normalizeUserContextId(userContextId);
    const cachedTurns = getCachedTranscript(normalizedSessionId, requestedContextId);
    if (cachedTurns) return cachedTurns;

    const legacyPath = getLegacyTranscriptPath(normalizedSessionId);
    const legacyTurns = readTranscriptFile(legacyPath);

    const scopedUserContextId = requestedContextId || resolveUserContextIdForSessionId(normalizedSessionId);
    if (scopedUserContextId) {
      const scopedPath = getScopedTranscriptPath(normalizedSessionId, scopedUserContextId);
      if (scopedPath) {
        const scopedTurns = readTranscriptFile(scopedPath);
        if (legacyTurns.length > 0 && scopedTurns.length > 0) {
          const seen = new Set();
          const merged = [];
          for (const turn of [...legacyTurns, ...scopedTurns]) {
            const key = `${String(turn?.timestamp || "")}|${String(turn?.role || "")}|${String(turn?.content || "")}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(turn);
          }
          setCachedTranscript(normalizedSessionId, scopedUserContextId, merged);
          return merged;
        }
        if (scopedTurns.length > 0) {
          setCachedTranscript(normalizedSessionId, scopedUserContextId, scopedTurns);
          return scopedTurns;
        }
      }
    }

    setCachedTranscript(normalizedSessionId, requestedContextId, legacyTurns);
    return legacyTurns;
  }

  function appendTranscriptTurn(sessionId, role, content, meta = null) {
    if (!transcriptsEnabled) return;
    ensureSessionStorePaths();
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return;
    const scopedUserContextId = resolveUserContextIdForSessionId(normalizedSessionId);
    const transcriptPath = scopedUserContextId
      ? getScopedTranscriptPath(normalizedSessionId, scopedUserContextId)
      : getLegacyTranscriptPath(normalizedSessionId);
    if (!transcriptPath) return;
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
    const payload = {
      role,
      content,
      timestamp: Date.now(),
      ...(meta && typeof meta === "object" ? { meta } : {}),
    };
    fs.appendFileSync(transcriptPath, `${JSON.stringify(payload)}\n`, "utf8");
    trimTranscriptFile(transcriptPath);
    const cachedTurns = getCachedTranscript(normalizedSessionId, scopedUserContextId || "");
    if (Array.isArray(cachedTurns)) {
      const nextTurns = [...cachedTurns, payload];
      const maxLines = Number.isFinite(maxTranscriptLines) && maxTranscriptLines > 0 ? maxTranscriptLines : 0;
      const bounded = maxLines > 0 && nextTurns.length > maxLines
        ? nextTurns.slice(-maxLines)
        : nextTurns;
      setCachedTranscript(normalizedSessionId, scopedUserContextId || "", bounded);
    } else {
      // Cache miss at append-time should not collapse history to a single payload.
      // Rehydrate from disk so the next turn still sees full conversation context.
      const hydratedTurns = readTranscriptFile(transcriptPath);
      setCachedTranscript(normalizedSessionId, scopedUserContextId || "", hydratedTurns);
    }
  }

  function trimTranscriptFile(transcriptPath) {
    const maxLines = Number.isFinite(maxTranscriptLines) && maxTranscriptLines > 0
      ? maxTranscriptLines
      : 0;
    if (maxLines <= 0) return;
    try {
      const raw = fs.readFileSync(transcriptPath, "utf8");
      const lines = raw.split(/\r?\n/).filter(Boolean);
      if (lines.length <= maxLines) return;
      const trimmed = lines.slice(-maxLines).join("\n");
      fs.writeFileSync(transcriptPath, `${trimmed}\n`, "utf8");
    } catch {
      // Ignore best-effort pruning failures.
    }
  }

  function pruneOldTranscriptsIfNeeded() {
    if (!transcriptsEnabled) return;
    const now = Date.now();
    if (now - lastTranscriptPruneAt < 10 * 60 * 1000) return;
    lastTranscriptPruneAt = now;

    const retentionDays =
      Number.isFinite(transcriptRetentionDays) && transcriptRetentionDays > 0
        ? transcriptRetentionDays
        : 0;
    if (retentionDays <= 0) return;
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    transcriptCacheByKey.clear();
    const pruneDir = (dirPath) => {
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) continue;
          const fullPath = path.join(dirPath, entry.name);
          try {
            const stat = fs.statSync(fullPath);
            if (now - stat.mtimeMs > retentionMs) {
              fs.unlinkSync(fullPath);
            }
          } catch {
            // Ignore per-file failures.
          }
        }
      } catch {
        // Ignore per-directory failures.
      }
    };

    pruneDir(transcriptDir);
    try {
      const contextDirs = fs.readdirSync(userContextRoot, { withFileTypes: true });
      for (const contextEntry of contextDirs) {
        if (!contextEntry.isDirectory()) continue;
        pruneDir(path.join(userContextRoot, contextEntry.name, "transcripts"));
      }
    } catch {
      // Ignore pruning failures.
    }
  }

  function limitTranscriptTurns(turns, maxTurns) {
    if (!Array.isArray(turns) || turns.length === 0) return [];
    const limit = Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 20;
    let userCount = 0;
    let start = turns.length;
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const role = turns[i]?.role;
      if (role === "user") {
        userCount += 1;
        if (userCount > limit) {
          break;
        }
        start = i;
      }
    }
    return turns.slice(start);
  }

  function transcriptToChatMessages(turns) {
    const out = [];
    for (const turn of turns) {
      if (!turn || (turn.role !== "user" && turn.role !== "assistant")) continue;
      if (typeof turn.content !== "string" || !turn.content.trim()) continue;
      out.push({ role: turn.role, content: turn.content });
    }
    return out;
  }

  function resolveSessionContext(opts = {}) {
    pruneOldTranscriptsIfNeeded();
    migrateLegacySessionStoreIfNeeded();
    const sessionKey = buildSessionKeyFromInput(opts);
    const resolvedUserContextId =
      resolveUserContextId(opts) ||
      parseSessionKeyUserContext(sessionKey) ||
      deriveFallbackUserContextId(sessionKey, opts.source || "");
    const storeInfo = loadSessionStoreForContext(resolvedUserContextId, sessionKey);
    const store = storeInfo.store;
    const now = Date.now();
    const idleMs = Math.max(1, sessionIdleMinutes) * 60 * 1000;
    const existing = store[sessionKey];
    const expired = existing?.updatedAt ? now - existing.updatedAt > idleMs : false;
    const effectiveUserContextId =
      normalizeUserContextId(resolvedUserContextId) ||
      normalizeUserContextId(existing?.userContextId || "") ||
      normalizeUserContextId(storeInfo.userContextId || "");
    const sessionEntry =
      !existing || expired
        ? {
            sessionId: randomUUID(),
            sessionKey,
            createdAt: now,
            updatedAt: now,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            contextTokens: 0,
            model: "",
            ...(effectiveUserContextId ? { userContextId: effectiveUserContextId } : {}),
          }
        : {
            ...existing,
            updatedAt: now,
            ...(effectiveUserContextId ? { userContextId: effectiveUserContextId } : {}),
          };

    if (sessionEntry.userContextId) {
      sessionUserContextCache.set(sessionEntry.sessionId, normalizeUserContextId(sessionEntry.userContextId));
    }
    store[sessionKey] = sessionEntry;
    saveStoreToPath(storeInfo.storePath, store);
    const transcript = transcriptsEnabled ? loadTranscript(sessionEntry.sessionId, sessionEntry.userContextId || "") : [];

    return {
      sessionKey,
      sessionEntry,
      transcript,
      persistUsage: ({ model, promptTokens, completionTokens }) => {
        const latestStore = loadStoreFromPath(storeInfo.storePath);
        const latestEntry = latestStore[sessionKey] || sessionEntry;
        latestStore[sessionKey] = {
          ...latestEntry,
          ...(sessionEntry.userContextId ? { userContextId: sessionEntry.userContextId } : {}),
          updatedAt: Date.now(),
          model: model || latestEntry.model || "",
          inputTokens: Number(latestEntry.inputTokens || 0) + Number(promptTokens || 0),
          outputTokens: Number(latestEntry.outputTokens || 0) + Number(completionTokens || 0),
          totalTokens:
            Number(latestEntry.totalTokens || 0) +
            Number(promptTokens || 0) +
            Number(completionTokens || 0),
          contextTokens: Number(latestEntry.contextTokens || 0) + Number(promptTokens || 0),
        };
        saveStoreToPath(storeInfo.storePath, latestStore);
      },
    };
  }

  return {
    ensureSessionStorePaths,
    normalizeUserContextId,
    resolveUserContextId,
    resolveSessionContext,
    appendTranscriptTurn,
    limitTranscriptTurns,
    transcriptToChatMessages,
  };
}
