/**
 * Agent Task Store
 *
 * Persists per-user agent tasks in the local SQLite database (nova.db, table `agent_tasks`).
 * Every read-modify-write runs in one BEGIN IMMEDIATE transaction (serialized across processes and
 * atomic: an error thrown by the mutator rolls everything back). This module is the only publisher of
 * task events: each write path publishes after its transaction has committed.
 */

import { randomUUID } from "node:crypto"

import { nowIso, tx, type Database } from "../../../src/db/index.js"
import { resolveModelPricing } from "../../app/integrations/constants/pricing"
import { createWorktree, deleteWorktree, generateBranchName } from "../git/worktree-manager"
import { publishTaskEvent } from "./task-events"
import { computeTaskStats } from "./task-stats"
import {
  AGENT_TASK_TERMINAL,
  type AgentPermissionMode,
  type AgentProvider,
  type AgentTask,
  type AgentTaskAction,
  type AgentTaskPriority,
  type AgentTaskStats,
  type AgentTaskStatus,
  type CreateAgentTaskInput,
} from "./types"

const MAX_TASKS = 300
const MAX_PROMPT_CHARS = 4000
const MAX_NAME_CHARS = 80
const MAX_MODEL_CHARS = 80
const DEFAULT_NAME_CHARS = 48

const STATUSES: readonly AgentTaskStatus[] = ["queued", "running", "paused", "completed", "failed", "cancelled"]
const PRIORITIES: readonly AgentTaskPriority[] = ["low", "normal", "high"]
const PROVIDERS: readonly AgentProvider[] = ["claude", "openai", "gemini", "grok"]
const PERMISSION_MODES: readonly AgentPermissionMode[] = ["default", "accept-edits", "plan-mode", "dont-ask", "bypass"]

export class AgentTaskValidationError extends Error {}
export class AgentTaskNotFoundError extends Error {}
export class AgentTaskTransitionError extends Error {}

function sanitizeUserId(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
  if (!normalized) throw new AgentTaskValidationError("A user id is required.")
  return normalized
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function pickEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}

function isoOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined
}

interface AgentTaskRow {
  id: string
  name: string
  prompt: string
  agent: string
  model: string
  status: string
  priority: string
  permission_mode: string
  progress: number
  tokens_in: number
  tokens_out: number
  cost_usd: number
  error: string | null
  attached_files: string | null
  worktree_path: string | null
  branch_name: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  paused_at: string | null
  completed_at: string | null
}

/** Validates a stored row; rows that fail are skipped rather than surfaced. */
function rowToTask(row: AgentTaskRow, userId: string): AgentTask | null {
  const id = typeof row.id === "string" ? row.id : ""
  const prompt = typeof row.prompt === "string" ? row.prompt : ""
  const agent = pickEnum(row.agent, PROVIDERS)
  const status = pickEnum(row.status, STATUSES)
  const createdAt = isoOrUndefined(row.created_at)
  if (!id || !prompt || !agent || !status || !createdAt) return null

  const task: AgentTask = {
    id,
    userId,
    name: typeof row.name === "string" && row.name ? row.name.slice(0, MAX_NAME_CHARS) : defaultTaskName(prompt),
    prompt,
    agent,
    model: typeof row.model === "string" ? row.model.slice(0, MAX_MODEL_CHARS) : "",
    status,
    priority: pickEnum(row.priority, PRIORITIES) ?? "normal",
    permissionMode: pickEnum(row.permission_mode, PERMISSION_MODES) ?? "default",
    progress: clampInt(row.progress, 0, 100),
    tokensIn: clampInt(row.tokens_in, 0, Number.MAX_SAFE_INTEGER),
    tokensOut: clampInt(row.tokens_out, 0, Number.MAX_SAFE_INTEGER),
    costUsd: Math.max(0, Number(row.cost_usd) || 0),
    createdAt,
    updatedAt: isoOrUndefined(row.updated_at) ?? createdAt,
  }
  if (typeof row.error === "string" && row.error) task.error = row.error
  if (typeof row.attached_files === "string" && row.attached_files) {
    try {
      const parsed = JSON.parse(row.attached_files)
      if (Array.isArray(parsed) && parsed.length > 0) task.attachedFiles = parsed
    } catch {
      // Ignore malformed JSON
    }
  }
  if (typeof row.worktree_path === "string" && row.worktree_path) task.worktreePath = row.worktree_path
  if (typeof row.branch_name === "string" && row.branch_name) task.branchName = row.branch_name
  const startedAt = isoOrUndefined(row.started_at)
  if (startedAt) task.startedAt = startedAt
  const pausedAt = isoOrUndefined(row.paused_at)
  if (pausedAt) task.pausedAt = pausedAt
  const completedAt = isoOrUndefined(row.completed_at)
  if (completedAt) task.completedAt = completedAt
  return task
}

