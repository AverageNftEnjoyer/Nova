import { nowIso, tx } from "./index.js";
import { redactSecrets } from "../security/secrets/index.js";

export function isDeploymentRunCancelled({ userId, runId }) {
  const row = tx(
    (db) => db.prepare(
      `SELECT r.status AS run_status, j.status AS job_status
       FROM deployment_runs r
       LEFT JOIN job_runs j ON j.id = r.job_run_id
       WHERE r.user_id = ? AND r.id = ?`,
    ).get(userId, runId),
    "deferred",
  );
  return Boolean(row && (row.run_status === "cancelled" || row.job_status === "cancelled"));
}

export function reserveDeploymentEffect({
  userId,
  runId,
  effectKey,
  toolName,
  leaseToken = "",
}) {
  return tx((db) => {
    const run = db.prepare(
      "SELECT id FROM deployment_runs WHERE user_id = ? AND id = ?",
    ).get(userId, runId);
    if (!run) return { ok: true, tracked: false, duplicate: false };

    const existing = db.prepare(
      "SELECT status, lease_token, result_json FROM deployment_effects WHERE user_id = ? AND run_id = ? AND effect_key = ?",
    ).get(userId, runId, effectKey);
    if (existing) {
      const currentLease = leaseToken
        ? db.prepare("SELECT lease_token FROM job_runs WHERE id = ? AND user_id = ?").get(runId, userId)?.lease_token
        : null;
      const mayRetry = existing.status === "failed"
        || (existing.status === "reserved" && leaseToken && currentLease === leaseToken && existing.lease_token !== leaseToken);
      if (mayRetry) {
        db.prepare(
          `UPDATE deployment_effects
           SET status = 'reserved', lease_token = ?, result_json = NULL, updated_at = ?
           WHERE user_id = ? AND run_id = ? AND effect_key = ?`,
        ).run(leaseToken || null, nowIso(), userId, runId, effectKey);
        return { ok: true, tracked: true, duplicate: false };
      }
      return {
        ok: false,
        tracked: true,
        duplicate: true,
        status: existing.status,
        result: existing.result_json ? JSON.parse(existing.result_json) : null,
      };
    }
    const now = nowIso();
    db.prepare(
      `INSERT INTO deployment_effects
         (user_id, run_id, effect_key, tool_name, status, lease_token, result_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'reserved', ?, NULL, ?, ?)`,
    ).run(userId, runId, effectKey, toolName, leaseToken || null, now, now);
    return { ok: true, tracked: true, duplicate: false };
  });
}

export function settleDeploymentEffect({
  userId,
  runId,
  effectKey,
  leaseToken = "",
  ok,
  result,
}) {
  return tx((db) => {
    const changed = db.prepare(
      `UPDATE deployment_effects
       SET status = ?, result_json = ?, updated_at = ?
       WHERE user_id = ? AND run_id = ? AND effect_key = ?
         AND status = 'reserved'
         AND (lease_token IS NULL OR lease_token = ?)`,
    ).run(
      ok ? "committed" : "failed",
      result === undefined ? null : JSON.stringify(redactSecrets(result)),
      nowIso(),
      userId,
      runId,
      effectKey,
      leaseToken || null,
    ).changes;
    return { ok: changed === 1 };
  });
}
