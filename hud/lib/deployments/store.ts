import "server-only"

import { randomUUID } from "node:crypto"

import { nowIso, tx, type Database } from "../../../src/db/index.js"
import { redactSecrets } from "../../../src/security/secrets/index.js"
import type {
  CreateDeploymentInput,
  Deployment,
  DeploymentConfig,
  DeploymentEvent,
  DeploymentPlan,
  DeploymentRun,
  DeploymentRunStatus,
} from "./types"

const RUN_STATUSES: readonly DeploymentRunStatus[] = [
  "pending",
  "queued",
  "running",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
  "dead",
]

function safeUserId(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
  if (!normalized) throw new Error("A user id is required.")
  return normalized
}

function boundedText(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max)
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

interface DeploymentRow {
  user_id: string
  id: string
  kind: "task" | "automation"
  status: Deployment["status"]
  title: string
  outcome: string
  acceptance_json: string
  plan_json: string | null
  config_json: string
  mission_id: string | null
  revision: number
  created_at: string
  updated_at: string
}

interface DeploymentRunRow {
  user_id: string
  id: string
  deployment_id: string
  deployment_revision: number
  idempotency_key: string | null
  job_run_id: string | null
  agent_task_id: string | null
  status: DeploymentRunStatus
  permission_mode: DeploymentRun["permissionMode"]
  cost_budget_usd: number | null
  token_budget: number | null
  cancellation_requested_at: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  updated_at: string
}

interface DeploymentEventRow {
  seq: number
  event_id: string
  user_id: string
  deployment_id: string
  run_id: string | null
  type: string
  actor: string
  ts: string
  data_json: string
}

