/**
 * Agent Task Store
 *
 * Persists per-user agent tasks as JSON at:
 *   .user/user-context/<userId>/agent-tasks/agent-tasks.json
 *
 * Every read-modify-write runs under a per-user promise-chain lock and writes
 * atomically (tmp + rename). This module is the only publisher of task events:
 * each write path publishes after the file write succeeds.
 */

import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { randomBytes, randomUUID } from "node:crypto"
import path from "node:path"

import { resolveModelPricing } from "../../app/integrations/constants/pricing"
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

const AGENT_TASKS_DIR_NAME = "agent-tasks"
const AGENT_TASKS_FILE_NAME = "agent-tasks.json"
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

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd()
  return path.basename(cwd).toLowerCase() === "hud" ? path.resolve(cwd, "..") : cwd
}

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

function resolveTasksFile(userId: string): string {
  return path.join(resolveWorkspaceRoot(), ".user", "user-context", userId, AGENT_TASKS_DIR_NAME, AGENT_TASKS_FILE_NAME)
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

function normalizeStoredTask(raw: unknown, userId: string): AgentTask | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === "string" ? r.id : ""
  const prompt = typeof r.prompt === "string" ? r.prompt : ""
  const agent = pickEnum(r.agent, PROVIDERS)
  const status = pickEnum(r.status, STATUSES)
  const createdAt = isoOrUndefined(r.createdAt)
  if (!id || !prompt || !agent || !status || !createdAt) return null

  const task: AgentTask = {
    id,
    userId,
    name: typeof r.name === "string" && r.name ? r.name.slice(0, MAX_NAME_CHARS) : defaultTaskName(prompt),
    prompt,
    agent,
    model: typeof r.model === "string" ? r.model.slice(0, MAX_MODEL_CHARS) : "",
    status,
    priority: pickEnum(r.priority, PRIORITIES) ?? "normal",
    permissionMode: pickEnum(r.permissionMode, PERMISSION_MODES) ?? "default",
    progress: clampInt(r.progress, 0, 100),
    tokensIn: clampInt(r.tokensIn, 0, Number.MAX_SAFE_INTEGER),
    tokensOut: clampInt(r.tokensOut, 0, Number.MAX_SAFE_INTEGER),
    costUsd: Math.max(0, Number(r.costUsd) || 0),
    createdAt,
    updatedAt: isoOrUndefined(r.updatedAt) ?? createdAt,
  }
  if (typeof r.error === "string" && r.error) task.error = r.error
  const startedAt = isoOrUndefined(r.startedAt)
  if (startedAt) task.startedAt = startedAt
  const pausedAt = isoOrUndefined(r.pausedAt)
  if (pausedAt) task.pausedAt = pausedAt
  const completedAt = isoOrUndefined(r.completedAt)
  if (completedAt) task.completedAt = completedAt
  return task
}

function sortNewestFirst(tasks: AgentTask[]): AgentTask[] {
  return tasks.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

async function readTasksFile(userId: string): Promise<AgentTask[]> {
  const filePath = resolveTasksFile(userId)
  let text: string
  try {
    text = await readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  try {
    const parsed = JSON.parse(text) as { tasks?: unknown }
    if (!parsed || !Array.isArray(parsed.tasks)) throw new Error("Malformed agent tasks file.")
    const tasks: AgentTask[] = []
    for (const raw of parsed.tasks) {
      const task = normalizeStoredTask(raw, userId)
      if (task) tasks.push(task)
    }
    return sortNewestFirst(tasks)
  } catch {
    await copyFile(filePath, `${filePath}.corrupt-${Date.now()}`).catch(() => undefined)
    return []
  }
}

async function writeTasksFile(userId: string, tasks: AgentTask[]): Promise<void> {
  const filePath = resolveTasksFile(userId)
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  const payload = { version: 1, updatedAt: new Date().toISOString(), tasks }
  await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  await rename(tmpPath, filePath)
}

const locksByUserId = new Map<string, Promise<unknown>>()

function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locksByUserId.get(userId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(fn)
  const tail = next.catch(() => undefined)
  locksByUserId.set(userId, tail)
  void tail.then(() => {
    if (locksByUserId.get(userId) === tail) locksByUserId.delete(userId)
  })
  return next
}

/**
 * Runs `fn` against the freshly loaded tasks under the user lock. If `fn`
 * changed, added or removed tasks, writes the file and then publishes events.
 * If `fn` throws, nothing is written or published.
 */
function transact<T>(
  rawUserId: string,
  fn: (tasks: AgentTask[]) => T,
): Promise<{ result: T; changed: AgentTask[] }> {
  const userId = sanitizeUserId(rawUserId)
  return withUserLock(userId, async () => {
    const tasks = await readTasksFile(userId)
    const before = new Map(tasks.map((t) => [t.id, JSON.stringify(t)]))
    const result = fn(tasks)

    const now = new Date().toISOString()
    const changed: AgentTask[] = []
    for (const task of tasks) {
      const prev = before.get(task.id)
      if (prev === JSON.stringify(task)) continue
      if (prev !== undefined && task.updatedAt === (JSON.parse(prev) as AgentTask).updatedAt) task.updatedAt = now
      changed.push(task)
    }
    const present = new Set(tasks.map((t) => t.id))
    const removed = [...before.keys()].filter((id) => !present.has(id))
    if (changed.length === 0 && removed.length === 0) return { result, changed }

    await writeTasksFile(userId, sortNewestFirst(tasks))
    for (const task of changed) publishTaskEvent(userId, { type: "task.upserted", task })
    for (const id of removed) publishTaskEvent(userId, { type: "task.deleted", id })
    return { result, changed }
  })
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
): Pick<AgentTask, "name" | "prompt" | "agent" | "model" | "priority" | "permissionMode"> {
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
  return {
    name,
    prompt,
    agent,
    model,
    priority: pickEnum(input?.priority, PRIORITIES) ?? "normal",
    permissionMode: pickEnum(input?.permissionMode, PERMISSION_MODES) ?? "default",
  }
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
  return (await transact(userId, (tasks) => tasks.map((t) => ({ ...t })))).result
}

export async function getTask(userId: string, id: string): Promise<AgentTask | null> {
  return (await transact(userId, (tasks) => tasks.find((t) => t.id === id) ?? null)).result
}

export async function createTask(userId: string, input: CreateAgentTaskInput): Promise<AgentTask> {
  const fields = validateCreateInput(input)
  const safeUserId = sanitizeUserId(userId)
  const now = new Date().toISOString()
  const task: AgentTask = {
    id: randomUUID(),
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
  const { result } = await transact(userId, (tasks) => {
    const index = tasks.findIndex((t) => t.id === id)
    if (index === -1) return false
    tasks.splice(index, 1)
    return true
  })
  return result
}

export async function getTaskStats(userId: string): Promise<AgentTaskStats> {
  return (await transact(userId, (tasks) => computeTaskStats(tasks))).result
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
