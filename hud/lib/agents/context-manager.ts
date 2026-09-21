/**
 * Agent Task Context Manager
 *
 * Manages context groups for related agent tasks. Tasks in the same context can share
 * information, enabling new tasks to benefit from the outcomes of previously completed tasks.
 */

import { randomUUID } from "node:crypto"

import { nowIso, tx, type Database } from "../../../src/db/index.js"
import type { AgentTask } from "./types"

const MAX_CONTEXTS = 100
const MAX_CONTEXT_NAME_CHARS = 60

export interface TaskContext {
  id: string
  userId: string
  name: string
  createdAt: string
}

export interface TaskContextAssignment {
  taskId: string
  contextId: string
  assignedAt: string
}

export class TaskContextValidationError extends Error {}
export class TaskContextNotFoundError extends Error {}

function sanitizeUserId(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
  if (!normalized) throw new TaskContextValidationError("A user id is required.")
  return normalized
}

function sanitizeContextName(value: unknown): string {
  const name = String(value ?? "").trim().slice(0, MAX_CONTEXT_NAME_CHARS)
  if (!name) throw new TaskContextValidationError("Context name is required.")
  return name
}

// ─── Persistence ─────────────────────────────────────────────────────────────

interface ContextRow {
  id: string
  name: string
  created_at: string
}

function rowToContext(row: ContextRow, userId: string): TaskContext | null {
  const id = typeof row.id === "string" ? row.id : ""
  const name = typeof row.name === "string" ? row.name : ""
  const createdAt = typeof row.created_at === "string" ? row.created_at : ""
  if (!id || !name || !createdAt) return null

  return {
    id,
    userId,
    name,
    createdAt,
  }
}

