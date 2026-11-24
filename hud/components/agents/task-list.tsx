"use client"

import { useMemo } from "react"

import type { AgentTask, AgentTaskStatus, AgentTaskUiAction } from "@/lib/agents/types"
import { cn } from "@/lib/shared/utils"
import { TaskCard, type RaiseTaskBudgetHandler } from "./task-card"

interface TaskListProps {
  tasks: AgentTask[]
  isLight: boolean
  subPanelClass: string
  onAction: (taskId: string, action: AgentTaskUiAction) => Promise<void>
  onRaiseBudget: RaiseTaskBudgetHandler
}

const GROUPS: readonly { label: string; statuses: readonly AgentTaskStatus[] }[] = [
  { label: "Running", statuses: ["running"] },
  { label: "Queued", statuses: ["queued", "paused"] },
  { label: "Completed", statuses: ["completed"] },
  { label: "Failed", statuses: ["failed", "cancelled"] },
]

export function TaskList({ tasks, isLight, subPanelClass, onAction, onRaiseBudget }: TaskListProps) {
  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        label: group.label,
        tasks: tasks.filter((task) => group.statuses.includes(task.status)),
      })).filter((group) => group.tasks.length > 0),
    [tasks],
  )

  return (
    <div className="module-hover-scroll no-scrollbar min-h-0 flex-1 space-y-2.5 overflow-y-auto overflow-x-hidden pr-0.5">
      {groups.map((group) => (
        <section key={group.label}>
          <h3 className={cn("mb-1 px-0.5 text-[9px] font-semibold uppercase tracking-widest", isLight ? "text-s-50" : "text-slate-400")}>
            {group.label} <span className="tabular-nums">({group.tasks.length})</span>
          </h3>
          <div className="space-y-1.5">
            {group.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                isLight={isLight}
                subPanelClass={subPanelClass}
                onAction={onAction}
                onRaiseBudget={onRaiseBudget}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