function rowToDeployment(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    outcome: row.outcome,
    acceptanceCriteria: parseJson<string[]>(row.acceptance_json, []),
    plan: parseJson<DeploymentPlan | null>(row.plan_json, null),
    config: parseJson<DeploymentConfig>(row.config_json, {}),
    missionId: row.mission_id,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToRun(row: DeploymentRunRow): DeploymentRun {
  return {
    id: row.id,
    userId: row.user_id,
    deploymentId: row.deployment_id,
    deploymentRevision: row.deployment_revision,
    jobRunId: row.job_run_id,
    agentTaskId: row.agent_task_id,
    status: row.status,
    permissionMode: row.permission_mode,
    costBudgetUsd: row.cost_budget_usd,
    tokenBudget: row.token_budget,
    cancellationRequestedAt: row.cancellation_requested_at,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  }
}

function rowToEvent(row: DeploymentEventRow): DeploymentEvent {
  return {
    seq: row.seq,
    eventId: row.event_id,
    userId: row.user_id,
    deploymentId: row.deployment_id,
    runId: row.run_id,
    type: row.type,
    actor: row.actor,
    ts: row.ts,
    data: parseJson<Record<string, unknown>>(row.data_json, {}),
  }
}

function insertEvent(
  db: Database,
  input: {
    userId: string
    deploymentId: string
    runId?: string | null
    type: string
    actor?: string
    data?: Record<string, unknown>
  },
): DeploymentEvent {
  const eventId = randomUUID()
  const ts = nowIso()
  const data = redactSecrets(input.data ?? {}) as Record<string, unknown>
  const result = db.prepare(
    `INSERT INTO deployment_events
       (event_id, user_id, deployment_id, run_id, type, actor, ts, data_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    eventId,
    input.userId,
    input.deploymentId,
    input.runId ?? null,
    boundedText(input.type, 96),
    boundedText(input.actor || "system", 64),
    ts,
    JSON.stringify(data),
  )
  return {
    seq: Number(result.lastInsertRowid),
    eventId,
    userId: input.userId,
    deploymentId: input.deploymentId,
    runId: input.runId ?? null,
    type: boundedText(input.type, 96),
    actor: boundedText(input.actor || "system", 64),
    ts,
    data,
  }
}

export function createDeployment(userId: string, input: CreateDeploymentInput): Deployment {
  const uid = safeUserId(userId)
  const outcome = boundedText(input.outcome, 8_000)
  if (!outcome) throw new Error("Deployment outcome is required.")
  if (input.kind !== "task" && input.kind !== "automation") throw new Error("Unknown deployment kind.")
  const id = boundedText(input.id, 96) || randomUUID()
  const now = nowIso()
  const title = boundedText(input.title, 120) || outcome.slice(0, 80)
  const acceptanceCriteria = (input.acceptanceCriteria ?? [])
    .map((entry) => boundedText(entry, 500))
    .filter(Boolean)
    .slice(0, 20)
  const status = input.status ?? "draft"

  return tx((db) => {
    db.prepare(
      `INSERT INTO deployments
         (user_id, id, kind, status, title, outcome, acceptance_json, plan_json, config_json,
          mission_id, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      uid,
      id,
      input.kind,
      status,
      title,
      outcome,
      JSON.stringify(acceptanceCriteria),
      input.plan ? JSON.stringify(redactSecrets(input.plan)) : null,
      JSON.stringify(redactSecrets(input.config ?? {})),
      boundedText(input.missionId, 96) || null,
      now,
      now,
    )
    for (const [index, path] of (input.config?.attachedFiles ?? []).entries()) {
      const filePath = boundedText(path, 2_000)
      if (!filePath) continue
      const normalized = filePath.replace(/\\/g, "/")
      db.prepare(
        `INSERT INTO deployment_attachments
           (user_id, deployment_id, attachment_id, path, name, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      ).run(uid, id, `${id}-${index}`, filePath, normalized.split("/").pop() || filePath, now)
    }
    insertEvent(db, {
      userId: uid,
      deploymentId: id,
      type: "deployment.created",
      actor: "user",
      data: { kind: input.kind, revision: 1 },
    })
    const row = db.prepare("SELECT * FROM deployments WHERE user_id = ? AND id = ?").get(uid, id) as DeploymentRow
    return rowToDeployment(row)
  })
}

export function listDeployments(userId: string): Deployment[] {
  const uid = safeUserId(userId)
  const rows = tx(
    (db) => db.prepare("SELECT * FROM deployments WHERE user_id = ? ORDER BY updated_at DESC, id ASC").all(uid),
    "deferred",
  ) as DeploymentRow[]
  return rows.map(rowToDeployment)
}

export function projectLegacyDeployments(userId: string): void {
  const uid = safeUserId(userId)
  tx((db) => {
    const missions = db.prepare(
      `SELECT id, data_json, label, enabled, created_at, updated_at
       FROM missions
       WHERE user_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM deployment_legacy_links l
           WHERE l.user_id = missions.user_id AND l.legacy_type = 'mission' AND l.legacy_id = missions.id
         )`,
    ).all(uid) as Array<{
      id: string
      data_json: string
      label: string | null
      enabled: number
      created_at: string | null
      updated_at: string
    }>
    for (const row of missions) {
      const data = parseJson<Record<string, unknown>>(row.data_json, {})
      const outcome = boundedText(data.description || data.message || data.label || row.label || "Legacy automation", 8_000)
      const createdAt = row.created_at || row.updated_at || nowIso()
      const updatedAt = row.updated_at || createdAt
      db.prepare(
        `INSERT OR IGNORE INTO deployments
           (user_id, id, kind, status, title, outcome, acceptance_json, plan_json, config_json,
            mission_id, revision, created_at, updated_at)
         VALUES (?, ?, 'automation', ?, ?, ?, '[]', NULL, '{}', ?, ?, ?, ?)`,
      ).run(
        uid,
        row.id,
        row.enabled ? "active" : "paused",
        boundedText(data.label || row.label || "Legacy automation", 120),
        outcome,
        row.id,
        Math.max(1, Number(data.version) || 1),
        createdAt,
        updatedAt,
      )
      db.prepare(
        `INSERT OR IGNORE INTO deployment_legacy_links
           (user_id, legacy_type, legacy_id, deployment_id, run_id, created_at)
         VALUES (?, 'mission', ?, ?, NULL, ?)`,
      ).run(uid, row.id, row.id, nowIso())
    }

    const tasks = db.prepare(
      `SELECT *
       FROM agent_tasks
       WHERE user_id = ? AND status IN ('completed','failed','cancelled')
         AND NOT EXISTS (
           SELECT 1 FROM deployment_legacy_links l
           WHERE l.user_id = agent_tasks.user_id AND l.legacy_type = 'agent_task' AND l.legacy_id = agent_tasks.id
         )`,
    ).all(uid) as Array<{
      id: string
      name: string
      prompt: string
      status: "completed" | "failed" | "cancelled"
      agent: string
      model: string
      permission_mode: string
      cost_budget_usd: number | null
      token_budget: number | null
      attached_files: string | null
      created_at: string
      updated_at: string
      started_at: string | null
      completed_at: string | null
    }>
    for (const task of tasks) {
      const deploymentId = `legacy-task-${task.id}`
      const runId = `legacy-task-run-${task.id}`
      const status: DeploymentRunStatus = task.status === "completed" ? "succeeded" : task.status
      db.prepare(
        `INSERT OR IGNORE INTO deployments
           (user_id, id, kind, status, title, outcome, acceptance_json, plan_json, config_json,
            mission_id, revision, created_at, updated_at)
         VALUES (?, ?, 'task', 'archived', ?, ?, '[]', NULL, ?, NULL, 1, ?, ?)`,
      ).run(
        uid,
        deploymentId,
        task.name,
        task.prompt,
        JSON.stringify({ provider: task.agent, model: task.model }),
        task.created_at,
        task.updated_at,
      )
      db.prepare(
        `INSERT OR IGNORE INTO deployment_runs
           (user_id, id, deployment_id, deployment_revision, agent_task_id, status, permission_mode,
            cost_budget_usd, token_budget, created_at, started_at, finished_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        uid,
        runId,
        deploymentId,
        task.id,
        status,
        task.permission_mode || "default",
        task.cost_budget_usd,
        task.token_budget,
        task.created_at,
        task.started_at,
        task.completed_at || task.updated_at,
        task.updated_at,
      )
      const attachments = parseJson<string[]>(task.attached_files, [])
      for (const [index, path] of attachments.entries()) {
        if (typeof path !== "string" || !path.trim()) continue
        const normalized = path.replace(/\\/g, "/")
        db.prepare(
          `INSERT OR IGNORE INTO deployment_attachments
             (user_id, deployment_id, attachment_id, path, name, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?)`,
        ).run(uid, deploymentId, `${task.id}-${index}`, path, normalized.split("/").pop() || path, task.created_at)
      }
      db.prepare(
        `INSERT OR IGNORE INTO deployment_legacy_links
           (user_id, legacy_type, legacy_id, deployment_id, run_id, created_at)
         VALUES (?, 'agent_task', ?, ?, ?, ?)`,
      ).run(uid, task.id, deploymentId, runId, nowIso())
    }
  })
}

