import type { AgentTask, AgentTaskStats } from "./types"

/** Pure so the server store and the client hook derive identical stats. "Today" is the local date. */
export function computeTaskStats(tasks: readonly AgentTask[], now: Date = new Date()): AgentTaskStats {
  const stats: AgentTaskStats = {
    queued: 0,
    running: 0,
    paused: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    totalCostTodayUsd: 0,
    totalTokensToday: 0,
  }
  const today = now.toDateString()
  for (const task of tasks) {
    stats[task.status] += 1
    if (new Date(task.updatedAt).toDateString() !== today) continue
    stats.totalCostTodayUsd += task.costUsd
    stats.totalTokensToday += task.tokensIn + task.tokensOut
  }
  return stats
}
