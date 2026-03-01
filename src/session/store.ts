import fs from "node:fs";
import path from "node:path";
import type { SessionConfig } from "../config/types.js";
import {
  fallbackUserContextIdFromSessionKey,
  normalizeUserContextId,
  parseSessionKeyUserContext,
} from "./key.js";
import type { SessionEntry, TranscriptTurn } from "./types.js";

export class SessionStore {
  private readonly storePath: string;
  private readonly transcriptDir: string;
  private readonly userContextRoot: string;
  private readonly transcriptsEnabled: boolean;
  private readonly maxTranscriptLines: number;
  private readonly transcriptRetentionDays: number;
  private readonly allowCrossContextLookup: boolean;

  private lastTranscriptPruneAt = 0;
  private legacySessionMigrationDone = false;
  private readonly sessionUserContextCache = new Map<string, string>();

  public constructor(config: SessionConfig) {
    const extended = config as SessionConfig & {
      userContextRoot?: string;
      transcriptsEnabled?: boolean;
      maxTranscriptLines?: number;
      transcriptRetentionDays?: number;
      allowCrossContextLookup?: boolean;
    };

    this.storePath = path.resolve(config.storePath);
    this.transcriptDir = path.resolve(config.transcriptDir);
    this.userContextRoot = path.resolve(
      extended.userContextRoot || path.join(this.transcriptDir, "..", "user-context"),
    );
    this.transcriptsEnabled = extended.transcriptsEnabled !== false;
    this.maxTranscriptLines = Number.isFinite(extended.maxTranscriptLines)
      ? Math.trunc(Number(extended.maxTranscriptLines))
      : 0;
    this.transcriptRetentionDays = Number.isFinite(extended.transcriptRetentionDays)
      ? Math.trunc(Number(extended.transcriptRetentionDays))
      : 0;
    this.allowCrossContextLookup =
      typeof extended.allowCrossContextLookup === "boolean"
        ? extended.allowCrossContextLookup
        : String(process.env.NOVA_SESSION_ALLOW_CROSS_CONTEXT_LOOKUP || "").trim() === "1";

    this.ensurePaths();
  }

  public appendTurn(sessionKey: string, role: string, content: unknown): void {
    const entry = this.getEntry(sessionKey);
    if (!entry) {
      throw new Error(`Cannot append turn: missing session entry for key ${sessionKey}`);
    }
    this.appendTurnBySessionId(entry.sessionId, role, content);
  }

  public appendTurnBySessionId(
    sessionId: string,
    role: string,
    content: unknown,
    tokens?: { input?: number; output?: number; total?: number },
    meta?: Record<string, unknown>,
  ): void {
    if (!this.transcriptsEnabled) return;
    this.ensurePaths();

    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return;

    const scopedUserContextId = this.resolveUserContextIdForSessionId(normalizedSessionId);
    const transcriptFile = scopedUserContextId
      ? this.getScopedTranscriptPath(normalizedSessionId, scopedUserContextId)
      : this.getLegacyTranscriptPath(normalizedSessionId);
    if (!transcriptFile) return;

    const entry: TranscriptTurn = {
      role,
      content,
      timestamp: Date.now(),
      ...(tokens ? { tokens } : {}),
      ...(meta ? { meta } : {}),
    };
    fs.mkdirSync(path.dirname(transcriptFile), { recursive: true });
    fs.appendFileSync(transcriptFile, `${JSON.stringify(entry)}\n`, "utf8");
    this.trimTranscriptFile(transcriptFile);
  }

