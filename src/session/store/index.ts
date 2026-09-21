import type { SessionConfig } from "../../config/types/index.js";
import {
  normalizeUserContextId,
  parseSessionKeyUserContext,
} from "../key/index.js";
// The data layer is plain JS beside the runtime (src/session/sqlite-store). It is imported by repo-root-relative path
// so the same file is used from src/ (tsx/tests) and from the compiled dist/ output.
import {
  appendSessionTurn,
  deleteSessionEntry,
  findSessionEntryAcrossUsers,
  findUserIdForSessionId,
  getSessionEntry,
  loadSessionTurns,
  pruneSessionTurnsOlderThan,
  putSessionEntry,
} from "../../../src/session/sqlite-store/index.js";
import type { SessionEntry, TranscriptTurn } from "../types/index.js";

export class SessionStore {
  private readonly transcriptsEnabled: boolean;
  private readonly maxTranscriptLines: number;
  private readonly transcriptRetentionDays: number;
  private readonly allowCrossContextLookup: boolean;

  private lastTranscriptPruneAt = 0;
  private readonly sessionUserContextCache = new Map<string, string>();

  public constructor(config: SessionConfig) {
    const extended = config as SessionConfig & {
      userContextRoot?: string;
      transcriptsEnabled?: boolean;
      maxTranscriptLines?: number;
      transcriptRetentionDays?: number;
      allowCrossContextLookup?: boolean;
    };

    this.transcriptsEnabled = extended.transcriptsEnabled !== false;
    this.maxTranscriptLines = Number.isFinite(extended.maxTranscriptLines)
      ? Math.trunc(Number(extended.maxTranscriptLines))
      : 400;
    this.transcriptRetentionDays = Number.isFinite(extended.transcriptRetentionDays)
      ? Math.trunc(Number(extended.transcriptRetentionDays))
      : 30;
    this.allowCrossContextLookup =
      typeof extended.allowCrossContextLookup === "boolean"
        ? extended.allowCrossContextLookup
        : String(process.env.NOVA_SESSION_ALLOW_CROSS_CONTEXT_LOOKUP || "").trim() === "1";
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

    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return;

    const scopedUserContextId = this.resolveUserContextIdForSessionId(normalizedSessionId);
    const effectiveContextId = normalizeUserContextId(scopedUserContextId);
    if (!effectiveContextId) {
      throw new Error(`appendTurnBySessionId requires mapped userContextId for session ${normalizedSessionId}`);
    }

    const entry: TranscriptTurn = {
      role,
      content,
      timestamp: Date.now(),
      ...(tokens ? { tokens } : {}),
      ...(meta ? { meta } : {}),
    };
    appendSessionTurn(effectiveContextId, normalizedSessionId, entry, { maxTurns: this.maxTranscriptLines });
  }

  public loadTranscript(sessionId: string, userContextId = ""): TranscriptTurn[] {
    if (!this.transcriptsEnabled) return [];
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return [];

    const scopedUserContextId =
      normalizeUserContextId(userContextId) || this.resolveUserContextIdForSessionId(normalizedSessionId);
    if (!scopedUserContextId) return [];
    return loadSessionTurns(scopedUserContextId, normalizedSessionId) as TranscriptTurn[];
  }

  public getEntry(sessionKey: string, userContextId = ""): SessionEntry | null {
    const normalizedKey = String(sessionKey || "").trim();
    if (!normalizedKey) return null;

    const normalizedContext =
      normalizeUserContextId(userContextId) ||
      parseSessionKeyUserContext(normalizedKey);

    if (normalizedContext) {
      const scopedEntry = getSessionEntry(normalizedContext, normalizedKey) as SessionEntry | null;
      if (scopedEntry) {
        if (scopedEntry.sessionId) this.sessionUserContextCache.set(String(scopedEntry.sessionId), normalizedContext);
        return scopedEntry;
      }
    }

    if (this.allowCrossContextLookup) {
      const found = findSessionEntryAcrossUsers(normalizedKey);
      if (found) {
        const entry = found.entry as SessionEntry;
        const resolved =
          normalizeUserContextId(entry.userContextId || "") ||
          normalizeUserContextId(found.userId) ||
          parseSessionKeyUserContext(entry.sessionKey || normalizedKey);
        if (resolved && entry.sessionId) this.sessionUserContextCache.set(String(entry.sessionId), resolved);
        return entry;
      }
    }

    return null;
  }

  public setEntry(sessionKey: string, entry: SessionEntry, userContextId = ""): void {
    const normalizedKey = String(sessionKey || "").trim();
    if (!normalizedKey) return;

    const normalizedContext =
      normalizeUserContextId(userContextId || entry.userContextId || "") ||
      parseSessionKeyUserContext(normalizedKey);
    if (!normalizedContext) {
      throw new Error(`setEntry requires userContextId for session key ${normalizedKey}`);
    }

    const normalizedEntry: SessionEntry = { ...entry, userContextId: normalizedContext };
    putSessionEntry(normalizedContext, normalizedKey, normalizedEntry);

    if (normalizedEntry.sessionId) {
      this.sessionUserContextCache.set(String(normalizedEntry.sessionId), normalizedContext);
    }
  }

  public deleteEntry(sessionKey: string, userContextId = ""): void {
    const normalizedKey = String(sessionKey || "").trim();
    if (!normalizedKey) return;

    const normalizedContext =
      normalizeUserContextId(userContextId) ||
      parseSessionKeyUserContext(normalizedKey);
    if (!normalizedContext) return;
    deleteSessionEntry(normalizedContext, normalizedKey);
  }

  public resolveUserContextIdForSessionId(sessionId: string): string {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";

    const cached = this.sessionUserContextCache.get(normalizedSessionId);
    if (cached) return cached;

    const resolved = normalizeUserContextId(findUserIdForSessionId(normalizedSessionId));
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
    pruneSessionTurnsOlderThan(now - retentionDays * 24 * 60 * 60 * 1000);
  }
}
