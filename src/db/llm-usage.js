// Per-call LLM usage ledger (`llm_usage`, migration 13). One row per LLM API call from chat, agent tasks and
// missions; the single data source for per-task budgets and usage analytics.
//
// input_tokens is the TOTAL input for the call (cached + cache-write included). Uncached input is
// input - cached - cache_write, computed by readers. cost_usd is NULL when the model has no known pricing.
//
// Writers go through recordLlmUsageSafe() in src/providers/usage, which never throws; the functions here do
// throw on invalid input so misuse is visible in tests.

import { randomUUID } from "node:crypto";

import { getDb, nowIso } from "./index.js";

const LLM_USAGE_SOURCES = Object.freeze(["chat", "agent-task", "mission"]);
const DEFAULT_LLM_USAGE_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1000;
// On globalThis (like getDb's singleton) so Next.js dev HMR doesn't reset the once-per-day prune marker.
const LAST_PRUNE_KEY = "__novaLlmUsageLastPruneMs";

const statementsByDb = new WeakMap();

function statementsFor(db) {
  let statements = statementsByDb.get(db);
  if (!statements) {
    statements = {
      insert: db.prepare(
        `INSERT INTO llm_usage (user_id, id, ts, source, ref_id, provider, model, input_tokens, output_tokens,
           cached_input_tokens, cache_write_input_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      prune: db.prepare("DELETE FROM llm_usage WHERE ts < ?"),
    };
    statementsByDb.set(db, statements);
  }
  return statements;
}

function requireUserId(userId) {
  const uid = typeof userId === "string" ? userId.trim() : "";
  if (!uid) throw new TypeError("userId is required and must be a non-empty string.");
  return uid;
}

function requireSource(source) {
  if (!LLM_USAGE_SOURCES.includes(source)) {
    throw new TypeError(`source must be one of ${LLM_USAGE_SOURCES.join(", ")} (got ${String(source)}).`);
  }
  return source;
}

function toCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function toCostOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function toIsoOrNow(value) {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return nowIso();
}

/**
 * Insert one ledger row. Throws on a missing userId or unknown source (callers wrap; see recordLlmUsageSafe).
 * @returns {string} the generated row id
 */
export function insertLlmUsage(record) {
  const userId = requireUserId(record?.userId);
  const source = requireSource(record?.source);
  const id = randomUUID();
  statementsFor(getDb()).insert.run(
    userId,
    id,
    toIsoOrNow(record.ts),
    source,
    String(record.refId ?? "").trim(),
    String(record.provider ?? "").trim(),
    String(record.model ?? "").trim(),
    toCount(record.inputTokens),
    toCount(record.outputTokens),
    toCount(record.cachedInputTokens),
    toCount(record.cacheWriteInputTokens),
    toCostOrNull(record.costUsd),
  );
  return id;
}

/** NOVA_LLM_USAGE_RETENTION_DAYS, default 90, clamped to [1, 3650]; an invalid value falls back to 90. */
export function resolveLlmUsageRetentionDays() {
  const raw = String(process.env.NOVA_LLM_USAGE_RETENTION_DAYS ?? "").trim();
  if (!raw) return DEFAULT_LLM_USAGE_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LLM_USAGE_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.floor(parsed)));
}

function toNowMs(now) {
  if (now instanceof Date) return now.getTime();
  const parsed = typeof now === "string" ? Date.parse(now) : Number(now);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/** Delete rows (all users) older than the retention period. Returns the number of rows removed. */
export function pruneLlmUsage({ retentionDays, now } = {}) {
  const requested = Number(retentionDays);
  const days = Number.isFinite(requested) && requested > 0
    ? Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.floor(requested)))
    : resolveLlmUsageRetentionDays();
  const cutoff = new Date(toNowMs(now) - days * DAY_MS).toISOString();
  return statementsFor(getDb()).prune.run(cutoff).changes;
}

/**
 * Prune at most once per 24 h per process; the first call in a process always prunes (effectively "on startup").
 * Returns the deleted count, or null when skipped.
 */
export function maybePruneLlmUsage({ now } = {}) {
  const nowMs = toNowMs(now);
  const last = Number(globalThis[LAST_PRUNE_KEY]);
  if (Number.isFinite(last) && nowMs - last < PRUNE_INTERVAL_MS) return null;
  // Mark before pruning so a failing prune isn't retried on every call.
  globalThis[LAST_PRUNE_KEY] = nowMs;
  return pruneLlmUsage({ now: nowMs });
}

function buildFilter(userId, { source, refId, sinceTs } = {}) {
  const clauses = ["user_id = ?"];
  const params = [requireUserId(userId)];
  if (source !== undefined && source !== null) {
    clauses.push("source = ?");
    params.push(requireSource(source));
  }
  if (refId !== undefined && refId !== null) {
    clauses.push("ref_id = ?");
    params.push(String(refId).trim());
  }
  if (typeof sinceTs === "string" && sinceTs.trim()) {
    clauses.push("ts >= ?");
    params.push(toIsoOrNow(sinceTs));
  }
  return { where: clauses.join(" AND "), params };
}

function mapRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    ts: row.ts,
    source: row.source,
    refId: row.ref_id,
    provider: row.provider,
    model: row.model,
    inputTokens: Number(row.input_tokens) || 0,
    outputTokens: Number(row.output_tokens) || 0,
    cachedInputTokens: Number(row.cached_input_tokens) || 0,
    cacheWriteInputTokens: Number(row.cache_write_input_tokens) || 0,
    costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
  };
}

/** One user's rows, newest first. */
export function listLlmUsage(userId, { source, refId, sinceTs, limit } = {}) {
  const { where, params } = buildFilter(userId, { source, refId, sinceTs });
  const requested = Math.floor(Number(limit));
  const cappedLimit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT;
  return getDb()
    .prepare(`SELECT * FROM llm_usage WHERE ${where} ORDER BY ts DESC, id DESC LIMIT ?`)
    .all(...params, cappedLimit)
    .map(mapRow);
}

/** Totals for one user. costUsd sums priced rows only (unpriced rows add tokens but no cost). */
export function sumLlmUsage(userId, { source, refId, sinceTs } = {}) {
  const { where, params } = buildFilter(userId, { source, refId, sinceTs });
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
              COALESCE(SUM(cache_write_input_tokens), 0) AS cache_write_input_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM llm_usage WHERE ${where}`,
    )
    .get(...params);
  return {
    calls: Number(row?.calls) || 0,
    inputTokens: Number(row?.input_tokens) || 0,
    outputTokens: Number(row?.output_tokens) || 0,
    cachedInputTokens: Number(row?.cached_input_tokens) || 0,
    cacheWriteInputTokens: Number(row?.cache_write_input_tokens) || 0,
    costUsd: Number(row?.cost_usd) || 0,
  };
}