  public loadTranscript(sessionId: string, userContextId = ""): TranscriptTurn[] {
    if (!this.transcriptsEnabled) return [];
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return [];

    const legacyTurns = this.readTranscriptFile(this.getLegacyTranscriptPath(normalizedSessionId));

    const scopedUserContextId =
      normalizeUserContextId(userContextId) || this.resolveUserContextIdForSessionId(normalizedSessionId);
    if (scopedUserContextId) {
      const scopedPath = this.getScopedTranscriptPath(normalizedSessionId, scopedUserContextId);
      if (scopedPath) {
        const scopedTurns = this.readTranscriptFile(scopedPath);
        if (legacyTurns.length > 0 && scopedTurns.length > 0) {
          const seen = new Set<string>();
          const merged: TranscriptTurn[] = [];
          for (const turn of [...legacyTurns, ...scopedTurns]) {
            const key = `${String(turn?.timestamp || "")}|${String(turn?.role || "")}|${String(turn?.content || "")}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(turn);
          }
          return merged;
        }
        if (scopedTurns.length > 0) return scopedTurns;
      }
    }

    return legacyTurns;
  }

  public getEntry(sessionKey: string, userContextId = ""): SessionEntry | null {
    this.migrateLegacySessionStoreIfNeeded();
    const normalizedKey = String(sessionKey || "").trim();
    if (!normalizedKey) return null;

    const normalizedContext =
      normalizeUserContextId(userContextId) ||
      parseSessionKeyUserContext(normalizedKey) ||
      fallbackUserContextIdFromSessionKey(normalizedKey);

    if (normalizedContext) {
      const scopedPath = this.getScopedSessionStorePath(normalizedContext);
      const scopedStore = this.loadStoreFromPath(scopedPath);
      const scopedEntry = scopedStore[normalizedKey] ?? null;
      if (scopedEntry) {
        if (scopedEntry.sessionId) this.sessionUserContextCache.set(String(scopedEntry.sessionId), normalizedContext);
        return scopedEntry;
      }
    }

    const legacyStore = this.loadStoreFromPath(this.storePath, { createIfMissing: false });
    const legacyEntry = legacyStore[normalizedKey] ?? null;
    if (legacyEntry) {
      const resolved =
        normalizeUserContextId(legacyEntry.userContextId || "") ||
        parseSessionKeyUserContext(legacyEntry.sessionKey || normalizedKey);
      if (resolved && legacyEntry.sessionId) this.sessionUserContextCache.set(String(legacyEntry.sessionId), resolved);
      return legacyEntry;
    }

    if (this.allowCrossContextLookup) {
      try {
        const contextDirs = fs.readdirSync(this.userContextRoot, { withFileTypes: true });
        for (const contextEntry of contextDirs) {
          if (!contextEntry.isDirectory()) continue;
          const scopedPath = this.getScopedSessionStorePath(contextEntry.name);
          let scopedStore = this.loadStoreFromPath(scopedPath, { createIfMissing: false });
          if (Object.keys(scopedStore).length === 0) {
            const legacyScopedPath = path.join(this.userContextRoot, contextEntry.name, "sessions.json");
            scopedStore = this.loadStoreFromPath(legacyScopedPath, { createIfMissing: false });
          }
          const entry = scopedStore[normalizedKey];
          if (!entry) continue;
          const resolved =
            normalizeUserContextId(entry.userContextId || "") ||
            normalizeUserContextId(contextEntry.name) ||
            parseSessionKeyUserContext(entry.sessionKey || normalizedKey);
          if (resolved && entry.sessionId) this.sessionUserContextCache.set(String(entry.sessionId), resolved);
          return entry;
        }
      } catch {
        // Ignore scan failures and report no entry.
      }
    }

    return null;
  }

  public setEntry(sessionKey: string, entry: SessionEntry, userContextId = ""): void {
    this.migrateLegacySessionStoreIfNeeded();
    const normalizedKey = String(sessionKey || "").trim();
    if (!normalizedKey) return;

    const normalizedContext =
      normalizeUserContextId(userContextId || entry.userContextId || "") ||
      parseSessionKeyUserContext(normalizedKey) ||
      fallbackUserContextIdFromSessionKey(normalizedKey);

    const storeInfo = this.loadSessionStoreForContext(normalizedContext, normalizedKey);
    const normalizedEntry: SessionEntry = normalizedContext
      ? { ...entry, userContextId: normalizedContext }
      : { ...entry };

    storeInfo.store[normalizedKey] = normalizedEntry;
    this.saveStoreToPath(storeInfo.storePath, storeInfo.store);

    if (normalizedContext && normalizedEntry.sessionId) {
      this.sessionUserContextCache.set(String(normalizedEntry.sessionId), normalizedContext);
    }
  }

  public deleteEntry(sessionKey: string, userContextId = ""): void {
    const normalizedKey = String(sessionKey || "").trim();
    if (!normalizedKey) return;

    const normalizedContext =
      normalizeUserContextId(userContextId) ||
      parseSessionKeyUserContext(normalizedKey) ||
      fallbackUserContextIdFromSessionKey(normalizedKey);

    if (normalizedContext) {
      const scopedPath = this.getScopedSessionStorePath(normalizedContext);
      const scopedStore = this.loadStoreFromPath(scopedPath);
      delete scopedStore[normalizedKey];
      this.saveStoreToPath(scopedPath, scopedStore);
      return;
    }
  }

  public getTranscriptPath(sessionId: string, userContextId = ""): string {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";
    const normalizedContext = normalizeUserContextId(userContextId);
    if (normalizedContext) {
      return this.getScopedTranscriptPath(normalizedSessionId, normalizedContext);
    }
    return path.join(this.transcriptDir, `${normalizedSessionId}.jsonl`);
  }

  public ensurePaths(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.mkdirSync(this.userContextRoot, { recursive: true });
  }

  public migrateLegacySessionStoreIfNeeded(): void {
    if (this.legacySessionMigrationDone) return;
    this.legacySessionMigrationDone = true;

    const legacyStore = this.loadStoreFromPath(this.storePath, { createIfMissing: false });
    const legacyKeys = Object.keys(legacyStore || {});
    if (legacyKeys.length === 0) return;

    const scopedStores = new Map<string, Record<string, SessionEntry>>();
    let mutated = false;

    for (const key of legacyKeys) {
      const entry = legacyStore[key];
      if (!entry || typeof entry !== "object") continue;

      const contextId =
        normalizeUserContextId(entry.userContextId || "") ||
        parseSessionKeyUserContext(entry.sessionKey || key);
      if (!contextId) continue;

      const scopedPath = this.getScopedSessionStorePath(contextId);
      if (!scopedPath) continue;

      if (!scopedStores.has(scopedPath)) {
        scopedStores.set(scopedPath, this.loadStoreFromPath(scopedPath));
      }
      const scopedStore = scopedStores.get(scopedPath);
      if (!scopedStore) continue;

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
      this.saveStoreToPath(scopedPath, scopedStore);
    }
  }

  public resolveUserContextIdForSessionId(sessionId: string): string {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";

    const cached = this.sessionUserContextCache.get(normalizedSessionId);
    if (cached) return cached;

    let resolved = "";
    try {
      const legacyStore = this.loadStoreFromPath(this.storePath, { createIfMissing: false });
      for (const entry of Object.values(legacyStore)) {
        if (!entry || typeof entry !== "object") continue;
        if (String(entry.sessionId || "").trim() !== normalizedSessionId) continue;
        resolved = normalizeUserContextId(entry.userContextId || "");
        if (!resolved) resolved = parseSessionKeyUserContext(entry.sessionKey || "");
        break;
      }

      if (!resolved) {
        const contextDirs = fs.readdirSync(this.userContextRoot, { withFileTypes: true });
        for (const contextEntry of contextDirs) {
          if (!contextEntry.isDirectory()) continue;
          const scopedPath = this.getScopedSessionStorePath(contextEntry.name);
          let scopedStore = this.loadStoreFromPath(scopedPath, { createIfMissing: false });
          if (Object.keys(scopedStore).length === 0) {
            const legacyScopedPath = path.join(this.userContextRoot, contextEntry.name, "sessions.json");
            scopedStore = this.loadStoreFromPath(legacyScopedPath, { createIfMissing: false });
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

    if (resolved) this.sessionUserContextCache.set(normalizedSessionId, resolved);
    return resolved;
  }

  public pruneOldTranscriptsIfNeeded(): void {
    if (!this.transcriptsEnabled) return;

    const now = Date.now();
    if (now - this.lastTranscriptPruneAt < 10 * 60 * 1000) return;
    this.lastTranscriptPruneAt = now;

    const retentionDays =
      Number.isFinite(this.transcriptRetentionDays) && this.transcriptRetentionDays > 0
        ? this.transcriptRetentionDays
        : 0;
    if (retentionDays <= 0) return;
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

    const pruneDir = (dirPath: string) => {
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

    pruneDir(this.transcriptDir);
    try {
      const contextDirs = fs.readdirSync(this.userContextRoot, { withFileTypes: true });
      for (const contextEntry of contextDirs) {
        if (!contextEntry.isDirectory()) continue;
        pruneDir(path.join(this.userContextRoot, contextEntry.name, "transcripts"));
      }
    } catch {
      // Ignore pruning failures.
    }
  }

  private getLegacyTranscriptPath(sessionId: string): string {
    return path.join(this.transcriptDir, `${sessionId}.jsonl`);
  }

  private getScopedTranscriptPath(sessionId: string, userContextId: string): string {
    const normalized = normalizeUserContextId(userContextId);
    if (!normalized) return "";
    return path.join(this.userContextRoot, normalized, "transcripts", `${sessionId}.jsonl`);
  }

  private getScopedSessionStorePath(userContextId: string): string {
    const normalized = normalizeUserContextId(userContextId);
    if (!normalized) return "";
    return path.join(this.userContextRoot, normalized, "state", "sessions.json");
  }

  private migrateLegacyScopedStoreIfNeeded(storePath: string): void {
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

  private ensureStoreFile(storePath: string): void {
    if (!storePath) return;
    this.migrateLegacyScopedStoreIfNeeded(storePath);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    if (!fs.existsSync(storePath)) {
      fs.writeFileSync(storePath, "{}", "utf8");
    }
  }

  private loadStoreFromPath(
    storePath: string,
    opts: { createIfMissing?: boolean } = {},
  ): Record<string, SessionEntry> {
    if (!storePath) return {};

    const createIfMissing = opts.createIfMissing !== false;
    if (createIfMissing) {
      this.ensureStoreFile(storePath);
    } else if (!fs.existsSync(storePath)) {
      return {};
    }

    try {
      const raw = fs.readFileSync(storePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, SessionEntry>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Ignore parse errors.
    }
    return {};
  }

  private saveStoreToPath(storePath: string, store: Record<string, SessionEntry>): void {
    if (!storePath) return;
    this.ensureStoreFile(storePath);
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  }

  private loadSessionStoreForContext(
    userContextId: string,
    sessionKey = "",
  ): {
    userContextId: string;
    storePath: string;
    store: Record<string, SessionEntry>;
  } {
    const normalized =
      normalizeUserContextId(userContextId) ||
      parseSessionKeyUserContext(sessionKey) ||
      fallbackUserContextIdFromSessionKey(sessionKey);
    const scopedPath = this.getScopedSessionStorePath(normalized);
    const scopedStore = this.loadStoreFromPath(scopedPath);
    if (sessionKey && !scopedStore[sessionKey]) {
      const legacyStore = this.loadStoreFromPath(this.storePath, { createIfMissing: false });
      const legacyEntry = legacyStore[sessionKey];
      if (legacyEntry && typeof legacyEntry === "object") {
        scopedStore[sessionKey] = {
          ...legacyEntry,
          userContextId: normalized,
        };
        this.saveStoreToPath(scopedPath, scopedStore);
      }
    }

    return {
      userContextId: normalized,
      storePath: scopedPath,
      store: scopedStore,
    };
  }

  private readTranscriptFile(transcriptPath: string): TranscriptTurn[] {
    try {
      if (!fs.existsSync(transcriptPath)) return [];
      const raw = fs.readFileSync(transcriptPath, "utf8");
      const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const out: TranscriptTurn[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as TranscriptTurn;
          if (typeof parsed.role !== "string") continue;
          out.push(parsed);
        } catch {
          // Ignore malformed JSONL lines.
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  private trimTranscriptFile(transcriptPath: string): void {
    const maxLines =
      Number.isFinite(this.maxTranscriptLines) && this.maxTranscriptLines > 0
        ? this.maxTranscriptLines
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
}