function loadTasks(db: Database, userId: string): AgentTask[] {
  const rows = db
    .prepare(
      `SELECT
        a.*,
        c.context_id
       FROM agent_tasks a
       LEFT JOIN task_context_assignments c ON a.user_id = c.user_id AND a.id = c.task_id
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC, a.id ASC`,
    )
    .all(userId) as (AgentTaskRow & { context_id: string | null })[]
  const tasks: AgentTask[] = []
  for (const row of rows) {
    const task = rowToTask(row, userId)
    if (task) {
      if (typeof row.context_id === "string" && row.context_id) {
        task.contextId = row.context_id
      }
      tasks.push(task)
    }
  }
  return tasks
}

function upsertTask(db: Database, userId: string, task: AgentTask): void {
  db.prepare(
    `INSERT INTO agent_tasks
       (user_id, id, name, prompt, agent, model, status, priority, permission_mode, progress, tokens_in, tokens_out,
        cost_usd, error, attached_files, worktree_path, branch_name, created_at, updated_at, started_at, paused_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, id) DO UPDATE SET
       name = excluded.name, prompt = excluded.prompt, agent = excluded.agent, model = excluded.model,
       status = excluded.status, priority = excluded.priority, permission_mode = excluded.permission_mode,
       progress = excluded.progress, tokens_in = excluded.tokens_in, tokens_out = excluded.tokens_out,
       cost_usd = excluded.cost_usd, error = excluded.error, attached_files = excluded.attached_files,
       worktree_path = excluded.worktree_path, branch_name = excluded.branch_name,
       created_at = excluded.created_at, updated_at = excluded.updated_at, started_at = excluded.started_at,
       paused_at = excluded.paused_at, completed_at = excluded.completed_at`,
  ).run(
    userId,
    task.id,
    task.name,
    task.prompt,
    task.agent,
    task.model,
    task.status,
    task.priority,
    task.permissionMode,
    task.progress,
    task.tokensIn,
    task.tokensOut,
    task.costUsd,
    task.error ?? null,
    task.attachedFiles ? JSON.stringify(task.attachedFiles) : null,
    task.worktreePath ?? null,
    task.branchName ?? null,
    task.createdAt,
    task.updatedAt,
    task.startedAt ?? null,
    task.pausedAt ?? null,
    task.completedAt ?? null,
  )
}

/** Cheap read-only probe (indexed, no write lock): does this user have any queued or running task? */
export function hasActiveTasks(rawUserId: string): boolean {
  const userId = sanitizeUserId(rawUserId)
  return tx(
    (db) =>
      db
        .prepare("SELECT 1 FROM agent_tasks WHERE user_id = ? AND status IN ('queued', 'running') LIMIT 1")
        .get(userId) !== undefined,
    "deferred",
  )
}

// Kept on globalThis (like the event bus) so every route bundle shares one listener set.
type TaskActivityListener = (userId: string) => void
type ActivityGlobal = typeof globalThis & { __novaAgentTaskActivity?: Set<TaskActivityListener> }

function getActivityListeners(): Set<TaskActivityListener> {
  const g = globalThis as ActivityGlobal
  if (!g.__novaAgentTaskActivity) g.__novaAgentTaskActivity = new Set()
  return g.__novaAgentTaskActivity
}

/**
 * Notified (after commit) whenever a write leaves a task queued or running for `userId`.
 * The runner uses this to wake its timer, which otherwise sleeps while nothing is active.
 */
