/**
 * SIMULATED AGENT TASK RUNNER — NO REAL AGENT EXECUTES.
 *
 * Moves tasks through queued -> running -> completed/failed on a 1s timer so the
 * Agent Tasks UI behaves like a live system. The timer only exists while some task is
 * queued or running: it starts on register/create/resume/recovery (store activity hook)
 * and clears itself on the first tick that finds nothing active. Progress, tokens and cost are
 * synthetic. Phase 4 of the Phantom roadmap replaces this file with real agent
 * processes; the store, events and UI contracts stay the same.
 *
 * Permission mode is intentionally ignored here.
 */

import {
  computeTaskCostUsd,
  hasActiveTasks,
  mutateTasks,
  recoverInterruptedTasks,
  subscribeTaskActivity,
} from "./task-store"
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
  // Detaches the store activity hook (registered together with the first user)
  unsubscribeActivity: (() => void) | null
}

type RunnerGlobal = typeof globalThis & { __novaAgentTaskRunner?: RunnerState }

function getState(): RunnerState {
  const g = globalThis as RunnerGlobal
  if (!g.__novaAgentTaskRunner) g.__novaAgentTaskRunner = {
      timer: null,
      users: new Map(),
      ticking: new Set(),
      unsubscribeActivity: null,
    }
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

function safeHasActiveTasks(userId: string): boolean {
  try {
    return hasActiveTasks(userId)
  } catch {
    // If the probe fails, assume work exists so a transient error never strands a task.
    return true
  }
}

async function tickAllUsers(): Promise<void> {
  const state = getState()
  await Promise.all(
    [...state.users].map(async ([userId, ready]) => {
      if (state.ticking.has(userId)) return
      state.ticking.add(userId)
      try {
        await ready
        // Read-only probe first: an idle user costs no write transaction.
        if (safeHasActiveTasks(userId)) await tickTaskRunner(userId)
      } catch {
        // A failed tick is retried on the next interval.
      } finally {
        state.ticking.delete(userId)
      }
    }),
  )
  stopTimerIfIdle(state)
}

// Synchronous check-then-clear: any commit after this block sees `timer === null` and restarts it.
function stopTimerIfIdle(state: RunnerState): void {
  if (!state.timer || state.ticking.size > 0) return
  for (const userId of state.users.keys()) {
    if (safeHasActiveTasks(userId)) return
  }
  clearInterval(state.timer)
  state.timer = null
}

function startTimer(state: RunnerState): void {
  if (state.timer) return
  state.timer = setInterval(() => void tickAllUsers(), TICK_INTERVAL_MS)
  state.timer.unref?.()
}

export function ensureTaskRunnerStarted(userId: string): void {
  const state = getState()
  if (!state.unsubscribeActivity) {
    // Wake the timer when a create/resume/retry leaves work queued while the timer sleeps.
    state.unsubscribeActivity = subscribeTaskActivity((activeUserId) => {
      if (getState().timer) return
      ensureTaskRunnerStarted(activeUserId)
    })
  }
  if (!state.users.has(userId)) {
    // Recovery may re-queue interrupted tasks, so a newly seen user always gets one tick to look.
    state.users.set(userId, recoverInterruptedTasks(userId).catch(() => 0))
    startTimer(state)
    return
  }
  if (!state.timer && safeHasActiveTasks(userId)) startTimer(state)
}

export function stopTaskRunner(): void {
  const state = getState()
  if (state.timer) clearInterval(state.timer)
  state.timer = null
  state.unsubscribeActivity?.()
  state.unsubscribeActivity = null
  state.users.clear()
  state.ticking.clear()
}
