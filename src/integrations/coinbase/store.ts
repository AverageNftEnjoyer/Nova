import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { decryptTokenFromStorage, encryptTokenForStorage } from "./crypto.js";

export type CoinbaseSnapshotType = "spot_price" | "portfolio" | "transactions";
export type CoinbaseAuditStatus = "ok" | "error";
export type CoinbaseIdempotencyStatus = "pending" | "completed" | "failed";

export interface CoinbaseSnapshotRecordInput {
  userContextId: string;
  snapshotType: CoinbaseSnapshotType;
  symbolPair?: string;
  payload: unknown;
  fetchedAtMs: number;
  freshnessMs: number;
  source?: string;
}

export interface CoinbaseReportHistoryInput {
  reportRunId?: string;
  userContextId: string;
  scheduleId?: string;
  missionRunId?: string;
  reportType: string;
  deliveredChannel?: string;
  deliveredAtMs?: number;
  payload: unknown;
}

export interface CoinbaseAuditLogInput {
  userContextId: string;
  eventType: string;
  status: CoinbaseAuditStatus;
  conversationId?: string;
  missionRunId?: string;
  details?: Record<string, unknown>;
}

export interface CoinbaseConnectionMetadataInput {
  userContextId: string;
  connected: boolean;
  mode: "api_key_pair" | "oauth";
  keyFingerprint?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
}

export interface CoinbaseIdempotencyClaimInput {
  key: string;
  userContextId: string;
  scope: string;
  ttlMs: number;
}

export interface CoinbaseIdempotencyClaimResult {
  accepted: boolean;
  status: CoinbaseIdempotencyStatus;
  resultRef?: string;
  firstSeenAtMs: number;
  expiresAtMs: number;
}

export interface CoinbaseOAuthTokenInput {
  userContextId: string;
  accessToken: string;
  refreshToken: string;
  scope?: string;
  expiresAtMs: number;
}

export interface CoinbaseOAuthTokenRecord {
  userContextId: string;
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAtMs: number;
  updatedAtMs: number;
  keyId: string;
  revokedAtMs: number;
}

export class CoinbaseDataStore {
  private readonly dbPath: string;
  private readonly db: Database.Database;

  public constructor(dbPath = defaultCoinbaseDbPath()) {
    this.dbPath = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    ensureCoinbaseSchema(this.db);
  }

  public getPath(): string {
    return this.dbPath;
  }

  public close(): void {
    this.db.close();
  }

  public upsertConnectionMetadata(input: CoinbaseConnectionMetadataInput): void {
    const userContextId = normalizeUserContextId(input.userContextId);
    if (!userContextId) return;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO coinbase_connection_metadata (
        user_context_id, connected, mode, key_fingerprint, last_error_code, last_error_message, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_context_id) DO UPDATE SET
        connected=excluded.connected,
        mode=excluded.mode,
        key_fingerprint=excluded.key_fingerprint,
        last_error_code=excluded.last_error_code,
        last_error_message=excluded.last_error_message,
        updated_at=excluded.updated_at
    `).run(
      userContextId,
      input.connected ? 1 : 0,
      String(input.mode || "api_key_pair"),
      sanitizeString(input.keyFingerprint, 128),
      sanitizeString(input.lastErrorCode, 64),
      sanitizeString(input.lastErrorMessage, 500),
      now,
    );
  }

  public appendSnapshot(input: CoinbaseSnapshotRecordInput): string {
    const userContextId = normalizeUserContextId(input.userContextId);
    if (!userContextId) return "";
    const snapshotId = randomUUID();
    this.db.prepare(`
      INSERT INTO coinbase_snapshots (
        snapshot_id, user_context_id, snapshot_type, symbol_pair, payload_json, fetched_at, freshness_ms, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId,
      userContextId,
      String(input.snapshotType),
      sanitizeString(input.symbolPair, 32),
      safeJsonStringify(input.payload),
      Math.max(0, Math.floor(Number(input.fetchedAtMs || 0))),
      Math.max(0, Math.floor(Number(input.freshnessMs || 0))),
      sanitizeString(input.source || "coinbase", 32),
      Date.now(),
    );
    return snapshotId;
  }

  public appendReportHistory(input: CoinbaseReportHistoryInput): string {
    const userContextId = normalizeUserContextId(input.userContextId);
    if (!userContextId) return "";
    const reportRunId = sanitizeString(input.reportRunId, 96) || randomUUID();
    const payloadJson = safeJsonStringify(input.payload);
    const reportHash = hashPayload(payloadJson);

    this.db.prepare(`
      INSERT INTO coinbase_report_history (
        report_run_id, user_context_id, schedule_id, mission_run_id, report_type, delivered_channel,
        delivered_at, report_hash, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(report_run_id) DO UPDATE SET
        delivered_channel=excluded.delivered_channel,
        delivered_at=excluded.delivered_at,
        report_hash=excluded.report_hash,
        payload_json=excluded.payload_json
    `).run(
      reportRunId,
      userContextId,
      sanitizeString(input.scheduleId, 96),
      sanitizeString(input.missionRunId, 96),
      sanitizeString(input.reportType, 64) || "portfolio_summary",
      sanitizeString(input.deliveredChannel, 32),
      Math.max(0, Math.floor(Number(input.deliveredAtMs || Date.now()))),
      reportHash,
      payloadJson,
      Date.now(),
    );
    return reportRunId;
  }