export function subscribeTaskActivity(listener: TaskActivityListener): () => void {
  const listeners = getActivityListeners()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyTaskActivity(userId: string, changed: AgentTask[]): void {
  if (!changed.some((t) => t.status === "queued" || t.status === "running")) return
  for (const listener of [...getActivityListeners()]) {
    try {
      listener(userId)
    } catch {
      // A failing listener must not affect the write that already committed.
    }
  }
}

/** Read-only snapshot (no write lock), used by list/get/stats. */
function readTasks(rawUserId: string): AgentTask[] {
  const userId = sanitizeUserId(rawUserId)
  return tx((db) => loadTasks(db, userId), "deferred")
}

/**
 * Runs `fn` against the freshly loaded tasks inside one write transaction. If `fn` changed, added or removed
 * tasks, they are persisted and, once the transaction has committed, events are published. If `fn` throws,
 * nothing is written or published. `fn` must be synchronous (tx callbacks cannot await).
 */
async function transact<T>(
  rawUserId: string,
  fn: (tasks: AgentTask[]) => T,
): Promise<{ result: T; changed: AgentTask[] }> {
  const userId = sanitizeUserId(rawUserId)
  const outcome = tx((db) => {
    const tasks = loadTasks(db, userId)
    const before = new Map(tasks.map((t) => [t.id, JSON.stringify(t)]))
    const result = fn(tasks)

    const now = nowIso()
    const changed: AgentTask[] = []
    for (const task of tasks) {
      const prev = before.get(task.id)
      if (prev === JSON.stringify(task)) continue
      if (prev !== undefined && task.updatedAt === (JSON.parse(prev) as AgentTask).updatedAt) task.updatedAt = now
      changed.push(task)
    }
    const present = new Set(tasks.map((t) => t.id))
    const removed = [...before.keys()].filter((id) => !present.has(id))

    for (const id of removed) db.prepare("DELETE FROM agent_tasks WHERE user_id = ? AND id = ?").run(userId, id)
    for (const task of changed) upsertTask(db, userId, task)
    return { result, changed, removed }
  })

  for (const task of outcome.changed) publishTaskEvent(userId, { type: "task.upserted", task })
  for (const id of outcome.removed) publishTaskEvent(userId, { type: "task.deleted", id })
  notifyTaskActivity(userId, outcome.changed)
  return { result: outcome.result, changed: outcome.changed }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultTaskName(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim().slice(0, DEFAULT_NAME_CHARS)
}

export function computeTaskCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = resolveModelPricing(model)
  if (!pricing) return 0
  return (tokensIn * pricing.input + tokensOut * pricing.output) / 1_000_000
}

function validateCreateInput(
  input: CreateAgentTaskInput,
): Pick<AgentTask, "name" | "prompt" | "agent" | "model" | "priority" | "permissionMode" | "attachedFiles"> {
  const prompt = String(input?.prompt ?? "").trim()
  if (!prompt) throw new AgentTaskValidationError("Prompt is required.")
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new AgentTaskValidationError(`Prompt must be ${MAX_PROMPT_CHARS} characters or fewer.`)
  }
  const agent = pickEnum(input?.agent, PROVIDERS)
  if (!agent) throw new AgentTaskValidationError("Unknown agent.")
  const model = String(input?.model ?? "").trim()
  if (!model) throw new AgentTaskValidationError("Model is required.")
  if (model.length > MAX_MODEL_CHARS) {
    throw new AgentTaskValidationError(`Model must be ${MAX_MODEL_CHARS} characters or fewer.`)
  }
  const name = String(input?.name ?? "").trim().slice(0, MAX_NAME_CHARS) || defaultTaskName(prompt)
  const result: Pick<AgentTask, "name" | "prompt" | "agent" | "model" | "priority" | "permissionMode" | "attachedFiles"> = {
    name,
    prompt,
    agent,
    model,
    priority: pickEnum(input?.priority, PRIORITIES) ?? "normal",
    permissionMode: pickEnum(input?.permissionMode, PERMISSION_MODES) ?? "default",
  }
  if (Array.isArray(input?.attachedFiles) && input.attachedFiles.length > 0) {
    result.attachedFiles = input.attachedFiles.filter((f) => typeof f === "string" && f.trim()).slice(0, 20)
  }
  return result
}

function findTask(tasks: AgentTask[], id: string): AgentTask {
  const task = tasks.find((t) => t.id === id)
  if (!task) throw new AgentTaskNotFoundError("Task not found.")
  return task
}

function transitionError(action: AgentTaskAction, status: AgentTaskStatus): AgentTaskTransitionError {
  return new AgentTaskTransitionError(`Cannot ${action} a ${status} task.`)
}

