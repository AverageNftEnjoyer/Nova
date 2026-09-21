import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"
import { listTasks } from "@/lib/agents/task-store"
import { loadMissions } from "@/lib/missions/store"
import { resolveModelPricing } from "@/app/integrations/constants/pricing"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface DailyStats {
  date: string
  totalTasks: number
  successfulTasks: number
  failedTasks: number
  totalCost: number
}

interface ModelStats {
  model: string
  provider: string
  taskCount: number
  tokensIn: number
  tokensOut: number
  totalCost: number
}

interface AnalyticsData {
  totalTasks: number
  totalCost: number
  successRate: number
  averageCostPerTask: number
  totalTokensIn: number
  totalTokensOut: number
  byModel: ModelStats[]
  byProvider: Record<string, {
    taskCount: number
    totalCost: number
    successCount: number
  }>
  timeline: DailyStats[]
  recentTasks: number
  todayTasks: number
  weekTasks: number
  monthTasks: number
}

function getDateKey(isoString: string): string {
  return isoString.split("T")[0] || ""
}

function getDaysAgo(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(0, 0, 0, 0)
  return date
}

export async function GET() {
  try {
    const { userId } = await requireLocalUser()
    const tasks = await listTasks(userId)

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekAgo = getDaysAgo(7)
    const monthAgo = getDaysAgo(30)

    let totalCost = 0
    let totalTokensIn = 0
    let totalTokensOut = 0
    let successCount = 0
    let todayCount = 0
    let weekCount = 0
    let monthCount = 0

    const modelMap = new Map<string, ModelStats>()
    const providerMap = new Map<string, { taskCount: number; totalCost: number; successCount: number }>()
    const timelineMap = new Map<string, DailyStats>()

    for (const task of tasks) {
      const taskDate = new Date(task.createdAt)
      const dateKey = getDateKey(task.createdAt)

      // Total stats
      totalCost += task.costUsd
      totalTokensIn += task.tokensIn
      totalTokensOut += task.tokensOut

      if (task.status === "completed") {
        successCount++
      }

      // Time range counts
      if (taskDate >= today) todayCount++
      if (taskDate >= weekAgo) weekCount++
      if (taskDate >= monthAgo) monthCount++

      // By model
      const modelKey = `${task.agent}:${task.model}`
      if (!modelMap.has(modelKey)) {
        modelMap.set(modelKey, {
          model: task.model,
          provider: task.agent,
          taskCount: 0,
          tokensIn: 0,
          tokensOut: 0,
          totalCost: 0,
        })
      }
      const modelStats = modelMap.get(modelKey)!
      modelStats.taskCount++
      modelStats.tokensIn += task.tokensIn
      modelStats.tokensOut += task.tokensOut
      modelStats.totalCost += task.costUsd

      // By provider
      if (!providerMap.has(task.agent)) {
        providerMap.set(task.agent, { taskCount: 0, totalCost: 0, successCount: 0 })
      }
      const providerStats = providerMap.get(task.agent)!
      providerStats.taskCount++
      providerStats.totalCost += task.costUsd
      if (task.status === "completed") {
        providerStats.successCount++
      }

      // Timeline (last 30 days)
      if (taskDate >= monthAgo) {
        if (!timelineMap.has(dateKey)) {
          timelineMap.set(dateKey, {
            date: dateKey,
            totalTasks: 0,
            successfulTasks: 0,
            failedTasks: 0,
            totalCost: 0,
          })
        }
        const dayStats = timelineMap.get(dateKey)!
        dayStats.totalTasks++
        if (task.status === "completed") {
          dayStats.successfulTasks++
        } else if (task.status === "failed") {
          dayStats.failedTasks++
        }
        dayStats.totalCost += task.costUsd
      }
    }

    const successRate = tasks.length > 0 ? (successCount / tasks.length) * 100 : 0
    const averageCostPerTask = tasks.length > 0 ? totalCost / tasks.length : 0

    const byModel = Array.from(modelMap.values()).sort((a, b) => b.totalCost - a.totalCost)

    const byProvider = Object.fromEntries(providerMap)

    // Fill timeline with missing dates (last 30 days)
    const timeline: DailyStats[] = []
    for (let i = 29; i >= 0; i--) {
      const date = getDaysAgo(i)
      const dateKey = getDateKey(date.toISOString())
      timeline.push(
        timelineMap.get(dateKey) || {
          date: dateKey,
          totalTasks: 0,
          successfulTasks: 0,
          failedTasks: 0,
          totalCost: 0,
        },
      )
    }

    const analytics: AnalyticsData = {
      totalTasks: tasks.length,
      totalCost,
      successRate,
      averageCostPerTask,
      totalTokensIn,
      totalTokensOut,
      byModel,
      byProvider,
      timeline,
      recentTasks: tasks.slice(0, 10).length,
      todayTasks: todayCount,
      weekTasks: weekCount,
      monthTasks: monthCount,
    }

    return NextResponse.json({ ok: true, analytics })
  } catch (error) {
    console.error("Analytics error:", error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load analytics" },
      { status: 500 },
    )
  }
}
