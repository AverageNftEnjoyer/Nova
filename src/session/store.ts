import fs from "node:fs";
import path from "node:path";
import type { SessionConfig } from "../config/types.js";
import type { SessionEntry, TranscriptTurn } from "./types.js";

export class SessionStore {
  private readonly storePath: string;
  private readonly transcriptDir: string;

  public constructor(config: SessionConfig) {
    this.storePath = path.resolve(config.storePath);
    this.transcriptDir = path.resolve(config.transcriptDir);
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
    const transcriptFile = this.getTranscriptPath(sessionId);
    const entry: TranscriptTurn = {
      role,
      content,
      timestamp: Date.now(),
      ...(tokens ? { tokens } : {}),
      ...(meta ? { meta } : {}),
    };
    fs.mkdirSync(path.dirname(transcriptFile), { recursive: true });
    fs.appendFileSync(transcriptFile, `${JSON.stringify(entry)}\n`, "utf8");
  }

  public loadTranscript(sessionId: string): TranscriptTurn[] {
    const transcriptFile = this.getTranscriptPath(sessionId);
    if (!fs.existsSync(transcriptFile)) {
      return [];
    }

    const raw = fs.readFileSync(transcriptFile, "utf8");
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
  }

  public getEntry(sessionKey: string): SessionEntry | null {
    const store = this.loadStore();
    return store[sessionKey] ?? null;
  }

  public setEntry(sessionKey: string, entry: SessionEntry): void {
    const store = this.loadStore();
    store[sessionKey] = entry;
    this.saveStore(store);
  }

  public deleteEntry(sessionKey: string): void {
    const store = this.loadStore();
    delete store[sessionKey];
    this.saveStore(store);
  }

  public getTranscriptPath(sessionId: string): string {
    return path.join(this.transcriptDir, `${sessionId}.jsonl`);
  }

  private ensurePaths(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.mkdirSync(this.transcriptDir, { recursive: true });

    if (!fs.existsSync(this.storePath)) {
      fs.writeFileSync(this.storePath, "{}", "utf8");
    }
  }

  private loadStore(): Record<string, SessionEntry> {
    this.ensurePaths();
    try {
      const raw = fs.readFileSync(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, SessionEntry>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
      return {};
    } catch {
      return {};
    }
  }

  private saveStore(store: Record<string, SessionEntry>): void {
    this.ensurePaths();
    fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2), "utf8");
  }
}