/**
 * SIMULATED AGENT TASK RUNNER — NO REAL AGENT EXECUTES.
 *
 * Moves tasks through queued -> running -> completed/failed on a 1s timer so the
 * Agent Tasks UI behaves like a live system. Progress, tokens and cost are
 * synthetic. Phase 4 of the Phantom roadmap replaces this file with real agent
 * processes; the store, events and UI contracts stay the same.
 *
 * Permission mode is intentionally ignored here.
 */

import { computeTaskCostUsd, mutateTasks, recoverInterruptedTasks } from "./task-store"
import { AGENT_TASK_MAX_CONCURRENT, type AgentTask, type AgentTaskPriority } from "./types"

export const SIM_FAIL_MARKER = "[sim:fail]"

const TICK_INTERVAL_MS = 1000
const PROGRESS_PER_TICK = 5
const SIM_FAIL_PROGRESS = 50
const TOKENS_IN_PER_TICK = 120
const TOKENS_OUT_PER_TICK = 60

const PRIORITY_RANK: Record<AgentTaskPriority, number> = { high: 0, normal: 1, low: 2 }

type RunnerState = {
  timer: ReturnType<typeof setInterval> | null
  // userId -> settles once startup recovery for that user has finished
  users: Map<string, Promise<unknown>>
  ticking: Set<string>
}

type RunnerGlobal = typeof globalThis & { __novaAgentTaskRunner?: RunnerState }

function getState(): RunnerState {
  const g = globalThis as RunnerGlobal
  if (!g.__novaAgentTaskRunner) g.__novaAgentTaskRunner = { timer: null, users: new Map(), ticking: new Set() }
  return g.__novaAgentTaskRunner
}

// Small per-task offset so cards don't advance tokens in lockstep.
function hashId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return Math.abs(hash)
}

function queueOrder(a: AgentTask, b: AgentTask): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || Date.parse(a.createdAt) - Date.parse(b.createdAt)
}

function advance(task: AgentTask, nowIso: string): void {
  const jitter = hashId(task.id)
  task.progress = Math.min(100, task.progress + PROGRESS_PER_TICK)
  task.tokensIn += TOKENS_IN_PER_TICK + (jitter % 40)
  task.tokensOut += TOKENS_OUT_PER_TICK + ((jitter >>> 8) % 20)
  task.costUsd = computeTaskCostUsd(task.model, task.tokensIn, task.tokensOut)

  if (task.prompt.includes(SIM_FAIL_MARKER) && task.progress >= SIM_FAIL_PROGRESS) {
    task.status = "failed"
    task.error = "Simulated failure"
    task.completedAt = nowIso
  } else if (task.progress >= 100) {
    task.status = "completed"
    task.completedAt = nowIso
  }
}

export async function tickTaskRunner(userId: string, nowMs: number = Date.now()): Promise<void> {
  const nowIso = new Date(nowMs).toISOString()
  await mutateTasks(userId, (tasks) => {
    let running = tasks.filter((t) => t.status === "running").length
    const queued = tasks.filter((t) => t.status === "queued").sort(queueOrder)
    for (const task of queued) {
      if (running >= AGENT_TASK_MAX_CONCURRENT) break
      task.status = "running"
      task.startedAt ??= nowIso
      running += 1
    }
    for (const task of tasks) {
      if (task.status === "running") advance(task, nowIso)
    }
  })
}

async function tickAllUsers(): Promise<void> {
  const state = getState()
  await Promise.all(
    [...state.users].map(async ([userId, ready]) => {
      if (state.ticking.has(userId)) return
      state.ticking.add(userId)
      try {
        await ready
        await tickTaskRunner(userId)
      } catch {
        // A failed tick is retried on the next interval.
      } finally {
        state.ticking.delete(userId)
      }
    }),
  )
}

export function ensureTaskRunnerStarted(userId: string): void {
  const state = getState()
  if (!state.users.has(userId)) {
    state.users.set(userId, recoverInterruptedTasks(userId).catch(() => 0))
  }
  if (state.timer) return
  state.timer = setInterval(() => void tickAllUsers(), TICK_INTERVAL_MS)
  state.timer.unref?.()
}

export function stopTaskRunner(): void {
  const state = getState()
  if (state.timer) clearInterval(state.timer)
  state.timer = null
  state.users.clear()
  state.ticking.clear()
}
