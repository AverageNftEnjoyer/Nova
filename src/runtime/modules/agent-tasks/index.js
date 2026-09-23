import { randomUUID } from "node:crypto";

import { getDb } from "../../../db/index.js";
import { addLlmUsage, emptyLlmUsage, withLlmUsageObserver } from "../../../providers/usage/index.js";
import { redactSecrets } from "../../../security/secrets/index.js";
import { estimateTokenCostUsd } from "../llm/providers/index.js";
import { finalizeDeferredTaskDeletes } from "./cleanup/index.js";
import { prepareTaskExecutionContext } from "./execution-context/index.js";

function envInt(name, fallback, minimum) {
  const value = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

const MAX_CONCURRENT = 5;
const POLL_INTERVAL_MS = envInt("NOVA_AGENT_TASK_POLL_MS", 750, 10);
const LEASE_DURATION_MS = envInt("NOVA_AGENT_TASK_LEASE_MS", 20_000, 100);
const HEARTBEAT_INTERVAL_MS = envInt("NOVA_AGENT_TASK_HEARTBEAT_MS", 5_000, 10);
const CONTROL_INTERVAL_MS = envInt("NOVA_AGENT_TASK_CONTROL_MS", 200, 25);
const MAX_RESULT_CHARS = 64_000;
const MAX_ERROR_CHARS = 2_000;

function nowIso() {
  return new Date().toISOString();
}

function leaseExpiryIso() {
  return new Date(Date.now() + LEASE_DURATION_MS).toISOString();
}

function toTokenCount(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;
}

function normalizeResult(value) {
  const result = value && typeof value === "object" ? value : {};
  return {
    ok: result.ok !== false,
    reply: String(redactSecrets(String(result.reply || "")) || "").trim().slice(0, MAX_RESULT_CHARS),
    error: String(redactSecrets(String(result.error || "")) || "").trim().slice(0, MAX_ERROR_CHARS),
    errorCode: String(result.errorCode || "").trim(),
    pendingApproval:
      result.pendingApproval && typeof result.pendingApproval === "object"
        ? {
            toolName: String(result.pendingApproval.toolName || "unknown"),
            reason: String(result.pendingApproval.reason || "Approval required."),
            approvalKey: String(result.pendingApproval.approvalKey || ""),
          }
        : null,
    promptTokens: toTokenCount(result.promptTokens),
    completionTokens: toTokenCount(result.completionTokens),
    cachedInputTokens: toTokenCount(result.cachedInputTokens),
    cacheWriteInputTokens: toTokenCount(result.cacheWriteInputTokens),
    toolCalls: Array.isArray(result.toolCalls)
      ? [...new Set(result.toolCalls.map((entry) => String(entry || "").trim().slice(0, 128)).filter(Boolean))].slice(0, 128)
      : [],
  };
}

function claimQueuedTasks(instanceId, localActiveKeys = new Set()) {
  const db = getDb();
  const transaction = db.transaction(() => {
    const now = nowIso();
    db.prepare(
      `UPDATE agent_tasks
       SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE status = 'running' AND deleted_at IS NULL
         AND (lease_expires_at IS NULL OR lease_expires_at < ?)`,
    ).run(now, now);

    const running = Number(
      db.prepare(
        `SELECT COUNT(*) AS count
         FROM agent_tasks
         WHERE status = 'running' AND deleted_at IS NULL AND lease_expires_at >= ?`,
      ).get(now)?.count || 0,
    );
    const capacity = Math.max(0, MAX_CONCURRENT - Math.max(running, localActiveKeys.size));
    if (capacity === 0) return [];

    const queued = db.prepare(
      `SELECT user_id, id, prompt, agent, model, permission_mode, worktree_path, attached_files, approved_tools_json,
              attempt_no
       FROM agent_tasks
       WHERE status = 'queued' AND deleted_at IS NULL
       ORDER BY
         CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
         created_at ASC,
         id ASC
       LIMIT ?`,
    ).all(capacity + localActiveKeys.size);

    const claimed = [];
    const claim = db.prepare(
      `UPDATE agent_tasks
       SET status = 'running',
           progress = CASE WHEN progress < 5 THEN 5 ELSE progress END,
           started_at = COALESCE(started_at, ?),
           paused_at = NULL,
           completed_at = NULL,
           error = NULL,
           lease_owner = ?,
           lease_expires_at = ?,
           attempt_no = attempt_no + 1,
           updated_at = ?
       WHERE user_id = ? AND id = ? AND status = 'queued'`,
    );
    for (const task of queued) {
      if (localActiveKeys.has(`${task.user_id}:${task.id}`)) continue;
      if (claimed.length >= capacity) break;
      const result = claim.run(now, instanceId, leaseExpiryIso(), now, task.user_id, task.id);
      // attempt_no as written by this claim; fences the attempt's token-only write (persistAttemptUsageOnly).
      if (result.changes === 1) claimed.push({ ...task, attempt_no: (Number(task.attempt_no) || 0) + 1 });
    }
    return claimed;
  });
  return transaction();
}

function renewLease(instanceId, task) {
  const result = getDb().prepare(
    `UPDATE agent_tasks
     SET lease_expires_at = ?, updated_at = ?
     WHERE user_id = ? AND id = ? AND status = 'running' AND lease_owner = ?`,
  ).run(leaseExpiryIso(), nowIso(), task.user_id, task.id, instanceId);
  return result.changes === 1;
}

// Usage of one attempt (one handleInput run). Tokens are CUMULATIVE per task: every persist below ADDS the
// attempt's usage, so a paused-then-resumed task keeps the tokens it already spent. A user retry of a failed or
// cancelled task resets the counters in the HUD task store (hud/lib/agents/task-store.ts), so a retry counts afresh.
function createAttemptUsage() {
  return { calls: 0, usage: emptyLlmUsage(), costUsd: 0 };
}

/** Observer for withLlmUsageObserver: totals every LLM call recorded while the attempt runs (even if it throws). */
function observeAttemptUsage(attempt) {
  return (record) => {
    attempt.calls += 1;
    attempt.usage = addLlmUsage(attempt.usage, record);
    // An unpriced model adds no cost (agent_tasks.cost_usd keeps its 0-for-unknown convention).
    if (record?.costUsd !== null && Number.isFinite(Number(record?.costUsd))) attempt.costUsd += Number(record.costUsd);
  };
}

/**
 * The attempt's tokens and cost. Prefers the calls observed through the usage ledger; falls back to the token
 * fields handleInput returned when no call was observed (e.g. a caller-supplied handleInput that reports totals).
 */
function resolveAttemptUsage(task, attempt, result = null) {
  if (attempt && attempt.calls > 0) {
    return { ...attempt.usage, costUsd: Number(attempt.costUsd.toFixed(6)) };
  }
  const usage = {
    inputTokens: toTokenCount(result?.promptTokens),
    outputTokens: toTokenCount(result?.completionTokens),
    cachedInputTokens: toTokenCount(result?.cachedInputTokens),
    cacheWriteInputTokens: toTokenCount(result?.cacheWriteInputTokens),
  };
  const estimated = estimateTokenCostUsd(task.model, usage.inputTokens, usage.outputTokens, {
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
  });
  return { ...usage, costUsd: estimated !== null && Number.isFinite(Number(estimated)) ? Number(estimated) : 0 };
}

const ADD_USAGE_SQL = `tokens_in = tokens_in + ?,
         tokens_out = tokens_out + ?,
         cached_input_tokens = cached_input_tokens + ?,
         cache_write_input_tokens = cache_write_input_tokens + ?,
         cost_usd = COALESCE(cost_usd, 0) + ?`;

function usageParams(usage) {
  return [usage.inputTokens, usage.outputTokens, usage.cachedInputTokens, usage.cacheWriteInputTokens, usage.costUsd];
}

function persistCompleted(instanceId, task, result, usage) {
  getDb().prepare(
    `UPDATE agent_tasks
     SET status = 'completed',
         progress = 100,
         ${ADD_USAGE_SQL},
         result_text = ?,
         tool_calls = ?,
         approved_tools_json = NULL,
         error = NULL,
         completed_at = ?,
         lease_owner = NULL,
         lease_expires_at = NULL,
         updated_at = ?
     WHERE user_id = ? AND id = ? AND status = 'running' AND lease_owner = ?`,
  ).run(
    ...usageParams(usage),
    result.reply || "Task completed without a text result.",
    JSON.stringify(result.toolCalls),
    nowIso(),
    nowIso(),
    task.user_id,
    task.id,
    instanceId,
  );
}

function persistFailed(instanceId, task, error, usage = resolveAttemptUsage(task, null)) {
  const rawMessage = error instanceof Error ? error.message : String(error || "Agent task failed.");
  const message = String(redactSecrets(rawMessage) || "Agent task failed.").slice(0, MAX_ERROR_CHARS);
  getDb().prepare(
    `UPDATE agent_tasks
     SET status = 'failed',
         progress = CASE WHEN progress < 10 THEN 10 ELSE progress END,
         ${ADD_USAGE_SQL},
         error = ?,
         approved_tools_json = NULL,
         completed_at = ?,
         lease_owner = NULL,
         lease_expires_at = NULL,
         updated_at = ?
     WHERE user_id = ? AND id = ? AND status = 'running' AND lease_owner = ?`,
  ).run(...usageParams(usage), message, nowIso(), nowIso(), task.user_id, task.id, instanceId);
}

function persistApprovalRequired(instanceId, task, approval, usage = resolveAttemptUsage(task, null)) {
  const now = nowIso();
  const boundedApproval = {
    ...approval,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  getDb().prepare(
    `UPDATE agent_tasks
     SET status = 'paused',
         paused_at = ?,
         pause_reason = 'approval',
         pending_approval_json = ?,
         error = ?,
         ${ADD_USAGE_SQL},
         lease_owner = NULL,
         lease_expires_at = NULL,
         updated_at = ?
     WHERE user_id = ? AND id = ? AND status = 'running' AND lease_owner = ?`,
  ).run(
    now,
    JSON.stringify(boundedApproval),
    `Approval required for ${approval.toolName}.`,
    ...usageParams(usage),
    now,
    task.user_id,
    task.id,
    instanceId,
  );
}

/**
 * The user paused, stopped or deleted the task mid-run (the HUD already wrote the new status). Only add the tokens
 * this attempt spent: fenced on attempt_no so a later attempt's row is never touched, and skipped for deleted tasks.
 */
function persistAttemptUsageOnly(task, usage) {
  if (!usage.inputTokens && !usage.outputTokens) return;
  getDb().prepare(
    `UPDATE agent_tasks
     SET ${ADD_USAGE_SQL},
         updated_at = ?
     WHERE user_id = ? AND id = ? AND attempt_no = ? AND deleted_at IS NULL`,
  ).run(...usageParams(usage), nowIso(), task.user_id, task.id, Number(task.attempt_no) || 0);
}

async function executeTask(instanceId, task, handleInput, controller) {
  const control = setInterval(() => {
    const row = getDb().prepare(
      "SELECT status, lease_owner, deleted_at FROM agent_tasks WHERE user_id = ? AND id = ?",
    ).get(task.user_id, task.id);
    if (!row || row.status !== "running" || row.lease_owner !== instanceId || row.deleted_at) {
      controller.abort(new Error("Agent task was paused, stopped, or deleted."));
    }
  }, CONTROL_INTERVAL_MS);
  control.unref?.();
  const heartbeat = setInterval(() => {
    if (!renewLease(instanceId, task)) controller.abort(new Error("Agent task was paused, stopped, or deleted."));
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  const attempt = createAttemptUsage();
  let returnedResult = null;
  try {
    const executionContext = await prepareTaskExecutionContext(task);
    let approvedTools = [];
    try {
      const parsed = JSON.parse(String(task.approved_tools_json || "[]"));
      if (Array.isArray(parsed)) {
        const now = Date.now();
        approvedTools = parsed.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const key = String(entry.key || "").trim();
          const expiresAt = Date.parse(String(entry.expiresAt || ""));
          return key && Number.isFinite(expiresAt) && expiresAt > now ? [key] : [];
        });
      }
    } catch {
      approvedTools = [];
    }
    const rawResult = await withLlmUsageObserver(observeAttemptUsage(attempt), () => handleInput(executionContext.prompt, {
      voice: false,
      source: "agent-task",
      sender: "agent-task",
      userContextId: task.user_id,
      conversationId: `agent-task-${task.id}`,
      sessionKeyHint: `agent-task:${task.user_id}:${task.id}`,
      preferredProvider: task.agent,
      preferredModel: task.model,
      autonomousTask: true,
      permissionMode: task.permission_mode,
      approvedTools,
      taskId: task.id,
      workspaceDir: executionContext.workspaceDir,
      worktreePath: task.worktree_path || "",
      abortSignal: controller.signal,
      executionFenceCheck: () => {
        const row = getDb().prepare(
          "SELECT status, lease_owner, deleted_at FROM agent_tasks WHERE user_id = ? AND id = ?",
        ).get(task.user_id, task.id);
        if (!row || row.status !== "running" || row.lease_owner !== instanceId || row.deleted_at) {
          const error = new Error("Agent task execution lease is no longer valid.");
          error.code = "AGENT_TASK_FENCE_REVOKED";
          throw error;
        }
      },
      consumeTaskApproval: (approvalKey) => {
        const db = getDb();
        const consumed = db.transaction(() => {
          const row = db.prepare(
            `SELECT approved_tools_json FROM agent_tasks
             WHERE user_id = ? AND id = ? AND status = 'running'
               AND lease_owner = ? AND deleted_at IS NULL`,
          ).get(task.user_id, task.id, instanceId);
          if (!row) return false;
          let grants = [];
          try {
            const parsed = JSON.parse(String(row.approved_tools_json || "[]"));
            if (Array.isArray(parsed)) grants = parsed.filter((entry) => entry && typeof entry === "object");
          } catch {
            grants = [];
          }
          const now = Date.now();
          const key = String(approvalKey || "");
          const matching = grants.filter(
            (entry) => String(entry.key || "") === key
              && Number.isFinite(Date.parse(String(entry.expiresAt || "")))
              && Date.parse(String(entry.expiresAt || "")) > now,
          );
          if (matching.length !== 1) return false;
          const remaining = grants.filter((entry) => String(entry.key || "") !== key);
          const result = db.prepare(
            `UPDATE agent_tasks SET approved_tools_json = ?, updated_at = ?
             WHERE user_id = ? AND id = ? AND status = 'running'
               AND lease_owner = ? AND deleted_at IS NULL
               AND approved_tools_json IS ?`,
          ).run(
            JSON.stringify(remaining),
            nowIso(),
            task.user_id,
            task.id,
            instanceId,
            row.approved_tools_json,
          );
          return result.changes === 1;
        })();
        if (!consumed) {
          throw new Error("Agent task approval grant is missing, expired, or already consumed.");
        }
      },
      reserveTaskEffect: (effectKey) => {
        const normalizedKey = String(effectKey || "").trim().toLowerCase();
        if (!normalizedKey) throw new Error("Agent task side-effect key is required.");
        const result = getDb().prepare(
          `INSERT OR IGNORE INTO agent_task_effects
             (user_id, task_id, effect_key, attempt_no, created_at)
           SELECT user_id, id, ?, attempt_no, ?
           FROM agent_tasks
           WHERE user_id = ? AND id = ? AND status = 'running'
             AND lease_owner = ? AND deleted_at IS NULL`,
        ).run(normalizedKey, nowIso(), task.user_id, task.id, instanceId);
        if (result.changes !== 1) {
          const error = new Error("This Agent Task side effect was already reserved; refusing a duplicate execution.");
          error.code = "AGENT_TASK_DUPLICATE_EFFECT";
          throw error;
        }
      },
      customInstructions:
        "Execute this as an autonomous background task. Use available Nova integrations and tools when needed. " +
        "Return a clear final result describing completed work and any blockers.",
    }));
    const result = normalizeResult(rawResult);
    returnedResult = result;
    if (result.errorCode === "AGENT_TASK_APPROVAL_REQUIRED" && result.pendingApproval) {
      persistApprovalRequired(instanceId, task, result.pendingApproval, resolveAttemptUsage(task, attempt, result));
      return;
    }
    if (!result.ok) throw new Error(result.error || "Agent task failed.");
    persistCompleted(instanceId, task, result, resolveAttemptUsage(task, attempt, result));
  } catch (error) {
    // Tokens spent before the failure / pause are recorded too (observed calls, or the returned totals).
    const usage = resolveAttemptUsage(task, attempt, returnedResult);
    if (!controller.signal.aborted && error?.code === "AGENT_TASK_APPROVAL_REQUIRED") {
      persistApprovalRequired(instanceId, task, {
        toolName: String(error?.toolName || "local mutation"),
        reason: String(error?.message || "Approval required."),
        approvalKey: String(error?.approvalKey || error?.toolName || "local mutation"),
      }, usage);
    } else if (!controller.signal.aborted) {
      persistFailed(instanceId, task, error, usage);
    } else {
      persistAttemptUsageOnly(task, usage);
    }
  } finally {
    clearInterval(control);
    clearInterval(heartbeat);
    getDb().prepare(
      `UPDATE agent_tasks
       SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE user_id = ? AND id = ? AND lease_owner = ?`,
    ).run(nowIso(), task.user_id, task.id, instanceId);
  }
}

export function startAgentTaskService({ handleInput }) {
  if (String(process.env.NOVA_AGENT_TASK_EXECUTION || "1").trim() === "0") {
    console.log("[AgentTasks] Runtime execution disabled by NOVA_AGENT_TASK_EXECUTION=0.");
    return () => {};
  }
  if (typeof handleInput !== "function") throw new Error("AgentTaskService requires handleInput.");

  const instanceId = randomUUID();
  const active = new Map();
  let ticking = false;

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await finalizeDeferredTaskDeletes();
      const claimed = claimQueuedTasks(instanceId, new Set(active.keys()));
      for (const task of claimed) {
        const key = `${task.user_id}:${task.id}`;
        if (active.has(key)) continue;
        const controller = new AbortController();
        const promise = executeTask(instanceId, task, handleInput, controller)
          .catch((error) => persistFailed(instanceId, task, error))
          .finally(() => active.delete(key));
        active.set(key, { controller, promise });
      }
    } catch (error) {
      console.error(`[AgentTasks] Scheduler tick failed: ${String(error?.message || error)}`);
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  timer.unref?.();
  void tick();
  console.log(`[AgentTasks] Runtime scheduler online instance=${instanceId}`);

  return () => {
    clearInterval(timer);
    for (const run of active.values()) run.controller.abort(new Error("Nova runtime is shutting down."));
    active.clear();
  };
}