export function getDeployment(userId: string, deploymentId: string): Deployment | null {
  const uid = safeUserId(userId)
  const row = tx(
    (db) => db.prepare("SELECT * FROM deployments WHERE user_id = ? AND id = ?").get(uid, deploymentId),
    "deferred",
  ) as DeploymentRow | undefined
  return row ? rowToDeployment(row) : null
}

export function updateDeployment(
  userId: string,
  deploymentId: string,
  expectedRevision: number,
  patch: Partial<Pick<CreateDeploymentInput, "title" | "outcome" | "acceptanceCriteria" | "config" | "status">>,
): Deployment {
  const uid = safeUserId(userId)
  return tx((db) => {
    const current = db.prepare(
      "SELECT * FROM deployments WHERE user_id = ? AND id = ?",
    ).get(uid, deploymentId) as DeploymentRow | undefined
    if (!current) throw new Error("Deployment not found.")
    if (current.revision !== expectedRevision) {
      throw new Error(`Deployment changed since revision ${expectedRevision}. Reload before saving.`)
    }
    const nextRevision = current.revision + 1
    const nextConfig = {
      ...parseJson<DeploymentConfig>(current.config_json, {}),
      ...(patch.config ?? {}),
    }
    const acceptance = patch.acceptanceCriteria
      ? patch.acceptanceCriteria.map((entry) => boundedText(entry, 500)).filter(Boolean).slice(0, 20)
      : parseJson<string[]>(current.acceptance_json, [])
    const now = nowIso()
    const changed = db.prepare(
      `UPDATE deployments
       SET status = ?, title = ?, outcome = ?, acceptance_json = ?, config_json = ?,
           revision = ?, updated_at = ?
       WHERE user_id = ? AND id = ? AND revision = ?`,
    ).run(
      patch.status ?? current.status,
      boundedText(patch.title ?? current.title, 120) || current.title,
      boundedText(patch.outcome ?? current.outcome, 8_000) || current.outcome,
      JSON.stringify(acceptance),
      JSON.stringify(redactSecrets(nextConfig)),
      nextRevision,
      now,
      uid,
      deploymentId,
      expectedRevision,
    ).changes
    if (changed !== 1) throw new Error("Deployment revision conflict.")
    insertEvent(db, {
      userId: uid,
      deploymentId,
      type: "deployment.updated",
      actor: "user",
      data: { previousRevision: expectedRevision, revision: nextRevision },
    })
    const row = db.prepare("SELECT * FROM deployments WHERE user_id = ? AND id = ?").get(uid, deploymentId) as DeploymentRow
    return rowToDeployment(row)
  })
}