function loadContexts(db: Database, userId: string): TaskContext[] {
  const rows = db
    .prepare("SELECT id, name, created_at FROM task_contexts WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as ContextRow[]
  const contexts: TaskContext[] = []
  for (const row of rows) {
    const context = rowToContext(row, userId)
    if (context) contexts.push(context)
  }
  return contexts
}

function loadContext(db: Database, userId: string, contextId: string): TaskContext | null {
  const row = db
    .prepare("SELECT id, name, created_at FROM task_contexts WHERE user_id = ? AND id = ?")
    .get(userId, contextId) as ContextRow | undefined
  return row ? rowToContext(row, userId) : null
}

function insertContext(db: Database, userId: string, context: TaskContext): void {
  db.prepare(
    "INSERT INTO task_contexts (user_id, id, name, created_at) VALUES (?, ?, ?, ?)",
  ).run(userId, context.id, context.name, context.createdAt)
}

function loadTasksInContext(db: Database, userId: string, contextId: string): string[] {
  const rows = db
    .prepare(
      `SELECT task_id FROM task_context_assignments
       WHERE user_id = ? AND context_id = ?
       ORDER BY assigned_at ASC`,
    )
    .all(userId, contextId) as { task_id: string }[]
  return rows.map((row) => row.task_id)
}

function getTaskContext(db: Database, userId: string, taskId: string): string | null {
  const row = db
    .prepare("SELECT context_id FROM task_context_assignments WHERE user_id = ? AND task_id = ?")
    .get(userId, taskId) as { context_id: string } | undefined
  return row?.context_id ?? null
}

function assignTaskToContextInDb(
  db: Database,
  userId: string,
  taskId: string,
  contextId: string,
): void {
  const now = nowIso()
  db.prepare(
    `INSERT INTO task_context_assignments (user_id, task_id, context_id, assigned_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, task_id) DO UPDATE SET
       context_id = excluded.context_id,
       assigned_at = excluded.assigned_at`,
  ).run(userId, taskId, contextId, now)
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create a new context group for organizing related tasks.
 */
export async function createContext(rawUserId: string, name: string): Promise<TaskContext> {
  const userId = sanitizeUserId(rawUserId)
  const sanitizedName = sanitizeContextName(name)

  return tx((db) => {
    const existing = loadContexts(db, userId)
    if (existing.length >= MAX_CONTEXTS) {
      throw new TaskContextValidationError(`Context limit reached (${MAX_CONTEXTS}).`)
    }

    // Check for duplicate name
    if (existing.some((ctx) => ctx.name === sanitizedName)) {
      throw new TaskContextValidationError("A context with this name already exists.")
    }

    const context: TaskContext = {
      id: randomUUID(),
      userId,
      name: sanitizedName,
      createdAt: nowIso(),
    }

    insertContext(db, userId, context)
    return context
  })
}

/**
 * List all context groups for a user.
 */
export async function listContexts(rawUserId: string): Promise<TaskContext[]> {
  const userId = sanitizeUserId(rawUserId)
  return tx((db) => loadContexts(db, userId), "deferred")
}

/**
 * Get a specific context by ID.
 */
export async function getContext(rawUserId: string, contextId: string): Promise<TaskContext | null> {
  const userId = sanitizeUserId(rawUserId)
  return tx((db) => loadContext(db, userId, contextId), "deferred")
}

/**
 * Assign a task to a context group.
 */
export async function assignTaskToContext(
  rawUserId: string,
  taskId: string,
  contextId: string,
): Promise<void> {
  const userId = sanitizeUserId(rawUserId)

  return tx((db) => {
    // Verify context exists
    const context = loadContext(db, userId, contextId)
    if (!context) {
      throw new TaskContextNotFoundError("Context not found.")
    }

    assignTaskToContextInDb(db, userId, taskId, contextId)
  })
}

/**
 * Get all task IDs in a context group.
 */
export async function getContextTaskIds(rawUserId: string, contextId: string): Promise<string[]> {
  const userId = sanitizeUserId(rawUserId)
  return tx((db) => loadTasksInContext(db, userId, contextId), "deferred")
}

/**
 * Get the context ID for a task (if any).
 */
export async function getTaskContextId(rawUserId: string, taskId: string): Promise<string | null> {
  const userId = sanitizeUserId(rawUserId)
  return tx((db) => getTaskContext(db, userId, taskId), "deferred")
}

/**
 * Remove a task from its context group.
 */
export async function removeTaskFromContext(rawUserId: string, taskId: string): Promise<boolean> {
  const userId = sanitizeUserId(rawUserId)
  return tx((db) => {
    const result = db
      .prepare("DELETE FROM task_context_assignments WHERE user_id = ? AND task_id = ?")
      .run(userId, taskId)
    return result.changes > 0
  })
}

/**
 * Delete a context group (removes all task assignments).
 */
export async function deleteContext(rawUserId: string, contextId: string): Promise<boolean> {
  const userId = sanitizeUserId(rawUserId)
  return tx((db) => {
    const result = db.prepare("DELETE FROM task_contexts WHERE user_id = ? AND id = ?").run(userId, contextId)
    return result.changes > 0
  })
}

/**
 * Generate a context summary for prompt injection.
 * Returns formatted text describing all sibling tasks in the context.
 */
export async function generateContextSummary(
  rawUserId: string,
  contextId: string,
  tasks: AgentTask[],
): Promise<string> {
  const userId = sanitizeUserId(rawUserId)
  const context = await getContext(userId, contextId)
  if (!context) {
    throw new TaskContextNotFoundError("Context not found.")
  }

  const taskIds = await getContextTaskIds(userId, contextId)
  const contextTasks = tasks.filter((t) => taskIds.includes(t.id))

  if (contextTasks.length === 0) {
    return ""
  }

  const summaries = contextTasks.map((task) => {
    const outcome = task.error
      ? `Failed: ${task.error.slice(0, 100)}`
      : task.status === "completed"
        ? `Completed (${task.progress}% done)`
        : `${task.status.charAt(0).toUpperCase() + task.status.slice(1)} (${task.progress}% done)`

    return `- [${task.agent} ${task.model}] "${task.name}" → ${outcome}`
  })

  return `Context: Related tasks in "${context.name}":\n${summaries.join("\n")}\n`
}
