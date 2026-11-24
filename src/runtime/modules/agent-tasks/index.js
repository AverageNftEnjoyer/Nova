import { randomUUID } from "node:crypto";

import { recordAgentTaskBudgetEventSafe } from "../../../db/agent-task-budget-events.js";
import { getDb } from "../../../db/index.js";
import { addLlmUsage, emptyLlmUsage, withLlmUsageObserver } from "../../../providers/usage/index.js";
import { redactSecrets } from "../../../security/secrets/index.js";
import { broadcastAgentTaskBudget } from "../../infrastructure/hud-gateway/index.js";
import { estimateTokenCostUsd } from "../llm/providers/index.js";
import { AGENT_TASK_BUDGET_EXHAUSTED, createTaskBudgetController } from "./budget/index.js";
import { isCostBudgetBlind, readAgentTaskBudgetSettings, resolveEffectiveTaskBudget } from "./budget-settings/index.js";
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
              attempt_no, tokens_in, tokens_out, cost_usd, cost_budget_usd, token_budget, budget_state
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

function formatBudgetUsd(value) {
  // At least cents, up to 4 decimals: $0.25, $0.2512, $1.00.
  const [whole, fraction] = Number(value || 0).toFixed(4).split(".");
  return `$${whole}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}

/** The short message shown on a task paused at its budget (only the dimensions that have a limit). */
function describeBudgetPause(snapshot) {
  const parts = [];
  if (snapshot && Number(snapshot.costBudgetUsd) > 0) {
    parts.push(`$${Number(snapshot.spentUsd || 0).toFixed(4)} of ${formatBudgetUsd(snapshot.costBudgetUsd)}`);
  }
  if (snapshot && Number(snapshot.tokenBudget) > 0) {
    parts.push(
      `${Math.round(Number(snapshot.spentTokens || 0)).toLocaleString("en-US")} of `
        + `${Math.round(Number(snapshot.tokenBudget)).toLocaleString("en-US")} tokens`,
    );
  }
  const spend = parts.length > 0 ? `: ${parts.join(" \u00b7 ")}` : "";
  return `Paused at its budget${spend}. Resume re-runs the task from the start.`;
}

/**
 * Budget event history (agent_task_budget_events): one row per warning / degraded / exhausted transition, written
 * only after the matching fenced state write succeeded (so a paused / deleted task gets no late rows). Timestamps
 * are made strictly increasing per attempt so the sequence reads back in order even within one millisecond.
 * recordAgentTaskBudgetEventSafe never throws: a failed history write never breaks the task.
 */
function recordBudgetHistory(task, clock, kind, data) {
  const ts = Math.max(Number(data?.ts) || Date.now(), clock.lastTs + 1);
  clock.lastTs = ts;
  recordAgentTaskBudgetEventSafe({
    userId: task.user_id,
    taskId: task.id,
    kind,
    state: kind,
    ts,
    spentUsd: data?.spentUsd,
    spentTokens: data?.spentTokens,
    costBudgetUsd: data?.costBudgetUsd ?? null,
    tokenBudget: data?.tokenBudget ?? null,
    model: String(data?.model ?? data?.lastModel ?? ""),
    economyModel: data?.economyModel ?? null,
  });
}

/**
 * The task's next model call would have gone over its budget (the loop stopped BEFORE that call). Pause it with
 * pause_reason 'budget' and add the tokens this attempt spent; fenced like persistApprovalRequired. The 'exhausted'
 * history row is written here, once the pause has landed.
 */
function persistBudgetPaused(instanceId, task, snapshot, usage = resolveAttemptUsage(task, null), clock = { lastTs: 0 }) {
  const now = nowIso();
  const result = getDb().prepare(
    `UPDATE agent_tasks
     SET status = 'paused',
         paused_at = ?,
         pause_reason = 'budget',
         budget_state = 'exhausted',
         pending_approval_json = NULL,
         error = ?,
         ${ADD_USAGE_SQL},
         lease_owner = NULL,
         lease_expires_at = NULL,
         updated_at = ?
     WHERE user_id = ? AND id = ? AND status = 'running' AND lease_owner = ?`,
  ).run(now, describeBudgetPause(snapshot), ...usageParams(usage), now, task.user_id, task.id, instanceId);
  if (result.changes === 1) recordBudgetHistory(task, clock, "exhausted", snapshot);
}

/** Budget state for the HUD while the task runs (warning / degraded). Fenced to this attempt's lease. */
function persistBudgetState(instanceId, task, state) {
  return getDb().prepare(
    `UPDATE agent_tasks SET budget_state = ?, updated_at = ?
     WHERE user_id = ? AND id = ? AND status = 'running' AND lease_owner = ?`,
  ).run(state, nowIso(), task.user_id, task.id, instanceId).changes === 1;
}

/**
 * The attempt's budget controller (agent-tasks/budget), or null when the task has no budget (neither its own nor
 * a user default). Spend of earlier attempts counts: the stored totals are cumulative per task.
 */
function createAttemptBudgetController(instanceId, task, onBudgetEvent, clock) {
  const settings = readAgentTaskBudgetSettings(task.user_id);
  const budget = resolveEffectiveTaskBudget(
    { costBudgetUsd: task.cost_budget_usd, tokenBudget: task.token_budget },
    settings,
  );
  if (isCostBudgetBlind(budget, task.model)) {
    // Not blocked on purpose (the HUD shows the same note on the task): the user can add a token budget.
    console.warn(
      `[AgentTasks] Task ${task.id}: no price is known for model "${task.model}", so its cost-only budget cannot `
        + "stop it. Set a token budget to limit it.",
    );
  }
  const budgetController = createTaskBudgetController({
    userContextId: task.user_id,
    taskId: task.id,
    budget,
    prior: {
      spentUsd: Number(task.cost_usd) || 0,
      spentTokens: toTokenCount(task.tokens_in) + toTokenCount(task.tokens_out),
    },
    economyModels: settings.economyModels,
    onEvent: (event) => {
      // 'exhausted' is written by persistBudgetPaused together with the pause.
      // Its history row too (after the pause has landed).
      if (event.state !== "exhausted") {
        try {
          if (persistBudgetState(instanceId, task, event.state)) recordBudgetHistory(task, clock, event.state, event);
        } catch (error) {
          console.warn(`[AgentTasks] Budget state write failed: ${String(error?.message || error)}`);
        }
      }
      broadcastAgentTaskBudget(event);
      if (typeof onBudgetEvent === "function") onBudgetEvent(event);
    },
  });
  if (budgetController && budgetController.getState() !== String(task.budget_state || "ok")) {
    persistBudgetState(instanceId, task, budgetController.getState());
  }
  return budgetController;
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

async function executeTask(instanceId, task, handleInput, controller, onBudgetEvent) {
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
  let budgetController = null;
  const budgetHistoryClock = { lastTs: 0 };
  try {
    budgetController = createAttemptBudgetController(instanceId, task, onBudgetEvent, budgetHistoryClock);
    const attemptObserver = observeAttemptUsage(attempt);
    const usageObserver = budgetController
      ? (record) => {
          attemptObserver(record);
          budgetController.observe(record);
        }
      : attemptObserver;
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
    const rawResult = await withLlmUsageObserver(usageObserver, () => handleInput(executionContext.prompt, {
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
      taskBudget: budgetController ?? undefined,
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
    if (result.errorCode === AGENT_TASK_BUDGET_EXHAUSTED || budgetController?.getState() === "exhausted") {
      persistBudgetPaused(
        instanceId,
        task,
        budgetController?.snapshot() ?? rawResult?.budgetExhausted ?? null,
        resolveAttemptUsage(task, attempt, result),
        budgetHistoryClock,
      );
      return;
    }
    if (result.errorCode === "AGENT_TASK_APPROVAL_REQUIRED" && result.pendingApproval) {
      persistApprovalRequired(instanceId, task, result.pendingApproval, resolveAttemptUsage(task, attempt, result));
      return;
    }
    if (!result.ok) throw new Error(result.error || "Agent task failed.");
    persistCompleted(instanceId, task, result, resolveAttemptUsage(task, attempt, result));
  } catch (error) {
    // Tokens spent before the failure / pause are recorded too (observed calls, or the returned totals).
    const usage = resolveAttemptUsage(task, attempt, returnedResult);
    if (!controller.signal.aborted && error?.code === AGENT_TASK_BUDGET_EXHAUSTED) {
      persistBudgetPaused(
        instanceId,
        task,
        budgetController?.snapshot() ?? error?.snapshot ?? null,
        usage,
        budgetHistoryClock,
      );
    } else if (!controller.signal.aborted && error?.code === "AGENT_TASK_APPROVAL_REQUIRED") {
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

/**
 * @param {object} options
 * @param {Function} options.handleInput  the runtime's chat entry point
 * @param {(event: object) => void} [options.onBudgetEvent]  test hook: every agent-task-budget event, after it is
 *   persisted and broadcast
 */
export function startAgentTaskService({ handleInput, onBudgetEvent }) {
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
        const promise = executeTask(instanceId, task, handleInput, controller, onBudgetEvent)
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