export function createDeploymentRun(userId: string, deploymentId: string, idempotencyKey?: string): DeploymentRun {
  const uid = safeUserId(userId)
  const now = nowIso()
  return tx((db) => {
    const deployment = db.prepare(
      "SELECT * FROM deployments WHERE user_id = ? AND id = ?",
    ).get(uid, deploymentId) as DeploymentRow | undefined
    if (!deployment) throw new Error("Deployment not found.")
    const config = parseJson<DeploymentConfig>(deployment.config_json, {})
    const id = randomUUID()
    const permissionMode = config.permissionMode ?? "default"
    db.prepare(
      `INSERT INTO deployment_runs
         (user_id, id, deployment_id, deployment_revision, idempotency_key, status, permission_mode, cost_budget_usd,
          token_budget, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    ).run(
      uid,
      id,
      deploymentId,
      deployment.revision,
      boundedText(idempotencyKey, 160) || null,
      permissionMode,
      config.costBudgetUsd ?? null,
      config.tokenBudget ?? null,
      now,
      now,
    )
    insertEvent(db, {
      userId: uid,
      deploymentId,
      runId: id,
      type: "deployment.run.created",
      actor: "user",
      data: { revision: deployment.revision },
    })
    const row = db.prepare("SELECT * FROM deployment_runs WHERE user_id = ? AND id = ?").get(uid, id) as DeploymentRunRow
    return rowToRun(row)
  })
}

export function findDeploymentRunByIdempotency(
  userId: string,
  deploymentId: string,
  idempotencyKey: string,
): DeploymentRun | null {
  const uid = safeUserId(userId)
  const key = boundedText(idempotencyKey, 160)
  if (!key) return null
  const row = tx(
    (db) => db.prepare(
      `SELECT * FROM deployment_runs
       WHERE user_id = ? AND deployment_id = ? AND idempotency_key = ?`,
    ).get(uid, deploymentId, key),
    "deferred",
  ) as DeploymentRunRow | undefined
  return row ? rowToRun(row) : null
}

export function getDeploymentRun(userId: string, runId: string): DeploymentRun | null {
  const uid = safeUserId(userId)
  const row = tx(
    (db) => db.prepare("SELECT * FROM deployment_runs WHERE user_id = ? AND id = ?").get(uid, runId),
    "deferred",
  ) as DeploymentRunRow | undefined
  return row ? rowToRun(row) : null
}

export function updateDeploymentRun(
  userId: string,
  runId: string,
  patch: {
    status?: DeploymentRunStatus
    jobRunId?: string | null
    agentTaskId?: string | null
    eventType?: string
    eventData?: Record<string, unknown>
  },
): DeploymentRun {
  const uid = safeUserId(userId)
  if (patch.status && !RUN_STATUSES.includes(patch.status)) throw new Error("Unknown deployment run status.")
  return tx((db) => {
    const current = db.prepare(
      "SELECT * FROM deployment_runs WHERE user_id = ? AND id = ?",
    ).get(uid, runId) as DeploymentRunRow | undefined
    if (!current) throw new Error("Deployment run not found.")
    const status = patch.status ?? current.status
    const now = nowIso()
    const startedAt = status === "running" ? current.started_at ?? now : current.started_at
    const finishedAt = ["succeeded", "failed", "cancelled", "dead"].includes(status)
      ? current.finished_at ?? now
      : current.finished_at
    db.prepare(
      `UPDATE deployment_runs
       SET status = ?, job_run_id = ?, agent_task_id = ?, started_at = ?, finished_at = ?, updated_at = ?
       WHERE user_id = ? AND id = ?`,
    ).run(
      status,
      patch.jobRunId === undefined ? current.job_run_id : patch.jobRunId,
      patch.agentTaskId === undefined ? current.agent_task_id : patch.agentTaskId,
      startedAt,
      finishedAt,
      now,
      uid,
      runId,
    )
    if (patch.eventType) {
      insertEvent(db, {
        userId: uid,
        deploymentId: current.deployment_id,
        runId,
        type: patch.eventType,
        data: patch.eventData,
      })
    }
    const row = db.prepare("SELECT * FROM deployment_runs WHERE user_id = ? AND id = ?").get(uid, runId) as DeploymentRunRow
    return rowToRun(row)
  })
}

export function attachAgentTaskToDeploymentRun(
  userId: string,
  runId: string,
  agentTaskId: string,
): DeploymentRun {
  const uid = safeUserId(userId)
  return tx((db) => {
    const run = db.prepare(
      "SELECT * FROM deployment_runs WHERE user_id = ? AND id = ?",
    ).get(uid, runId) as DeploymentRunRow | undefined
    if (!run) throw new Error("Deployment run not found.")
    const now = nowIso()
    db.prepare(
      `INSERT INTO job_runs
         (id, user_id, mission_id, idempotency_key, status, priority, scheduled_for, lease_token, lease_expires_at,
          heartbeat_at, attempt, max_attempts, backoff_ms, source, run_key, input_snapshot,
          created_at, started_at)
       VALUES (?, ?, ?, ?, 'claimed', 5, ?, ?, '9999-12-31T23:59:59.999Z', ?, 1, 1, 0,
               'deployment-task', ?, ?, ?, ?)`,
    ).run(
      run.id,
      uid,
      run.deployment_id,
      run.idempotency_key ? `deployment:${run.deployment_id}:${run.idempotency_key}` : null,
      now,
      `agent-task:${agentTaskId}`,
      now,
      `deployment:${run.deployment_id}:task:${agentTaskId}`,
      JSON.stringify({ agentTaskId }),
      now,
      now,
    )
    db.prepare(
      `INSERT INTO job_audit_events (id, job_run_id, user_id, event, actor, ts, metadata)
       VALUES (?, ?, ?, 'job.delegated_to_agent_task', 'deployment-manager', ?, ?)`,
    ).run(randomUUID(), run.id, uid, now, JSON.stringify({ agentTaskId }))
    db.prepare(
      `UPDATE deployment_runs
       SET status = 'queued', job_run_id = ?, agent_task_id = ?, updated_at = ?
       WHERE user_id = ? AND id = ?`,
    ).run(run.id, agentTaskId, now, uid, run.id)
    insertEvent(db, {
      userId: uid,
      deploymentId: run.deployment_id,
      runId: run.id,
      type: "deployment.run.task_queued",
      data: { taskId: agentTaskId, jobRunId: run.id },
    })
    const updated = db.prepare(
      "SELECT * FROM deployment_runs WHERE user_id = ? AND id = ?",
    ).get(uid, run.id) as DeploymentRunRow
    return rowToRun(updated)
  })
}

export function listDeploymentRuns(userId: string, deploymentId?: string): DeploymentRun[] {
  const uid = safeUserId(userId)
  const rows = tx(
    (db) => deploymentId
      ? db.prepare(
          "SELECT * FROM deployment_runs WHERE user_id = ? AND deployment_id = ? ORDER BY created_at DESC",
        ).all(uid, deploymentId)
      : db.prepare("SELECT * FROM deployment_runs WHERE user_id = ? ORDER BY created_at DESC").all(uid),
    "deferred",
  ) as DeploymentRunRow[]
  return rows.map(rowToRun)
}

export function syncDeploymentRuns(userId: string): void {
  const uid = safeUserId(userId)
  tx((db) => {
    const rows = db.prepare(
      `SELECT r.*,
              a.status AS agent_status,
              j.status AS job_status
       FROM deployment_runs r
       LEFT JOIN agent_tasks a
         ON a.user_id = r.user_id AND a.id = r.agent_task_id
       LEFT JOIN job_runs j ON j.id = r.job_run_id
       WHERE r.user_id = ? AND r.status IN ('pending','queued','running','paused')`,
    ).all(uid) as Array<DeploymentRunRow & { agent_status: string | null; job_status: string | null }>

    for (const row of rows) {
      const sourceStatus = row.agent_task_id ? row.agent_status : row.job_run_id ? row.job_status : null
      const next: DeploymentRunStatus | null =
        sourceStatus === "queued" || sourceStatus === "pending" || sourceStatus === "claimed"
          ? "queued"
          : sourceStatus === "running"
            ? "running"
            : sourceStatus === "paused"
              ? "paused"
              : sourceStatus === "completed" || sourceStatus === "succeeded"
                ? "succeeded"
                : sourceStatus === "cancelled"
                  ? "cancelled"
                  : sourceStatus === "dead"
                    ? "dead"
                    : sourceStatus === "failed"
                      ? "failed"
                      : null
      if (!next || next === row.status) continue
      const now = nowIso()
      const terminal = ["succeeded", "failed", "cancelled", "dead"].includes(next)
      if (row.agent_task_id && row.job_run_id) {
        const jobStatus =
          next === "succeeded" ? "succeeded"
            : next === "failed" ? "failed"
              : next === "cancelled" ? "cancelled"
                : next === "dead" ? "dead"
                  : next === "running" ? "running"
                    : "claimed"
        db.prepare(
          `UPDATE job_runs
           SET status = ?,
               finished_at = CASE WHEN ? THEN COALESCE(finished_at, ?) ELSE finished_at END,
               lease_token = CASE WHEN ? THEN NULL ELSE lease_token END,
               lease_expires_at = CASE WHEN ? THEN NULL ELSE lease_expires_at END
           WHERE id = ? AND user_id = ? AND source = 'deployment-task'`,
        ).run(jobStatus, terminal ? 1 : 0, now, terminal ? 1 : 0, terminal ? 1 : 0, row.job_run_id, uid)
      }
      db.prepare(
        `UPDATE deployment_runs
         SET status = ?, started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
             finished_at = CASE WHEN ? THEN COALESCE(finished_at, ?) ELSE finished_at END,
             updated_at = ?
         WHERE user_id = ? AND id = ? AND status = ?`,
      ).run(next, next, now, terminal ? 1 : 0, now, now, uid, row.id, row.status)
      insertEvent(db, {
        userId: uid,
        deploymentId: row.deployment_id,
        runId: row.id,
        type: `deployment.run.${next}`,
        actor: "executor",
        data: { previousStatus: row.status },
      })
    }
  })
}

export function listDeploymentEvents(userId: string, afterSeq = 0, limit = 200): DeploymentEvent[] {
  const uid = safeUserId(userId)
  const safeAfter = Math.max(0, Math.floor(Number(afterSeq) || 0))
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 200)))
  const rows = tx(
    (db) => db.prepare(
      `SELECT * FROM deployment_events
       WHERE user_id = ? AND seq > ?
       ORDER BY seq ASC LIMIT ?`,
    ).all(uid, safeAfter, safeLimit),
    "deferred",
  ) as DeploymentEventRow[]
  return rows.map(rowToEvent)
}

export function linkLegacyDeployment(input: {
  userId: string
  legacyType: "mission" | "agent_task"
  legacyId: string
  deploymentId: string
  runId?: string | null
}): void {
  const uid = safeUserId(input.userId)
  tx((db) => {
    db.prepare(
      `INSERT INTO deployment_legacy_links
         (user_id, legacy_type, legacy_id, deployment_id, run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, legacy_type, legacy_id) DO UPDATE SET
         deployment_id = excluded.deployment_id,
         run_id = COALESCE(excluded.run_id, deployment_legacy_links.run_id)`,
    ).run(uid, input.legacyType, input.legacyId, input.deploymentId, input.runId ?? null, nowIso())
  })
}
