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

export function createSessionRuntime({
  sessionStorePath,
  transcriptDir,
  sessionIdleMinutes,
  sessionMainKey,
  transcriptsEnabled = true,
  maxTranscriptLines = 400,
  transcriptRetentionDays = 30,
}) {
  let lastTranscriptPruneAt = 0;

  function ensureSessionStorePaths() {
    try {
      fs.mkdirSync(path.dirname(sessionStorePath), { recursive: true });
      fs.mkdirSync(transcriptDir, { recursive: true });
      if (!fs.existsSync(sessionStorePath)) {
        fs.writeFileSync(sessionStorePath, "{}", "utf8");
      }
    } catch {
      // Ignore path bootstrap failures and let call sites handle downstream errors.
    }
  }

  function loadSessionStore() {
    ensureSessionStorePaths();
    try {
      const raw = fs.readFileSync(sessionStorePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {}
    return {};
  }

  function saveSessionStore(store) {
    ensureSessionStorePaths();
    fs.writeFileSync(sessionStorePath, JSON.stringify(store, null, 2), "utf8");
  }

  function buildSessionKeyFromInput(opts = {}) {
    const explicit = String(opts.sessionKeyHint || "").trim();
    if (explicit) return normalizeToken(explicit);

    const source = normalizeToken(opts.source || "hud");
    const sender = normalizeToken(opts.sender || "");
    const agent = "agent:nova";
    if (source === "hud") {
      return `${agent}:${normalizeToken(sessionMainKey)}`;
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
    if (source !== "hud") return "";

    const senderFallback = normalizeUserContextId(sender);
    if (senderFallback && senderFallback !== "hud-user") return senderFallback;
    return "";
  }

  function getTranscriptPath(sessionId) {
    return path.join(transcriptDir, `${sessionId}.jsonl`);
  }

  function loadTranscript(sessionId) {
    if (!transcriptsEnabled) return [];
    const transcriptPath = getTranscriptPath(sessionId);
    if (!fs.existsSync(transcriptPath)) return [];
    try {
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

  function appendTranscriptTurn(sessionId, role, content, meta = null) {
    if (!transcriptsEnabled) return;
    ensureSessionStorePaths();
    const transcriptPath = getTranscriptPath(sessionId);
    const payload = {
      role,
      content,
      timestamp: Date.now(),
      ...(meta && typeof meta === "object" ? { meta } : {}),
    };
    fs.appendFileSync(transcriptPath, `${JSON.stringify(payload)}\n`, "utf8");
    trimTranscriptFile(transcriptPath);
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
    try {
      const entries = fs.readdirSync(transcriptDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) continue;
        const fullPath = path.join(transcriptDir, entry.name);
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
    const sessionKey = buildSessionKeyFromInput(opts);
    const store = loadSessionStore();
    const now = Date.now();
    const idleMs = Math.max(1, sessionIdleMinutes) * 60 * 1000;
    const existing = store[sessionKey];
    const expired = existing?.updatedAt ? now - existing.updatedAt > idleMs : false;
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
          }
        : {
            ...existing,
            updatedAt: now,
          };

    store[sessionKey] = sessionEntry;
    saveSessionStore(store);
    const transcript = transcriptsEnabled ? loadTranscript(sessionEntry.sessionId) : [];

    return {
      sessionKey,
      sessionEntry,
      transcript,
      persistUsage: ({ model, promptTokens, completionTokens }) => {
        const latestStore = loadSessionStore();
        const latestEntry = latestStore[sessionKey] || sessionEntry;
        latestStore[sessionKey] = {
          ...latestEntry,
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
        saveSessionStore(latestStore);
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
