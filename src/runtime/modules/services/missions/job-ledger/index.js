/**
 * Durable job ledger on local SQLite (tables job_runs, scheduler_leases, job_audit_events; see src/db migration 0003).
 *
 * Implements the JobLedgerStore contract of hud/lib/missions/job-ledger/types.ts. It has NO server-only import so the
 * Next server, the agent runtime and plain-node smokes can all load it.
 *
 * Every state transition is ONE `BEGIN IMMEDIATE` transaction. SQLite allows a single writer at a time, so two
 * processes (Next server + agent runtime) can never both win a claim, steal a live lease, or lose a retry row.
 * Semantics follow the retired Supabase functions claim_job_run_lease_with_limits, heartbeat_job_run_lease,
 * complete_job_run, fail_job_run_with_retry, reclaim_expired_job_leases and acquire/renew_scheduler_lease.
 * Timestamps are UTC ISO-8601 strings (lexicographically comparable).
 */

import { randomUUID } from "node:crypto";

import { getDb, tx, nowIso } from "../../../../../db/index.js";
import { redactSecrets } from "../../../../../security/secrets/index.js";
import { insertDeadLetterRow } from "../persistence/sqlite-store.js";

const IN_FLIGHT = "('claimed','running')";

function readIntEnv(name, fallback, min, max) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function concurrencyPolicy() {
  return {
    perUserInflightLimit: readIntEnv("NOVA_MISSION_EXECUTION_MAX_INFLIGHT_PER_USER", 3, 1, 100),
    globalInflightLimit: readIntEnv("NOVA_MISSION_EXECUTION_MAX_INFLIGHT_GLOBAL", 200, 1, 5000),
  };
}