  public claimIdempotencyKey(input: CoinbaseIdempotencyClaimInput): CoinbaseIdempotencyClaimResult {
    const key = sanitizeString(input.key, 160);
    const userContextId = normalizeUserContextId(input.userContextId);
    const scope = sanitizeString(input.scope, 64) || "coinbase_report";
    const now = Date.now();
    const ttlMs = Math.max(1_000, Math.floor(Number(input.ttlMs || 0)));
    if (!key || !userContextId) {
      return {
        accepted: false,
        status: "failed",
        firstSeenAtMs: now,
        expiresAtMs: now,
      };
    }

    this.pruneExpiredIdempotency(now);

    const existing = this.db
      .prepare(`
        SELECT status, result_ref, first_seen_at, expires_at
        FROM coinbase_idempotency_keys
        WHERE idempotency_key = ? AND user_context_id = ?
      `)
      .get(key, userContextId) as
      | { status: CoinbaseIdempotencyStatus; result_ref: string; first_seen_at: number; expires_at: number }
      | undefined;

    if (existing && existing.expires_at > now) {
      return {
        accepted: false,
        status: existing.status,
        resultRef: existing.result_ref || "",
        firstSeenAtMs: Number(existing.first_seen_at || now),
        expiresAtMs: Number(existing.expires_at || now),
      };
    }

    const expiresAtMs = now + ttlMs;
    this.db.prepare(`
      INSERT INTO coinbase_idempotency_keys (
        idempotency_key, user_context_id, scope, status, result_ref, first_seen_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        user_context_id=excluded.user_context_id,
        scope=excluded.scope,
        status=excluded.status,
        result_ref=excluded.result_ref,
        first_seen_at=excluded.first_seen_at,
        expires_at=excluded.expires_at
    `).run(key, userContextId, scope, "pending", "", now, expiresAtMs);

    return {
      accepted: true,
      status: "pending",
      firstSeenAtMs: now,
      expiresAtMs,
    };
  }

  public completeIdempotencyKey(input: {
    key: string;
    userContextId: string;
    status: Extract<CoinbaseIdempotencyStatus, "completed" | "failed">;
    resultRef?: string;
    extendTtlMs?: number;
  }): void {
    const key = sanitizeString(input.key, 160);
    const userContextId = normalizeUserContextId(input.userContextId);
    if (!key || !userContextId) return;
    const now = Date.now();
    const ttlMs = Math.max(60_000, Math.floor(Number(input.extendTtlMs || 6 * 60 * 60 * 1000)));
    this.db.prepare(`
      UPDATE coinbase_idempotency_keys
      SET status = ?, result_ref = ?, expires_at = ?
      WHERE idempotency_key = ? AND user_context_id = ?
    `).run(input.status, sanitizeString(input.resultRef, 160), now + ttlMs, key, userContextId);
  }

  public pruneExpiredIdempotency(now = Date.now()): number {
    const result = this.db
      .prepare("DELETE FROM coinbase_idempotency_keys WHERE expires_at <= ?")
      .run(Math.max(0, Math.floor(now)));
    return Number(result.changes || 0);
  }

