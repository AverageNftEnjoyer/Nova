"use client"

import { ArrowUpRight, Bot, Loader2, Plus } from "lucide-react"
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
  onOpenMissions: () => void
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
  onOpenMissions,
}: AgentTasksHomeModuleProps) {
  const { tasks, stats, loading, error, connection, createTask, runAction, raiseBudget } = useAgentTasks()
  const [createOpen, setCreateOpen] = useState(false)

  const handleAction = useCallback(
    async (taskId: string, action: AgentTaskUiAction) => {
      await runAction(taskId, action)
    },
    [runAction],
  )
  const closeCreate = useCallback(() => setCreateOpen(false), [])

  const running = stats?.running ?? 0
  const statItems = [
    { label: "Running", value: String(running), active: running > 0 },
    { label: "Queued", value: String((stats?.queued ?? 0) + (stats?.paused ?? 0)), active: false },
    { label: "Done", value: String(stats?.completed ?? 0), active: false },
    { label: "Today", value: formatCostToday(stats?.totalCostTodayUsd ?? 0), active: false },
  ]
  const mutedText = isLight ? "text-s-50" : "text-slate-400"
  const iconButtonClass = cn(
    "h-7 w-7 shrink-0 rounded-md transition-colors inline-flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
    subPanelClass,
  )
  const iconClass = cn("h-3.5 w-3.5", isLight ? "text-s-70" : "text-slate-300")

  return (
    <section style={panelStyle} className={cn(panelClass, "home-spotlight-shell px-3 py-2.5 flex flex-col min-h-0", className)}>
      <div className="grid grid-cols-[3.75rem_minmax(0,1fr)_3.75rem] items-center gap-2 shrink-0 text-s-80">
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
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => setCreateOpen(true)} title="Create task" aria-label="Create task" className={iconButtonClass}>
            <Plus className={iconClass} />
          </button>
          <button type="button" onClick={onOpenMissions} title="Open Mission Hub" aria-label="Open Mission Hub" className={iconButtonClass}>
            <ArrowUpRight className={iconClass} />
          </button>
        </div>
      </div>

      <div className="mt-2 grid shrink-0 grid-cols-4 gap-1.5">
        {statItems.map((item) => (
          <div
            key={item.label}
            className={cn("min-w-0 rounded-sm border px-2 py-1 text-center home-spotlight-card home-border-glow", subPanelClass)}
          >
            <p className={cn("truncate text-[9px] uppercase tracking-widest", mutedText)}>{item.label}</p>
            <p
              className={cn(
                "truncate text-[14px] font-semibold leading-tight tabular-nums",
                item.active ? (isLight ? "text-emerald-600" : "text-emerald-400") : isLight ? "text-s-90" : "text-slate-100",
              )}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>

      {error ? (
        <p className={cn("mt-2 shrink-0 text-[11px] leading-4", isLight ? "text-[#a53b3b]" : "text-rose-300")}>{error}</p>
      ) : null}

      <div className="mt-2 flex min-h-0 flex-1 flex-col">
        {loading ? (
          <div className={cn("flex flex-1 items-center justify-center gap-2 text-[12px]", mutedText)}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading tasks...
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <Bot className={cn("h-6 w-6", mutedText)} />
            <p className={cn("text-[12px] font-medium", isLight ? "text-s-80" : "text-slate-200")}>No tasks yet</p>
            <p className={cn("max-w-[18rem] text-[11px] leading-4", mutedText)}>
              Queue a job for an agent to run in the background. Automations live in the Mission Hub.
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover",
                  subPanelClass,
                  isLight ? "text-s-80" : "text-slate-200",
                )}
              >
                <Plus className="h-3 w-3" />
                New task
              </button>
              <button
                type="button"
                onClick={onOpenMissions}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors hover:text-accent",
                  mutedText,
                )}
              >
                Mission Hub
                <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        ) : (
          <>
            <TaskList
              tasks={tasks}
              isLight={isLight}
              subPanelClass={subPanelClass}
              onAction={handleAction}
              onRaiseBudget={raiseBudget}
            />
            <button
              type="button"
              onClick={onOpenMissions}
              className={cn(
                "mt-1.5 inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-md text-[10px] font-medium uppercase tracking-[0.12em] transition-colors hover:text-accent",
                mutedText,
              )}
            >
              Open Mission Hub
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </>
        )}
      </div>

      <CreateTaskModal open={createOpen} isLight={isLight} onClose={closeCreate} onCreate={createTask} />
    </section>
  )
}