function generateId(prefix) {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}_${rand}`;
}

function addMs(iso, ms) {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function isConstraintError(error) {
  return typeof error?.code === "string" && error.code.startsWith("SQLITE_CONSTRAINT");
}

function parseJsonColumn(text) {
  if (typeof text !== "string" || text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Audit rows are best-effort provenance; a failed audit insert must never fail (or roll back) a state transition. */
function insertAudit(db, { jobRunId, userId, event, actor, metadata }) {
  try {
    db.prepare(
      "INSERT INTO job_audit_events (id, job_run_id, user_id, event, actor, ts, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      generateId("ae"),
      jobRunId,
      userId,
      event,
      actor,
      nowIso(),
      metadata ? JSON.stringify(redactSecrets(metadata)) : null,
    );
  } catch {
    // FK/constraint failure on an audit row is intentionally ignored.
  }
}

function claimFailure(reason, jobRunId, policy) {
  if (reason === "not_found") return { ok: false, reason: `Job run not found: ${jobRunId}` };
  if (reason.startsWith("not_pending:")) {
    const status = reason.slice("not_pending:".length) || "unknown";
    return { ok: false, reason: `Job run ${jobRunId} is not pending (status=${status}).` };
  }
  if (reason === "global_limit") {
    return {
      ok: false,
      reason: `Mission execution concurrency exceeded global in-flight cap (${policy.globalInflightLimit}).`,
    };
  }
  if (reason === "per_user_limit") {
    return {
      ok: false,
      reason: `Mission execution concurrency exceeded per-user cap (${policy.perUserInflightLimit}).`,
    };
  }
  return { ok: false, reason: "Failed to claim job run - may have been claimed by another worker." };
}

function computeRetryBackoffMs(nextAttempt) {
  const base = readIntEnv("NOVA_SCHEDULER_RETRY_BASE_MS", 60_000, 1_000, 3_600_000);
  const max = readIntEnv("NOVA_SCHEDULER_RETRY_MAX_MS", 900_000, 10_000, 86_400_000);
  const jitter = 0.9 + Math.random() * 0.2;
  return Math.min(Math.round(base * Math.pow(2, Math.max(0, nextAttempt - 1)) * jitter), max);
}

export const jobLedger = {
  async enqueue(input) {
    const now = nowIso();
    const priority = input.priority ?? 5;
    const source = input.source ?? "scheduler";
    try {
      tx((db) => {
        db.prepare(
          `INSERT INTO job_runs
             (id, user_id, mission_id, idempotency_key, status, priority, scheduled_for, attempt, max_attempts,
              backoff_ms, source, run_key, input_snapshot, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, 0, ?, 0, ?, ?, ?, ?)`,
        ).run(
          input.id,
          input.user_id,
          input.mission_id,
          input.idempotency_key ?? null,
          priority,
          input.scheduled_for ?? now,
          input.max_attempts ?? 1,
          source,
          input.run_key ?? null,
          input.input_snapshot ? JSON.stringify(input.input_snapshot) : null,
          now,
        );
        insertAudit(db, {
          jobRunId: input.id,
          userId: input.user_id,
          event: "job.enqueued",
          actor: "system",
          metadata: { source, priority },
        });
      });
    } catch (error) {
      // Callers (scheduler-core, queue-mode, execution-guard) key off this exact code for both a repeated
      // idempotency key and a repeated run id.
      if (isConstraintError(error)) return { ok: false, error: "duplicate_idempotency_key" };
      return { ok: false, error: error instanceof Error ? error.message : "enqueue_failed" };
    }
    return { ok: true };
  },

  async claimRun(input) {
    const policy = concurrencyPolicy();
    const leaseToken = generateId("lt");
    try {
      return tx((db) => {
        const target = db.prepare("SELECT status, user_id FROM job_runs WHERE id = ?").get(input.jobRunId);
        if (!target) return claimFailure("not_found", input.jobRunId, policy);
        if (target.status !== "pending") {
          return claimFailure(`not_pending:${target.status}`, input.jobRunId, policy);
        }
        const globalInflight = db.prepare(`SELECT COUNT(*) AS n FROM job_runs WHERE status IN ${IN_FLIGHT}`).get().n;
        if (globalInflight >= policy.globalInflightLimit) return claimFailure("global_limit", input.jobRunId, policy);
        const userInflight = db
          .prepare(`SELECT COUNT(*) AS n FROM job_runs WHERE user_id = ? AND status IN ${IN_FLIGHT}`)
          .get(target.user_id).n;
        if (userInflight >= policy.perUserInflightLimit) return claimFailure("per_user_limit", input.jobRunId, policy);

        const now = nowIso();
        const changed = db
          .prepare(
            `UPDATE job_runs SET status = 'claimed', lease_token = ?, lease_expires_at = ?, heartbeat_at = ?
             WHERE id = ? AND status = 'pending'`,
          )
          .run(leaseToken, addMs(now, input.leaseDurationMs), now, input.jobRunId).changes;
        if (changed === 0) return claimFailure("claim_raced", input.jobRunId, policy);

        insertAudit(db, {
          jobRunId: input.jobRunId,
          userId: target.user_id,
          event: "job.claimed",
          actor: "scheduler",
          metadata: { leaseDurationMs: input.leaseDurationMs },
        });
        return { ok: true, leaseToken };
      });
    } catch (error) {
      return { ok: false, reason: `DB error claiming job run: ${error instanceof Error ? error.message : "unknown"}` };
    }
  },

  async heartbeat(input) {
    try {
      const now = nowIso();
      const changed = tx((db) =>
        db
          .prepare(
            `UPDATE job_runs SET heartbeat_at = ?, lease_expires_at = ?
             WHERE id = ? AND lease_token = ? AND status IN ${IN_FLIGHT}`,
          )
          .run(now, addMs(now, input.leaseDurationMs), input.jobRunId, input.leaseToken).changes,
      );
      return { ok: changed > 0 };
    } catch {
      return { ok: false };
    }
  },

  async startRun(input) {
    const startedAt = nowIso();
    try {
      const ok = tx((db) => {
        const row = db.prepare("SELECT user_id FROM job_runs WHERE id = ?").get(input.jobRunId);
        const changed = db
          .prepare(
            `UPDATE job_runs SET status = 'running', started_at = ?
             WHERE id = ? AND lease_token = ? AND status = 'claimed'`,
          )
          .run(startedAt, input.jobRunId, input.leaseToken).changes;
        if (changed > 0 && row) {
          insertAudit(db, { jobRunId: input.jobRunId, userId: row.user_id, event: "job.started", actor: "executor" });
        }
        return changed > 0;
      });
      return { ok, startedAt: ok ? startedAt : null };
    } catch {
      return { ok: false, startedAt: null };
    }
  },

  async completeRun(input) {
    const outputSummary = input.outputSummary ? JSON.stringify(redactSecrets(input.outputSummary)) : null;
    try {
      return tx((db) => {
        const row = db
          .prepare("SELECT user_id, started_at FROM job_runs WHERE id = ? AND lease_token = ? AND status = 'running'")
          .get(input.jobRunId, input.leaseToken);
        if (!row) return { ok: false };
        const finishedAt = nowIso();
        const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(row.started_at ?? finishedAt));
        db.prepare(
          `UPDATE job_runs SET status = 'succeeded', finished_at = ?, duration_ms = ?, output_summary = ?,
             lease_token = NULL, lease_expires_at = NULL
           WHERE id = ?`,
        ).run(finishedAt, durationMs, outputSummary, input.jobRunId);
        insertAudit(db, {
          jobRunId: input.jobRunId,
          userId: row.user_id,
          event: "job.succeeded",
          actor: "executor",
          metadata: { durationMs },
        });
        return { ok: true };
      });
    } catch {
      return { ok: false };
    }
  },

  async failRun(input) {
    const errorCode = input.errorCode ?? null;
    const errorDetail = input.errorDetail === undefined ? null : redactSecrets(String(input.errorDetail));
    try {
      return tx((db) => {
        const target = db
          .prepare(`SELECT * FROM job_runs WHERE id = ? AND lease_token = ? AND status IN ${IN_FLIGHT}`)
          .get(input.jobRunId, input.leaseToken);
        if (!target) return { ok: false };

        const finishedAt = nowIso();
        const startedAt = input.startedAt || target.started_at || finishedAt;
        const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
        const nextAttempt = (target.attempt ?? 0) + 1;
        const maxAttempts = Math.max(1, target.max_attempts ?? 1);

        const markDead = (code, detail, backoffMs, event, reason, deadStatus) => {
          db.prepare(
            `UPDATE job_runs SET status = 'dead', finished_at = ?, duration_ms = ?, backoff_ms = ?, error_code = ?,
               error_detail = ?, lease_token = NULL, lease_expires_at = NULL
             WHERE id = ?`,
          ).run(finishedAt, durationMs, backoffMs, code, detail, input.jobRunId);
          insertAudit(db, {
            jobRunId: input.jobRunId,
            userId: target.user_id,
            event,
            actor: "executor",
            metadata: { errorCode: code, attempt: nextAttempt, maxAttempts },
          });
          insertDeadLetterRow(db, "mission_run", target.user_id, {
            id: randomUUID(),
            ts: Date.now(),
            userId: target.user_id,
            missionId: target.mission_id,
            jobRunId: input.jobRunId,
            attempt: Math.max(1, nextAttempt),
            maxAttempts,
            source: target.source,
            status: deadStatus,
            reason,
            errorCode: code ?? undefined,
            errorDetail: detail ?? undefined,
            retryBackoffMs: backoffMs,
          });
        };

        if (nextAttempt >= maxAttempts) {
          markDead(errorCode, errorDetail, target.backoff_ms ?? 0, "job.dead", "max_attempts_exhausted", "dead");
          return { ok: true };
        }

        const backoffMs = computeRetryBackoffMs(nextAttempt);
        const retryId = generateId("jr");
        try {
          // Nested tx() joins the outer BEGIN IMMEDIATE via a savepoint, so a failed retry insert rolls back only itself.
          tx((inner) => {
            inner
              .prepare(
                `UPDATE job_runs SET status = 'failed', finished_at = ?, duration_ms = ?, backoff_ms = ?, error_code = ?,
                   error_detail = ?, lease_token = NULL, lease_expires_at = NULL
                 WHERE id = ?`,
              )
              .run(finishedAt, durationMs, backoffMs, errorCode, errorDetail, input.jobRunId);
            inner
              .prepare(
                `INSERT INTO job_runs
                   (id, user_id, mission_id, status, priority, scheduled_for, attempt, max_attempts, backoff_ms,
                    source, run_key, input_snapshot, created_at)
                 VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, 'retry', ?, ?, ?)`,
              )
              .run(
                retryId,
                target.user_id,
                target.mission_id,
                target.priority ?? 5,
                addMs(finishedAt, backoffMs),
                nextAttempt,
                target.max_attempts,
                backoffMs,
                target.run_key,
                target.input_snapshot,
                finishedAt,
              );
          });
        } catch (retryError) {
          const detail = `Retry enqueue failed for ${input.jobRunId}: ${
            retryError instanceof Error ? retryError.message : "unknown"
          }`;
          markDead("RETRY_ENQUEUE_FAILED", detail, backoffMs, "job.dead", "retry_enqueue_failed", "retry_enqueue_failed");
          return { ok: false };
        }

        insertAudit(db, {
          jobRunId: input.jobRunId,
          userId: target.user_id,
          event: "job.retrying",
          actor: "executor",
          metadata: { attempt: nextAttempt, backoffMs, retryJobRunId: retryId },
        });
        insertAudit(db, {
          jobRunId: retryId,
          userId: target.user_id,
          event: "job.enqueued",
          actor: "retry",
          metadata: { source: "retry", attempt: nextAttempt },
        });
        return { ok: true };
      });
    } catch {
      return { ok: false };
    }
  },

  async cancelRun(input) {
    try {
      return tx((db) => {
        const changed = db
          .prepare(
            `UPDATE job_runs SET status = 'cancelled', finished_at = ?, lease_token = NULL, lease_expires_at = NULL
             WHERE id = ? AND user_id = ? AND status IN ('pending','claimed','running')`,
          )
          .run(nowIso(), input.jobRunId, input.userId).changes;
        if (changed > 0) {
          insertAudit(db, { jobRunId: input.jobRunId, userId: input.userId, event: "job.cancelled", actor: "user" });
        }
        return { ok: changed > 0 };
      });
    } catch {
      return { ok: false };
    }
  },

  async reclaimExpiredLeases() {
    try {
      return tx((db) => {
        const now = nowIso();
        const expired = db
          .prepare(`SELECT id, user_id FROM job_runs WHERE status IN ${IN_FLIGHT} AND lease_expires_at < ?`)
          .all(now);
        if (expired.length === 0) return 0;
        const changed = db
          .prepare(
            `UPDATE job_runs SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL
             WHERE status IN ${IN_FLIGHT} AND lease_expires_at < ?`,
          )
          .run(now).changes;
        for (const row of expired) {
          insertAudit(db, { jobRunId: row.id, userId: row.user_id, event: "job.lease_reclaimed", actor: "scheduler" });
        }
        return changed;
      });
    } catch {
      return 0;
    }
  },

  async cancelPendingForMission(input) {
    try {
      return tx((db) => {
        const rows = db
          .prepare(
            `SELECT id FROM job_runs WHERE user_id = ? AND mission_id = ? AND status IN ('pending','claimed','running')`,
          )
          .all(input.userId, input.missionId);
        if (rows.length === 0) return 0;
        db.prepare(
          `UPDATE job_runs SET status = 'cancelled', finished_at = ?, lease_token = NULL, lease_expires_at = NULL
           WHERE user_id = ? AND mission_id = ? AND status IN ('pending','claimed','running')`,
        ).run(nowIso(), input.userId, input.missionId);
        for (const row of rows) {
          insertAudit(db, { jobRunId: row.id, userId: input.userId, event: "job.cancelled", actor: "mission_delete" });
        }
        return rows.length;
      });
    } catch {
      return 0;
    }
  },

  async auditEvent(input) {
    try {
      tx((db) => insertAudit(db, input));
    } catch {
      // best effort
    }
  },

  async acquireSchedulerLease(input) {
    try {
      return tx((db) => {
        const now = nowIso();
        const existing = db
          .prepare("SELECT holder_id, expires_at FROM scheduler_leases WHERE scope = ?")
          .get(input.scope);
        const stealable = !existing || existing.expires_at < now || existing.holder_id === input.holderId;
        if (!stealable) return { acquired: false, reason: "already_held" };
        const expiresAt = addMs(now, input.ttlMs);
        db.prepare(
          `INSERT INTO scheduler_leases (scope, holder_id, acquired_at, expires_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (scope) DO UPDATE SET holder_id = excluded.holder_id, acquired_at = excluded.acquired_at,
             expires_at = excluded.expires_at`,
        ).run(input.scope, input.holderId, now, expiresAt);
        return { acquired: true, scope: input.scope, holderId: input.holderId, expiresAt };
      });
    } catch {
      return { acquired: false, reason: "db_error" };
    }
  },

  async renewSchedulerLease(input) {
    try {
      const changed = tx(
        (db) =>
          db
            .prepare("UPDATE scheduler_leases SET expires_at = ? WHERE scope = ? AND holder_id = ?")
            .run(addMs(nowIso(), input.ttlMs), input.scope, input.holderId).changes,
      );
      return { ok: changed > 0 };
    } catch {
      return { ok: false };
    }
  },

  async releaseSchedulerLease(input) {
    try {
      const changed = tx(
        (db) => db.prepare("DELETE FROM scheduler_leases WHERE scope = ? AND holder_id = ?").run(input.scope, input.holderId).changes,
      );
      return { ok: changed > 0 };
    } catch {
      return { ok: false };
    }
  },

  async getPendingRuns(input) {
    const cutoff = (input.now ?? new Date()).toISOString();
    const userIds = Array.isArray(input.userIds) && input.userIds.length > 0 ? input.userIds : null;
    const filter = userIds ? ` AND user_id IN (${userIds.map(() => "?").join(",")})` : "";
    const rows = getDb()
      .prepare(
        `SELECT id, user_id, mission_id, priority, scheduled_for, attempt, source, input_snapshot
         FROM job_runs WHERE status = 'pending' AND scheduled_for <= ?${filter}
         ORDER BY priority DESC, scheduled_for ASC LIMIT ?`,
      )
      .all(cutoff, ...(userIds ?? []), input.limit);
    return rows.map((row) => ({ ...row, input_snapshot: parseJsonColumn(row.input_snapshot) }));
  },
};

/** Test/tooling helpers: read a run and its audit trail without going through the store interface. */
export function readJobRun(jobRunId) {
  const row = getDb().prepare("SELECT * FROM job_runs WHERE id = ?").get(jobRunId);
  if (!row) return null;
  return {
    ...row,
    input_snapshot: parseJsonColumn(row.input_snapshot),
    output_summary: parseJsonColumn(row.output_summary),
  };
}

export function readJobAuditEvents(jobRunId) {
  return getDb()
    .prepare("SELECT * FROM job_audit_events WHERE job_run_id = ? ORDER BY ts, rowid")
    .all(jobRunId)
    .map((row) => ({ ...row, metadata: parseJsonColumn(row.metadata) }));
}