  public appendAuditLog(input: CoinbaseAuditLogInput): void {
    const userContextId = normalizeUserContextId(input.userContextId);
    if (!userContextId) return;
    this.db.prepare(`
      INSERT INTO coinbase_audit_log (
        user_context_id, conversation_id, mission_run_id, event_type, status, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userContextId,
      sanitizeString(input.conversationId, 96),
      sanitizeString(input.missionRunId, 96),
      sanitizeString(input.eventType, 64),
      input.status === "error" ? "error" : "ok",
      safeJsonStringify(input.details || {}),
      Date.now(),
    );
  }

  public saveOauthTokens(input: CoinbaseOAuthTokenInput): void {
    const userContextId = normalizeUserContextId(input.userContextId);
    if (!userContextId) return;
    const accessEnvelope = encryptTokenForStorage(input.accessToken);
    const refreshEnvelope = encryptTokenForStorage(input.refreshToken);
    if (!accessEnvelope || !refreshEnvelope) return;

    this.db.prepare(`
      INSERT INTO coinbase_oauth_tokens (
        user_context_id, access_token_enc, refresh_token_enc, key_id, scope, expires_at, revoked_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_context_id) DO UPDATE SET
        access_token_enc=excluded.access_token_enc,
        refresh_token_enc=excluded.refresh_token_enc,
        key_id=excluded.key_id,
        scope=excluded.scope,
        expires_at=excluded.expires_at,
        revoked_at=excluded.revoked_at,
        updated_at=excluded.updated_at
    `).run(
      userContextId,
      accessEnvelope.payload,
      refreshEnvelope.payload,
      accessEnvelope.keyId,
      sanitizeString(input.scope, 512),
      Math.max(0, Math.floor(Number(input.expiresAtMs || 0))),
      0,
      Date.now(),
    );
  }

  public getOauthTokens(userContextIdInput: string): CoinbaseOAuthTokenRecord | null {
    const userContextId = normalizeUserContextId(userContextIdInput);
    if (!userContextId) return null;
    const row = this.db.prepare(`
      SELECT user_context_id, access_token_enc, refresh_token_enc, key_id, scope, expires_at, updated_at, revoked_at
      FROM coinbase_oauth_tokens
      WHERE user_context_id = ?
    `).get(userContextId) as
      | {
          user_context_id: string;
          access_token_enc: string;
          refresh_token_enc: string;
          key_id: string;
          scope: string;
          expires_at: number;
          updated_at: number;
          revoked_at: number;
        }
      | undefined;
    if (!row) return null;

    const accessToken = decryptTokenFromStorage({ keyId: String(row.key_id || ""), payload: String(row.access_token_enc || "") });
    const refreshToken = decryptTokenFromStorage({ keyId: String(row.key_id || ""), payload: String(row.refresh_token_enc || "") });
    if (!accessToken || !refreshToken) return null;
    return {
      userContextId: String(row.user_context_id || ""),
      accessToken,
      refreshToken,
      scope: String(row.scope || ""),
      expiresAtMs: Number(row.expires_at || 0),
      updatedAtMs: Number(row.updated_at || 0),
      keyId: String(row.key_id || ""),
      revokedAtMs: Number(row.revoked_at || 0),
    };
  }

  public revokeOauthTokens(userContextIdInput: string): void {
    const userContextId = normalizeUserContextId(userContextIdInput);
    if (!userContextId) return;
    this.db.prepare(`
      UPDATE coinbase_oauth_tokens
      SET revoked_at = ?, updated_at = ?
      WHERE user_context_id = ?
    `).run(Date.now(), Date.now(), userContextId);
  }
}

function ensureCoinbaseSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coinbase_connection_metadata (
      user_context_id TEXT PRIMARY KEY,
      connected INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL DEFAULT 'api_key_pair',
      key_fingerprint TEXT DEFAULT '',
      last_error_code TEXT DEFAULT '',
      last_error_message TEXT DEFAULT '',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coinbase_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      user_context_id TEXT NOT NULL,
      snapshot_type TEXT NOT NULL,
      symbol_pair TEXT DEFAULT '',
      payload_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      freshness_ms INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'coinbase',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coinbase_snapshots_user_type ON coinbase_snapshots(user_context_id, snapshot_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS coinbase_report_history (
      report_run_id TEXT PRIMARY KEY,
      user_context_id TEXT NOT NULL,
      schedule_id TEXT DEFAULT '',
      mission_run_id TEXT DEFAULT '',
      report_type TEXT NOT NULL,
      delivered_channel TEXT DEFAULT '',
      delivered_at INTEGER NOT NULL,
      report_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coinbase_report_history_user ON coinbase_report_history(user_context_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS coinbase_idempotency_keys (
      idempotency_key TEXT PRIMARY KEY,
      user_context_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result_ref TEXT DEFAULT '',
      first_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coinbase_idempotency_user_scope ON coinbase_idempotency_keys(user_context_id, scope, expires_at);

    CREATE TABLE IF NOT EXISTS coinbase_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_context_id TEXT NOT NULL,
      conversation_id TEXT DEFAULT '',
      mission_run_id TEXT DEFAULT '',
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coinbase_audit_user_time ON coinbase_audit_log(user_context_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS coinbase_oauth_tokens (
      user_context_id TEXT PRIMARY KEY,
      access_token_enc TEXT NOT NULL,
      refresh_token_enc TEXT NOT NULL,
      key_id TEXT NOT NULL,
      scope TEXT DEFAULT '',
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function sanitizeString(value: unknown, maxLen: number): string {
  const out = typeof value === "string" ? value.trim() : "";
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}

function normalizeUserContextId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function hashPayload(payloadJson: string): string {
  return createHash("sha256").update(payloadJson).digest("hex").slice(0, 32);
}

function defaultCoinbaseDbPath(): string {
  return path.join(process.cwd(), ".agent", "coinbase", "coinbase.sqlite");
}

