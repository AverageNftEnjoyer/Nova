"use client"

import { Bot, Loader2, Plus } from "lucide-react"
import { useCallback, useState, type CSSProperties } from "react"

import { CreateTaskModal } from "@/components/agents/create-task-modal"
import { TaskList } from "@/components/agents/task-list"
import type { AgentTaskUiAction } from "@/lib/agents/types"
import { cn } from "@/lib/shared/utils"
import { useAgentTasks } from "../hooks/use-agent-tasks"

interface AgentTasksHomeModuleProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle: CSSProperties | undefined
  className?: string
}

function formatCostToday(cost: number): string {
  if (cost > 0 && cost < 0.01) return "<$0.01"
  return `$${cost.toFixed(2)}`
}

export function AgentTasksHomeModule({
  isLight,
  panelClass,
  subPanelClass,
  panelStyle,
  className,
}: AgentTasksHomeModuleProps) {
  const { tasks, stats, loading, error, connection, createTask, runAction } = useAgentTasks()
  const [createOpen, setCreateOpen] = useState(false)

  const handleAction = useCallback(
    async (taskId: string, action: AgentTaskUiAction) => {
      await runAction(taskId, action)
    },
    [runAction],
  )
  const closeCreate = useCallback(() => setCreateOpen(false), [])

  const statItems = [
    { label: "Running", value: String(stats?.running ?? 0) },
    { label: "Queued", value: String((stats?.queued ?? 0) + (stats?.paused ?? 0)) },
    { label: "Done", value: String(stats?.completed ?? 0) },
    { label: "Today", value: formatCostToday(stats?.totalCostTodayUsd ?? 0) },
  ]
  const mutedText = isLight ? "text-s-60" : "text-slate-400"

  return (
    <section style={panelStyle} className={cn(panelClass, "home-spotlight-shell px-3 py-2.5 flex flex-col min-h-0", className)}>
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center gap-2 text-s-80">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-accent" />
        </div>
        <h2 className={cn("flex min-w-0 items-center justify-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] whitespace-nowrap", isLight ? "text-s-90" : "text-slate-200")}>
          Agent Tasks
          <span
            title={connection === "live" ? "Live updates" : "Polling for updates"}
            className={cn("h-1.5 w-1.5 rounded-full", connection === "live" ? "bg-emerald-500" : "bg-yellow-500")}
          />
        </h2>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          title="Create task"
          aria-label="Create task"
          className={cn("flex h-7 w-7 items-center justify-center rounded-lg transition-colors", isLight ? "text-s-70 hover:bg-black/5" : "text-slate-300 hover:bg-white/10")}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className={cn("mt-2 grid grid-cols-4 gap-2 rounded-lg px-3 py-2 text-center text-xs", isLight ? "bg-black/5" : "bg-white/5")}>
        {statItems.map((item) => (
          <div key={item.label} className="min-w-0">
            <div className={cn("truncate font-semibold tabular-nums", isLight ? "text-s-90" : "text-white")}>{item.value}</div>
            <div className={mutedText}>{item.label}</div>
          </div>
        ))}
      </div>

      {error ? <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-500">{error}</p> : null}

      <div className="mt-2 flex min-h-0 flex-1 flex-col">
        {loading ? (
          <div className={cn("flex flex-1 items-center justify-center gap-2 rounded-[18px] border text-sm", subPanelClass, mutedText)}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading tasks...
          </div>
        ) : tasks.length === 0 ? (
          <div className={cn("flex flex-1 items-center justify-center rounded-[18px] border px-4 text-center text-sm", subPanelClass, mutedText)}>
            No tasks yet. Click + to create one.
          </div>
        ) : (
          <TaskList tasks={tasks} isLight={isLight} subPanelClass={subPanelClass} onAction={handleAction} />
        )}
      </div>

      <CreateTaskModal open={createOpen} isLight={isLight} onClose={closeCreate} onCreate={createTask} />
    </section>
  )
}
