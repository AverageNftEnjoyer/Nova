// Agent-task budget event history (`agent_task_budget_events`, migration 15).
//
// One row per budget event of a task: the runtime's warning / degraded / exhausted transitions
// (src/runtime/modules/agent-tasks) and the user's raise-budget action (HUD task store). /analytics reads it to
// show the sequence over time; the task row's budget_state stays the source of truth for the CURRENT state.
// Rows are pruned with the llm_usage retention period (pruneLlmUsage in ./llm-usage.js) and removed with the task.
//
// Writers should use recordAgentTaskBudgetEventSafe (never throws: a history row must never break a task);
// insertAgentTaskBudgetEvent throws on invalid input so misuse is visible in tests.

import { randomUUID } from "node:crypto";

import { getDb, nowIso } from "./index.js";

export const AGENT_TASK_BUDGET_EVENT_KINDS = Object.freeze(["warning", "degraded", "exhausted", "raised"]);
const BUDGET_STATES = Object.freeze(["ok", "warning", "degraded", "exhausted"]);
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 2000;

const statementsByDb = new WeakMap();

function statementsFor(db) {
  let statements = statementsByDb.get(db);
  if (!statements) {
    statements = {
      insert: db.prepare(
        `INSERT INTO agent_task_budget_events (user_id, id, task_id, ts, kind, state, spent_usd, spent_tokens,
           cost_budget_usd, token_budget, model, economy_model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      deleteForTask: db.prepare("DELETE FROM agent_task_budget_events WHERE user_id = ? AND task_id = ?"),
      prune: db.prepare("DELETE FROM agent_task_budget_events WHERE ts < ?"),
    };
    statementsByDb.set(db, statements);
  }
  return statements;
}

function requireText(name, value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new TypeError(`${name} is required and must be a non-empty string.`);
  return text;
}

function requireKind(kind) {
  if (!AGENT_TASK_BUDGET_EVENT_KINDS.includes(kind)) {
    throw new TypeError(`kind must be one of ${AGENT_TASK_BUDGET_EVENT_KINDS.join(", ")} (got ${String(kind)}).`);
  }
  return kind;
}

function requireState(state) {
  if (!BUDGET_STATES.includes(state)) {
    throw new TypeError(`state must be one of ${BUDGET_STATES.join(", ")} (got ${String(state)}).`);
  }
  return state;
}

function toNonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toPositiveOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toIsoOrNow(value) {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return new Date(value).toISOString();
  return nowIso();
}

/**
 * Insert one event. Throws on a missing userId / taskId or an unknown kind / state.
 * @returns {string} the generated row id
 */
export function insertAgentTaskBudgetEvent(event) {
  const userId = requireText("userId", event?.userId);
  const taskId = requireText("taskId", event?.taskId);
  const kind = requireKind(event?.kind);
  const state = requireState(event?.state);
  const id = randomUUID();
  const tokenBudget = toPositiveOrNull(event.tokenBudget);
  statementsFor(getDb()).insert.run(
    userId,
    id,
    taskId,
    toIsoOrNow(event.ts),
    kind,
    state,
    toNonNegative(event.spentUsd),
    Math.round(toNonNegative(event.spentTokens)),
    toPositiveOrNull(event.costBudgetUsd),
    tokenBudget === null ? null : Math.round(tokenBudget),
    String(event.model ?? "").trim().slice(0, 120),
    String(event.economyModel ?? "").trim().slice(0, 120),
  );
  return id;
}

/** Like insertAgentTaskBudgetEvent, but never throws (logs instead). Returns the row id or null. */
export function recordAgentTaskBudgetEventSafe(event) {
  try {
    return insertAgentTaskBudgetEvent(event);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[AgentTaskBudget] Could not record budget event: ${reason}`);
    return null;
  }
}

/** Remove a task's events (called when the task itself is deleted). Returns the number of rows removed. */
export function deleteAgentTaskBudgetEvents(userId, taskId) {
  return statementsFor(getDb()).deleteForTask.run(requireText("userId", userId), requireText("taskId", taskId)).changes;
}

/** Delete events (all users) older than `cutoffIso`. Used by pruneLlmUsage. */
export function pruneAgentTaskBudgetEventsBefore(cutoffIso) {
  return statementsFor(getDb()).prune.run(requireText("cutoffIso", cutoffIso)).changes;
}

function mapRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    ts: row.ts,
    kind: row.kind,
    state: row.state,
    spentUsd: Number(row.spent_usd) || 0,
    spentTokens: Number(row.spent_tokens) || 0,
    costBudgetUsd: row.cost_budget_usd === null || row.cost_budget_usd === undefined ? null : Number(row.cost_budget_usd),
    tokenBudget: row.token_budget === null || row.token_budget === undefined ? null : Number(row.token_budget),
    model: row.model || "",
    economyModel: row.economy_model || "",
  };
}

/** One user's events, newest first, optionally for one task and / or since an ISO timestamp (inclusive). */
export function listAgentTaskBudgetEvents(userId, { taskId, sinceTs, limit } = {}) {
  const clauses = ["user_id = ?"];
  const params = [requireText("userId", userId)];
  if (typeof taskId === "string" && taskId.trim()) {
    clauses.push("task_id = ?");
    params.push(taskId.trim());
  }
  if (typeof sinceTs === "string" && sinceTs.trim()) {
    clauses.push("ts >= ?");
    params.push(toIsoOrNow(sinceTs));
  }
  const requested = Math.floor(Number(limit));
  const cappedLimit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT;
  return getDb()
    .prepare(`SELECT * FROM agent_task_budget_events WHERE ${clauses.join(" AND ")} ORDER BY ts DESC, id DESC LIMIT ?`)
    .all(...params, cappedLimit)
    .map(mapRow);
}
