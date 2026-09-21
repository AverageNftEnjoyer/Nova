import crypto from "node:crypto";

import { nowIso, tx } from "../../../../../db/index.js";
import { normalizeMissionBuildInput } from "../build-service/index.js";

const PENDING_TTL_MS = 120_000;
const RESULT_TTL_MS = 5 * 60 * 1000;
const NAMESPACE = "mission-build-idempotency";

function sanitizeScopePart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function computeDeterministicFingerprint(input = {}) {
  const normalized = normalizeMissionBuildInput(input);
  const seed = JSON.stringify({
    userContextId: sanitizeScopePart(normalized.userContextId),
    prompt: String(normalized.prompt || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 1200),
    deploy: normalized.deploy,
    timezone: normalized.timezone,
    enabled: normalized.enabled,
  });
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

function readRow(db, userId, key) {
  const row = db
    .prepare("SELECT value_json FROM kv_state WHERE user_id = ? AND namespace = ? AND key = ?")
    .get(userId, NAMESPACE, key);
  if (!row) return null;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return null;
  }
}

function writeRow(db, userId, key, value) {
  db.prepare(
    `INSERT INTO kv_state (user_id, namespace, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, namespace, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).run(userId, NAMESPACE, key, JSON.stringify(value), nowIso());
}

export function resolveMissionBuildIdempotencyKey(input = {}) {
  return `mission-build:${sanitizeScopePart(input.userContextId)}:${computeDeterministicFingerprint(input)}`;
}

export async function reserveMissionBuildRequest(input = {}) {
  const nowMs = Date.now();
  const key = resolveMissionBuildIdempotencyKey(input);
  const userId = sanitizeScopePart(input.userContextId);
  if (!userId) throw new Error("Missing user context id for mission idempotency.");
  return tx((db) => {
    const existing = readRow(db, userId, key);
    if (!existing || Number(existing.expiresAt || 0) <= nowMs) {
      writeRow(db, userId, key, {
        status: "pending",
        createdAt: nowMs,
        updatedAt: nowMs,
        expiresAt: nowMs + PENDING_TTL_MS,
        result: null,
        error: "",
      });
      return { status: "started", key };
    }
    if (existing.status === "pending") {
      return {
        status: "pending",
        key,
        retryAfterMs: Math.max(250, Math.min(4000, Number(existing.expiresAt) - nowMs)),
      };
    }
    if (existing.status === "completed" && existing.result) {
      return { status: "completed", key, result: existing.result };
    }
    return { status: "failed", key, error: String(existing.error || "Mission build previously failed.") };
  });
}

export async function finalizeMissionBuildRequest(input = {}) {
  const nowMs = Date.now();
  const userId = sanitizeScopePart(input.userContextId);
  const key = String(input.key || "").trim();
  if (!userId || !key) return;
  tx((db) => {
    const existing = readRow(db, userId, key);
    if (!existing || Number(existing.expiresAt || 0) <= nowMs) return;
    writeRow(db, userId, key, {
      ...existing,
      status: input.ok ? "completed" : "failed",
      updatedAt: nowMs,
      expiresAt: nowMs + RESULT_TTL_MS,
      result: input.ok ? input.result : null,
      error: input.ok ? "" : String(input.error || "Mission build failed."),
    });
  });
}
