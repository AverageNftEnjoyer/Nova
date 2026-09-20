"use client"

import { useMemo } from "react"

import type { AgentTask, AgentTaskStatus, AgentTaskUiAction } from "@/lib/agents/types"
import { cn } from "@/lib/shared/utils"
import { TaskCard } from "./task-card"

interface TaskListProps {
  tasks: AgentTask[]
  isLight: boolean
  subPanelClass: string
  onAction: (taskId: string, action: AgentTaskUiAction) => Promise<void>
}

const GROUPS: readonly { label: string; statuses: readonly AgentTaskStatus[] }[] = [
  { label: "Running", statuses: ["running"] },
  { label: "Queued", statuses: ["queued", "paused"] },
  { label: "Completed", statuses: ["completed"] },
  { label: "Failed", statuses: ["failed", "cancelled"] },
]

export function TaskList({ tasks, isLight, subPanelClass, onAction }: TaskListProps) {
  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        label: group.label,
        tasks: tasks.filter((task) => group.statuses.includes(task.status)),
      })).filter((group) => group.tasks.length > 0),
    [tasks],
  )

  return (
    <div className={cn("min-h-0 flex-1 overflow-hidden rounded-[18px] border", subPanelClass)}>
      <div className="h-full space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3">
        {groups.map((group) => (
          <section key={group.label}>
            <h3 className={cn("mb-2 text-[11px] font-semibold uppercase tracking-wider", isLight ? "text-gray-700" : "text-slate-300")}>
              {group.label} ({group.tasks.length})
            </h3>
            <div className="space-y-2">
              {group.tasks.map((task) => (
                <TaskCard key={task.id} task={task} isLight={isLight} onAction={onAction} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