function applyAction(task: AgentTask, action: AgentTaskAction): void {
  const now = new Date().toISOString()
  const { status } = task
  if (action === "play") {
    if (status === "running" || status === "queued") return
    if (status === "paused") {
      task.status = "queued"
      delete task.pausedAt
      return
    }
    if (status === "failed" || status === "cancelled") {
      task.status = "queued"
      task.progress = 0
      task.tokensIn = 0
      task.tokensOut = 0
      task.costUsd = 0
      delete task.error
      delete task.completedAt
      delete task.startedAt
      delete task.pausedAt
      return
    }
    throw transitionError(action, status)
  }
  if (action === "pause") {
    if (status !== "running" && status !== "queued") throw transitionError(action, status)
    task.status = "paused"
    task.pausedAt = now
    return
  }
  if (AGENT_TASK_TERMINAL.includes(status)) throw transitionError(action, status)
  task.status = "cancelled"
  task.completedAt = now
  delete task.pausedAt
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function listTasks(userId: string): Promise<AgentTask[]> {
  return readTasks(userId)
}

export async function getTask(userId: string, id: string): Promise<AgentTask | null> {
  return readTasks(userId).find((t) => t.id === id) ?? null
}

export async function createTask(userId: string, input: CreateAgentTaskInput): Promise<AgentTask> {
  const fields = validateCreateInput(input)
  const safeUserId = sanitizeUserId(userId)
  const now = nowIso()
  const taskId = randomUUID()

  const task: AgentTask = {
    id: taskId,
    userId: safeUserId,
    ...fields,
    status: "queued",
    progress: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    createdAt: now,
    updatedAt: now,
  }

  // Create worktree if requested
  if (input.useWorktree) {
    try {
      const branchName = generateBranchName(input.prompt, taskId)
      const worktreePath = await createWorktree(taskId, branchName)
      task.worktreePath = worktreePath
      task.branchName = branchName
    } catch (error) {
      // Log error but don't fail task creation
      console.error(`Failed to create worktree for task ${taskId}:`, error)
      // Continue without worktree
    }
  }

  await transact(userId, (tasks) => {
    if (tasks.length >= MAX_TASKS) {
      const oldestTerminal = tasks
        .filter((t) => AGENT_TASK_TERMINAL.includes(t.status))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0]
      if (!oldestTerminal) throw new AgentTaskValidationError("Task limit reached. Delete a task first.")
      tasks.splice(tasks.indexOf(oldestTerminal), 1)
    }
    tasks.unshift(task)
  })

  // Assign to context if provided
  if (input.contextId) {
    tx((db) => {
      db.prepare(
        `INSERT INTO task_context_assignments (user_id, task_id, context_id, assigned_at)
         VALUES (?, ?, ?, ?)`,
      ).run(safeUserId, taskId, input.contextId, now)
    })
    task.contextId = input.contextId
  }

  return task
}

export async function applyTaskAction(userId: string, id: string, action: AgentTaskAction): Promise<AgentTask> {
  const { result } = await transact(userId, (tasks) => {
    const task = findTask(tasks, id)
    applyAction(task, action)
    return task
  })
  return result
}

export async function deleteTask(userId: string, id: string): Promise<boolean> {
  // Get task to check for worktree before deleting
  const task = await getTask(userId, id)

  const { result } = await transact(userId, (tasks) => {
    const index = tasks.findIndex((t) => t.id === id)
    if (index === -1) return false
    tasks.splice(index, 1)
    return true
  })

  // Clean up worktree if it exists (do this after successful deletion)
  if (result && task?.worktreePath) {
    try {
      // Force delete worktree since task is being deleted
      await deleteWorktree(id, undefined, true)
    } catch (error) {
      // Log but don't fail deletion if worktree cleanup fails
      console.error(`Failed to clean up worktree for task ${id}:`, error)
    }
  }

  return result
}

export async function getTaskStats(userId: string): Promise<AgentTaskStats> {
  return computeTaskStats(readTasks(userId))
}

/** Runner-only: mutate tasks in place. Returns the tasks whose JSON changed. */
export async function mutateTasks(userId: string, mutator: (tasks: AgentTask[]) => void): Promise<AgentTask[]> {
  return (await transact(userId, mutator)).changed
}

/** Tasks left "running" by a dead process go back to the queue. Returns how many. */
export async function recoverInterruptedTasks(userId: string): Promise<number> {
  const changed = await mutateTasks(userId, (tasks) => {
    for (const task of tasks) {
      if (task.status === "running") task.status = "queued"
    }
  })
  return changed.length
}
